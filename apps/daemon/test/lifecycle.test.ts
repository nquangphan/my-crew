import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { events, ticketReports, tickets } from '../../api/src/db/schema.js';
import { isDocsPath } from '../src/runner/guard-hook.js';
import { commentsOf, RATED, useApi } from './helpers/api.js';
import { waitFor } from './helpers/daemon.js';
import { git } from './helpers/git.js';
import {
  type LifecycleResult,
  loadScenario,
  type PastedImage,
  runScenario,
  stuckTickets,
} from './helpers/lifecycle.js';
import { crewDocs } from './helpers/workflow.js';

/**
 * The scripted lifecycle matrix: every scenario under `test/lifecycle/` runs the real API and daemon with
 * the role workflow, the scripted runner (no model cost), real git worktrees, the real crew-docs hooks and a
 * bare `origin`. Each ends in a settled state that leaves no ticket stuck.
 */
const api = useApi();
const dir = fileURLToPath(new URL('./lifecycle/', import.meta.url));
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.yaml'))
  .sort();

type Row = typeof tickets.$inferSelect;

async function all(): Promise<Row[]> {
  return api.db.select().from(tickets);
}
async function one(title: RegExp, type?: Row['type']): Promise<Row> {
  const row = (await all()).find((r) => title.test(r.title) && (!type || r.type === type));
  if (!row) throw new Error(`no ticket ${title}`);
  return row;
}
async function report(ticketId: string) {
  const rows = await api.db.select().from(ticketReports);
  return rows.find((row) => row.ticketId === ticketId && row.isCurrent) ?? null;
}
const jobsOf = (r: LifecycleResult, ticketId: string) => r.daemon.daemon.state.jobsForTicket(ticketId);

/** Files a commit range touched. */
const touched = (repo: string, range: string) =>
  git(repo, 'diff', '--name-only', range).split('\n').filter(Boolean);

/** Every dev or bug ticket closed through one docs_update job on sonnet, and its branch commit holds code and docs. */
async function assertDocsJobCommits(r: LifecycleResult) {
  for (const row of (await all()).filter(
    (t) => (t.type === 'dev' || t.type === 'bug') && t.status === 'done',
  )) {
    const jobs = jobsOf(r, row.id);
    const docsJobs = jobs.filter((job) => job.kind === 'docs_update');
    expect(docsJobs.at(-1)?.status, `${row.key} docs job`).toBe('done');
    for (const job of docsJobs) expect(job.model, `${row.key} docs model`).toBe('sonnet');
    for (const job of jobs.filter((j) => j.kind === 'agent' && j.stage === 'dev')) {
      // The dev model never wrote under docs/ (the guard denies it; nothing was even tried here).
      const writes = r.daemon.daemon.state
        .toolLog(job.id)
        .filter((e) => ['Write', 'Edit'].includes(e.tool) && e.decision === 'allow');
      expect(
        writes.every((e) => !isDocsPath(String(e.target))),
        `${row.key} dev wrote docs`,
      ).toBe(true);
    }
    const rep = await report(row.id);
    expect(rep?.headSha, `${row.key} head`).toBeTruthy();
    const own = rep?.commits ?? [];
    expect(own.length, `${row.key} commits`).toBeGreaterThan(0);
    const last = own[0] as string;
    const files = git(r.repo.repo, 'show', '--name-only', '--format=', last).split('\n').filter(Boolean);
    expect(
      files.some((file) => file.startsWith('src/')),
      `${row.key} code in commit`,
    ).toBe(true);
    expect(
      files.some((file) => file.startsWith('docs/')),
      `${row.key} docs in commit`,
    ).toBe(true);
  }
}

const CHECKS: Record<string, (r: LifecycleResult) => Promise<void>> = {
  async 'happy-path'(r) {
    await assertDocsJobCommits(r);
    const dev = await one(/^Viết route \/health$/);
    const devJobs = jobsOf(r, dev.id);
    expect(devJobs.map((j) => [j.kind, j.model])).toEqual([
      ['agent', 'haiku'],
      ['docs_update', 'sonnet'],
    ]);
    const devReport = await report(dev.id);
    expect(devReport).toMatchObject({ docsFirst: true, skillsMissing: [], leftResources: false });
    expect(devReport?.skillsUsed).toContain('api-design');
    const qc = await one(/^QC: Viết route/);
    expect(qc.requiredMcps).toEqual(['playwright']);
    expect((await report(qc.id))?.mcpsUsed).toEqual(['playwright']);
    // The PM question was answered once and the same session resumed.
    const pm = await one(/^Thêm endpoint \/health$/, 'pm_task');
    const pmJobs = jobsOf(r, pm.id).filter((j) => j.stage === 'pm_analyze' && j.status === 'done');
    expect(pmJobs).toHaveLength(2);
    expect(pmJobs[1]?.sessionId).toBe(pmJobs[0]?.sessionId);
    // Reports at every level; the request shows the chain.
    const request = await one(/^Thêm endpoint \/health$/, 'request');
    for (const row of [request, pm, dev, qc]) expect(await report(row.id), row.key).not.toBeNull();
    const pmReport = await report(pm.id);
    expect(pmReport?.summaryMd).toContain('## Dọn dẹp tài nguyên');
    expect(pmReport?.headSha).toBeTruthy();
    // Pushed to origin through the pre-push gate; the local main moved too.
    const remoteHead = git(r.repo.remote, 'rev-parse', 'main').trim();
    expect(remoteHead).toBe(pmReport?.headSha ?? pm.id);
    expect(git(r.repo.remote, 'show', 'main:src/health.js')).toContain('health');
    expect(git(r.repo.repo, 'rev-parse', 'main').trim()).toBe(remoteHead);
    expect(git(r.repo.remote, 'show', 'main:docs/files.md')).toContain('src/health.js');
    // Costs were recorded.
    expect(dev.costUsd).toBeGreaterThan(0);
  },

  async 'docs-rejected-r7'(r) {
    await assertDocsJobCommits(r);
    const dev = await one(/^Đọc cấu hình từ env$/);
    const jobs = jobsOf(r, dev.id);
    expect(jobs.map((j) => [j.kind, j.status])).toEqual([
      ['agent', 'done'],
      ['docs_update', 'failed'],
      ['agent', 'done'],
      ['docs_update', 'done'],
    ]);
    expect(jobs[1]?.returnToDev?.output).toMatch(/R7/);
    const retry = r.runs.find((run) => run.ticketId === dev.id && run.stage === 'dev' && run.n === 2);
    expect(retry?.prompt).toContain('R7');
    expect(jobs[2]?.failedAttempts).toBe(1);
    expect(git(r.repo.remote, 'show', 'main:src/config.js')).not.toContain('AKIA');
    const bodies = (await commentsOf(api.db, dev.id)).map((c) => c.body);
    expect(bodies.some((b) => b.includes('trả việc về cho dev'))).toBe(true);
  },

  async 'capability-preflight'(r) {
    const request = await one(/^Làm trang giỏ hàng$/, 'request');
    const pm = await one(/^Làm trang giỏ hàng$/, 'pm_task');
    const dev = await one(/^Trang giỏ hàng$/);
    const qc = await one(/^QC: Trang giỏ hàng$/);
    for (const row of [request, pm, dev, qc]) {
      const rep = await report(row.id);
      expect(rep?.skillsSelected.length, `${row.key} skillsSelected`).toBeGreaterThan(0);
      for (const pick of rep?.skillsSelected ?? []) expect(pick.reason).not.toBe('');
    }
    // Every run of every role started with the preflight.
    for (const run of r.runs) {
      const tools = r.daemon.daemon.state.toolLog(run.jobId).map((e) => e.tool);
      expect(tools[0], `${run.stage} ${run.title}`).toBe('mcp__tickets__select_capabilities');
    }
    expect(new Set(r.runs.map((run) => run.stage))).toEqual(
      new Set(['assistant_triage', 'pm_analyze', 'dev', 'docs_update', 'qc', 'pm_accept', 'assistant_close']),
    );
    // A report pick outside the run's inventory was refused; the stored report has none.
    expect((await report(request.id))?.summaryMd).not.toContain('lựa chọn sai');
    expect((await report(request.id))?.skillsSelected.map((s) => s.name)).not.toContain('health-endpoints');
    // Picks of runs without their own report (triage, analyze, dev) land in the ticket's report.
    expect((await report(request.id))?.skillsSelected.map((s) => s.name)).toContain('requirements');
    expect((await report(pm.id))?.skillsSelected.map((s) => s.name)).toEqual(
      expect.arrayContaining(['requirements', 'planning', 'code-review']),
    );
    expect((await report(pm.id))?.mcpsSelected.map((s) => s.server)).toContain('figma');
    expect((await report(pm.id))?.mcpsUsed).toContain('figma');
    // The dev picked "brainstorm" and never used it: flagged in the report and in a warning comment.
    const devReport = await report(dev.id);
    expect(devReport?.skillsMissing).toEqual(['brainstorm']);
    expect(
      (await commentsOf(api.db, dev.id)).some((c) => c.body.includes('Skill đã chọn `brainstorm`')),
    ).toBe(true);
    // QC of a web project gets playwright automatically and uses it.
    expect(qc.requiredMcps).toEqual(['playwright']);
    expect((await report(qc.id))?.mcpsUsed).toEqual(['playwright']);
    // A mobile project's QC gets maestro, a web+mobile one both.
    const { createTestProject } = await import('../../api/test/helpers/test-db.js');
    const { createRequestTicket, createSubtask } = await import('../../api/src/services/ticket-service.js');
    for (const [key, platform, expected] of [
      ['MOB', 'mobile', ['maestro']],
      ['WMB', 'web_mobile', ['maestro', 'playwright']],
      ['LIB', 'backend', []],
    ] as const) {
      const project = await createTestProject(api.db, { key, platform });
      const req = await createRequestTicket(api.db, { title: `r ${key}` });
      const task = await createSubtask(api.db, {
        type: 'pm_task',
        parentId: req.id,
        projectId: project.id,
        title: 'p',
      });
      const d = await createSubtask(api.db, { type: 'dev', ...RATED, parentId: task.id, title: 'd' });
      const q = await createSubtask(api.db, {
        type: 'qc',
        ...RATED,
        parentId: task.id,
        title: 'q',
        pairsWith: d.id,
      });
      expect([...q.requiredMcps].sort(), key).toEqual([...expected]);
    }
  },

  async 'resources-cleanup'(r) {
    const dev = await one(/^Chạy thử máy chủ$/);
    const devJob = jobsOf(r, dev.id).find((j) => j.stage === 'dev');
    const [record] = r.daemon.daemon.state.cleanups({ jobId: devJob?.id as string });
    expect(record?.ports).toContain(4391);
    expect(record?.bytesFreed).toBeGreaterThanOrEqual(100_000);
    const pm = await one(/^Chạy thử máy chủ$/, 'pm_task');
    const monitor = jobsOf(r, pm.id).find((j) => j.stage === 'pm_monitor');
    expect(monitor?.trigger).toBe('child.resources');
    const monitorLog = r.daemon.daemon.state.toolLog(monitor?.id as string).map((e) => e.tool);
    expect(monitorLog).toContain('mcp__tickets__resource_report');
    const pmReport = await report(pm.id);
    expect(pmReport?.summaryMd).toMatch(/## Dọn dẹp tài nguyên[\s\S]*4391/);
    expect((await commentsOf(api.db, pm.id)).some((c) => c.body.includes('để lại'))).toBe(true);
  },

  async 'qc-two-bugs'(r) {
    await assertDocsJobCommits(r);
    const bugs = (await all()).filter((t) => t.type === 'bug');
    expect(bugs.map((b) => b.bugCycle)).toEqual([1, 1]);
    const retests = (await all()).filter((t) => t.title.startsWith('Kiểm thử lại'));
    expect(retests.every((t) => t.status === 'done')).toBe(true);
    for (const file of ['src/cart.js', 'src/fix-a.js', 'src/fix-b.js']) {
      expect(git(r.repo.remote, 'show', `main:${file}`), file).toBeTruthy();
    }
    const head = git(r.repo.remote, 'rev-parse', 'main').trim();
    const check = join(r.repo.repo, '.crew', 'check');
    git(r.repo.repo, 'worktree', 'add', '-q', '--detach', check, head);
    expect(crewDocs(check, 'check', '--all')).toBeDefined();
    git(r.repo.repo, 'worktree', 'remove', '--force', check);
  },

  async 'qc-own-rating'(r) {
    await assertDocsJobCommits(r);
    const agentModels = (ticketId: string) =>
      jobsOf(r, ticketId)
        .filter((j) => j.kind === 'agent' && j.status === 'done')
        .map((j) => [j.model, j.effort]);
    const dev = await one(/^Tính thuế theo vùng$/, 'dev');
    const qc = await one(/^QC: Tính thuế/, 'qc');
    expect(dev).toMatchObject({ complexity: 'large', complexityReason: 'Đổi lõi tính giá ở nhiều module' });
    expect(qc).toMatchObject({
      complexity: 'trivial',
      complexityReason: 'Một hàm thuần, kiểm bằng test đơn vị',
    });
    expect(agentModels(dev.id)).toEqual([['opus', 'high']]);
    // QC runs on its own rating, not the dev one.
    expect(agentModels(qc.id)).toEqual([['haiku', 'low']]);
    const bug = await one(/^Lỗi làm tròn thuế$/, 'bug');
    expect(bug).toMatchObject({
      complexity: 'large',
      complexityReason: `kế thừa từ ${dev.key}: Đổi lõi tính giá ở nhiều module`,
    });
    expect(agentModels(bug.id)).toEqual([['opus', 'high']]);
    const retest = await one(/^Kiểm thử lại/, 'qc');
    expect(retest).toMatchObject({ complexity: 'trivial' });
    expect(agentModels(retest.id)).toEqual([['haiku', 'low']]);
  },

  async 'pm-rates-in-place'(r) {
    await assertDocsJobCommits(r);
    const agentModels = (ticketId: string) =>
      jobsOf(r, ticketId)
        .filter((j) => j.kind === 'agent' && j.status === 'done')
        .map((j) => [j.model, j.effort]);
    const first = await one(/^Bảng phí theo vùng$/, 'dev');
    const second = await one(/^Áp phí vào đơn hàng$/, 'dev');
    expect(first).toMatchObject({ complexity: 'small', complexityReason: 'Một bảng tra và test của nó' });
    // Re-rated in place: the same ticket, the new rating, no replacement.
    expect(second).toMatchObject({
      complexity: 'large',
      complexityReason: 'Tổng đơn hàng dùng ở thanh toán, hoá đơn và báo cáo, rủi ro hồi quy cao',
      model: null,
    });
    expect((await all()).filter((t) => t.type === 'dev')).toHaveLength(2);
    expect(agentModels(first.id)).toEqual([['sonnet', 'medium']]);
    expect(agentModels(second.id)).toEqual([['opus', 'high']]);
    // The PM's tool call is in the log of its breakdown run.
    const pm = await one(/^Tính phí vận chuyển$/, 'pm_task');
    const analyze = jobsOf(r, pm.id).find((j) => j.stage === 'pm_analyze');
    const rateCalls = r.daemon.daemon.state
      .toolLog(analyze?.id ?? '')
      .filter((e) => e.tool === 'mcp__tickets__rate_subtask');
    expect(rateCalls).toHaveLength(1);
  },

  async 'bug-cycle-cap'(r) {
    const pm = await one(/^Sửa lỗi lặp lại$/, 'pm_task');
    expect(pm.status).toBe('needs_input');
    const bugs = (await all()).filter((t) => t.type === 'bug');
    expect(bugs.map((b) => b.bugCycle).sort()).toEqual([1, 2, 3]);
    const system = (await commentsOf(api.db, pm.id)).filter((c) => c.authorKind === 'system');
    expect(system.some((c) => c.body.includes('3 vòng'))).toBe(true);
    // The PM woke on children.all_done but waits for the owner instead of accepting.
    expect(jobsOf(r, pm.id).some((j) => j.status === 'skipped' && /chờ chủ dự án/.test(j.error ?? ''))).toBe(
      true,
    );
  },

  async 'owner-cancels-mid-dev'(r) {
    const dev = await one(/^Việc dài$/);
    const [job] = jobsOf(r, dev.id);
    expect(job?.status).toBe('cancelled');
    expect(existsSync(job?.worktree as string)).toBe(false);
    expect(r.daemon.daemon.state.cleanups({ jobId: job?.id as string })).toHaveLength(1);
    const qc = await one(/^QC: Việc dài$/);
    expect(jobsOf(r, qc.id).every((j) => j.status === 'cancelled')).toBe(true);
    expect((await all()).every((t) => t.status === 'cancelled')).toBe(true);
  },

  async 'crash-mid-breakdown'(r) {
    const pm = await one(/^Thêm trang liên hệ$/, 'pm_task');
    const children = (await all()).filter((t) => t.parentId === pm.id);
    expect(children.map((c) => c.title).sort()).toEqual(['QC: Trang liên hệ', 'Trang liên hệ']);
    const analyze = jobsOf(r, pm.id).filter((j) => j.stage === 'pm_analyze');
    expect(analyze).toHaveLength(1);
    expect(analyze[0]?.resumeMode).toBe('restart_resume');
  },

  async 'backoff-resume'(r) {
    const dev = await one(/^Trang giới thiệu$/);
    const [first] = jobsOf(r, dev.id);
    expect(first?.attempts).toBe(1);
    expect(first?.status).toBe('done');
    expect((await commentsOf(api.db, dev.id)).some((c) => c.body.includes('rate_limit'))).toBe(true);
  },

  async 'two-devs-one-flow'(r) {
    await assertDocsJobCommits(r);
    const files = git(r.repo.remote, 'show', 'main:docs/files.md');
    expect(files).toContain('src/beta.js');
    expect(files).toContain('src/bravo.js');
    const pm = await one(/^Hai tính năng cùng flow$/, 'pm_task');
    const range = `${git(r.repo.remote, 'rev-list', '--max-parents=0', 'main').trim()}..main`;
    expect(touched(r.repo.remote, range)).toEqual(expect.arrayContaining(['src/beta.js', 'src/bravo.js']));
    const head = git(r.repo.remote, 'rev-parse', 'main').trim();
    expect((await report(pm.id))?.headSha).toBe(head);
    const check = join(r.repo.repo, '.crew', 'check');
    git(r.repo.repo, 'worktree', 'add', '-q', '--detach', check, head);
    expect(crewDocs(check, 'check', '--all')).toBeDefined();
    git(r.repo.repo, 'worktree', 'remove', '--force', check);
  },

  async 'no-docs-init-first'(r) {
    await assertDocsJobCommits(r);
    const init = await one(/^Khởi tạo docs/);
    const dev = await one(/^Trang sản phẩm$/, 'dev');
    const qc = await one(/^QC: Trang sản phẩm$/);
    expect(init.type).toBe('docs_init');
    expect(init.createdAt.getTime()).toBeLessThan(dev.createdAt.getTime());
    expect(dev.dependsOn).toContain(init.id);
    expect(qc.dependsOn).toContain(init.id);
    const initJobs = jobsOf(r, init.id);
    expect(initJobs.map((j) => [j.kind, j.model])).toEqual([['docs_init', 'sonnet']]);
    const initReport = await report(init.id);
    expect(initReport?.skillsSelected.length).toBeGreaterThan(0);
    expect(git(r.repo.remote, 'show', 'main:docs/flows.yaml')).toContain('flows:');
    expect(git(r.repo.remote, 'show', 'main:.githooks/pre-commit')).toContain('crew-docs');
    expect(git(r.repo.repo, 'config', '--get', 'crew-docs.bundle').trim()).toBeTruthy();
    // The owner's checkout fast-forwarded and has the docs and hooks now.
    expect(existsSync(join(r.repo.repo, 'docs', 'flows.yaml'))).toBe(true);
  },

  async 'docs-init-not-finished'(r) {
    const init = await one(/^Khởi tạo docs/);
    const jobs = jobsOf(r, init.id);
    expect(jobs.map((j) => [j.kind, j.status, j.error])).toEqual([
      ['docs_init', 'failed', 'not_finished'],
      ['docs_init', 'blocked', 'not_finished'],
    ]);
    const bodies = (await commentsOf(api.db, init.id)).map((c) => c.body);
    const retry = bodies.find((b) => b.startsWith('Lần thử 1/2 không thành'));
    const block = bodies.find((b) => b.startsWith('Ticket bị chặn: lượt chạy kết thúc mà ticket chưa xong'));
    for (const body of [retry, block]) {
      expect(body).toBeDefined();
      expect(body).toContain('**Số lượt / thời gian / chi phí:** 7 lượt · ');
      expect(body).toContain('kết quả SDK `success` · giai đoạn `docs_init`');
      expect(body).toContain('**Tin nhắn cuối của agent**');
      expect(body).toContain(
        '> Đã đọc README và src/.\n>\n> Chưa viết xong docs/flows.yaml: cần hỏi lại cấu hình (khoá [đã ẩn: aws-access-key-id] trong .env).',
      );
      expect(body).not.toMatch(/AKIA[A-Z0-9]{16}/);
      expect(body).toContain(
        [
          '1. `Skill` `docs-writer`',
          '2. `mcp__tickets__update_status`',
          '3. `Read` `README.md`',
          '4. `Glob` `src`',
          '5. `Bash`',
        ].join('\n'),
      );
    }
    // The job row keeps the diagnosis for the app and web activity.
    expect(jobs[1]?.runTrace).toMatchObject({
      subtype: 'success',
      numTurns: 7,
      compactions: 0,
      lastMessageTrimmed: false,
      lastTools: expect.arrayContaining([{ tool: 'Read', target: 'README.md' }]),
    });
    expect(jobs[1]?.runTrace?.lastMessage).toContain('[đã ẩn: aws-access-key-id]');
  },

  async 'child-cap'(r) {
    const pm = await one(/^Hai trang tĩnh$/, 'pm_task');
    const children = (await all()).filter((t) => t.parentId === pm.id);
    expect(children).toHaveLength(4);
    const system = (await commentsOf(api.db, pm.id)).filter((c) => c.authorKind === 'system');
    expect(system.some((c) => c.body.includes('giới hạn 2 ticket con'))).toBe(true);
    const analyze = jobsOf(r, pm.id).filter((j) => j.stage === 'pm_analyze');
    expect(analyze.map((j) => j.askedOwner)).toEqual([true, false]);
  },

  async 'budget-hold'(r) {
    const pm = await one(/^Trang khuyến mãi$/, 'pm_task');
    const system = (await commentsOf(api.db, pm.id)).filter((c) => c.authorKind === 'system');
    expect(system.some((c) => c.body.includes('vượt ngân sách'))).toBe(true);
    expect(pm.status).toBe('done');
    expect(pm.budgetHold).toBeNull();
    // Jobs held by the budget waited queued; none was dropped.
    expect(r.daemon.daemon.state.listJobs(['skipped']).filter((j) => /budget/.test(j.error ?? ''))).toEqual(
      [],
    );
  },

  async 'pm-rejects'(r) {
    const dev = await one(/^Danh sách đơn hàng$/);
    expect(await report(dev.id)).toMatchObject({ docsFirst: false, skillsMissing: ['api-design'] });
    const bug = await one(/^Sửa: đọc docs trước/);
    expect(bug).toMatchObject({ type: 'bug', originDevId: dev.id, bugCycle: 1 });
    expect(await report(bug.id)).toMatchObject({ docsFirst: true, skillsMissing: [] });
    const pm = await one(/^Trang đơn hàng$/, 'pm_task');
    const accepts = jobsOf(r, pm.id).filter((j) => j.stage === 'pm_accept');
    expect(accepts).toHaveLength(2);
    // The first accept tried to merge and was refused: nothing reached origin until the fix.
    const firstLog = r.daemon.daemon.state.toolLog(accepts[0]?.id as string).map((e) => e.tool);
    expect(firstLog).toContain('mcp__tickets__merge_and_push');
    expect(firstLog).toContain('mcp__tickets__reject_work');
    expect(git(r.repo.remote, 'show', 'main:src/orders-fix.js')).toBeTruthy();
    expect((await report(pm.id))?.headSha).toBe(git(r.repo.remote, 'rev-parse', 'main').trim());
  },

  async 'owner-calls-pm'(r) {
    await assertDocsJobCommits(r);
    const pm = await one(/^Tính thuế đơn hàng$/, 'pm_task');
    const dev = await one(/^Áp thuế vào đơn hàng$/, 'dev');
    expect(dev).toMatchObject({
      complexity: 'medium',
      complexityReason: 'Thuế áp lên tổng đơn, ảnh hưởng thanh toán và hoá đơn',
    });
    // The tag woke the PM only: one ticket.pm_mentioned for the PM, no wake-up of the dev from that comment.
    const tagged = (await commentsOf(api.db, dev.id)).find((c) => c.body.startsWith('@pm'));
    const woken = (await api.db.select().from(events)).filter(
      (e) => e.type === 'ticket.pm_mentioned' || e.type === 'ticket.comment_added',
    );
    const byTag = woken.filter(
      (e) => (e.payload as { data: { commentId?: string } }).data.commentId === tagged?.id,
    );
    expect(byTag.map((e) => [e.type, e.ticketId, e.targetRole])).toEqual([
      ['ticket.pm_mentioned', pm.id, 'pm'],
    ]);
    // The PM's monitor run got the owner's comment and the tagged ticket, rated it and replied on it.
    const monitor = r.runs.find((run) => run.ticketId === pm.id && run.stage === 'pm_monitor');
    expect(monitor?.prompt).toContain('## Chủ dự án gọi PM (@pm)');
    expect(monitor?.prompt).toContain(`### Gọi từ ${dev.key}`);
    expect(monitor?.prompt).toContain('trạng thái `blocked`, complexity chưa đánh giá');
    expect(monitor?.prompt).toContain('@pm ticket này chưa được đánh giá độ phức tạp');
    const monitorJob = jobsOf(r, pm.id).find((j) => j.stage === 'pm_monitor');
    expect(
      r.daemon.daemon.state
        .toolLog(monitorJob?.id ?? '')
        .filter((e) => e.decision === 'allow')
        .map((e) => e.tool),
    ).toEqual(expect.arrayContaining(['mcp__tickets__rate_subtask', 'mcp__tickets__comment']));
    const replies = (await commentsOf(api.db, dev.id)).filter((c) => c.authorRole === 'pm');
    expect(replies.map((c) => c.body)).toEqual([
      'PM đã đánh giá độ phức tạp medium; ticket chạy lại trên model theo mức này.',
    ]);
    // Dev: the question, the run that could not choose a model, then the rerun on the new rating.
    expect(jobsOf(r, dev.id).map((j) => [j.kind, j.status, j.model])).toEqual([
      ['agent', 'done', 'sonnet'],
      ['agent', 'failed', null],
      ['agent', 'done', 'sonnet'],
      ['docs_update', 'done', 'sonnet'],
    ]);
    expect(jobsOf(r, dev.id)[2]?.trigger).toBe('ticket.unblocked');
  },

  async 'qc-mcp-missing'(r) {
    const qc = await one(/^QC: Trang tìm kiếm$/);
    expect(qc.status).toBe('blocked');
    const bodies = (await commentsOf(api.db, qc.id)).map((c) => c.body);
    expect(bodies.some((b) => b.includes('`playwright`') && b.includes('chưa kết nối'))).toBe(true);
    expect(r.runs.some((run) => run.ticketId === qc.id)).toBe(false);
  },

  async 'docs-only-readme'(r) {
    const dev = await one(/^Viết mục cài đặt trong README$/, 'dev');
    const devJobs = jobsOf(r, dev.id);
    expect(devJobs.map((j) => [j.kind, j.status])).toEqual([
      ['agent', 'done'],
      ['docs_update', 'done'],
    ]);
    // The dev run was refused README.md and handed off without touching code.
    const devLog = r.daemon.daemon.state.toolLog(devJobs[0]?.id ?? '');
    const readme = devLog.find((e) => e.tool === 'Write' && e.target === 'README.md');
    expect(readme?.decision).toBe('deny');
    expect(readme?.reason).toContain('README.md');
    // The docs job's commit holds README.md alone and passed the crew-docs hooks.
    const devReport = await report(dev.id);
    const commit = devReport?.commits[0] as string;
    expect(git(r.repo.repo, 'show', '--name-only', '--format=', commit).split('\n').filter(Boolean)).toEqual([
      'README.md',
    ]);
    // QC kept Playwright on the ticket but reviewed the docs-only diff statically and said why.
    const qc = await one(/^QC: Viết mục cài đặt trong README$/);
    expect(qc.requiredMcps).toEqual(['playwright']);
    const qcRun = r.runs.find((run) => run.ticketId === qc.id && run.stage === 'qc');
    expect(qcRun?.prompt).toContain('diff chỉ đổi docs');
    const qcReport = await report(qc.id);
    expect(qcReport?.summaryMd).toContain('Không có thay đổi giao diện (chỉ docs) nên không chạy test UI.');
    expect(qcReport?.mcpsUsed).toEqual([]);
    expect(qcReport?.mcpsMissing).toEqual([]);
    const qcBodies = (await commentsOf(api.db, qc.id)).map((c) => c.body);
    expect(qcBodies.some((b) => b.includes('`playwright`'))).toBe(false);
    expect(git(r.repo.remote, 'show', 'main:README.md')).toContain('## Cài đặt');
  },

  async 'ticket-images'(r) {
    await assertDocsJobCommits(r);
    const login = r.images.get('login') as PastedImage;
    const narrow = r.images.get('narrow') as PastedImage;
    const request = await one(/^Sửa bố cục trang đăng nhập$/, 'request');
    const pm = await one(/^Sửa bố cục trang đăng nhập$/, 'pm_task');
    const dev = await one(/^Sửa CSS trang đăng nhập$/, 'dev');
    const qc = await one(/^QC: Sửa CSS trang đăng nhập$/);
    const runOf = (ticketId: string, stage: string, n = 1) => {
      const run = r.runs.find(
        (entry) => entry.ticketId === ticketId && entry.stage === stage && entry.n === n,
      );
      if (!run) throw new Error(`no ${stage} run #${n}`);
      return run;
    };
    /** What a run received: every image as an intact file inside that job's own temp dir. */
    const received = (run: ReturnType<typeof runOf>) => {
      for (const image of run.images) {
        expect(image.path.startsWith(`${run.tmpDir}/`), `${run.stage} image in the job temp dir`).toBe(true);
        expect(image.intact, `${run.stage} image bytes`).toBe(true);
        expect(image.mediaType).toBe('image/png');
      }
      return run.images.map((image) => [image.index, image.id, image.source]);
    };

    // The assistant gets the image of the request's description.
    const triage = runOf(request.id, 'assistant_triage');
    expect(received(triage)).toEqual([[1, login.id, `mô tả ticket ${request.key}`]]);
    expect(triage.prompt).toContain('## Ảnh đính kèm trong ticket');
    expect(triage.prompt).toContain(
      `link \`/v1/attachments/${login.id}\` · file \`${triage.images[0]?.path}\``,
    );

    // The PM's first run gets the owner's request above its own ticket.
    const analyze = runOf(pm.id, 'pm_analyze');
    expect(analyze.resumeSessionId).toBeNull();
    expect(received(analyze)).toEqual([[1, login.id, `mô tả ticket ${request.key}`]]);

    // The owner's answer carries a new image: the resumed session gets that one only, the earlier one is
    // downloaded again for this job and listed as already sent.
    const resumed = runOf(pm.id, 'pm_analyze', 2);
    expect(resumed.resumeSessionId).toBeTruthy();
    expect(received(resumed)).toEqual([
      [
        1,
        narrow.id,
        expect.stringMatching(new RegExp(`^bình luận thứ \\d+ của ticket ${pm.key} \\(chủ dự án viết\\)$`)),
      ],
    ]);
    expect(resumed.prompt).toMatch(
      new RegExp(
        `2\\. Nguồn: mô tả ticket ${request.key} · link \`/v1/attachments/${login.id}\` · file \`${resumed.tmpDir}/ticket-images/${login.id}\\.png\` \\(image/png, 1 KB\\) · phiên này đã nhận ảnh ở lượt chạy trước, không gửi lại\\.`,
      ),
    );
    const pmJobs = jobsOf(r, pm.id).filter((j) => j.stage === 'pm_analyze');
    expect(pmJobs.map((j) => j.imagesSent)).toEqual([[login.id], [narrow.id]]);
    expect(pmJobs[1]?.sessionId).toBe(pmJobs[0]?.sessionId);

    // The PM kept the image link in the dev ticket, so the dev run gets the image and reads its file.
    expect(dev.description).toContain(`![ảnh](/v1/attachments/${login.id})`);
    const devRun = runOf(dev.id, 'dev');
    expect(received(devRun)).toEqual([[1, login.id, `mô tả ticket ${dev.key}`]]);
    const read = r.daemon.daemon.state
      .toolLog(devRun.jobId)
      .find((entry) => entry.tool === 'Read' && entry.target?.endsWith(`${login.id}.png`));
    expect(read).toMatchObject({ decision: 'allow', target: devRun.images[0]?.path });
    expect((await report(dev.id))?.docsFirst).toBe(true);

    // A ticket without an image link runs exactly as before: no images, no image section.
    const qcRun = runOf(qc.id, 'qc');
    expect(qcRun.images).toEqual([]);
    expect(qcRun.prompt).not.toContain('Ảnh đính kèm');
    expect(jobsOf(r, qc.id).map((j) => j.imagesSent)).toEqual([[]]);

    // Every job's temp dir, images included, is gone once the job ended.
    const withImages = r.runs.filter((run) => run.images.length > 0);
    expect(withImages.length).toBeGreaterThanOrEqual(5);
    await waitFor(() => r.runs.every((run) => !existsSync(run.tmpDir)), 15_000, 'job temp dirs removed');
  },
};

describe('scripted lifecycle matrix', () => {
  it('has a check for every scenario file', () => {
    expect(files.map((file) => loadScenario(join(dir, file)).name).sort()).toEqual(
      Object.keys(CHECKS).sort(),
    );
  });

  for (const file of files) {
    const scenario = loadScenario(join(dir, file));
    it(
      `${scenario.name}: ${scenario.description.slice(0, 80)}`,
      async () => {
        const result = await runScenario(api, scenario);
        try {
          expect(result.unmatched.map((u) => `${u.stage} ${u.title} #${u.n}`)).toEqual([]);
          expect(await stuckTickets(api, result.daemon.daemon.state.listJobs())).toEqual([]);
          await CHECKS[scenario.name]?.(result);
        } finally {
          await result.daemon.daemon.stop();
        }
      },
      scenario.timeoutMs + 60_000,
    );
  }
});
