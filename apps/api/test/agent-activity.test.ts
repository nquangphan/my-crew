import type { AgentActivity, HeartbeatRequest, Ticket, TicketListResponse } from '@crew/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { machines } from '../src/db/schema.js';
import { createRequestTicket } from '../src/services/ticket-service.js';
import { type PairedMachine, pairTestMachine } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { eventsOf, setStatus, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();

const RESOURCES = { cpus: 12, loadAvg1: 22.97, freeMemGb: 9, totalMemGb: 32 };

let app: FastifyInstance;
let owner: LoggedInOwner;
let mac: PairedMachine;

beforeEach(async () => {
  app = await makeApp(ctx.db);
  owner = await seedAndLogin(app, ctx.db);
  mac = await pairTestMachine(ctx.db, 'Macbook-M4');
});

afterEach(async () => {
  await app.close();
});

async function beat(body: Partial<HeartbeatRequest>, machine = mac): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/daemon/heartbeat',
    headers: machine.auth,
    payload: { resources: RESOURCES, cliVersion: '2.1.283', ...body },
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function ownerTicket(key: string): Promise<{ ticket: Ticket; children: Ticket[] }> {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/tickets/${key}`,
    headers: { cookie: owner.cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

async function ownerList(): Promise<Ticket[]> {
  const res = await app.inject({ method: 'GET', url: '/v1/tickets', headers: { cookie: owner.cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as TicketListResponse).items;
}

async function activityChanges(): Promise<string[][]> {
  return (await eventsOf(ctx.db, 'agent.activity_changed')).map(
    (row) => (row.payload as { data: { ticketIds: string[] } }).data.ticketIds,
  );
}

describe('agent activity', () => {
  it('shows what a machine runs and why its other jobs wait, on the ticket detail and list', async () => {
    const running = await createRequestTicket(ctx.db, { title: 'Đang chạy' });
    const busy = await createRequestTicket(ctx.db, { title: 'Chờ slot' });
    const deps = await createRequestTicket(ctx.db, { title: 'Chờ ticket khác' });
    const crashed = await createRequestTicket(ctx.db, { title: 'Lỗi khi chạy' });
    await setStatus(ctx.db, running.id, 'triage');
    await setStatus(ctx.db, crashed.id, 'blocked');
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const since = new Date(Date.now() - 120_000).toISOString();
    await beat({
      runningJobs: [
        {
          ticketId: running.id,
          role: 'assistant',
          kind: 'agent',
          startedAt,
          stage: 'assistant_triage',
          model: 'sonnet',
          effort: 'high',
        },
      ],
      waitingJobs: [
        {
          ticketId: busy.id,
          status: 'queued',
          role: 'assistant',
          kind: 'agent',
          since,
          waitReason: 'no_slots',
          waitDetail: { loadAvg1: 22.97, cpus: 12, maxLoad: 18, slots: 0, runningJobs: 1 },
        },
        {
          ticketId: deps.id,
          status: 'queued',
          role: 'assistant',
          since,
          waitReason: 'waiting_deps',
          waitDetail: { dependsOn: ['AST-3'] },
        },
      ],
      failedJobs: [
        {
          ticketId: crashed.id,
          role: 'assistant',
          failedAt: since,
          error: 'Error ENOENT: no such file or directory, open prompts/assistant-triage.md',
        },
      ],
    });

    const detail = await ownerTicket(running.key);
    expect(detail.ticket.agentActivity).toMatchObject({
      status: 'running',
      machineId: mac.machineId,
      machineName: 'Macbook-M4',
      stage: 'assistant_triage',
      since: startedAt,
      model: 'sonnet',
      effort: 'high',
    } satisfies Partial<AgentActivity>);

    const list = new Map((await ownerList()).map((ticket) => [ticket.id, ticket.agentActivity]));
    expect(list.get(busy.id)).toMatchObject({
      status: 'queued',
      since,
      waitReason: 'no_slots',
      waitDetail: { loadAvg1: 22.97, maxLoad: 18, slots: 0 },
    });
    expect(list.get(deps.id)).toMatchObject({
      waitReason: 'waiting_deps',
      waitDetail: { dependsOn: ['AST-3'] },
    });
    expect(list.get(crashed.id)).toMatchObject({
      status: 'failed',
      waitDetail: { message: expect.stringContaining('ENOENT') },
    });

    // One event names every ticket the first report covered.
    expect((await activityChanges()).map((ids) => [...ids].sort())).toEqual([
      [running.id, busy.id, deps.id, crashed.id].sort(),
    ]);

    // Load numbers moving is not a change; a new wait reason is, for that ticket only.
    await beat({
      runningJobs: [
        {
          ticketId: running.id,
          role: 'assistant',
          kind: 'agent',
          startedAt,
          stage: 'assistant_triage',
          model: 'sonnet',
          effort: 'high',
        },
      ],
      waitingJobs: [
        {
          ticketId: busy.id,
          status: 'queued',
          role: 'assistant',
          since,
          waitReason: 'no_slots',
          waitDetail: { loadAvg1: 30.1, cpus: 12, maxLoad: 18, slots: 0, runningJobs: 1 },
        },
        { ticketId: deps.id, status: 'queued', role: 'assistant', since, waitReason: 'check_failed' },
      ],
      failedJobs: [{ ticketId: crashed.id, role: 'assistant', failedAt: since, error: 'Error ENOENT' }],
    });
    expect(await activityChanges()).toHaveLength(2);
    expect((await activityChanges())[1]).toEqual([deps.id]);
  });

  it('reads a silent or offline machine as unknown, and names every ticket when it reports again', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Đang chạy' });
    await setStatus(ctx.db, ticket.id, 'triage');
    const job = { ticketId: ticket.id, role: 'assistant' as const, kind: 'agent' as const };
    await beat({ runningJobs: [job] });
    expect((await ownerTicket(ticket.key)).ticket.agentActivity?.status).toBe('running');

    await ctx.db
      .update(machines)
      .set({ lastHeartbeatAt: sql`now() - interval '3 minutes'` })
      .where(eq(machines.id, mac.machineId));
    expect((await ownerTicket(ticket.key)).ticket.agentActivity).toMatchObject({
      status: 'unknown',
      machineName: 'Macbook-M4',
    });

    await ctx.db.update(machines).set({ online: false }).where(eq(machines.id, mac.machineId));
    await beat({ runningJobs: [job] });
    expect((await ownerTicket(ticket.key)).ticket.agentActivity?.status).toBe('running');
    expect(await activityChanges()).toEqual([[ticket.id], [ticket.id]]);

    // The job ended: the ticket no longer has an activity (it is not waiting for an agent).
    await beat({});
    expect((await ownerTicket(ticket.key)).ticket.agentActivity).toBeNull();
    expect(await activityChanges()).toHaveLength(3);
  });

  it('handles concurrent heartbeats of one machine', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Hai heartbeat cùng lúc' });
    const job = { ticketId: ticket.id, status: 'queued' as const, waitReason: 'paused' as const };
    await Promise.all([
      beat({ waitingJobs: [job] }),
      beat({ waitingJobs: [{ ...job, waitReason: 'no_slots' }] }),
    ]);
    expect((await ownerTicket(ticket.key)).ticket.agentActivity?.status).toBe('queued');
  });

  it('names the assigned machine of a to-do ticket no machine reports', async () => {
    await ctx.db.update(machines).set({ hostsAssistant: true }).where(eq(machines.id, mac.machineId));
    const ticket = await createRequestTicket(ctx.db, { title: 'Chưa ai nhận' });
    await ctx.db.update(machines).set({ online: false }).where(eq(machines.id, mac.machineId));
    expect((await ownerTicket(ticket.key)).ticket.agentActivity).toMatchObject({
      status: 'unreported',
      machineId: mac.machineId,
      machineName: 'Macbook-M4',
      machineOnline: false,
    });
    await setStatus(ctx.db, ticket.id, 'cancelled');
    expect((await ownerTicket(ticket.key)).ticket.agentActivity).toBeNull();
  });

  it('keeps a heartbeat from a newer daemon with an unknown wait reason, and lists waiting jobs per machine', async () => {
    const ticket = await createRequestTicket(ctx.db, { title: 'Lý do mới' });
    await beat({
      waitingJobs: [
        {
          ticketId: ticket.id,
          status: 'queued',
          waitReason: 'some_future_reason' as never,
          waitDetail: { dependsOn: 'not-a-list' } as never,
        },
      ],
    });
    expect((await ownerTicket(ticket.key)).ticket.agentActivity).toMatchObject({
      status: 'queued',
      waitReason: null,
    });
    const res = await app.inject({ method: 'GET', url: '/v1/machines', headers: { cookie: owner.cookie } });
    const [machine] = res.json().items;
    expect(machine.waitingJobs).toEqual([{ ticketId: ticket.id, status: 'queued' }]);
    expect(machine.failedJobs).toEqual([]);
  });
});
