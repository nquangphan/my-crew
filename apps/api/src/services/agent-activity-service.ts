import {
  AGENT_ACTIVITY_STALE_MS,
  type AgentActivity,
  type FailedJob,
  type RunningJob,
  type Ticket,
  type WaitingJob,
} from '@crew/shared';
import { isNull } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { type MachineRow, machines, type TicketRow } from '../db/schema.js';

/** The job lists one heartbeat reports. */
export interface ReportedJobs {
  runningJobs: readonly RunningJob[];
  waitingJobs: readonly WaitingJob[];
  failedJobs: readonly FailedJob[];
}

/**
 * Per ticket, the reported fields the owner reads: status, stage, model, wait reason and the facts shown
 * with it. Load, memory and slot numbers are left out, so a busy machine does not count as a change on
 * every heartbeat.
 */
export function activitySignatures(jobs: ReportedJobs): Map<string, string> {
  const out = new Map<string, string>();
  for (const job of jobs.failedJobs) out.set(job.ticketId, JSON.stringify(['failed', job.failedAt]));
  for (const job of jobs.waitingJobs) {
    const detail = job.waitDetail ?? {};
    out.set(
      job.ticketId,
      JSON.stringify([
        job.status,
        job.stage ?? null,
        job.waitReason ?? null,
        job.retryAt ?? null,
        detail.dependsOn ?? null,
        detail.projectKey ?? null,
        detail.retryAt ?? null,
        detail.message ?? null,
      ]),
    );
  }
  for (const job of jobs.runningJobs) {
    out.set(
      job.ticketId,
      JSON.stringify([
        'running',
        job.startedAt ?? null,
        job.stage ?? null,
        job.model ?? null,
        job.effort ?? null,
      ]),
    );
  }
  return out;
}

/** Tickets whose reported activity differs between two heartbeats (appeared, changed or gone). */
export function changedTicketIds(before: Map<string, string>, after: Map<string, string>): string[] {
  const ids = new Set<string>();
  for (const [id, signature] of after) if (before.get(id) !== signature) ids.add(id);
  for (const id of before.keys()) if (!after.has(id)) ids.add(id);
  return [...ids];
}

/** A machine's latest heartbeat still describes it: online and heard from within the stale window. */
export function heartbeatFresh(
  machine: Pick<MachineRow, 'online' | 'lastHeartbeatAt'>,
  now = new Date(),
): boolean {
  return (
    machine.online &&
    machine.lastHeartbeatAt !== null &&
    now.getTime() - machine.lastHeartbeatAt.getTime() <= AGENT_ACTIVITY_STALE_MS
  );
}

type MachineView = Pick<
  MachineRow,
  'id' | 'name' | 'online' | 'lastHeartbeatAt' | 'runningJobs' | 'waitingJobs' | 'failedJobs'
>;

/** Lower wins: a fresh running job over a fresh waiting one over a fresh failure over anything stale. */
const RANK: Record<AgentActivity['status'], number> = {
  running: 0,
  queued: 1,
  backoff: 1,
  failed: 2,
  unknown: 3,
  unreported: 4,
};

function reportedActivity(machine: MachineView, fresh: boolean): Map<string, AgentActivity> {
  const base = {
    machineId: machine.id,
    machineName: machine.name,
    machineOnline: machine.online,
    reportedAt: machine.lastHeartbeatAt?.toISOString() ?? null,
  };
  const out = new Map<string, AgentActivity>();
  for (const job of machine.failedJobs) {
    out.set(job.ticketId, {
      ...base,
      status: 'failed',
      role: job.role,
      stage: job.stage ?? null,
      since: job.failedAt,
      model: null,
      effort: null,
      waitReason: null,
      waitDetail: { message: job.error },
    });
  }
  for (const job of machine.waitingJobs) {
    out.set(job.ticketId, {
      ...base,
      status: fresh ? job.status : 'unknown',
      role: job.role ?? null,
      stage: job.stage ?? null,
      since: job.since ?? null,
      model: null,
      effort: null,
      waitReason: fresh ? (job.waitReason ?? (job.retryAt ? 'retry_at' : null)) : null,
      waitDetail: fresh ? (job.waitDetail ?? (job.retryAt ? { retryAt: job.retryAt } : null)) : null,
    });
  }
  for (const job of machine.runningJobs) {
    out.set(job.ticketId, {
      ...base,
      status: fresh ? 'running' : 'unknown',
      role: job.role,
      stage: job.stage ?? null,
      since: job.startedAt ?? null,
      model: job.model ?? null,
      effort: job.effort ?? null,
      waitReason: null,
      waitDetail: null,
    });
  }
  return out;
}

/**
 * The agent activity of each ticket, from the machines' latest heartbeats. A job reported by a machine
 * that is offline or silent for AGENT_ACTIVITY_STALE_MS is `unknown`, never `running`. A `todo` ticket no
 * machine reports is `unreported`, naming the machine it is assigned to. Failures and unreported states
 * are not shown for closed tickets; other tickets without a report get null.
 */
export async function loadAgentActivity(
  db: Executor,
  tickets: readonly Pick<TicketRow, 'id' | 'status' | 'assigneeMachineId'>[],
  now = new Date(),
): Promise<Map<string, AgentActivity | null>> {
  const result = new Map<string, AgentActivity | null>();
  if (tickets.length === 0) return result;
  const rows: MachineView[] = await db
    .select({
      id: machines.id,
      name: machines.name,
      online: machines.online,
      lastHeartbeatAt: machines.lastHeartbeatAt,
      runningJobs: machines.runningJobs,
      waitingJobs: machines.waitingJobs,
      failedJobs: machines.failedJobs,
    })
    .from(machines)
    .where(isNull(machines.revokedAt));
  const best = new Map<string, AgentActivity>();
  for (const machine of rows) {
    for (const [ticketId, activity] of reportedActivity(machine, heartbeatFresh(machine, now))) {
      const current = best.get(ticketId);
      if (!current || RANK[activity.status] < RANK[current.status]) best.set(ticketId, activity);
    }
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const ticket of tickets) {
    const closed = ticket.status === 'done' || ticket.status === 'cancelled';
    const reported = best.get(ticket.id);
    if (reported && !(closed && reported.status === 'failed')) {
      result.set(ticket.id, reported);
    } else if (ticket.status === 'todo') {
      const host = ticket.assigneeMachineId ? byId.get(ticket.assigneeMachineId) : undefined;
      result.set(ticket.id, {
        status: 'unreported',
        machineId: host?.id ?? null,
        machineName: host?.name ?? null,
        machineOnline: host ? heartbeatFresh(host, now) : false,
        role: null,
        stage: null,
        since: null,
        model: null,
        effort: null,
        waitReason: null,
        waitDetail: null,
        reportedAt: host?.lastHeartbeatAt?.toISOString() ?? null,
      });
    } else {
      result.set(ticket.id, null);
    }
  }
  return result;
}

/** Owner DTOs with their agent activity attached. */
export async function withAgentActivity<T extends Ticket>(db: Executor, list: readonly T[]): Promise<T[]> {
  const activity = await loadAgentActivity(db, list);
  return list.map((ticket) => ({ ...ticket, agentActivity: activity.get(ticket.id) ?? null }));
}
