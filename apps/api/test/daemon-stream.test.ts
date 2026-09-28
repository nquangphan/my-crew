import { randomUUID } from 'node:crypto';
import { asc, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { events, machines } from '../src/db/schema.js';
import { appendEvents } from '../src/services/event-service.js';
import {
  emitEvents,
  openSse,
  pairTestMachine,
  type SseClient,
  sleep,
  startServer,
  type TestServer,
  within,
} from './helpers/machines.js';
import { seedAndLogin } from './helpers/owner-session.js';
import { useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let server: TestServer | undefined;
const clients: SseClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server?.app.close();
  server = undefined;
});

/** LISTEN on, poll effectively off: anything delivered quickly came through NOTIFY. */
async function start(realtime: Parameters<typeof startServer>[1] = { pollMs: 60_000 }) {
  server = await startServer(ctx.db, realtime);
  return server;
}

async function connect(path: string, headers: Record<string, string>) {
  if (!server) throw new Error('server not started');
  const client = await openSse(`${server.url}${path}`, headers);
  clients.push(client);
  return client;
}

const ticketIdsOf = (list: { ticketId: string | null }[]) => list.map((e) => e.ticketId);

describe('GET /v1/daemon/stream', () => {
  it('after a disconnect, 5 events appended meanwhile all arrive in order on reconnect', async () => {
    await start();
    const m = await pairTestMachine(ctx.db, 'm1');
    const before = await emitEvents(ctx.db, m.machineId, 2);

    const first = await connect('/v1/daemon/stream', m.auth);
    expect(first.status).toBe(200);
    const seen = await first.waitFor(2);
    expect(ticketIdsOf(seen)).toEqual(before);
    first.close();
    await first.closed;

    const missed = await emitEvents(ctx.db, m.machineId, 5);
    const lastId = seen.at(-1)?.id ?? '';
    const second = await connect('/v1/daemon/stream', { ...m.auth, 'last-event-id': lastId });
    const replayed = await second.waitFor(5);
    await sleep(150);
    expect(second.events).toHaveLength(5);
    expect(ticketIdsOf(replayed)).toEqual(missed);
    const ids = replayed.map((e) => BigInt(e.id));
    expect(ids.every((id, i) => i === 0 || id > (ids[i - 1] as bigint))).toBe(true);
    expect(ids[0]).toBeGreaterThan(BigInt(lastId));
  });

  it('delivers live events through LISTEN/NOTIFY, only those targeted at the machine', async () => {
    await start();
    const m = await pairTestMachine(ctx.db, 'm1');
    const other = await pairTestMachine(ctx.db, 'm2');
    const stream = await connect('/v1/daemon/stream', m.auth);
    await sleep(100);

    await emitEvents(ctx.db, other.machineId, 1);
    await emitEvents(ctx.db, null, 1);
    const mine = await emitEvents(ctx.db, m.machineId, 1);
    const got = await stream.waitFor(1, 2_000);
    await sleep(150);
    expect(ticketIdsOf(stream.events)).toEqual(mine);
    expect(got[0]).toMatchObject({ targetMachineId: m.machineId, type: 'ticket.unblocked' });
  });

  it('falls back to polling when LISTEN is unavailable', async () => {
    await start({ listen: false, pollMs: 100 });
    const m = await pairTestMachine(ctx.db, 'm1');
    const stream = await connect('/v1/daemon/stream', m.auth);
    await sleep(50);
    const sent = await emitEvents(ctx.db, m.machineId, 3);
    expect(ticketIdsOf(await stream.waitFor(3, 2_000))).toEqual(sent);
  });

  it('recovers when the LISTEN connection is killed', async () => {
    await start();
    const m = await pairTestMachine(ctx.db, 'm1');
    const stream = await connect('/v1/daemon/stream', m.auth);
    await sleep(50);
    const killed = await ctx.db.execute<{ ok: boolean }>(sql`
      select pg_terminate_backend(pid) as ok from pg_stat_activity
      where datname = current_database() and query ilike 'listen%'`);
    expect(killed.length).toBeGreaterThan(0);
    // An event committed while the listener is down is picked up on reconnect (the re-listen triggers a
    // catch-up read); later events flow through NOTIFY again. The poll is 60 s, so it cannot be the poll.
    const during = await emitEvents(ctx.db, m.machineId, 1);
    await sleep(1_500);
    const after = await emitEvents(ctx.db, m.machineId, 1);
    expect(ticketIdsOf(await stream.waitFor(2, 5_000))).toEqual([...during, ...after]);
  });

  it('loses nothing when transactions commit out of id order', async () => {
    await start();
    const m = await pairTestMachine(ctx.db, 'm1');
    const stream = await connect('/v1/daemon/stream', m.auth);
    await sleep(50);

    const slowTicket = randomUUID();
    let release!: () => void;
    let inserted!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const insertedSignal = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    // Transaction A takes its event id first but commits last.
    const slow = ctx.db.transaction(async (tx) => {
      await appendEvents(tx, [
        {
          payload: { type: 'ticket.unblocked', data: { ticketId: slowTicket } },
          ticketId: slowTicket,
          targetMachineId: m.machineId,
        },
      ]);
      inserted();
      await held;
    });
    await insertedSignal;
    const [fast] = await emitEvents(ctx.db, m.machineId, 1);
    const firstSeen = await stream.waitFor(1, 2_000);
    expect(firstSeen[0]?.ticketId).toBe(fast);

    release();
    await slow;
    const both = await stream.waitFor(2, 2_000);
    expect(ticketIdsOf(both)).toEqual([fast, slowTicket]);

    // Insert ids are in the opposite order; delivery sequence follows commit order.
    const rows = await ctx.db.select().from(events).orderBy(asc(events.id));
    expect(rows.map((r) => r.ticketId)).toEqual([slowTicket, fast]);
    expect(BigInt(both[1]?.id ?? 0)).toBeGreaterThan(BigInt(both[0]?.id ?? 0));

    // A reader that stopped right after the fast event still gets the slow one on resume.
    const resumed = await connect('/v1/daemon/stream', { ...m.auth, 'last-event-id': both[0]?.id ?? '' });
    expect(ticketIdsOf(await resumed.waitFor(1))).toEqual([slowTicket]);
  });

  it('accepts ?cursor, rejects a bad cursor and a missing token', async () => {
    await start();
    const m = await pairTestMachine(ctx.db, 'm1');
    const sent = await emitEvents(ctx.db, m.machineId, 3);
    const all = await connect('/v1/daemon/stream', m.auth);
    const seen = await all.waitFor(3);
    const fromCursor = await connect(`/v1/daemon/stream?cursor=${seen[0]?.id}`, m.auth);
    expect(ticketIdsOf(await fromCursor.waitFor(2))).toEqual(sent.slice(1));

    const bad = await connect('/v1/daemon/stream', { ...m.auth, 'last-event-id': 'abc' });
    expect(bad.status).toBe(400);
    const anonymous = await connect('/v1/daemon/stream', {});
    expect(anonymous.status).toBe(401);
  });

  it('an owner request reaches the assistant host within a second', async () => {
    const { app } = await start();
    const ownerSession = await seedAndLogin(app, ctx.db);
    const host = await pairTestMachine(ctx.db, 'host');
    await app.inject({
      method: 'POST',
      url: '/v1/daemon/claims',
      headers: { ...host.auth, 'idempotency-key': 'claim-assistant-1' },
      payload: { hostsAssistant: true },
    });
    const stream = await connect('/v1/daemon/stream', host.auth);
    await sleep(50);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers: ownerSession.headers,
      payload: { title: 'Sửa trang thanh toán' },
    });
    expect(created.statusCode).toBe(201);
    const [event] = await within(stream.waitFor(1), 1_000, 'ticket.assigned delivery');
    expect(event).toMatchObject({
      type: 'ticket.assigned',
      ticketId: created.json().id,
      targetRole: 'assistant',
      payload: { data: { role: 'assistant' } },
    });
  });

  it('reports streamConnected on the machines list while a stream is open', async () => {
    const { app } = await start();
    const ownerSession = await seedAndLogin(app, ctx.db);
    const m = await pairTestMachine(ctx.db, 'm1');
    await connect('/v1/daemon/stream', m.auth);
    await sleep(50);
    const res = await app.inject({ method: 'GET', url: '/v1/machines', headers: ownerSession.headers });
    expect(res.json().items[0]).toMatchObject({ id: m.machineId, streamConnected: true });
    expect(await ctx.db.$count(machines)).toBe(1);
  });
});

describe('GET /v1/stream (owner)', () => {
  it('carries every event, starts at the newest without a cursor and resumes from Last-Event-ID', async () => {
    const { app } = await start();
    const ownerSession = await seedAndLogin(app, ctx.db);
    const m = await pairTestMachine(ctx.db, 'm1');
    await emitEvents(ctx.db, m.machineId, 2);

    const live = await connect('/v1/stream', { cookie: ownerSession.cookie });
    expect(live.status).toBe(200);
    await sleep(100);
    const toMachine = await emitEvents(ctx.db, m.machineId, 1);
    const ownerOnly = await emitEvents(ctx.db, null, 1);
    const got = await live.waitFor(2, 2_000);
    await sleep(150);
    expect(ticketIdsOf(live.events)).toEqual([...toMachine, ...ownerOnly]);

    live.close();
    await live.closed;
    const missed = [...(await emitEvents(ctx.db, null, 2)), ...(await emitEvents(ctx.db, m.machineId, 1))];
    const resumed = await connect('/v1/stream', {
      cookie: ownerSession.cookie,
      'last-event-id': got[1]?.id ?? '',
    });
    expect(ticketIdsOf(await resumed.waitFor(3))).toEqual(missed);
  });

  it('requires the owner session and ignores machine tokens', async () => {
    await start();
    const m = await pairTestMachine(ctx.db, 'm1');
    expect((await connect('/v1/stream', {})).status).toBe(401);
    expect((await connect('/v1/stream', m.auth)).status).toBe(401);
  });
});
