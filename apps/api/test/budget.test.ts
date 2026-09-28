import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { budgetsUsage, tickets } from '../src/db/schema.js';
import { updateProject } from '../src/services/project-service.js';
import { getReports, submitReport } from '../src/services/report-service.js';
import { addComment, createSubtask, fileBug, transitionTicket } from '../src/services/ticket-service.js';
import {
  commentsOf,
  createDevWithQc,
  createTree,
  eventsOf,
  getTicket,
  minimalReport,
  setStatus,
  useTestDb,
} from './helpers/test-db.js';

const ctx = useTestDb();

describe('child cap', () => {
  it('enforces the default cap of 12 and parks the pm_task in needs_input', async () => {
    const { pmTask } = await createTree(ctx.db);
    for (let i = 0; i < 12; i++)
      await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: `Dev ${i}` });

    await expect(
      createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Dev 13' }),
    ).rejects.toMatchObject({
      code: 'CHILD_CAP_EXCEEDED',
      sideEffectsCommitted: true,
    });

    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('needs_input');
    expect((await getTicket(ctx.db, pmTask.id)).budgetHold).toBe('children');
    expect(await ctx.db.$count(tickets, eq(tickets.parentId, pmTask.id))).toBe(12);
    const [exceeded] = await eventsOf(ctx.db, 'budget.exceeded');
    expect(exceeded?.payload).toEqual({
      type: 'budget.exceeded',
      data: { ticketId: pmTask.id, kind: 'children' },
    });
    expect((await commentsOf(ctx.db, pmTask.id)).at(-1)?.authorKind).toBe('system');
  });

  it('keeps the agent parked until the owner approves by commenting, which lifts the cap', async () => {
    const { pmTask, project } = await createTree(ctx.db);
    await updateProject(ctx.db, project.id, { maxChildrenPerTicket: 2 });
    await createDevWithQc(ctx.db, pmTask.id);
    await expect(
      createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'x' }),
    ).rejects.toMatchObject({
      code: 'CHILD_CAP_EXCEEDED',
    });
    // A retry while parked adds no second comment or event.
    await expect(
      createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'x' }),
    ).rejects.toMatchObject({
      code: 'BUDGET_HOLD',
    });
    await expect(
      transitionTicket(ctx.db, { ticketId: pmTask.id, to: 'in_progress', actor: 'agent' }),
    ).rejects.toMatchObject({ code: 'BUDGET_HOLD' });
    expect(await eventsOf(ctx.db, 'budget.exceeded')).toHaveLength(1);

    await addComment(ctx.db, { ticketId: pmTask.id, body: 'Đồng ý, tạo thêm.', authorKind: 'owner' });

    const resumed = await getTicket(ctx.db, pmTask.id);
    expect(resumed).toMatchObject({ status: 'in_progress', budgetHold: null, childCapLifted: true });
    await expect(
      createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Thêm' }),
    ).resolves.toMatchObject({
      type: 'dev',
    });
  });

  it('counts the bug and its retest against the cap', async () => {
    const { pmTask, project } = await createTree(ctx.db);
    await updateProject(ctx.db, project.id, { maxChildrenPerTicket: 3 });
    const { qc } = await createDevWithQc(ctx.db, pmTask.id);
    await setStatus(ctx.db, qc.id, 'in_progress');
    await expect(fileBug(ctx.db, qc.id, { title: 'Lỗi' })).rejects.toMatchObject({
      code: 'CHILD_CAP_EXCEEDED',
    });
    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('needs_input');
  });
});

describe('cost budgets', () => {
  it('has no limit by default', async () => {
    const { pmTask } = await createTree(ctx.db);
    const dev = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Dev' });
    await submitReport(ctx.db, dev.id, minimalReport({ costUsd: 5_000 }));
    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('in_progress');
    expect((await getTicket(ctx.db, dev.id)).costUsd).toBe(5_000);
    expect(await eventsOf(ctx.db, 'budget.exceeded')).toHaveLength(0);
  });

  it('parks the pm_task when the ticket tree budget is exceeded, until the owner approves', async () => {
    const { pmTask, project } = await createTree(ctx.db);
    await updateProject(ctx.db, project.id, { ticketTreeBudgetUsd: 10 });
    const dev = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Dev' });
    await submitReport(ctx.db, pmTask.id, minimalReport({ costUsd: 4 }));
    await submitReport(ctx.db, dev.id, minimalReport({ costUsd: 5 }));
    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('in_progress');

    await submitReport(ctx.db, dev.id, minimalReport({ costUsd: 2 }));

    const parked = await getTicket(ctx.db, pmTask.id);
    expect(parked).toMatchObject({ status: 'needs_input', budgetHold: 'cost' });
    const [exceeded] = await eventsOf(ctx.db, 'budget.exceeded');
    expect(exceeded?.payload).toEqual({
      type: 'budget.exceeded',
      data: { ticketId: pmTask.id, kind: 'cost' },
    });

    await addComment(ctx.db, { ticketId: pmTask.id, body: 'Tiếp tục.', authorKind: 'owner' });
    await submitReport(ctx.db, dev.id, minimalReport({ costUsd: 3 }));
    expect(await getTicket(ctx.db, pmTask.id)).toMatchObject({
      status: 'in_progress',
      costBudgetLifted: true,
    });
    expect(await eventsOf(ctx.db, 'budget.exceeded')).toHaveLength(1);
  });

  it('parks the pm_task when the project daily budget is exceeded', async () => {
    const { pmTask, project } = await createTree(ctx.db);
    await updateProject(ctx.db, project.id, { dailyBudgetUsd: 1 });
    const dev = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Dev' });
    await submitReport(ctx.db, dev.id, minimalReport({ costUsd: 0.6 }));
    await submitReport(ctx.db, dev.id, minimalReport({ costUsd: 0.6 }));

    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('needs_input');
    const [usage] = await ctx.db.select().from(budgetsUsage).where(eq(budgetsUsage.projectId, project.id));
    expect(usage?.costUsd).toBeCloseTo(1.2);
  });
});

describe('reports', () => {
  it('keeps one current report plus history', async () => {
    const { pmTask } = await createTree(ctx.db);
    await submitReport(ctx.db, pmTask.id, minimalReport({ summaryMd: 'v1' }));
    const second = await submitReport(
      ctx.db,
      pmTask.id,
      minimalReport({
        summaryMd: 'v2',
        skillsSelected: [{ name: 'brainstorm', reason: 'phân tích yêu cầu' }],
        mcpsSelected: [{ server: 'playwright', reason: 'kiểm thử UI' }],
        skillsUsed: ['brainstorm'],
        testsRun: [{ name: 'pnpm test', passed: true }],
        headSha: 'abcdef1',
      }),
    );
    expect(second).toMatchObject({ version: 2, isCurrent: true, headSha: 'abcdef1' });
    const reports = await getReports(ctx.db, pmTask.id);
    expect(reports.current?.summaryMd).toBe('v2');
    expect(reports.history.map((r) => [r.version, r.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(reports.current?.skillsSelected).toEqual([{ name: 'brainstorm', reason: 'phân tích yêu cầu' }]);
  });
});
