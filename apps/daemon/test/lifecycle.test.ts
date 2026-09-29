import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ticketReports, tickets } from '../../api/src/db/schema.js';
import { commentsOf, RATED, useApi } from './helpers/api.js';
import { git } from './helpers/git.js';
import { type LifecycleResult, loadScenario, runScenario, stuckTickets } from './helpers/lifecycle.js';
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
        writes.every((e) => !String(e.target).startsWith('docs/')),
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

  async 'qc-mcp-missing'(r) {
    const qc = await one(/^QC: Trang tìm kiếm$/);
    expect(qc.status).toBe('blocked');
    const bodies = (await commentsOf(api.db, qc.id)).map((c) => c.body);
    expect(bodies.some((b) => b.includes('`playwright`') && b.includes('chưa kết nối'))).toBe(true);
    expect(r.runs.some((run) => run.ticketId === qc.id)).toBe(false);
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
