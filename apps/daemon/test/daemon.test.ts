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
import { FRESH_SESSION_TITLE } from '../src/runner/run-trace.js';
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
import { ownerDescribes, tinyPng, uploadImage } from './helpers/images.js';

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
    // The crash left the session abandoned: the job ran again in a fresh session whose prompt summarizes the
    // cut-short run, and carried on from there (no step repeated above).
    const devRuns = second.book.runs.filter((run) => run.ticketId === dev.id);
    expect(devRuns).toHaveLength(2);
    const [crashed, rerun] = devRuns;
    expect(rerun?.jobId).toBe(crashed?.jobId);
    expect(rerun?.resumeSessionId).toBeNull();
    expect(rerun?.prompt).toContain(FRESH_SESSION_TITLE);
    expect(rerun?.prompt).toContain('daemon tắt đột ngột giữa lượt chạy');
    expect(rerun?.prompt).toContain('git status');
    expect(rerun?.prompt).toContain('get_ticket');
    // The summary quotes the ticket's comments as untrusted data.
    expect(rerun?.prompt).toMatch(
      /<untrusted-data source="comment by agent\/dev">\nBước 1\n<\/untrusted-data>/,
    );
    const [job] = second.daemon.state.jobsForTicket(dev.id);
    expect(job).toMatchObject({ status: 'done', resumeMode: null, sessionAbandoned: null });
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

  it('re-queues running jobs on a graceful stop and runs them again in a fresh session on the next start', async () => {
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
    expect(job).toMatchObject({
      status: 'queued',
      resumeMode: 'restart_fresh',
      sessionAbandoned: 'daemon_stopped',
    });
    // The stopped run's diagnosis is kept for the next session's summary.
    expect(job?.runTrace?.lastTools).toEqual([{ tool: 'mcp__tickets__comment', target: null }]);

    const again = makeDaemon(f, { repoPath: repo, home: t.home, book: t.book });
    t.book.byTicket.set(dev.id, {
      steps: [tool('comment', { body: 'Một' }), { sleep: 0 }, tool('comment', { body: 'Hai' })],
    });
    await again.daemon.start();
    await waitFor(
      async () => (await commentsOf(api.db, dev.id)).some((c) => c.body === 'Hai'),
      15_000,
      'run again',
    );
    expect((await commentsOf(api.db, dev.id)).map((c) => c.body)).toEqual(['Một', 'Hai']);
    const rerun = t.book.runs.filter((run) => run.ticketId === dev.id).at(-1);
    expect(rerun?.jobId).toBe(job?.id);
    expect(rerun?.resumeSessionId).toBeNull();
    expect(rerun?.prompt).toContain(FRESH_SESSION_TITLE);
    expect(rerun?.prompt).toContain('daemon dừng giữa lượt chạy');
    expect(rerun?.prompt).toContain('`mcp__tickets__comment`');
    await waitFor(() => again.daemon.state.getJob(job?.id as string)?.status === 'done', 15_000, 'job done');
    expect(again.daemon.state.getJob(job?.id as string)).toMatchObject({
      resumeMode: null,
      sessionAbandoned: null,
    });
    await again.daemon.stop();
    // Every job temp dir was cleaned, so the stop dropped the empty temp root too.
    expect(existsSync(homePaths(t.home).tmp)).toBe(false);
  });
});

describe('abandoned sessions', () => {
  it('starts the next job in a fresh session with a summary after a run ended with a background task alive', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Hỏi chủ dự án khi còn lệnh nền');
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { bgBash: { id: 'server', command: 'sleep 999999' } },
        { say: 'Đang chờ server nền, cần hỏi chủ dự án.' },
        tool('ask_owner', { question: 'Có cần thêm bước xác thực không?' }),
      ],
    });
    await t.daemon.start();
    const first = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done'),
      15_000,
      'first job done',
    );
    // Closed with the background command alive (the daemon stopped it): the session is abandoned.
    expect(first.sessionAbandoned).toBe('background_tasks');
    expect(first.sessionId).toBeTruthy();

    t.book.byTicket.set(dev.id, { steps: [tool('comment', { body: 'Đã nhận câu trả lời' })] });
    await ownerComment(f, dev.id, 'Có, thêm xác thực.');
    await waitFor(
      async () => (await commentsOf(api.db, dev.id)).some((c) => c.body === 'Đã nhận câu trả lời'),
      15_000,
      'answer run',
    );
    const next = t.book.runs.filter((run) => run.ticketId === dev.id).at(-1);
    expect(next?.jobId).not.toBe(first.id);
    expect(next?.resumeSessionId).toBeNull();
    expect(next?.prompt).toContain(FRESH_SESSION_TITLE);
    expect(next?.prompt).toContain('phiên đóng khi agent còn tác vụ nền đang chạy');
    // The earlier run's diagnosis, as untrusted data.
    expect(next?.prompt).toMatch(
      /<untrusted-data source="run trace of the interrupted run">[\s\S]*> Đang chờ server nền, cần hỏi chủ dự án\.[\s\S]*<\/untrusted-data>/,
    );
    await t.daemon.stop();
  });

  it('resumes a clean session as before: an ask_owner answer, the retries after backoff and the unblock after them', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Phiên sạch');
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        tool('ask_owner', { question: 'Dùng cổng nào?' }),
      ],
    });
    await t.daemon.start();
    const asked = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done'),
      15_000,
      'ask_owner done',
    );
    expect(asked.sessionAbandoned).toBeNull();
    const session = asked.sessionId as string;

    // The owner's answer resumes the session; this run keeps hitting a rate limit until blocked.
    t.book.byTicket.set(dev.id, { steps: [{ apiError: 'rate_limit' }] });
    await ownerComment(f, dev.id, 'Cổng 8080.');
    for (let attempt = 1; attempt <= 3; attempt++) {
      const job = await waitFor(
        () =>
          t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'backoff' && j.attempts === attempt),
        15_000,
        `backoff ${attempt}`,
      );
      expect(job.sessionAbandoned).toBeNull();
      t.daemon.state.updateJob(job.id, { retryAt: new Date(Date.now() - 1000).toISOString() });
    }
    const blocked = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'blocked'),
      15_000,
      'blocked after 4 attempts',
    );
    expect(blocked).toMatchObject({ sessionId: session, sessionAbandoned: null, error: 'rate_limit' });

    // Unblocked after an API error on a clean session: resumed, no summary.
    t.book.byTicket.set(dev.id, { steps: [tool('comment', { body: 'Chạy tiếp' })] });
    await ownerTransition(f, dev.id, 'in_progress');
    await waitFor(
      async () => (await commentsOf(api.db, dev.id)).some((c) => c.body === 'Chạy tiếp'),
      15_000,
      'run after the unblock',
    );
    const runs = t.book.runs.filter((run) => run.ticketId === dev.id);
    expect(runs).toHaveLength(6);
    expect(runs.slice(1).map((run) => run.resumeSessionId)).toEqual(Array(5).fill(session));
    expect(t.daemon.state.jobsForTicket(dev.id).at(-1)?.trigger).toBe('ticket.unblocked');
    for (const run of runs) expect(run.prompt).not.toContain(FRESH_SESSION_TITLE);
    await t.daemon.stop();
  });

  it('marks a run whose runner throws without a result; the run after the unblock starts fresh with a summary', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Runner lỗi');
    t.book.byTicket.set(dev.id, {
      steps: [tool('update_status', { to: 'in_progress' }), tool('ask_owner', { question: 'Bắt đầu chứ?' })],
    });
    await t.daemon.start();
    const asked = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done'),
      15_000,
      'ask_owner done',
    );
    // The resumed run's agent process goes away before any result message.
    t.book.byTicket.set(dev.id, () => {
      throw new Error('claude process exited with code 1');
    });
    await ownerComment(f, dev.id, 'Bắt đầu đi.');
    const failed = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'failed'),
      15_000,
      'runner error',
    );
    expect(failed).toMatchObject({ sessionId: asked.sessionId, sessionAbandoned: 'no_result' });
    await waitFor(async () => (await getTicket(api.db, dev.id)).status === 'blocked', 10_000, 'blocked');

    t.book.byTicket.set(dev.id, { steps: [tool('comment', { body: 'Làm lại từ đầu phiên mới' })] });
    await ownerTransition(f, dev.id, 'in_progress');
    await waitFor(
      async () => (await commentsOf(api.db, dev.id)).some((c) => c.body === 'Làm lại từ đầu phiên mới'),
      15_000,
      'run after the unblock',
    );
    const next = t.book.runs.filter((run) => run.ticketId === dev.id).at(-1);
    expect(next?.resumeSessionId).toBeNull();
    expect(next?.prompt).toContain(FRESH_SESSION_TITLE);
    expect(next?.prompt).toContain('tiến trình agent kết thúc mà không trả kết quả');
    await t.daemon.stop();
  });

  it('retries no_handoff on the clean session, then starts fresh after the unblock and asks for a new preflight', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo, extra: { planner: rolePlanner } });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Không bàn giao');
    const scripts = [
      // 1: preflight done, no handoff. 2: the retry resumes the session, no handoff again: blocked.
      [
        tool('select_capabilities', { noneReason: 'không có skill hay MCP nào hợp' }),
        tool('comment', { body: 'Lượt 1' }),
      ],
      [tool('comment', { body: 'Lượt 2' })],
      // 3: after the unblock, a fresh session that skips its preflight (warned), no handoff: retried.
      [tool('comment', { body: 'Lượt 3' })],
      // 4: the retry resumes the fresh session and asks the owner.
      [tool('ask_owner', { question: 'Bàn giao phần nào trước?' })],
    ];
    let runCount = 0;
    t.book.byTicket.set(dev.id, () => ({ steps: scripts[runCount++] ?? [] }));
    await t.daemon.start();
    await waitFor(async () => (await getTicket(api.db, dev.id)).status === 'blocked', 20_000, 'blocked');
    const [firstJob, retryJob] = t.daemon.state.jobsForTicket(dev.id);
    expect(retryJob).toMatchObject({ trigger: 'retry:no_handoff', status: 'blocked', error: 'no_handoff' });
    expect(firstJob?.sessionAbandoned).toBeNull();
    let runs = t.book.runs.filter((run) => run.ticketId === dev.id);
    expect(runs[1]?.resumeSessionId).toBe(firstJob?.sessionId);
    expect(runs[1]?.prompt).not.toContain(FRESH_SESSION_TITLE);
    const warnings = async () =>
      (await commentsOf(api.db, dev.id)).filter((c) => c.body.includes('`select_capabilities`')).length;
    // The retry resumed the session that already did its preflight: no warning.
    expect(await warnings()).toBe(0);

    // A session broken before the mark existed looks like this: an unblock after no_handoff starts fresh.
    await ownerTransition(f, dev.id, 'in_progress');
    await waitFor(async () => (await getTicket(api.db, dev.id)).status === 'needs_input', 20_000, 'asked');
    runs = t.book.runs.filter((run) => run.ticketId === dev.id);
    expect(runs).toHaveLength(4);
    expect(runs[2]?.resumeSessionId).toBeNull();
    expect(runs[2]?.prompt).toContain(FRESH_SESSION_TITLE);
    expect(runs[2]?.prompt).toContain('lượt dev kết thúc mà không gọi `handoff_docs`');
    const jobs = t.daemon.state.jobsForTicket(dev.id);
    expect(jobs[2]?.trigger).toBe('ticket.unblocked');
    expect(runs[3]?.resumeSessionId).toBe(jobs[2]?.sessionId);
    // The fresh session had no preflight of its own: warned once (the resumed retry after it asked the owner).
    expect(await warnings()).toBe(1);
    await t.daemon.stop();
  });

  it('resumes the clean session the unblock opened when its run backs off after no_handoff', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo, extra: { planner: rolePlanner } });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Mở chặn rồi bị rate limit');
    const scripts = [
      // 1 and 2: no handoff twice (the retry resumes), blocked.
      [
        tool('select_capabilities', { noneReason: 'không có skill hay MCP nào hợp' }),
        tool('comment', { body: 'Lượt 1' }),
      ],
      [tool('comment', { body: 'Lượt 2' })],
      // 3: after the unblock, a fresh session that ends on a rate limit (a clean session): backoff.
      [tool('comment', { body: 'Lượt 3' }), { apiError: 'rate_limit' }],
      // 4: the backoff retry of the same job carries on after its last completed step and asks the owner.
      [tool('comment', { body: 'Lượt 3' }), tool('ask_owner', { question: 'Bàn giao phần nào trước?' })],
    ];
    let runCount = 0;
    t.book.byTicket.set(dev.id, () => ({ steps: scripts[runCount++] ?? [] }));
    await t.daemon.start();
    await waitFor(async () => (await getTicket(api.db, dev.id)).status === 'blocked', 20_000, 'blocked');
    expect(t.daemon.state.jobsForTicket(dev.id).at(-1)).toMatchObject({ error: 'no_handoff' });

    await ownerTransition(f, dev.id, 'in_progress');
    const backoff = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'backoff'),
      20_000,
      'backoff after the unblock',
    );
    expect(backoff).toMatchObject({ trigger: 'ticket.unblocked', sessionAbandoned: null, attempts: 1 });
    const fresh = backoff.sessionId as string;
    expect(fresh).toBeTruthy();
    t.daemon.state.updateJob(backoff.id, { retryAt: new Date(Date.now() - 1000).toISOString() });
    await waitFor(async () => (await getTicket(api.db, dev.id)).status === 'needs_input', 20_000, 'asked');

    const runs = t.book.runs.filter((run) => run.ticketId === dev.id);
    expect(runs).toHaveLength(4);
    // The unblock's first run starts fresh, summarizing the no_handoff run.
    expect(runs[2]?.resumeSessionId).toBeNull();
    expect(runs[2]?.prompt).toContain(FRESH_SESSION_TITLE);
    // Its retry after the backoff resumes the session it opened, no summary.
    expect(runs[3]?.resumeSessionId).toBe(fresh);
    expect(runs[3]?.prompt).not.toContain(FRESH_SESSION_TITLE);
    const jobs = t.daemon.state.jobsForTicket(dev.id);
    expect(jobs).toHaveLength(3);
    expect(jobs[2]).toMatchObject({ id: backoff.id, sessionId: fresh, status: 'done' });
    await t.daemon.stop();
  });

  it('sends the ticket images again to the fresh session that replaces an abandoned one, not to a clean resumed one', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Ảnh và phiên bỏ dở');
    const image = await uploadImage(f, dev.id, tinyPng(7));
    await ownerDescribes(f, dev.id, `Ảnh lỗi: ${image.markdown}`);
    const sentIn = (run: (typeof t.book.runs)[number] | undefined) => (run?.images ?? []).map((i) => i.id);

    // 1: the first session gets the image, then closes with a background command alive: abandoned.
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { bgBash: { id: 'server', command: 'sleep 999999' } },
        tool('ask_owner', { question: 'Lỗi ở trang nào?' }),
      ],
    });
    await t.daemon.start();
    const first = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'done'),
      15_000,
      'first job done',
    );
    expect(first).toMatchObject({ sessionAbandoned: 'background_tasks', imagesSent: [image.id] });

    // 2: the answer's run would resume that session, but it was abandoned: the fresh one gets the image.
    t.book.byTicket.set(dev.id, { steps: [tool('ask_owner', { question: 'Cần sửa cả bản mobile không?' })] });
    await ownerComment(f, dev.id, 'Trang đăng nhập.');
    await waitFor(() => t.book.runs.filter((run) => run.ticketId === dev.id).length === 2, 15_000, 'run 2');
    await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).filter((j) => j.status === 'done').length === 2,
      15_000,
      'second job done',
    );
    // 3: the next answer resumes the clean fresh session, which already has the image.
    t.book.byTicket.set(dev.id, { steps: [tool('comment', { body: 'Đã nhận' })] });
    await ownerComment(f, dev.id, 'Không cần.');
    await waitFor(
      async () => (await commentsOf(api.db, dev.id)).some((c) => c.body === 'Đã nhận'),
      15_000,
      'run 3',
    );
    const runs = t.book.runs.filter((run) => run.ticketId === dev.id);
    const jobs = t.daemon.state.jobsForTicket(dev.id);
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => run.resumeSessionId)).toEqual([null, null, jobs[1]?.sessionId]);
    expect(runs.map(sentIn)).toEqual([[image.id], [image.id], []]);
    expect(jobs[1]).toMatchObject({ sessionAbandoned: null, imagesSent: [image.id] });
    expect(jobs[1]?.sessionId).not.toBe(first.sessionId);
    // The clean resumed run still lists the image (its file, already sent before) in the prompt.
    expect(runs[2]?.prompt).toContain('## Ảnh đính kèm trong ticket');
    expect(t.daemon.state.imagesSentInSession(jobs[1]?.sessionId as string)).toEqual([image.id]);
    await t.daemon.stop();
  });

  it('forgets the images a job sent to its old session when it re-runs in a fresh one that got none', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Ảnh và phiên mới không tải được ảnh');
    const image = await uploadImage(f, dev.id, tinyPng(9));
    await ownerDescribes(f, dev.id, `Ảnh lỗi: ${image.markdown}`);
    const sentIn = (run: (typeof t.book.runs)[number] | undefined) => (run?.images ?? []).map((i) => i.id);

    // 1: the first session gets the image, then the daemon stops mid-run: the job is re-queued.
    const ask = tool('ask_owner', { question: 'Lỗi ở trang nào?' });
    t.book.byTicket.set(dev.id, {
      steps: [tool('update_status', { to: 'in_progress' }), { sleep: 30_000 }, ask],
    });
    await t.daemon.start();
    const running = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.imagesSent.includes(image.id)),
      15_000,
      'image sent to the first session',
    );
    await waitFor(async () => (await getTicket(api.db, dev.id)).status === 'in_progress', 15_000, 'started');
    await t.daemon.stop();

    // 2: the next start re-runs the same job in a fresh session, but the image cannot be downloaded now.
    let imagesDown = true;
    const flakyFetch: typeof fetch = async (input, init) =>
      imagesDown && String(input).includes('/v1/daemon/attachments/')
        ? new Response('unavailable', { status: 503 })
        : fetch(input, init);
    const again = makeDaemon(f, { repoPath: repo, home: t.home, book: t.book, extra: { fetch: flakyFetch } });
    // The fresh session carries on after the last completed step: it asks the owner.
    t.book.byTicket.set(dev.id, {
      steps: [tool('update_status', { to: 'in_progress' }), { sleep: 0 }, ask],
    });
    await again.daemon.start();
    const rerun = await waitFor(
      () => {
        const job = again.daemon.state.getJob(running.id);
        return job?.status === 'done' ? job : undefined;
      },
      15_000,
      're-run done',
    );
    let runs = t.book.runs.filter((run) => run.ticketId === dev.id);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.jobId).toBe(running.id);
    expect(runs[1]?.resumeSessionId).toBeNull();
    expect(sentIn(runs[1])).toEqual([]);
    expect(runs[1]?.prompt).toContain('không tải được');
    const fresh = rerun.sessionId as string;
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(running.sessionId);
    // The images sent belong to the old session: the fresh one has seen none.
    expect(rerun).toMatchObject({ sessionAbandoned: null, imagesSent: [] });
    expect(again.daemon.state.imagesSentInSession(fresh)).toEqual([]);

    // 3: the answer resumes the clean fresh session, the image downloads again and is sent to it.
    imagesDown = false;
    t.book.byTicket.set(dev.id, { steps: [tool('comment', { body: 'Đã nhận' })] });
    await ownerComment(f, dev.id, 'Trang đăng nhập.');
    await waitFor(
      async () => (await commentsOf(api.db, dev.id)).some((c) => c.body === 'Đã nhận'),
      15_000,
      'run 3',
    );
    runs = t.book.runs.filter((run) => run.ticketId === dev.id);
    expect(runs).toHaveLength(3);
    expect(runs[2]?.resumeSessionId).toBe(fresh);
    expect(sentIn(runs[2])).toEqual([image.id]);
    expect(again.daemon.state.imagesSentInSession(fresh)).toEqual([image.id]);
    await again.daemon.stop();
  });

  it('sends the ticket images again to the fresh session an unblock opens, and not to the retries that resume', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo, extra: { planner: rolePlanner } });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Ảnh và mở chặn');
    const image = await uploadImage(f, dev.id, tinyPng(8));
    await ownerDescribes(f, dev.id, `Ảnh thiết kế: ${image.markdown}`);
    const scripts = [
      // 1 and 2: no handoff twice on one clean session (the retry resumes it): blocked.
      [
        tool('select_capabilities', { noneReason: 'không có skill hay MCP nào hợp' }),
        tool('comment', { body: 'Lượt 1' }),
      ],
      [tool('comment', { body: 'Lượt 2' })],
      // 3: the unblock opens a fresh session (the rule for a run left unfinished), which backs off.
      [tool('comment', { body: 'Lượt 3' }), { apiError: 'rate_limit' }],
      // 4: the retry after the backoff resumes that fresh session and asks the owner.
      [tool('comment', { body: 'Lượt 3' }), tool('ask_owner', { question: 'Bàn giao phần nào trước?' })],
    ];
    let runCount = 0;
    t.book.byTicket.set(dev.id, () => ({ steps: scripts[runCount++] ?? [] }));
    await t.daemon.start();
    await waitFor(async () => (await getTicket(api.db, dev.id)).status === 'blocked', 20_000, 'blocked');
    await ownerTransition(f, dev.id, 'in_progress');
    const backoff = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'backoff'),
      20_000,
      'backoff after the unblock',
    );
    t.daemon.state.updateJob(backoff.id, { retryAt: new Date(Date.now() - 1000).toISOString() });
    await waitFor(async () => (await getTicket(api.db, dev.id)).status === 'needs_input', 20_000, 'asked');

    const runs = t.book.runs.filter((run) => run.ticketId === dev.id);
    const [firstJob] = t.daemon.state.jobsForTicket(dev.id);
    expect(runs).toHaveLength(4);
    expect(runs.map((run) => run.resumeSessionId)).toEqual([
      null,
      firstJob?.sessionId,
      null,
      backoff.sessionId,
    ]);
    expect(runs.map((run) => (run.images ?? []).map((i) => i.id))).toEqual([[image.id], [], [image.id], []]);
    // The unblocked job ran in another session than the one its images were first sent to.
    expect(t.daemon.state.imagesSentInSession(backoff.sessionId as string)).toEqual([image.id]);
    await t.daemon.stop();
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
    expect(job).toMatchObject({
      status: 'queued',
      resumeMode: 'restart_fresh',
      sessionAbandoned: 'daemon_stopped',
    });
    await noTaggedProcessLeft(running?.id as string);
  });

  it('leaves the session abandoned when a cancelled run had a background command alive', async () => {
    const f = await fixture(api);
    const repo = makeRepo();
    const t = makeDaemon(f, { repoPath: repo });
    const pm = await pmTask(api, f);
    const dev = await devTicket(api, pm.id, 'Huỷ giữa lượt có lệnh nền');
    t.book.byTicket.set(dev.id, {
      steps: [
        tool('update_status', { to: 'in_progress' }),
        { bgBash: { id: 'server', command: 'sleep 999999' } },
        { sleep: 30_000 },
      ],
    });
    await t.daemon.start();
    await waitFor(
      async () => (await getTicket(api.db, dev.id)).status === 'in_progress',
      15_000,
      'in progress',
    );
    await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'running' && j.pgid),
      15_000,
      'running',
    );
    await ownerTransition(f, dev.id, 'cancelled');
    const cancelled = await waitFor(
      () => t.daemon.state.jobsForTicket(dev.id).find((j) => j.status === 'cancelled'),
      10_000,
      'cancelled',
    );
    expect(cancelled.sessionAbandoned).toBe('aborted');
    expect(cancelled.sessionId).toBeTruthy();
    // Nothing resumes it: any later job of the ticket starts fresh with a summary of the cancelled run.
    const next = t.daemon.state.resumeChoice(dev.id, cancelled.sessionId, {
      trigger: 'ticket.comment_added',
    });
    expect(next.sessionId).toBeNull();
    expect(next.interrupted?.id).toBe(cancelled.id);
    expect(t.daemon.state.resumableSession(dev.id, 'agent', 'ticket.comment_added')).toBeNull();
    await t.daemon.stop();
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
