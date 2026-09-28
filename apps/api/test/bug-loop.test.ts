import { describe, expect, it } from 'vitest';
import { tickets } from '../src/db/schema.js';
import { fileBug, MAX_BUG_CYCLES } from '../src/services/ticket-service.js';
import {
  commentsOf,
  createDevWithQc,
  createTree,
  eventsOf,
  getTicket,
  reportAndFinish,
  setStatus,
  useTestDb,
} from './helpers/test-db.js';

const ctx = useTestDb();

async function qcFilesBug(qcId: string, title: string) {
  await setStatus(ctx.db, qcId, 'in_progress');
  return fileBug(ctx.db, qcId, { title, description: 'Nút thanh toán không phản hồi.' });
}

describe('QC bug loop', () => {
  it('creates a bug for dev and a paired QC retest that depends on it', async () => {
    const { pmTask, projectMachine } = await createTree(ctx.db);
    const { dev, qc } = await createDevWithQc(ctx.db, pmTask.id);
    await reportAndFinish(ctx.db, dev.id);

    const { bug, retest } = await qcFilesBug(qc.id, 'Lỗi thanh toán');

    expect(bug).toMatchObject({
      type: 'bug',
      assigneeRole: 'dev',
      assigneeMachineId: projectMachine,
      parentId: pmTask.id,
      originDevId: dev.id,
      bugCycle: 1,
      status: 'todo',
    });
    expect(retest).toMatchObject({
      type: 'qc',
      assigneeRole: 'qc',
      parentId: pmTask.id,
      pairsWith: bug.id,
      dependsOn: [bug.id],
      originDevId: dev.id,
      bugCycle: 1,
      requiredMcps: ['playwright'],
    });
    const assigned = await eventsOf(ctx.db, 'ticket.assigned');
    expect(assigned.map((e) => e.ticketId)).toEqual(expect.arrayContaining([bug.id, retest.id]));

    await reportAndFinish(ctx.db, bug.id);
    const resolved = await eventsOf(ctx.db, 'dependency.resolved');
    expect(resolved.some((e) => e.ticketId === retest.id)).toBe(true);
  });

  it(`allows ${MAX_BUG_CYCLES} cycles, then parks the pm_task at cycle ${MAX_BUG_CYCLES + 1}`, async () => {
    const { pmTask } = await createTree(ctx.db);
    const { dev, qc } = await createDevWithQc(ctx.db, pmTask.id);
    await reportAndFinish(ctx.db, dev.id);

    let currentQc = qc.id;
    for (let cycle = 1; cycle <= MAX_BUG_CYCLES; cycle++) {
      const { bug, retest } = await qcFilesBug(currentQc, `Lỗi vòng ${cycle}`);
      expect(bug.bugCycle).toBe(cycle);
      expect(bug.originDevId).toBe(dev.id);
      await reportAndFinish(ctx.db, bug.id);
      currentQc = retest.id;
    }
    const before = await ctx.db.$count(tickets);

    await expect(qcFilesBug(currentQc, 'Lỗi vòng 4')).rejects.toMatchObject({
      code: 'BUG_CYCLE_CAP',
      statusCode: 409,
    });

    expect(await ctx.db.$count(tickets)).toBe(before);
    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('needs_input');
    const notes = await commentsOf(ctx.db, pmTask.id);
    expect(notes.at(-1)).toMatchObject({ authorKind: 'system' });
    expect(notes.at(-1)?.body).toContain('Lỗi vòng 4');
    const [exceeded] = await eventsOf(ctx.db, 'budget.exceeded');
    expect(exceeded?.payload).toEqual({
      type: 'budget.exceeded',
      data: { ticketId: pmTask.id, kind: 'bug_cycles' },
    });
    expect(exceeded?.targetMachineId).toBeNull();
  });

  it('only accepts bugs from an open, paired QC ticket', async () => {
    const { pmTask } = await createTree(ctx.db);
    const { dev, qc } = await createDevWithQc(ctx.db, pmTask.id);
    await expect(fileBug(ctx.db, dev.id, { title: 'x' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await setStatus(ctx.db, qc.id, 'done');
    await expect(fileBug(ctx.db, qc.id, { title: 'x' })).rejects.toMatchObject({ code: 'TICKET_CLOSED' });
  });
});
