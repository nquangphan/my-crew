import { describe, expect, it } from 'vitest';
import { appendEvents } from '../src/services/event-service.js';
import { submitReport } from '../src/services/report-service.js';
import { addComment, createSubtask, transitionTicket } from '../src/services/ticket-service.js';
import {
  createDevWithQc,
  createTree,
  eventsOf,
  getTicket,
  minimalReport,
  reportAndFinish,
  setStatus,
  useTestDb,
} from './helpers/test-db.js';

const ctx = useTestDb();

describe('dependency.resolved', () => {
  it('wakes each open sibling that depends on the finished ticket', async () => {
    const { pmTask, projectMachine } = await createTree(ctx.db);
    const { dev, qc } = await createDevWithQc(ctx.db, pmTask.id);
    const other = await createSubtask(ctx.db, {
      type: 'dev',
      parentId: pmTask.id,
      title: 'Khác',
      dependsOn: [dev.id],
    });
    await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Độc lập' });

    await reportAndFinish(ctx.db, dev.id);

    const resolved = await eventsOf(ctx.db, 'dependency.resolved');
    expect(resolved.map((e) => e.ticketId).sort()).toEqual([qc.id, other.id].sort());
    const toQc = resolved.find((e) => e.ticketId === qc.id);
    expect(toQc).toMatchObject({ targetMachineId: projectMachine, targetRole: 'qc' });
    expect(toQc?.payload).toEqual({
      type: 'dependency.resolved',
      data: { ticketId: qc.id, dependencyId: dev.id },
    });
  });
});

describe('children.all_done', () => {
  it('fires once, to the parent machine, when the last open child finishes', async () => {
    const { pmTask, projectMachine } = await createTree(ctx.db);
    const { dev, qc } = await createDevWithQc(ctx.db, pmTask.id);

    await reportAndFinish(ctx.db, dev.id);
    expect(await eventsOf(ctx.db, 'children.all_done')).toHaveLength(0);
    await reportAndFinish(ctx.db, qc.id);

    const allDone = await eventsOf(ctx.db, 'children.all_done');
    expect(allDone).toHaveLength(1);
    expect(allDone[0]).toMatchObject({
      ticketId: pmTask.id,
      targetMachineId: projectMachine,
      targetRole: 'pm',
    });
  });

  it('fires exactly once when the last two children finish in concurrent transactions', async () => {
    const { request, project } = await createTree(ctx.db);
    for (let round = 0; round < 5; round++) {
      const pmTask = await createSubtask(ctx.db, {
        type: 'pm_task',
        parentId: request.id,
        projectId: project.id,
        title: `Vòng ${round}`,
      });
      const a = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'A' });
      const b = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'B' });
      for (const t of [a, b]) {
        await submitReport(ctx.db, t.id, minimalReport());
        await setStatus(ctx.db, t.id, 'in_progress');
      }
      await Promise.all([
        transitionTicket(ctx.db, { ticketId: a.id, to: 'done', actor: 'agent' }),
        transitionTicket(ctx.db, { ticketId: b.id, to: 'done', actor: 'agent' }),
      ]);
      const allDone = (await eventsOf(ctx.db, 'children.all_done')).filter((e) => e.ticketId === pmTask.id);
      expect(allDone, `round ${round}`).toHaveLength(1);
    }
  });

  it('counts cancelled children as closed', async () => {
    const { pmTask } = await createTree(ctx.db);
    const { dev, qc } = await createDevWithQc(ctx.db, pmTask.id);
    await reportAndFinish(ctx.db, dev.id);
    await transitionTicket(ctx.db, { ticketId: qc.id, to: 'cancelled', actor: 'owner' });
    expect(await eventsOf(ctx.db, 'children.all_done')).toHaveLength(1);
  });
});

describe('cascade cancel', () => {
  it('cancels every open descendant of an in_progress pm_task, one ticket.cancelled per machine', async () => {
    const { request, pmTask, projectMachine } = await createTree(ctx.db);
    const { dev, qc } = await createDevWithQc(ctx.db, pmTask.id);
    const finished = await createSubtask(ctx.db, { type: 'docs_init', parentId: pmTask.id, title: 'Docs' });
    await reportAndFinish(ctx.db, finished.id);
    await setStatus(ctx.db, dev.id, 'in_progress');

    await transitionTicket(ctx.db, { ticketId: pmTask.id, to: 'cancelled', actor: 'owner' });

    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('cancelled');
    expect((await getTicket(ctx.db, dev.id)).status).toBe('cancelled');
    expect((await getTicket(ctx.db, qc.id)).status).toBe('cancelled');
    expect((await getTicket(ctx.db, finished.id)).status).toBe('done');

    const cancelled = await eventsOf(ctx.db, 'ticket.cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({ ticketId: pmTask.id, targetMachineId: projectMachine });
    const changed = (await eventsOf(ctx.db, 'ticket.status_changed')).filter(
      (e) => (e.payload as { data: { to: string } }).data.to === 'cancelled',
    );
    expect(changed.map((e) => e.ticketId).sort()).toEqual([pmTask.id, dev.id, qc.id].sort());
    // The cancelled pm_task gets no wake-up; its request learns that its only child closed.
    const allDone = await eventsOf(ctx.db, 'children.all_done');
    expect(allDone.map((e) => e.ticketId)).toEqual([request.id]);
  });

  it('reaches every machine in the tree when the request is cancelled', async () => {
    const { request, pmTask, assistantMachine, projectMachine } = await createTree(ctx.db);
    await createDevWithQc(ctx.db, pmTask.id);
    await transitionTicket(ctx.db, { ticketId: request.id, to: 'cancelled', actor: 'owner' });
    const cancelled = await eventsOf(ctx.db, 'ticket.cancelled');
    expect(cancelled.map((e) => e.targetMachineId).sort()).toEqual([assistantMachine, projectMachine].sort());
    expect(cancelled.every((e) => e.ticketId === request.id)).toBe(true);
  });
});

describe('owner wake-ups', () => {
  it('an owner comment resumes a needs_input ticket and wakes its assignee', async () => {
    const { pmTask, projectMachine } = await createTree(ctx.db);
    await transitionTicket(ctx.db, { ticketId: pmTask.id, to: 'needs_input', actor: 'agent' });

    const comment = await addComment(ctx.db, {
      ticketId: pmTask.id,
      body: 'Dùng Stripe.',
      authorKind: 'owner',
    });

    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('in_progress');
    const [added] = await eventsOf(ctx.db, 'ticket.comment_added');
    expect(added).toMatchObject({ ticketId: pmTask.id, targetMachineId: projectMachine, targetRole: 'pm' });
    expect(added?.payload).toEqual({
      type: 'ticket.comment_added',
      data: { ticketId: pmTask.id, commentId: comment.id },
    });
  });

  it('agent comments wake nobody', async () => {
    const { pmTask } = await createTree(ctx.db);
    await transitionTicket(ctx.db, { ticketId: pmTask.id, to: 'needs_input', actor: 'agent' });
    await addComment(ctx.db, { ticketId: pmTask.id, body: 'Hỏi', authorKind: 'agent', authorRole: 'pm' });
    expect(await eventsOf(ctx.db, 'ticket.comment_added')).toHaveLength(0);
    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('needs_input');
  });

  it('done -> in_progress emits ticket.reopened and blocked -> in_progress emits ticket.unblocked', async () => {
    const { pmTask, projectMachine } = await createTree(ctx.db);
    const dev = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Dev' });
    await reportAndFinish(ctx.db, dev.id);
    await transitionTicket(ctx.db, { ticketId: dev.id, to: 'in_progress', actor: 'owner' });
    await transitionTicket(ctx.db, { ticketId: dev.id, to: 'blocked', actor: 'agent' });
    await transitionTicket(ctx.db, { ticketId: dev.id, to: 'in_progress', actor: 'owner' });

    const [reopened] = await eventsOf(ctx.db, 'ticket.reopened');
    const [unblocked] = await eventsOf(ctx.db, 'ticket.unblocked');
    expect(reopened).toMatchObject({ ticketId: dev.id, targetMachineId: projectMachine, targetRole: 'dev' });
    expect(unblocked).toMatchObject({ ticketId: dev.id, targetMachineId: projectMachine, targetRole: 'dev' });
  });
});

describe('atomic events', () => {
  it('rolls back the status change and its events when the surrounding transaction fails', async () => {
    const { pmTask } = await createTree(ctx.db);
    const dev = await createSubtask(ctx.db, { type: 'dev', parentId: pmTask.id, title: 'Dev' });
    await submitReport(ctx.db, dev.id, minimalReport());
    await setStatus(ctx.db, dev.id, 'in_progress');
    const before = (await eventsOf(ctx.db)).length;

    await expect(
      ctx.db.transaction(async (tx) => {
        await transitionTicket(tx, { ticketId: dev.id, to: 'done', actor: 'agent' });
        throw new Error('crash after the write');
      }),
    ).rejects.toThrow('crash after the write');

    expect((await getTicket(ctx.db, dev.id)).status).toBe('in_progress');
    expect(await eventsOf(ctx.db)).toHaveLength(before);
  });

  it('rejects an event that breaks the shared contract, rolling back the whole write', async () => {
    const { pmTask } = await createTree(ctx.db);
    const before = (await eventsOf(ctx.db)).length;
    await expect(
      ctx.db.transaction(async (tx) => {
        await setStatus(tx as never, pmTask.id, 'blocked');
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid payload
        await appendEvents(tx, [{ payload: { type: 'ticket.assigned', data: {} } as any }]);
      }),
    ).rejects.toThrow();
    expect((await getTicket(ctx.db, pmTask.id)).status).toBe('in_progress');
    expect(await eventsOf(ctx.db)).toHaveLength(before);
  });
});
