import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { describe, expect, it } from 'vitest';
import { machines } from '../../api/src/db/schema.js';
import { rateSubtask, transitionTicket } from '../../api/src/services/ticket-service.js';
import { homePaths } from '../src/config.js';
import { rolePlanner } from '../src/roles/role-planner.js';
import { jobTmpDir } from '../src/runner/job-cleanup.js';
import { defaultPlanner } from '../src/runner/job-runner.js';
import { ResourceTracker } from '../src/runner/resource-tracker.js';
import { StateDb } from '../src/state-db.js';
import {
  clearRating,
  commentsOf,
  devTicket,
  fixture,
  getTicket,
  ownerComment,
  ownerTransition,
  pmTask,
  RATED,
  useApi,
} from './helpers/api.js';
import { makeDaemon, sleep, waitFor } from './helpers/daemon.js';
import { makeRepo, onCleanup } from './helpers/git.js';

const api = useApi();

const tool = (name: string, input: Record<string, unknown> = {}) => ({
  tool: `mcp__tickets__${name}`,
  input,
});

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const SERVER_JS = (port: number) =>
  `require('node:http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1');\n`;

describe('daemon', () => {
  it('stops what a job started when it ends and leaves untagged processes alone', async () => {
    expect(await portOpen(4321)).toBe(false);
    const f = await fixture(api);
    const repo = makeRepo();
    // The owner's own dev server on another port, without a job tag.
    const own = spawn(process.execPath, ['-e', SERVER_JS(4322)], { stdio: 'ignore', detached: true });
    onCleanup(() => {
      if (own.pid && alive(own.pid)) process.kill(own.pid, 'SIGKILL');
    });
    await waitFor(() => portOpen(4322), 5_000, 'owner server');

    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Chạy server');
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { write: { path: 'server.js', content: SERVER_JS(4321) } },
        { bash: 'nohup node server.js > /dev/null 2>&1 &' },
        {
          bash: 'head -c 200000 /dev/zero > "$TMPDIR/scratch.bin" && mkdir -p "$TMPDIR/cache" && echo x > "$TMPDIR/cache/a"',
        },
        { sleep: 700 },
        tool('comment', { body: 'Đã chạy thử server.' }),
      ],
    });
    await t.daemon.start();

    const job = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'running'),
      15_000,
      'dev job running',
    );
    await waitFor(() => portOpen(4321), 10_000, 'job server listening');
    const ended = Date.now();
    const done = await waitFor(
      () =>
        t.daemon.state
          .jobsForTicket(dev.id)
          .find((j) => j.status === 'done' && t.daemon.state.cleanups({ jobId: j.id }).length > 0),
      15_000,
      'job done and cleaned',
    );
    expect(Date.now() - ended).toBeLessThan(15_000);
    expect(done.id).toBe(job.id);
    expect(await portOpen(4321)).toBe(false);
    expect(existsSync(jobTmpDir(homePaths(t.home).tmp, job.id))).toBe(false);
    const [record] = t.daemon.state.cleanups({ jobId: job.id });
    expect(record?.ports).toContain(4321);
    expect(record?.pids.length).toBeGreaterThan(0);
    expect(record?.bytesFreed).toBeGreaterThanOrEqual(200_000);
    for (const pid of record?.pids ?? []) expect(alive(pid)).toBe(false);
    // The owner's untagged process is untouched.
    expect(own.pid && alive(own.pid)).toBe(true);
    expect(await portOpen(4322)).toBe(true);
    expect((await commentsOf(api.db, dev.id)).map((c) => c.body)).toContain('Đã chạy thử server.');
    await t.daemon.stop();
  });

  it('survives a crash mid-run: no event lost, one active job per ticket, no duplicate records', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const first = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Việc bị gián đoạn');
    let crashes = 0;
    const script = () => ({
      steps: [
        tool('comment', { body: 'Bước 1' }),
        crashes++ === 0 ? { crash: true as const } : { sleep: 0 },
        tool('comment', { body: 'Bước 2' }),
      ],
    });
    first.book.byTicket.set(dev.id, script);
    await first.daemon.start();
    await waitFor(
      async () => (await commentsOf(api.db, dev.id)).length >= 1 && crashes >= 1,
      15_000,
      'first step',
    );
    await sleep(200);
    // The daemon dies here: the job stays "running" in the state DB.
    await first.daemon.halt();

    // While it is down, more work arrives for this machine.
    const other = await devTicket(api, pm.id, 'Việc mới khi daemon tắt');

    const second = makeDaemon(f, { repoPath: repo, home: first.home, book: first.book });
    second.book.byTicket.set(other.id, { steps: [tool('comment', { body: 'Việc mới đã nhận' })] });
    await second.daemon.start();
    await waitFor(
      () => second.daemon.state.jobsForTicket(dev.id).some((j) => j.status === 'done'),
      15_000,
      'resumed job done',
    );
    await waitFor(
      () => second.daemon.state.jobsForTicket(other.id).some((j) => j.status === 'done'),
      15_000,
      'new job done',
    );

    const bodies = (await commentsOf(api.db, dev.id)).map((c) => c.body);
    expect(bodies.filter((b) => b === 'Bước 1')).toHaveLength(1);
    expect(bodies.filter((b) => b === 'Bước 2')).toHaveLength(1);
    expect((await commentsOf(api.db, other.id)).map((c) => c.body)).toEqual(['Việc mới đã nhận']);
    // The resumed run continued the same session with the restart prompt.
    const resumed = second.book.runs.filter((run) => run.ticketId === dev.id).at(-1);
    expect(resumed?.resumeSessionId).toBeTruthy();
    expect(resumed?.prompt).toContain('git status');
    for (const ticket of [dev.id, other.id, pm.id]) {
      expect(
        second.daemon.state
          .jobsForTicket(ticket)
          .filter((j) => ['queued', 'running', 'backoff'].includes(j.status)).length,
      ).toBeLessThanOrEqual(1);
    }
    await second.daemon.stop();
  });

  it('reports a job that crashes before its agent runs on the ticket, blocks it, and runs it again after the unblock', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    let crashFor = '';
    const t = makeDaemon(f, {
      repoPath: repo,
      extra: {
        planner: {
          ...defaultPlanner,
          plan: async (input) => {
            if (input.detail.ticket.id === crashFor) {
              crashFor = '';
              throw Object.assign(
                new Error("ENOENT: no such file or directory, open '/app/out/main/prompts/dev.md'"),
                { code: 'ENOENT' },
              );
            }
            return defaultPlanner.plan(input);
          },
        },
      },
    });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Việc gặp lỗi khi chuẩn bị');
    crashFor = dev.id;
    await transitionTicket(api.db, { ticketId: dev.id, to: 'in_progress', actor: 'agent' });
    t.book.byTicket.set(dev.id, { steps: [tool('comment', { body: 'Chạy lại được rồi' })] });
    await t.daemon.start();

    await waitFor(
      async () => (await getTicket(api.db, dev.id)).status === 'blocked',
      15_000,
      'ticket blocked',
    );
    const [notice] = (await commentsOf(api.db, dev.id)).map((c) => c.body);
    expect(notice).toContain('Job gặp lỗi');
    expect(notice).toContain('Error ENOENT');
    expect(notice).toContain('prompts/dev.md');
    expect(t.book.runs.filter((run) => run.ticketId === dev.id)).toHaveLength(0);
    const [failed] = t.daemon.state.jobsForTicket(dev.id);
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringContaining('Error ENOENT') });

    // The failure is the ticket's agent activity until a new job starts, reported without waiting for
    // the next timed heartbeat (the test timer is a minute).
    const failedJobs = async () => (await api.db.select().from(machines))[0]?.failedJobs ?? [];
    await waitFor(async () => (await failedJobs()).length === 1, 5_000, 'failure reported');
    expect(await failedJobs()).toEqual([
      expect.objectContaining({ ticketId: dev.id, error: expect.stringContaining('ENOENT') }),
    ]);

    await ownerTransition(f, dev.id, 'in_progress');
    await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).some((j) => j.status === 'done'),
      15_000,
      'job after the unblock done',
    );
    expect((await commentsOf(api.db, dev.id)).map((c) => c.body)).toContain('Chạy lại được rồi');
    await waitFor(async () => (await failedJobs()).length === 0, 5_000, 'failure cleared');
    await t.daemon.stop();
  });

  it('blocks a dev ticket without the PM rating through the crash path, and reruns it once the PM rates it', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo, extra: { planner: rolePlanner } });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Việc tạo trước khi bắt buộc đánh giá');
    // A ticket created before the rating was required.
    await clearRating(api.db, dev.id);
    await transitionTicket(api.db, { ticketId: dev.id, to: 'in_progress', actor: 'agent' });
    await t.daemon.start();

    await waitFor(
      async () => (await getTicket(api.db, dev.id)).status === 'blocked',
      15_000,
      'ticket blocked',
    );
    const [notice] = (await commentsOf(api.db, dev.id)).map((c) => c.body);
    expect(notice).toContain('chưa được PM đánh giá độ phức tạp');
    expect(notice).toContain('không có model mặc định cho dev và QC');
    expect(t.book.runs.filter((run) => run.ticketId === dev.id)).toHaveLength(0);
    expect(notice).toContain('rate_subtask');
    const [failed] = t.daemon.state.jobsForTicket(dev.id);
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringContaining('MissingComplexity') });

    // The PM rates it in place: the server moves it back to in_progress and the daemon runs it on the
    // model of the new rating, without the owner.
    t.book.byTicket.set(dev.id, { steps: [tool('comment', { body: 'Chạy theo mức mới' })] });
    await rateSubtask(api.db, pm.id, {
      ticket: dev.key,
      complexity: 'large',
      complexityReason: 'Đổi lõi tính giá ở nhiều module',
    });
    await waitFor(
      () => t.book.runs.some((run) => run.ticketId === dev.id),
      15_000,
      'agent run after the rating',
    );
    expect(t.book.runs.find((run) => run.ticketId === dev.id)?.model).toBe('opus');
    const rerun = await waitFor(
      () =>
        t.daemon.state
          .jobsForTicket(dev.id)
          .find((j) => j.id !== failed?.id && !['queued', 'running'].includes(j.status)),
      15_000,
      'job after the rating finished',
    );
    expect(rerun).toMatchObject({
      kind: 'agent',
      trigger: 'ticket.unblocked',
      model: 'opus',
      effort: 'high',
    });
    await t.daemon.stop();
  });

  it('starts a QC job right after dependency.resolved and resumes a session on an owner comment', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, {
      repoPath: repo,
      config: { resources: { maxConcurrentJobs: 2, minFreeMemGb: 0, maxLoadPerCpu: 64 } },
    });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Tính năng');
    const { createSubtask } = await import('../../api/src/services/ticket-service.js');
    const qc = await createSubtask(api.db, {
      type: 'qc',
      ...RATED,
      parentId: pm.id,
      title: 'QC tính năng',
      pairsWith: dev.id,
    });
    let release = false;
    t.book.byTicket.set(dev.id, () => ({
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { sleep: release ? 0 : 400 },
        tool('submit_report', { summaryMd: 'Xong tính năng.' }),
        tool('update_status', { to: 'done' }),
      ],
    }));
    t.book.byTicket.set(qc.id, { steps: [tool('comment', { body: 'QC bắt đầu' })] });
    await t.daemon.start();
    await waitFor(() => t.daemon.state.activeJob(qc.id)?.waitingDeps, 15_000, 'qc waiting on dev');
    release = true;
    const devDone = await waitFor(
      async () => (await getTicket(api.db, dev.id)).status === 'done',
      15_000,
      'dev done',
    );
    expect(devDone).toBe(true);
    const started = Date.now();
    await waitFor(
      async () => (await commentsOf(api.db, qc.id)).some((c) => c.body === 'QC bắt đầu'),
      15_000,
      'qc ran',
    );
    expect(Date.now() - started).toBeLessThan(60_000);
    const devReport = await (await import('../../api/src/services/report-service.js')).getCurrentReport(
      api.db,
      dev.id,
    );
    expect(devReport).toMatchObject({ summaryMd: 'Xong tính năng.', costUsd: 0 });

    // Owner reopens and comments: the dev session is resumed.
    t.book.byTicket.set(dev.id, { steps: [tool('comment', { body: 'Đã đọc góp ý' })] });
    const sessionBefore = t.daemon.state.jobsForTicket(dev.id)[0]?.sessionId;
    expect(sessionBefore).toBeTruthy();
    const replies = async () =>
      (await commentsOf(api.db, dev.id)).filter((c) => c.body === 'Đã đọc góp ý').length;
    await ownerTransition(f, dev.id, 'in_progress');
    await waitFor(async () => (await replies()) === 1, 15_000, 'reopened dev');
    await waitFor(() => !t.daemon.state.activeJob(dev.id), 15_000, 'reopened run ended');
    await ownerComment(f, dev.id, 'Sửa thêm giúp tôi');
    await waitFor(async () => (await replies()) === 2, 15_000, 'resumed dev');
    const devRuns = t.book.runs.filter((run) => run.ticketId === dev.id);
    expect(devRuns.slice(-2).map((run) => run.resumeSessionId)).toEqual([sessionBefore, sessionBefore]);
    await t.daemon.stop();
  });

  it('parks a rate-limited run in backoff with a growing retry_at, then blocks after 4 attempts', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Bị giới hạn');
    t.book.byTicket.set(dev.id, {
      steps: [tool('update_status', { to: 'in_progress' }), { apiError: 'rate_limit' }],
      result: { costUsd: 0.01 },
    });
    await t.daemon.start();
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const job = await waitFor(
        () =>
          t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'backoff' && j.attempts === attempt),
        15_000,
        `backoff ${attempt}`,
      );
      delays.push(
        Math.round(
          (Date.parse(job.retryAt as string) - Date.parse(job.endedAt ?? job.startedAt ?? '')) / 60_000,
        ),
      );
      // Time passes: make the retry due now.
      t.daemon.state.updateJob(job.id, { retryAt: new Date(Date.now() - 1000).toISOString() });
    }
    const blocked = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'blocked'),
      15_000,
      'blocked',
    );
    expect(blocked.attempts).toBe(4);
    expect(delays).toEqual([5, 10, 20]);
    expect(t.daemon.state.jobsForTicket(dev.id)).toHaveLength(1);
    expect((await getTicket(api.db, dev.id)).status).toBe('blocked');
    const bodies = (await commentsOf(api.db, dev.id)).map((c) => c.body);
    expect(bodies.filter((b) => b.includes('rate_limit'))).toHaveLength(4);
    // One session, cumulative cost booked once per run.
    expect((await getTicket(api.db, dev.id)).costUsd).toBeCloseTo(0.04, 5);
    await t.daemon.stop();
  });

  it('aborts a running job when its ticket is cancelled and removes its worktree', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Sẽ bị huỷ');
    t.book.byTicket.set(dev.id, { steps: [tool('update_status', { to: 'in_progress' }), { sleep: 30_000 }] });
    await t.daemon.start();
    const running = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'running' && j.worktree),
      15_000,
      'running',
    );
    await waitFor(
      async () => (await getTicket(api.db, dev.id)).status === 'in_progress',
      10_000,
      'in progress',
    );
    expect(existsSync(running.worktree as string)).toBe(true);
    await ownerTransition(f, dev.id, 'cancelled');
    const cancelled = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'cancelled'),
      10_000,
      'cancelled',
    );
    expect(cancelled.id).toBe(running.id);
    await waitFor(() => !existsSync(running.worktree as string), 10_000, 'worktree removed');
    expect(t.daemon.state.cleanups({ jobId: running.id })).toHaveLength(1);
    await t.daemon.stop();
  });

  it('re-queues running jobs on a graceful stop and resumes them on the next start', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Dừng êm');
    t.book.byTicket.set(dev.id, {
      steps: [tool('comment', { body: 'Một' }), { sleep: 30_000 }, tool('comment', { body: 'Hai' })],
    });
    await t.daemon.start();
    await waitFor(async () => (await commentsOf(api.db, dev.id)).length === 1, 15_000, 'first comment');
    await t.daemon.stop();
    const closed = new StateDb(homePaths(t.home).stateDb);
    const [job] = closed.jobsForTicket(dev.id);
    closed.close();
    expect(job).toMatchObject({ status: 'queued', resumeMode: 'restart_resume' });

    const again = makeDaemon(f, { repoPath: repo, home: t.home, book: t.book });
    t.book.byTicket.set(dev.id, {
      steps: [tool('comment', { body: 'Một' }), { sleep: 0 }, tool('comment', { body: 'Hai' })],
    });
    await again.daemon.start();
    await waitFor(
      async () => (await commentsOf(api.db, dev.id)).some((c) => c.body === 'Hai'),
      15_000,
      'resumed',
    );
    expect((await commentsOf(api.db, dev.id)).map((c) => c.body)).toEqual(['Một', 'Hai']);
    await again.daemon.stop();
    // Every job temp dir was cleaned, so the stop dropped the empty temp root too.
    expect(existsSync(homePaths(t.home).tmp)).toBe(false);
  });
});

/** No process tagged with this job's id is still alive (by `ResourceTracker`, like `resources.test.ts`). */
async function noTaggedProcessLeft(jobId: string): Promise<void> {
  const tracker = new ResourceTracker({ dockerBin: null });
  await waitFor(
    () => tracker.jobProcesses().every((p) => p.jobId !== jobId),
    5_000,
    `process tagged with job ${jobId} gone`,
  );
}

describe('background tasks (scripted runner)', () => {
  it('keeps a background command alive across a turn boundary and finishes the same job once notified', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Chạy lệnh nền rồi tiếp tục');
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { bgBash: { id: 'build', command: 'sleep 0.2 && true' } },
        { endTurn: true },
        tool('comment', { body: 'Lệnh nền đã xong, tiếp tục việc.' }),
        tool('submit_report', { summaryMd: 'Xong sau khi lệnh nền kết thúc.' }),
        tool('update_status', { to: 'done' }),
      ],
    });
    await t.daemon.start();
    await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done'),
      15_000,
      'dev job done',
    );
    // One job, one session, carried both turns: no retry, no second agent job.
    const jobs = t.daemon.state.jobsForTicket(dev.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'done' });
    expect((await getTicket(api.db, dev.id)).status).toBe('done');
    expect((await commentsOf(api.db, dev.id)).map((c) => c.body)).toContain(
      'Lệnh nền đã xong, tiếp tục việc.',
    );
    await t.daemon.stop();
  });

  it('reminds once when a background command never ends, then closes the job without hanging and kills it', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    // A ceiling small enough for a fast test: the reminder, then the close, both fire almost at once.
    const t = makeDaemon(f, { repoPath: repo, config: { backgroundWaitMinutes: 0.001 } });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Lệnh nền không bao giờ xong');
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { bgBash: { id: 'forever', command: 'sleep 999999' } },
      ],
    });
    await t.daemon.start();
    const running = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'running' && j.pgid),
      15_000,
      'background command running',
    );
    const pid = running.pgid as number;
    expect(alive(pid)).toBe(true);
    const done = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done'),
      15_000,
      'job ends after the reminder instead of hanging',
    );
    expect(done.id).toBe(running.id);
    expect(alive(pid)).toBe(false);
    await t.daemon.stop();
  });

  it('ends the job via ask_owner while a background command is alive, and stops it', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Cần hỏi chủ dự án trong lúc có lệnh nền');
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { bgBash: { id: 'server', command: 'sleep 999999' } },
        tool('ask_owner', { question: 'Có cần thêm bước xác thực không?' }),
      ],
    });
    await t.daemon.start();
    const job = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done'),
      15_000,
      'job done',
    );
    expect((await getTicket(api.db, dev.id)).status).toBe('needs_input');
    await noTaggedProcessLeft(job.id);
    await t.daemon.stop();
  });

  it('ends the job via handoff_docs while a background command is alive, and stops it', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Bàn giao docs trong lúc có lệnh nền');
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { bgBash: { id: 'server', command: 'sleep 999999' } },
        tool('handoff_docs', { summaryMd: 'Đã xong phần code.', files: [], tests: [], flows: [] }),
      ],
    });
    await t.daemon.start();
    const job = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done'),
      15_000,
      'job done',
    );
    // handoff_docs leaves the ticket in_progress (a docs job picks it up next in the real role workflow).
    expect((await getTicket(api.db, dev.id)).status).toBe('in_progress');
    await noTaggedProcessLeft(job.id);
    await t.daemon.stop();
  });

  it('cancels the job while a background command is alive, and stops it', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Sẽ bị huỷ trong lúc có lệnh nền');
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { bgBash: { id: 'server', command: 'sleep 999999' } },
        { sleep: 30_000 },
      ],
    });
    await t.daemon.start();
    const running = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'running' && j.worktree),
      15_000,
      'running',
    );
    await waitFor(
      async () => (await getTicket(api.db, dev.id)).status === 'in_progress',
      10_000,
      'in progress',
    );
    await ownerTransition(f, dev.id, 'cancelled');
    const cancelled = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'cancelled'),
      10_000,
      'cancelled',
    );
    expect(cancelled.id).toBe(running.id);
    await noTaggedProcessLeft(cancelled.id);
    await t.daemon.stop();
  });

  it('fails the job on a budget error while a background command is alive, blocks the ticket, and stops it', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Vượt ngân sách trong lúc có lệnh nền');
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { bgBash: { id: 'server', command: 'sleep 999999' } },
        { apiError: 'error_max_budget_usd' },
      ],
    });
    await t.daemon.start();
    const failed = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'failed'),
      15_000,
      'job failed on the budget error',
    );
    expect(failed.error).toBe('error_max_budget_usd');
    await waitFor(
      async () => (await getTicket(api.db, dev.id)).status === 'blocked',
      10_000,
      'ticket blocked',
    );
    await noTaggedProcessLeft(failed.id);
    await t.daemon.stop();
  });

  it('re-queues the job on a graceful stop while a background command is alive, and stops it', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Dừng êm trong lúc có lệnh nền');
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('comment', { body: 'Một' }),
        { bgBash: { id: 'server', command: 'sleep 999999' } },
        { sleep: 30_000 },
        tool('comment', { body: 'Hai' }),
      ],
    });
    await t.daemon.start();
    await waitFor(async () => (await commentsOf(api.db, dev.id)).length === 1, 15_000, 'first comment');
    const [running] = t.daemon.state.jobsForTicket(dev.id);
    await t.daemon.stop();
    const closed = new StateDb(homePaths(t.home).stateDb);
    const [job] = closed.jobsForTicket(dev.id);
    closed.close();
    expect(job).toMatchObject({ status: 'queued', resumeMode: 'restart_resume' });
    await noTaggedProcessLeft(running?.id as string);
  });

  it('ends a QC job at once when it closes the ticket while its own background dev server is still running', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Tính năng đã xong');
    const { createSubtask } = await import('../../api/src/services/ticket-service.js');
    const qc = await createSubtask(api.db, {
      type: 'qc',
      ...RATED,
      parentId: pm.id,
      title: 'QC: dev server nền',
      pairsWith: dev.id,
    });
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        tool('submit_report', { summaryMd: 'Xong.' }),
        tool('update_status', { to: 'done' }),
      ],
    });
    t.book.byTicket.set(qc.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { bgBash: { id: 'devserver', command: 'sleep 999999' } },
        tool('submit_report', { summaryMd: 'Đạt: dev server nền chạy đúng.' }),
        tool('update_status', { to: 'done' }),
      ],
    });
    await t.daemon.start();
    await waitFor(async () => (await getTicket(api.db, dev.id)).status === 'done', 15_000, 'dev done');
    const started = Date.now();
    const done = await waitFor(
      () => t.daemon.state.jobsForTicket(qc.id).find((j) => j.status === 'done'),
      15_000,
      'qc job done',
    );
    // The ticket's own update_status to done ends the run at once, not after the (large default) ceiling.
    expect(Date.now() - started).toBeLessThan(10_000);
    await noTaggedProcessLeft(done.id);
    await t.daemon.stop();
  });
});
