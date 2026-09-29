import { describe, expect, it } from 'vitest';
import { tickets } from '../src/db/schema.js';
import { createSubtask, fileBug, MAX_BUG_CYCLES } from '../src/services/ticket-service.js';
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

  it('lets the PM reject a finished dev ticket: a bug for dev plus a retest with the QC settings', async () => {
    const { pmTask } = await createTree(ctx.db);
    const { dev, qc } = await createDevWithQc(ctx.db, pmTask.id);
    await reportAndFinish(ctx.db, dev.id);
    await reportAndFinish(ctx.db, qc.id);

    const { bug, retest } = await fileBug(ctx.db, dev.id, {
      title: 'Sửa: đọc docs trước',
      description: 'docs_first=false',
      requiredSkills: ['api-design'],
    });
    expect(bug).toMatchObject({ type: 'bug', originDevId: dev.id, bugCycle: 1, parentId: pmTask.id });
    expect(bug.requiredSkills).toContain('api-design');
    expect(retest).toMatchObject({
      type: 'qc',
      pairsWith: bug.id,
      dependsOn: [bug.id],
      requiredMcps: ['playwright'],
    });
    // A rejected bug fix is rejected the same way, one cycle further down the chain.
    await reportAndFinish(ctx.db, bug.id);
    const again = await fileBug(ctx.db, bug.id, { title: 'Sửa lần hai' });
    expect(again.bug).toMatchObject({ originDevId: dev.id, bugCycle: 2 });
  });

  it('a bug inherits the PM rating of its origin dev ticket; the retest keeps the QC rating', async () => {
    const { pmTask } = await createTree(ctx.db);
    const dev = await createSubtask(ctx.db, {
      type: 'dev',
      parentId: pmTask.id,
      title: 'Đổi luồng thanh toán',
      complexity: 'large',
      complexityReason: 'Sửa nhiều module thanh toán',
      model: 'opus',
      effort: 'xhigh',
    });
    const qc = await createSubtask(ctx.db, {
      type: 'qc',
      parentId: pmTask.id,
      title: 'QC thanh toán',
      pairsWith: dev.id,
      complexity: 'small',
      complexityReason: 'Một flow UI',
    });
    await reportAndFinish(ctx.db, dev.id);

    const first = await qcFilesBug(qc.id, 'Lỗi vòng 1');
    expect(first.bug).toMatchObject({
      complexity: 'large',
      complexityReason: `kế thừa từ ${dev.key}: Sửa nhiều module thanh toán`,
      model: 'opus',
      effort: 'xhigh',
    });
    expect(first.retest).toMatchObject({
      complexity: 'small',
      complexityReason: `kế thừa từ ${qc.key}: Một flow UI`,
    });

    // One cycle further down the chain the bug still names the origin dev, and the reason does not nest.
    await reportAndFinish(ctx.db, first.bug.id);
    const second = await qcFilesBug(first.retest.id, 'Lỗi vòng 2');
    expect(second.bug).toMatchObject({
      complexity: 'large',
      complexityReason: `kế thừa từ ${dev.key}: Sửa nhiều module thanh toán`,
    });
    expect(second.retest.complexityReason).toBe(`kế thừa từ ${qc.key}: Một flow UI`);

    // A PM rejection of the bug fix inherits from the origin dev the same way.
    await reportAndFinish(ctx.db, second.bug.id);
    const rejected = await fileBug(ctx.db, second.bug.id, { title: 'PM từ chối' });
    expect(rejected.bug).toMatchObject({
      complexity: 'large',
      complexityReason: `kế thừa từ ${dev.key}: Sửa nhiều module thanh toán`,
    });
  });

  it('only accepts bugs from an open, paired QC ticket or a PM rejection of a done dev ticket', async () => {
    const { pmTask } = await createTree(ctx.db);
    const { dev, qc } = await createDevWithQc(ctx.db, pmTask.id);
    // The dev ticket is not done yet: nothing to reject.
    await expect(fileBug(ctx.db, dev.id, { title: 'x' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(fileBug(ctx.db, pmTask.id, { title: 'x' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await setStatus(ctx.db, qc.id, 'done');
    await expect(fileBug(ctx.db, qc.id, { title: 'x' })).rejects.toMatchObject({ code: 'TICKET_CLOSED' });
  });
});
