import type { RunningJob, TicketStatus, WaitingJob } from '@crew/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Executor } from '../db/client.js';
import { machines } from '../db/schema.js';
import { appendEvents } from '../services/event-service.js';

/** A ticket quiet for longer than this, with nothing held for it anywhere, raises an alert. */
export const STUCK_AFTER_MS = 30 * 60 * 1000;
export const STUCK_CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Waiting jobs of a machine whose last heartbeat is older than this no longer count (heartbeats: 30 s). */
export const WAITING_JOBS_TTL_MS = 2 * 60 * 1000;

/**
 * The queued and backoff jobs each machine reported in its latest heartbeat. Kept in memory: the API runs
 * as one process, and after a restart the next heartbeats (every 30 s) refill it well before the first
 * check (5 min after start).
 */
export class WaitingJobsRegistry {
  private readonly byMachine = new Map<string, { at: number; ticketIds: string[] }>();

  record(machineId: string, jobs: readonly WaitingJob[], now = Date.now()): void {
    this.byMachine.set(machineId, { at: now, ticketIds: jobs.map((job) => job.ticketId) });
  }

  /** Tickets with a waiting job on a machine that reported within WAITING_JOBS_TTL_MS. */
  ticketIds(now = Date.now()): Set<string> {
    const ids = new Set<string>();
    for (const [machineId, entry] of this.byMachine) {
      if (now - entry.at > WAITING_JOBS_TTL_MS) {
        this.byMachine.delete(machineId);
        continue;
      }
      for (const id of entry.ticketIds) ids.add(id);
    }
    return ids;
  }
}

export interface StuckTicket {
  id: string;
  projectId: string | null;
  status: TicketStatus;
  lastActivityAt: Date;
}

interface CandidateRow extends Record<string, unknown> {
  id: string;
  project_id: string | null;
  status: TicketStatus;
  last_activity: Date | string;
  last_alert: Date | string | null;
}

/**
 * Non-terminal tickets that are neither waiting for the owner nor for other tickets, whose last activity
 * (a field change or any event other than a stuck alert) is older than STUCK_AFTER_MS, that no online
 * machine runs, queues or parks a job for, and that have not been alerted since that last activity.
 *
 * Waiting for the owner: needs_input, blocked, and a request in in_review (the owner accepts it). Waiting
 * for other tickets: an open child (the parent resumes on `children.all_done`) or an open dependency.
 */
export async function findStuckTickets(
  db: Executor,
  waiting: ReadonlySet<string>,
  now = new Date(),
): Promise<StuckTicket[]> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
  const rows = await db.execute<CandidateRow>(sql`
    select c.id, c.project_id, c.status,
      greatest(c.updated_at, coalesce(
        (select max(e.created_at) from events e where e.ticket_id = c.id and e.type <> 'ticket.stuck'),
        c.updated_at)) as last_activity,
      (select max(e.created_at) from events e where e.ticket_id = c.id and e.type = 'ticket.stuck') as last_alert
    from tickets c
    where c.status not in ('done', 'cancelled', 'needs_input', 'blocked')
      and not (c.type = 'request' and c.status = 'in_review')
      and c.updated_at < ${cutoff.toISOString()}::timestamptz
      and not exists (
        select 1 from tickets child where child.parent_id = c.id and child.status not in ('done', 'cancelled'))
      and not exists (
        select 1 from tickets dep where dep.id = any(c.depends_on) and dep.status not in ('done', 'cancelled'))
  `);
  const candidates = rows.filter((row) => {
    const lastActivity = new Date(row.last_activity);
    if (lastActivity >= cutoff) return false;
    return row.last_alert === null || new Date(row.last_alert) < lastActivity;
  });
  if (candidates.length === 0) return [];

  const held = new Set(waiting);
  const online = await db
    .select({ runningJobs: machines.runningJobs })
    .from(machines)
    .where(and(eq(machines.online, true), isNull(machines.revokedAt)));
  for (const { runningJobs } of online) {
    for (const job of runningJobs as RunningJob[]) held.add(job.ticketId);
  }
  return candidates
    .filter((row) => !held.has(row.id))
    .map((row) => ({
      id: row.id,
      projectId: row.project_id,
      status: row.status,
      lastActivityAt: new Date(row.last_activity),
    }));
}

/** Sends one `ticket.stuck` inbox alert per stuck ticket; returns their ids. */
export async function raiseStuckTicketAlarms(
  db: Executor,
  waiting: ReadonlySet<string>,
  now = new Date(),
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const stuck = await findStuckTickets(tx, waiting, now);
    await appendEvents(
      tx,
      stuck.map((ticket) => ({
        ticketId: ticket.id,
        projectId: ticket.projectId,
        payload: {
          type: 'ticket.stuck' as const,
          data: {
            ticketId: ticket.id,
            status: ticket.status,
            idleMinutes: Math.floor((now.getTime() - ticket.lastActivityAt.getTime()) / 60_000),
          },
        },
      })),
    );
    return stuck.map((ticket) => ticket.id);
  });
}

/** Runs the check every STUCK_CHECK_INTERVAL_MS; returns a stop function. */
export function startStuckTicketAlarm(
  db: Executor,
  registry: WaitingJobsRegistry,
  log: Pick<FastifyBaseLogger, 'error' | 'warn'>,
  intervalMs = STUCK_CHECK_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    raiseStuckTicketAlarms(db, registry.ticketIds()).then(
      (ids) => {
        if (ids.length > 0) log.warn({ tickets: ids }, 'stuck tickets reported to the inbox');
      },
      (error: unknown) => log.error({ err: error }, 'stuck-ticket check failed'),
    );
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
