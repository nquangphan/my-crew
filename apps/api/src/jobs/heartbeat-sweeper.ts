import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Executor } from '../db/client.js';
import { machines } from '../db/schema.js';
import { appendEvents } from '../services/event-service.js';

/** A machine silent for longer than this is marked offline. */
export const OFFLINE_AFTER_MS = 5 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Marks online machines whose `last_seen_at` is older than OFFLINE_AFTER_MS as offline and sends one
 * `machine.offline` per machine to the owner stream. The inbox lists the machine's open tickets with
 * `GET /v1/tickets?machineId=`. A machine comes back online on its next authenticated request; nothing
 * else changes, because the daemon resumes its own jobs.
 */
export async function sweepOfflineMachines(db: Executor, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - OFFLINE_AFTER_MS);
  return db.transaction(async (tx) => {
    const gone = await tx
      .update(machines)
      .set({ online: false })
      .where(
        and(
          eq(machines.online, true),
          isNull(machines.revokedAt),
          or(isNull(machines.lastSeenAt), lt(machines.lastSeenAt, cutoff)),
        ),
      )
      .returning({ id: machines.id });
    await appendEvents(
      tx,
      gone.map(({ id }) => ({ payload: { type: 'machine.offline' as const, data: { machineId: id } } })),
    );
    return gone.map(({ id }) => id);
  });
}

/** Runs the sweep every SWEEP_INTERVAL_MS; returns a stop function. */
export function startHeartbeatSweeper(
  db: Executor,
  log: Pick<FastifyBaseLogger, 'error'>,
  intervalMs = SWEEP_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    sweepOfflineMachines(db).catch((error: unknown) => log.error({ err: error }, 'heartbeat sweep failed'));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
