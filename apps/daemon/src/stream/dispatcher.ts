import type { AgentRole, EventEnvelope } from '@crew/shared';
import type { JobKind, JobRow, StateDb } from '../state-db.js';

/**
 * What an event did to the local state. The daemon acts on it after the transaction commits (start the
 * scheduler, abort a running job, refresh the project view).
 */
export type DispatchEffect =
  | { kind: 'enqueued'; job: JobRow }
  /** The ticket's job has not started yet (or waits in backoff): it answers this event too. */
  | { kind: 'absorbed'; job: JobRow }
  /** The ticket's job is running: the event waits in `pending_wakeups` for one follow-up run. */
  | { kind: 'folded'; job: JobRow }
  | { kind: 'recheck'; job: JobRow }
  | { kind: 'cancel'; ticketId: string; job: JobRow | null }
  | { kind: 'refresh_projects' }
  | { kind: 'ignored'; reason: string };

/** Events that wake the ticket's assignee: a new job, or a fold into the active one. */
const WAKE_EVENTS = new Set([
  'ticket.assigned',
  'ticket.comment_added',
  'ticket.pm_mentioned',
  'children.all_done',
  'ticket.reopened',
  'ticket.unblocked',
  'dependency.resolved',
]);

function roleOf(envelope: EventEnvelope): AgentRole | null {
  if (envelope.payload.type === 'ticket.assigned') return envelope.payload.data.role;
  return envelope.targetRole;
}

/**
 * Maps one event to local jobs. Must run inside the same SQLite transaction that advances the cursor, so
 * a crash keeps both writes or neither.
 *
 * One active job per ticket: an event for a ticket whose job is queued or in backoff is absorbed by that
 * job (it has not read the ticket yet); an event for a running job is kept in `pending_wakeups`, and all
 * of them are folded into a single follow-up run when the job ends.
 */
export function dispatchEvent(state: StateDb, envelope: EventEnvelope, now = new Date()): DispatchEffect {
  const { payload } = envelope;

  // A claim moved, or the owner decided a type and UI-test MCP change: the project views are stale.
  if (payload.type === 'claim.changed' || payload.type === 'project.change_decided') {
    return { kind: 'refresh_projects' };
  }

  if (payload.type === 'ticket.cancelled') {
    const ticketId = payload.data.ticketId;
    state.dropWakeups(ticketId);
    const active = state.activeJob(ticketId);
    if (!active) return { kind: 'cancel', ticketId, job: null };
    if (active.status === 'running') {
      return { kind: 'cancel', ticketId, job: state.updateJob(active.id, { cancelRequested: true }) };
    }
    const job = state.updateJob(active.id, {
      status: 'cancelled',
      endedAt: now.toISOString(),
      error: 'ticket cancelled before the job started',
    });
    return { kind: 'cancel', ticketId, job };
  }

  if (!WAKE_EVENTS.has(payload.type) || !('ticketId' in payload.data)) {
    return { kind: 'ignored', reason: `no job for ${payload.type}` };
  }
  const ticketId = payload.data.ticketId;
  const role = roleOf(envelope);
  if (!role) return { kind: 'ignored', reason: `${payload.type} carries no target role` };
  if (payload.type === 'ticket.pm_mentioned') {
    // The PM run reads the owner's call (comment and tagged ticket) from here, whichever job answers it.
    const { sourceTicketId, sourceTicketKey, commentId } = payload.data;
    state.recordPmMention(
      { eventId: envelope.id, pmTaskId: ticketId, sourceTicketId, sourceTicketKey, commentId },
      now,
    );
  }

  const active = state.activeJob(ticketId);
  if (active) {
    if (payload.type === 'dependency.resolved' && active.status !== 'running') {
      return { kind: 'recheck', job: state.updateJob(active.id, { waitingDeps: false }) };
    }
    if (active.status === 'running') {
      state.appendWakeup(ticketId, [envelope.id], now);
      return { kind: 'folded', job: active };
    }
    return {
      kind: 'absorbed',
      job: state.updateJob(active.id, { eventIds: [...active.eventIds, envelope.id] }),
    };
  }

  const kind = payload.type === 'ticket.assigned' ? 'agent' : resumeKind(state, ticketId);
  const job = state.insertJob(
    {
      ticketId,
      projectId: envelope.projectId,
      role,
      kind,
      trigger: payload.type,
      eventIds: [envelope.id],
      sessionId: payload.type === 'ticket.assigned' ? null : state.latestSession(ticketId, kind),
    },
    now,
  );
  return { kind: 'enqueued', job };
}

/**
 * The kind of job an owner event resumes: the docs job when it was the one that asked the owner (its
 * answer belongs to that session), docs-init for a docs-init ticket, otherwise the ticket's agent run.
 */
function resumeKind(state: StateDb, ticketId: string): JobKind {
  const last = state.jobsForTicket(ticketId).at(-1);
  if (last?.kind === 'docs_init') return 'docs_init';
  if (last?.kind === 'docs_update' && last.askedOwner) return 'docs_update';
  return 'agent';
}

/**
 * Called in the transaction that ends a job: folds the ticket's pending wake-ups into one follow-up job.
 * Returns it, or null when nothing was waiting.
 */
export function foldWakeups(state: StateDb, ended: JobRow, now = new Date()): JobRow | null {
  const eventIds = state.takeWakeups(ended.ticketId);
  if (eventIds.length === 0) return null;
  // A follow-up already queued in the same transaction (e.g. the docs job after a dev handoff) answers them.
  const queued = state.activeJob(ended.ticketId);
  if (queued) return state.updateJob(queued.id, { eventIds: [...queued.eventIds, ...eventIds] });
  return state.insertJob(
    {
      ticketId: ended.ticketId,
      projectId: ended.projectId,
      role: ended.role,
      trigger: 'wakeup',
      eventIds,
      sessionId: state.latestSession(ended.ticketId, 'agent'),
    },
    now,
  );
}

/**
 * A daemon-internal wake-up of a ticket's assignee (not a server event), e.g. the PM after a child left
 * processes behind. Same one-job-per-ticket rules as events: a queued or backoff job absorbs it, a running
 * one folds it into its follow-up run, otherwise a new job is queued. Call inside a state transaction.
 */
export function wakeTicket(
  state: StateDb,
  input: { ticketId: string; projectId: string | null; role: AgentRole; trigger: string; eventId: string },
  now = new Date(),
): Extract<DispatchEffect, { job: JobRow }> {
  const active = state.activeJob(input.ticketId);
  if (active?.status === 'running') {
    state.appendWakeup(input.ticketId, [input.eventId], now);
    return { kind: 'folded', job: active };
  }
  if (active) {
    return {
      kind: 'absorbed',
      job: state.updateJob(active.id, { eventIds: [...active.eventIds, input.eventId] }),
    };
  }
  const job = state.insertJob(
    {
      ticketId: input.ticketId,
      projectId: input.projectId,
      role: input.role,
      trigger: input.trigger,
      eventIds: [input.eventId],
      sessionId: state.latestSession(input.ticketId, 'agent'),
    },
    now,
  );
  return { kind: 'enqueued', job };
}
