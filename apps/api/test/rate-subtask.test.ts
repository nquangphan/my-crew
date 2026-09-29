import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { machines, modelAliasEnum, tickets } from '../src/db/schema.js';
import { createRequestTicket, createSubtask, fileBug } from '../src/services/ticket-service.js';
import { type PairedMachine, pairTestMachine, writeHeaders } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import {
  clearRating,
  createDevWithQc,
  createTestProject,
  eventsOf,
  getTicket,
  RATED,
  setStatus,
  useTestDb,
} from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
let owner: LoggedInOwner;
/** Owns projects WEB and APP. */
let a: PairedMachine;
/** Owns nothing. */
let b: PairedMachine;
let tree: Awaited<ReturnType<typeof buildTree>>;

async function pmTaskOf(projectId: string, title: string) {
  const request = await createRequestTicket(ctx.db, { title });
  const pmTask = await createSubtask(ctx.db, { type: 'pm_task', parentId: request.id, projectId, title });
  await setStatus(ctx.db, pmTask.id, 'in_progress');
  return pmTask;
}

async function buildTree() {
  const host = await pairTestMachine(ctx.db, 'mac-host');
  await ctx.db.update(machines).set({ hostsAssistant: true }).where(eq(machines.id, host.machineId));
  const project = await createTestProject(ctx.db, { ownerMachineId: a.machineId });
  const other = await createTestProject(ctx.db, {
    ownerMachineId: a.machineId,
    key: 'APP',
    name: 'Ứng dụng',
    repoUrl: 'https://github.com/2p/app.git',
  });
  const pmTask = await pmTaskOf(project.id, 'Thêm giỏ hàng');
  const { dev, qc } = await createDevWithQc(ctx.db, pmTask.id);
  const otherPm = await pmTaskOf(other.id, 'Việc của dự án khác');
  const otherDev = (await createDevWithQc(ctx.db, otherPm.id, 'Việc khác')).dev;
  return { project, pmTask, dev, qc, otherPm, otherDev };
}

beforeEach(async () => {
  app = await makeApp(ctx.db);
  owner = await seedAndLogin(app, ctx.db);
  a = await pairTestMachine(ctx.db, 'mac-a');
  b = await pairTestMachine(ctx.db, 'mac-b');
  tree = await buildTree();
});
afterEach(() => app.close());

const RATING = { complexity: 'large', complexityReason: 'Đổi lõi tính giá ở nhiều module' } as const;

const rate = (machine: PairedMachine, pmTaskId: string, payload: object, key?: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/daemon/tickets/${pmTaskId}/rate-subtask`,
    headers: writeHeaders(machine, key),
    payload,
  });

describe('Fable is not used', () => {
  it('refuses model fable on a new subtask with a clear message, and on a rating', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/daemon/tickets',
      headers: writeHeaders(a),
      payload: { type: 'dev', parentId: tree.pmTask.id, title: 'Dev', ...RATED, model: 'fable' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    expect(res.json().error.details).toEqual([
      { path: 'model', message: expect.stringContaining('Fable không được dùng') },
    ]);

    const rated = await rate(a, tree.pmTask.id, { ticket: tree.dev.id, ...RATING, model: 'fable' });
    expect(rated.statusCode).toBe(400);
    expect(rated.json().error.details).toEqual([
      { path: 'model', message: expect.stringContaining('haiku, sonnet hoặc opus') },
    ]);
    expect((await getTicket(ctx.db, tree.dev.id)).complexity).toBe('small');
  });

  it('keeps fable in the stored enum for legacy rows, spelled out (no migration drops it)', () => {
    expect(modelAliasEnum.enumValues).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
  });
});

describe('rate_subtask', () => {
  it('rates a dev subtask in place, replacing an earlier override, and tells the owner stream', async () => {
    const before = (await eventsOf(ctx.db)).length;
    // A legacy override, stored before Fable was dropped.
    await ctx.db.update(tickets).set({ model: 'fable', effort: 'max' }).where(eq(tickets.id, tree.dev.id));

    const res = await rate(a, tree.pmTask.id, { ticket: tree.dev.key, ...RATING });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: tree.dev.id,
      ...RATING,
      model: null,
      effort: null,
      status: 'todo',
    });

    const events = (await eventsOf(ctx.db)).slice(before);
    expect(events.map((e) => e.type)).toEqual(['ticket.updated']);
    expect(events[0]).toMatchObject({ ticketId: tree.dev.id, targetMachineId: null });

    // The owner's ticket detail (web Details) shows the new rating.
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${tree.dev.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(detail.json().ticket).toMatchObject(RATING);

    // A deliberate override with its reason, on the QC ticket.
    const qc = await rate(a, tree.pmTask.id, {
      ticket: tree.qc.id,
      complexity: 'medium',
      complexityReason: 'Kiểm 3 flow UI bằng Playwright',
      model: 'opus',
      effort: 'high',
    });
    expect(qc.statusCode).toBe(200);
    expect(qc.json()).toMatchObject({ complexity: 'medium', model: 'opus', effort: 'high' });
  });

  it('replays a retry with the same Idempotency-Key and writes once', async () => {
    const before = (await eventsOf(ctx.db, 'ticket.updated')).length;
    const first = await rate(a, tree.pmTask.id, { ticket: tree.dev.id, ...RATING }, 'job-5b1c0f7e-rate:1');
    const again = await rate(a, tree.pmTask.id, { ticket: tree.dev.id, ...RATING }, 'job-5b1c0f7e-rate:1');
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect((await eventsOf(ctx.db, 'ticket.updated')).length).toBe(before + 1);
    const noKey = await app.inject({
      method: 'POST',
      url: `/v1/daemon/tickets/${tree.pmTask.id}/rate-subtask`,
      headers: a.auth,
      payload: { ticket: tree.dev.id, ...RATING },
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('validates like create: complexity and a reason are required', async () => {
    const issues = async (payload: object) => {
      const res = await rate(a, tree.pmTask.id, { ticket: tree.dev.id, ...payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
      return res.json().error.details as { path: string; message: string }[];
    };
    expect(await issues({})).toEqual(
      expect.arrayContaining([
        { path: 'complexity', message: expect.stringContaining('complexity bắt buộc') },
        { path: 'complexityReason', message: expect.stringContaining('một dòng lý do') },
      ]),
    );
    expect(await issues({ complexity: 'huge', complexityReason: 'x' })).toEqual([
      { path: 'complexity', message: expect.stringContaining('trivial | small | medium | large') },
    ]);
    expect(await issues({ complexity: 'small', complexityReason: '   ' })).toEqual([
      { path: 'complexityReason', message: expect.stringContaining('một dòng lý do') },
    ]);
    expect((await getTicket(ctx.db, tree.dev.id)).complexityReason).toBe(RATED.complexityReason);
  });

  it('is scoped to the PM of the subtask: other machine, non-PM caller, other tree, closed ticket', async () => {
    const refused = async (machine: PairedMachine, callerId: string, ticket: string) => {
      const res = await rate(machine, callerId, { ticket, ...RATING });
      return { status: res.statusCode, code: res.json().error?.code as string | undefined };
    };
    // A machine that does not own the project.
    expect(await refused(b, tree.pmTask.id, tree.dev.id)).toEqual({ status: 403, code: 'FORBIDDEN' });
    // A dev or QC run (its own ticket is not a pm_task) cannot rate, even a sibling.
    expect(await refused(a, tree.qc.id, tree.dev.id)).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(await refused(a, tree.dev.id, tree.dev.id)).toEqual({ status: 403, code: 'FORBIDDEN' });
    // A subtask of another pm_task, in another project of the same machine.
    expect(await refused(a, tree.pmTask.id, tree.otherDev.id)).toEqual({ status: 403, code: 'FORBIDDEN' });
    // Only dev, qc and bug children: not the pm_task itself or a docs-init ticket.
    const docsInit = await createSubtask(ctx.db, {
      type: 'docs_init',
      parentId: tree.pmTask.id,
      title: 'Khởi tạo docs',
    });
    expect(await refused(a, tree.pmTask.id, docsInit.id)).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(await refused(a, tree.pmTask.id, tree.pmTask.id)).toEqual({ status: 403, code: 'FORBIDDEN' });
    // A finished or cancelled subtask keeps its rating.
    await setStatus(ctx.db, tree.dev.id, 'done');
    expect(await refused(a, tree.pmTask.id, tree.dev.id)).toEqual({ status: 409, code: 'TICKET_CLOSED' });
    await setStatus(ctx.db, tree.qc.id, 'cancelled');
    expect(await refused(a, tree.pmTask.id, tree.qc.key)).toEqual({ status: 409, code: 'TICKET_CLOSED' });
    expect(await refused(a, tree.pmTask.id, 'WEB-999')).toEqual({ status: 404, code: 'NOT_FOUND' });

    for (const id of [tree.dev.id, tree.qc.id, tree.otherDev.id, docsInit.id]) {
      const row = await getTicket(ctx.db, id);
      expect(row.complexity === 'large', row.key).toBe(false);
    }
  });

  it('re-queues a ticket blocked for having no rating, and wakes its machine', async () => {
    await clearRating(ctx.db, tree.dev.id);
    await setStatus(ctx.db, tree.dev.id, 'blocked');
    const before = (await eventsOf(ctx.db)).length;

    const res = await rate(a, tree.pmTask.id, { ticket: tree.dev.id, ...RATING });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'in_progress', ...RATING });

    const events = (await eventsOf(ctx.db)).slice(before);
    expect(events.map((e) => e.type)).toEqual([
      'ticket.updated',
      'ticket.status_changed',
      'ticket.unblocked',
    ]);
    expect(events[2]).toMatchObject({
      ticketId: tree.dev.id,
      targetMachineId: a.machineId,
      targetRole: 'dev',
    });
  });

  it('leaves a ticket blocked for another reason blocked', async () => {
    await setStatus(ctx.db, tree.dev.id, 'blocked');
    const before = (await eventsOf(ctx.db)).length;
    const res = await rate(a, tree.pmTask.id, { ticket: tree.dev.id, ...RATING });
    expect(res.json()).toMatchObject({ status: 'blocked', complexity: 'large' });
    expect((await eventsOf(ctx.db)).slice(before).map((e) => e.type)).toEqual(['ticket.updated']);
  });

  it('rates a bug ticket the QC filed', async () => {
    await setStatus(ctx.db, tree.qc.id, 'in_progress');
    const { bug } = await fileBug(ctx.db, tree.qc.id, { title: 'Lỗi tổng tiền' });
    const res = await rate(a, tree.pmTask.id, { ticket: bug.key, ...RATING });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ type: 'bug', ...RATING });
  });
});
