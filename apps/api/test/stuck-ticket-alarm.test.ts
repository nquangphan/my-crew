import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { machines } from '../src/db/schema.js';
import {
  raiseStuckTicketAlarms,
  STUCK_AFTER_MS,
  WAITING_JOBS_TTL_MS,
  WaitingJobsRegistry,
} from '../src/jobs/stuck-ticket-alarm.js';
import { listNotices } from '../src/services/event-service.js';
import { createRequestTicket, createSubtask } from '../src/services/ticket-service.js';
import { pairTestMachine } from './helpers/machines.js';
import { createTestProject, eventsOf, setStatus, testConfig, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
const NONE: ReadonlySet<string> = new Set();

/** Moves a ticket's last field change and all its events `minutes` into the past. */
async function age(ticketId: string, minutes: number) {
  const at = sql`now() - make_interval(mins => ${minutes})`;
  await ctx.db.execute(sql`update tickets set updated_at = ${at} where id = ${ticketId}`);
  await ctx.db.execute(sql`update events set created_at = ${at} where ticket_id = ${ticketId}`);
}

const QUIET = STUCK_AFTER_MS / 60_000 + 10;

async function quietRequest(title = 'Yêu cầu im lặng') {
  const ticket = await createRequestTicket(ctx.db, { title });
  await age(ticket.id, QUIET);
  return ticket;
}

async function onlineMachine(runningTicketIds: string[] = [], online = true) {
  const machine = await pairTestMachine(ctx.db, `m-${Math.random().toString(36).slice(2, 8)}`);
  await ctx.db
    .update(machines)
    .set({
      online,
      runningJobs: runningTicketIds.map((ticketId) => ({
        ticketId,
        role: 'dev' as const,
        kind: 'agent' as const,
      })),
    })
    .where(eq(machines.id, machine.machineId));
  return machine;
}

describe('stuck-ticket alarm', () => {
  it('alerts the owner inbox once for a ticket quiet for over 30 minutes', async () => {
    const ticket = await quietRequest();

    expect(await raiseStuckTicketAlarms(ctx.db, NONE)).toEqual([ticket.id]);
    const alerts = await eventsOf(ctx.db, 'ticket.stuck');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ ticketId: ticket.id, targetMachineId: null });
    expect(alerts[0]?.payload).toMatchObject({
      type: 'ticket.stuck',
      data: { ticketId: ticket.id, status: 'todo' },
    });
    // Ages come from the database clock and "now" from this process; allow a minute of skew.
    const idleMinutes =
      (alerts[0]?.payload as { data: { idleMinutes: number } } | undefined)?.data.idleMinutes ?? -1;
    expect(Math.abs(idleMinutes - QUIET)).toBeLessThanOrEqual(1);
    expect((await listNotices(ctx.db, 50)).map((notice) => notice.type)).toContain('ticket.stuck');

    // The alert itself is not activity, and the same quiet spell is never reported twice.
    expect(await raiseStuckTicketAlarms(ctx.db, NONE)).toEqual([]);
    expect(await eventsOf(ctx.db, 'ticket.stuck')).toHaveLength(1);
  });

  it('alerts again only after new activity followed by another quiet spell', async () => {
    const ticket = await quietRequest();
    await raiseStuckTicketAlarms(ctx.db, NONE);
    await ctx.db.execute(
      sql`update events set created_at = now() - interval '40 minutes' where type = 'ticket.stuck'`,
    );

    await setStatus(ctx.db, ticket.id, 'triage');
    await ctx.db.execute(
      sql`update tickets set updated_at = now() - interval '35 minutes' where id = ${ticket.id}`,
    );
    expect(await raiseStuckTicketAlarms(ctx.db, NONE)).toEqual([ticket.id]);
    expect(await eventsOf(ctx.db, 'ticket.stuck')).toHaveLength(2);
  });

  it('ignores tickets with recent activity, including a recent event on an old ticket', async () => {
    await createRequestTicket(ctx.db, { title: 'Mới tạo' });
    const old = await quietRequest('Cũ nhưng có bình luận');
    await ctx.db.execute(
      sql`insert into events (type, ticket_id, payload) values ('ticket.updated', ${old.id},
        ${JSON.stringify({ type: 'ticket.updated', data: { ticketId: old.id, change: 'comment' } })}::jsonb)`,
    );
    expect(await raiseStuckTicketAlarms(ctx.db, NONE)).toEqual([]);
  });

  it('ignores terminal tickets and tickets waiting for the owner', async () => {
    const statuses = ['done', 'cancelled', 'needs_input', 'blocked', 'in_review'] as const;
    for (const status of statuses) {
      const ticket = await createRequestTicket(ctx.db, { title: `Yêu cầu ${status}` });
      await setStatus(ctx.db, ticket.id, status);
      await age(ticket.id, QUIET);
    }
    expect(await raiseStuckTicketAlarms(ctx.db, NONE)).toEqual([]);
  });

  it('a pm_task quiet in in_review is stuck (only a request in review waits for the owner)', async () => {
    const project = await createTestProject(ctx.db);
    const request = await createRequestTicket(ctx.db, { title: 'Yêu cầu' });
    const pm = await createSubtask(ctx.db, {
      type: 'pm_task',
      parentId: request.id,
      projectId: project.id,
      title: 'PM',
    });
    await setStatus(ctx.db, pm.id, 'in_review');
    await age(pm.id, QUIET);
    await age(request.id, QUIET);
    // The request has an open child, so only the pm_task is reported.
    expect(await raiseStuckTicketAlarms(ctx.db, NONE)).toEqual([pm.id]);
  });

  it('ignores a parent with open children and a ticket with an open dependency', async () => {
    const project = await createTestProject(ctx.db);
    const request = await createRequestTicket(ctx.db, { title: 'Yêu cầu' });
    const pm = await createSubtask(ctx.db, {
      type: 'pm_task',
      parentId: request.id,
      projectId: project.id,
      title: 'PM',
    });
    const dev = await createSubtask(ctx.db, { type: 'dev', parentId: pm.id, title: 'Dev' });
    const qc = await createSubtask(ctx.db, { type: 'qc', parentId: pm.id, title: 'QC', pairsWith: dev.id });
    for (const id of [request.id, pm.id, dev.id, qc.id]) {
      await setStatus(ctx.db, id, 'in_progress');
      await age(id, QUIET);
    }
    // request and pm_task wait for children, qc waits for its dev: only the dev is stuck.
    expect(await raiseStuckTicketAlarms(ctx.db, NONE)).toEqual([dev.id]);
  });

  it('ignores tickets an online machine runs or holds in its queue or backoff', async () => {
    const running = await quietRequest('Đang chạy');
    const parked = await quietRequest('Đang chờ thử lại');
    const offline = await quietRequest('Máy offline');
    await onlineMachine([running.id]);
    await onlineMachine([offline.id], false);

    expect(await raiseStuckTicketAlarms(ctx.db, new Set([parked.id]))).toEqual([offline.id]);
  });
});

describe('waiting jobs from heartbeats', () => {
  it('the heartbeat records queued and backoff jobs; a stale report expires', async () => {
    const registry = new WaitingJobsRegistry();
    const app = await buildApp({
      config: testConfig(),
      db: ctx.db,
      realtime: { sweeper: false },
      waitingJobs: registry,
    });
    const machine = await pairTestMachine(ctx.db, 'mac');
    const parked = await quietRequest('Chờ thử lại');
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/daemon/heartbeat',
        headers: machine.auth,
        payload: {
          resources: { cpus: 8, loadAvg1: 1, freeMemGb: 8, totalMemGb: 16 },
          cliVersion: '2.1.283',
          waitingJobs: [{ ticketId: parked.id, status: 'backoff', retryAt: new Date().toISOString() }],
        },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
    expect([...registry.ticketIds()]).toEqual([parked.id]);
    expect(await raiseStuckTicketAlarms(ctx.db, registry.ticketIds())).toEqual([]);
    expect([...registry.ticketIds(Date.now() + WAITING_JOBS_TTL_MS + 1_000)]).toEqual([]);
  });

  it('rejects a malformed waiting job', async () => {
    const app = await buildApp({ config: testConfig(), db: ctx.db, realtime: { sweeper: false } });
    const machine = await pairTestMachine(ctx.db, 'mac');
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/daemon/heartbeat',
        headers: machine.auth,
        payload: {
          resources: { cpus: 8, loadAvg1: 1, freeMemGb: 8, totalMemGb: 16 },
          cliVersion: '2.1.283',
          waitingJobs: [{ ticketId: 'not-a-uuid', status: 'sleeping' }],
        },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
