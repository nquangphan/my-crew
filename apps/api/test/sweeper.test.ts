import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { machines } from '../src/db/schema.js';
import { OFFLINE_AFTER_MS, sweepOfflineMachines } from '../src/jobs/heartbeat-sweeper.js';
import { pairTestMachine } from './helpers/machines.js';
import { makeApp } from './helpers/owner-session.js';
import { eventsOf, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();

async function lastSeen(machineId: string, agoMs: number) {
  const at = new Date(Date.now() - agoMs).toISOString();
  await ctx.db.execute(sql`update machines set last_seen_at = ${at}::timestamptz where id = ${machineId}`);
}

async function machine(machineId: string) {
  const [row] = await ctx.db.select().from(machines).where(eq(machines.id, machineId));
  if (!row) throw new Error('machine missing');
  return row;
}

describe('heartbeat sweeper', () => {
  it('marks a machine silent for over 5 minutes offline, once, and alerts the owner stream', async () => {
    const stale = await pairTestMachine(ctx.db, 'stale');
    const fresh = await pairTestMachine(ctx.db, 'fresh');
    await lastSeen(stale.machineId, OFFLINE_AFTER_MS + 60_000);
    await lastSeen(fresh.machineId, OFFLINE_AFTER_MS - 60_000);

    expect(await sweepOfflineMachines(ctx.db)).toEqual([stale.machineId]);
    expect((await machine(stale.machineId)).online).toBe(false);
    expect((await machine(fresh.machineId)).online).toBe(true);
    const offline = await eventsOf(ctx.db, 'machine.offline');
    expect(offline).toHaveLength(1);
    expect(offline[0]).toMatchObject({ targetMachineId: null });
    expect(offline[0]?.payload).toEqual({ type: 'machine.offline', data: { machineId: stale.machineId } });

    expect(await sweepOfflineMachines(ctx.db)).toEqual([]);
    expect(await eventsOf(ctx.db, 'machine.offline')).toHaveLength(1);
  });

  it('a machine that comes back is marked online and nothing else happens', async () => {
    const m = await pairTestMachine(ctx.db, 'm1');
    await lastSeen(m.machineId, OFFLINE_AFTER_MS + 1_000);
    await sweepOfflineMachines(ctx.db);
    const eventsBefore = (await eventsOf(ctx.db)).length;

    const app = await makeApp(ctx.db);
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/daemon/projects', headers: m.auth });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
    const row = await machine(m.machineId);
    expect(row.online).toBe(true);
    expect(Date.now() - (row.lastSeenAt?.getTime() ?? 0)).toBeLessThan(10_000);
    expect(await eventsOf(ctx.db)).toHaveLength(eventsBefore);
  });

  it('ignores revoked machines', async () => {
    const m = await pairTestMachine(ctx.db, 'm1');
    await ctx.db.update(machines).set({ revokedAt: new Date() }).where(eq(machines.id, m.machineId));
    await lastSeen(m.machineId, OFFLINE_AFTER_MS * 2);
    expect(await sweepOfflineMachines(ctx.db)).toEqual([]);
  });
});
