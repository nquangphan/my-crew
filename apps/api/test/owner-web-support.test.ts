import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendEvents } from '../src/services/event-service.js';
import { submitReport } from '../src/services/report-service.js';
import { addComment, createRequestTicket } from '../src/services/ticket-service.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import {
  createMachine,
  createTree,
  eventsOf,
  getTicket,
  minimalReport,
  ORIGIN,
  useTestDb,
} from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
let owner: LoggedInOwner;

beforeEach(async () => {
  app = await makeApp(ctx.db);
  owner = await seedAndLogin(app, ctx.db);
});
afterEach(() => app.close());

describe('PATCH /v1/tickets/:id (owner inline edits)', () => {
  it('updates title, description and priority by key and emits an owner-only ticket.updated', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Cũ' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/tickets/${ticket.key}`,
      headers: owner.headers,
      payload: { title: 'Tiêu đề mới', description: '# Mô tả', priority: 'urgent' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Tiêu đề mới', description: '# Mô tả', priority: 'urgent' });
    const [updated] = await eventsOf(ctx.db, 'ticket.updated');
    expect(updated).toMatchObject({ ticketId: ticket.id, targetMachineId: null });
    expect(updated?.payload).toEqual({ type: 'ticket.updated', data: { ticketId: ticket.id, change: 'fields' } });
  });

  it('rejects an empty patch, an empty title and a missing CSRF token', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Cũ' });
    const url = `/v1/tickets/${ticket.id}`;
    const empty = await app.inject({ method: 'PATCH', url, headers: owner.headers, payload: {} });
    expect(empty.statusCode).toBe(400);
    const blank = await app.inject({ method: 'PATCH', url, headers: owner.headers, payload: { title: ' ' } });
    expect(blank.statusCode).toBe(400);
    const noCsrf = await app.inject({
      method: 'PATCH',
      url,
      headers: { cookie: owner.cookie, origin: ORIGIN },
      payload: { title: 'X' },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect((await getTicket(ctx.db, ticket.id)).title).toBe('Cũ');
  });

  it('returns 404 for an unknown ticket', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/tickets/AST-999',
      headers: owner.headers,
      payload: { priority: 'low' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('ticket.updated for the owner stream', () => {
  it('is emitted, untargeted, for agent comments and new reports; owner comments keep their wake-up', async () => {
    const { pmTask } = await createTree(ctx.db);
    await addComment(ctx.db, { ticketId: pmTask.id, body: 'Hỏi', authorKind: 'agent', authorRole: 'pm' });
    await submitReport(ctx.db, pmTask.id, minimalReport());
    const updates = await eventsOf(ctx.db, 'ticket.updated');
    expect(updates.map((row) => (row.payload as { data: { change: string } }).data.change)).toEqual([
      'comment',
      'report',
    ]);
    expect(updates.every((row) => row.targetMachineId === null && row.ticketId === pmTask.id)).toBe(true);

    await addComment(ctx.db, { ticketId: pmTask.id, body: 'Trả lời', authorKind: 'owner' });
    expect(await eventsOf(ctx.db, 'ticket.updated')).toHaveLength(2);
    expect(await eventsOf(ctx.db, 'ticket.comment_added')).toHaveLength(1);
  });
});

describe('GET /v1/notices', () => {
  it('lists machine and budget notices newest first, without ticket chatter', async () => {
    const machineId = await createMachine(ctx.db, 'mac-a');
    await ctx.db.transaction((tx) =>
      appendEvents(tx, [
        { payload: { type: 'machine.claimed', data: { machineId, projectId: null, assistant: true } } },
      ]),
    );
    await ctx.db.transaction((tx) =>
      appendEvents(tx, [{ payload: { type: 'machine.offline', data: { machineId } } }]),
    );
    await createRequestTicket(ctx.db, { title: 'Không phải thông báo' });

    const res = await app.inject({ method: 'GET', url: '/v1/notices', headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((event: { type: string }) => event.type)).toEqual([
      'machine.offline',
      'machine.claimed',
    ]);

    const limited = await app.inject({
      method: 'GET',
      url: '/v1/notices?limit=1',
      headers: { cookie: owner.cookie },
    });
    expect(limited.json().items).toHaveLength(1);
    const anonymous = await app.inject({ method: 'GET', url: '/v1/notices' });
    expect(anonymous.statusCode).toBe(401);
  });
});
