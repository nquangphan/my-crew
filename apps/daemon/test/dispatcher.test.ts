import { randomUUID } from 'node:crypto';
import type { EventEnvelope, EventPayload } from '@crew/shared';
import { describe, expect, it } from 'vitest';
import { StateDb } from '../src/state-db.js';
import { dispatchEvent, foldWakeups, wakeTicket } from '../src/stream/dispatcher.js';

let seq = 0;
function envelope(payload: EventPayload, targetRole: EventEnvelope['targetRole'] = 'dev'): EventEnvelope {
  seq += 1;
  const ticketId = 'ticketId' in payload.data ? (payload.data.ticketId as string) : null;
  return {
    id: String(seq),
    type: payload.type,
    ticketId,
    projectId: 'project-1',
    targetMachineId: 'machine-1',
    targetRole,
    payload,
    createdAt: new Date().toISOString(),
  };
}

const assigned = (ticketId: string, role: 'dev' | 'qc' | 'pm' = 'dev') =>
  envelope({ type: 'ticket.assigned', data: { ticketId, role } }, role);
const comment = (ticketId: string) =>
  envelope({ type: 'ticket.comment_added', data: { ticketId, commentId: randomUUID() } });

const pmMention = (pmTaskId: string, sourceTicketId = randomUUID(), sourceTicketKey = 'WEB-7') =>
  envelope(
    {
      type: 'ticket.pm_mentioned',
      data: { ticketId: pmTaskId, sourceTicketId, sourceTicketKey, commentId: randomUUID() },
    },
    'pm',
  );

describe('owner @pm tag', () => {
  it("queues a PM job on the pm_task and records the call for the PM's prompt", () => {
    const state = new StateDb(':memory:');
    const pmTask = randomUUID();
    const source = randomUUID();
    const pmDone = state.insertJob({
      ticketId: pmTask,
      projectId: null,
      role: 'pm',
      trigger: 'ticket.assigned',
    });
    state.updateJob(pmDone.id, { status: 'done', sessionId: 'pm-session' });
    const event = pmMention(pmTask, source, 'WEB-12');
    const effect = dispatchEvent(state, event);
    expect(effect.kind === 'enqueued' && effect.job).toMatchObject({
      ticketId: pmTask,
      role: 'pm',
      kind: 'agent',
      trigger: 'ticket.pm_mentioned',
      sessionId: 'pm-session',
      eventIds: [event.id],
    });
    // Nothing is queued for the tagged ticket itself.
    expect(state.jobsForTicket(source)).toHaveLength(0);
    expect(state.pmMentions([event.id])).toEqual([
      expect.objectContaining({
        eventId: event.id,
        pmTaskId: pmTask,
        sourceTicketId: source,
        sourceTicketKey: 'WEB-12',
      }),
    ]);
  });

  it('is absorbed by a queued PM job, and folded into one follow-up run when the PM job is running', () => {
    const state = new StateDb(':memory:');
    const pmTask = randomUUID();
    dispatchEvent(state, envelope({ type: 'children.all_done', data: { ticketId: pmTask } }, 'pm'));
    const first = pmMention(pmTask);
    expect(dispatchEvent(state, first).kind).toBe('absorbed');
    const queued = state.activeJob(pmTask) as NonNullable<ReturnType<StateDb['getJob']>>;
    expect(queued.eventIds).toContain(first.id);
    expect(state.pmMentions(queued.eventIds)).toHaveLength(1);

    state.updateJob(queued.id, { status: 'running', sessionId: 'pm-1' });
    const second = pmMention(pmTask);
    const third = pmMention(pmTask);
    expect(dispatchEvent(state, second).kind).toBe('folded');
    expect(dispatchEvent(state, third).kind).toBe('folded');
    const followUp = state.transaction(() =>
      foldWakeups(state, state.updateJob(queued.id, { status: 'done' })),
    );
    expect(followUp).toMatchObject({
      ticketId: pmTask,
      role: 'pm',
      trigger: 'wakeup',
      eventIds: [second.id, third.id],
    });
    expect(state.pmMentions(followUp?.eventIds ?? []).map((m) => m.eventId)).toEqual([second.id, third.id]);
    expect(state.listJobs(['queued', 'running', 'backoff'])).toHaveLength(1);
  });

  it('records a redelivered event once', () => {
    const state = new StateDb(':memory:');
    const pmTask = randomUUID();
    const event = pmMention(pmTask);
    dispatchEvent(state, event);
    dispatchEvent(state, event);
    expect(state.pmMentions([event.id])).toHaveLength(1);
  });
});

describe('choosing the session a next run resumes', () => {
  const unblocked = (ticketId: string) => envelope({ type: 'ticket.unblocked', data: { ticketId } });

  /** A finished job of the ticket on `sessionId`. */
  function ended(
    state: StateDb,
    ticketId: string,
    sessionId: string,
    patch: Parameters<StateDb['updateJob']>[1],
  ) {
    const job = state.insertJob({ ticketId, projectId: null, role: 'dev', trigger: 'ticket.assigned' });
    return state.updateJob(job.id, { status: 'done', sessionId, ...patch });
  }

  it('never resumes a session a run left abandoned, whichever path queues the next job', () => {
    for (const reason of [
      'background_tasks',
      'aborted',
      'daemon_stopped',
      'no_result',
      'daemon_restart',
      'run_started',
    ] as const) {
      const state = new StateDb(':memory:');
      const ticket = randomUUID();
      const cut = ended(state, ticket, 's-cut', { sessionAbandoned: reason });
      // An owner event.
      const effect = dispatchEvent(state, comment(ticket));
      expect(effect.kind === 'enqueued' && effect.job.sessionId, reason).toBeNull();
      // The planner, right before the run, falls back to the ticket's latest session and says why not.
      expect(state.resumeChoice(ticket, state.latestSession(ticket, 'agent'), { trigger: 'wakeup' })).toEqual(
        {
          sessionId: null,
          interrupted: expect.objectContaining({ id: cut.id }),
        },
      );
      // A folded wake-up and a daemon-internal one.
      const active = state.activeJob(ticket) as NonNullable<ReturnType<StateDb['activeJob']>>;
      state.updateJob(active.id, { status: 'running' });
      state.appendWakeup(ticket, ['99']);
      const folded = state.transaction(() =>
        foldWakeups(state, state.updateJob(active.id, { status: 'failed' })),
      );
      expect(folded?.sessionId, reason).toBeNull();
      state.updateJob(folded?.id as string, { status: 'done' });
      expect(
        wakeTicket(state, {
          ticketId: ticket,
          projectId: null,
          role: 'dev',
          trigger: 'child.resources',
          eventId: 'x',
        }).job.sessionId,
        reason,
      ).toBeNull();
    }
  });

  it('resumes a clean session: an owner answer, a wake-up, and an unblock after a clean failure', () => {
    const state = new StateDb(':memory:');
    const ticket = randomUUID();
    ended(state, ticket, 's-clean', { askedOwner: true });
    const effect = dispatchEvent(state, comment(ticket));
    expect(effect.kind === 'enqueued' && effect.job.sessionId).toBe('s-clean');
    expect(state.resumeChoice(ticket, 's-clean', { trigger: 'ticket.comment_added' })).toEqual({
      sessionId: 's-clean',
      interrupted: null,
    });
    // Blocked after four rate limits on a clean session: the unblock resumes it.
    const other = randomUUID();
    ended(state, other, 's-api', { status: 'blocked', error: 'rate_limit', attempts: 4 });
    const again = dispatchEvent(state, unblocked(other));
    expect(again.kind === 'enqueued' && again.job.sessionId).toBe('s-api');
  });

  it('starts fresh on an unblock after no_handoff or not_finished (a session broken before the mark existed)', () => {
    for (const [status, error] of [
      ['blocked', 'no_handoff'],
      ['failed', 'no_handoff'],
      ['blocked', 'not_finished'],
      ['failed', 'not_finished'],
    ] as const) {
      const state = new StateDb(':memory:');
      const ticket = randomUUID();
      const stuck = ended(state, ticket, 's-old', { status, error });
      // A skipped wake-up (the ticket waited for the owner) in between does not hide it.
      const skipped = state.insertJob({ ticketId: ticket, projectId: null, role: 'dev', trigger: 'wakeup' });
      state.updateJob(skipped.id, { status: 'skipped', sessionId: 's-old' });
      const effect = dispatchEvent(state, unblocked(ticket));
      expect(effect.kind === 'enqueued' && effect.job.sessionId, `${status} ${error}`).toBeNull();
      const job = state.activeJob(ticket) as NonNullable<ReturnType<StateDb['activeJob']>>;
      expect(state.resumeChoice(ticket, 's-old', job)).toEqual({
        sessionId: null,
        interrupted: expect.objectContaining({ id: stuck.id }),
      });
      // Only an unblock applies the rule: an owner comment on the same history resumes.
      expect(state.resumeChoice(ticket, 's-old', { trigger: 'ticket.comment_added' }).sessionId).toBe(
        's-old',
      );
    }
    // A later clean run (the owner's answer) after an old no_handoff: the unblock resumes again.
    const state = new StateDb(':memory:');
    const ticket = randomUUID();
    ended(state, ticket, 's-old', { status: 'failed', error: 'no_handoff' });
    ended(state, ticket, 's-old', { askedOwner: true });
    expect(state.resumeChoice(ticket, 's-old', { trigger: 'ticket.unblocked' }).sessionId).toBe('s-old');
  });

  it('runs a job re-queued after a daemon stop or crash in a fresh session, older restart rows included', () => {
    const state = new StateDb(':memory:');
    const ticket = randomUUID();
    const job = state.insertJob({
      ticketId: ticket,
      projectId: null,
      role: 'pm',
      trigger: 'ticket.assigned',
    });
    for (const resumeMode of ['restart_fresh', 'restart_resume'] as const) {
      const queued = state.updateJob(job.id, { status: 'queued', sessionId: 's-pm', resumeMode });
      expect(state.resumeChoice(ticket, queued.sessionId, queued)).toEqual({
        sessionId: null,
        interrupted: expect.objectContaining({ id: job.id }),
      });
    }
  });
});

describe('dispatcher', () => {
  it('turns ticket.assigned into one queued job for the ticket role', () => {
    const state = new StateDb(':memory:');
    const ticket = randomUUID();
    const effect = dispatchEvent(state, assigned(ticket, 'qc'));
    expect(effect.kind).toBe('enqueued');
    const [job] = state.listJobs();
    expect(job).toMatchObject({
      ticketId: ticket,
      role: 'qc',
      kind: 'agent',
      status: 'queued',
      trigger: 'ticket.assigned',
    });
  });

  it("routes the owner's answer to the job kind that asked: a docs job resumes its own session", () => {
    const state = new StateDb(':memory:');
    const ticket = randomUUID();
    const dev = state.insertJob({
      ticketId: ticket,
      projectId: null,
      role: 'dev',
      trigger: 'ticket.assigned',
    });
    state.updateJob(dev.id, { status: 'done', sessionId: 's-dev', handoff: { summaryMd: 'x' } });
    const docs = state.insertJob({
      ticketId: ticket,
      projectId: null,
      role: 'dev',
      kind: 'docs_update',
      trigger: 'handoff',
    });
    state.updateJob(docs.id, { status: 'done', sessionId: 's-docs', askedOwner: true });
    const effect = dispatchEvent(state, comment(ticket));
    expect(effect.kind === 'enqueued' && effect.job).toMatchObject({
      kind: 'docs_update',
      sessionId: 's-docs',
    });
    // Without a docs question, an owner comment wakes the dev session.
    const other = randomUUID();
    const d2 = state.insertJob({ ticketId: other, projectId: null, role: 'dev', trigger: 'ticket.assigned' });
    state.updateJob(d2.id, { status: 'done', sessionId: 's-dev-2' });
    const second = dispatchEvent(state, comment(other));
    expect(second.kind === 'enqueued' && second.job).toMatchObject({ kind: 'agent', sessionId: 's-dev-2' });
  });

  it('never creates a second active job: a queued job absorbs later events', () => {
    const state = new StateDb(':memory:');
    const ticket = randomUUID();
    dispatchEvent(state, assigned(ticket));
    const effect = dispatchEvent(state, comment(ticket));
    expect(effect.kind).toBe('absorbed');
    expect(state.listJobs()).toHaveLength(1);
    expect(state.listJobs()[0]?.eventIds).toHaveLength(2);
    // The partial unique index is the hard guarantee.
    expect(() => state.insertJob({ ticketId: ticket, projectId: null, role: 'dev', trigger: 'x' })).toThrow(
      /UNIQUE/,
    );
  });

  it('folds two wake-ups for a running job into exactly one follow-up run', () => {
    const state = new StateDb(':memory:');
    const ticket = randomUUID();
    dispatchEvent(state, assigned(ticket));
    const job = state.listJobs()[0];
    if (!job) throw new Error('no job');
    state.updateJob(job.id, { status: 'running', sessionId: 'session-1' });

    expect(dispatchEvent(state, comment(ticket)).kind).toBe('folded');
    expect(
      dispatchEvent(state, envelope({ type: 'ticket.unblocked', data: { ticketId: ticket } })).kind,
    ).toBe('folded');
    expect(state.pendingWakeupCount(ticket)).toBe(2);
    expect(state.listJobs()).toHaveLength(1);

    const followUp = state.transaction(() => {
      const ended = state.updateJob(job.id, { status: 'done', endedAt: new Date().toISOString() });
      return foldWakeups(state, ended);
    });
    expect(followUp).toMatchObject({ trigger: 'wakeup', status: 'queued', sessionId: 'session-1' });
    expect(followUp?.eventIds).toHaveLength(2);
    expect(state.pendingWakeupCount(ticket)).toBe(0);
    expect(state.listJobs(['queued', 'running', 'backoff'])).toHaveLength(1);
  });

  it('folds wake-ups into a follow-up already queued in the same transaction', () => {
    const state = new StateDb(':memory:');
    const ticket = randomUUID();
    dispatchEvent(state, assigned(ticket));
    const job = state.listJobs()[0] as NonNullable<ReturnType<StateDb['getJob']>>;
    state.updateJob(job.id, { status: 'running' });
    dispatchEvent(state, comment(ticket));
    const result = state.transaction(() => {
      const ended = state.updateJob(job.id, { status: 'done' });
      const docs = state.insertJob({
        ticketId: ticket,
        projectId: null,
        role: 'dev',
        kind: 'docs_update',
        trigger: 'handoff',
      });
      return { docs, folded: foldWakeups(state, ended) };
    });
    expect(result.folded?.id).toBe(result.docs.id);
    expect(result.folded?.eventIds).toHaveLength(1);
  });

  it('resumes the ticket session on an owner comment when no job is active', () => {
    const state = new StateDb(':memory:');
    const ticket = randomUUID();
    dispatchEvent(state, assigned(ticket));
    const first = state.listJobs()[0] as NonNullable<ReturnType<StateDb['getJob']>>;
    state.updateJob(first.id, { status: 'done', sessionId: 'session-a' });
    const effect = dispatchEvent(state, comment(ticket));
    expect(effect.kind).toBe('enqueued');
    expect(effect.kind === 'enqueued' && effect.job.sessionId).toBe('session-a');
  });

  it('re-checks a job waiting on dependencies on dependency.resolved', () => {
    const state = new StateDb(':memory:');
    const ticket = randomUUID();
    dispatchEvent(state, assigned(ticket, 'qc'));
    const job = state.listJobs()[0] as NonNullable<ReturnType<StateDb['getJob']>>;
    state.updateJob(job.id, { waitingDeps: true });
    const effect = dispatchEvent(
      state,
      envelope({ type: 'dependency.resolved', data: { ticketId: ticket, dependencyId: randomUUID() } }, 'qc'),
    );
    expect(effect.kind).toBe('recheck');
    expect(state.getJob(job.id)?.waitingDeps).toBe(false);
  });

  it('cancels a queued job at once and flags a running one for abort', () => {
    const state = new StateDb(':memory:');
    const queued = randomUUID();
    const running = randomUUID();
    dispatchEvent(state, assigned(queued));
    dispatchEvent(state, assigned(running));
    const runningJob = state.activeJob(running) as NonNullable<ReturnType<StateDb['getJob']>>;
    state.updateJob(runningJob.id, { status: 'running' });
    dispatchEvent(state, comment(running));

    expect(
      dispatchEvent(state, envelope({ type: 'ticket.cancelled', data: { ticketId: queued } })).kind,
    ).toBe('cancel');
    expect(state.jobsForTicket(queued)[0]?.status).toBe('cancelled');

    const effect = dispatchEvent(state, envelope({ type: 'ticket.cancelled', data: { ticketId: running } }));
    expect(effect.kind === 'cancel' && effect.job?.cancelRequested).toBe(true);
    expect(state.pendingWakeupCount(running)).toBe(0);
  });

  it('ignores events without a job and asks for a project refresh on claim.changed and project.change_decided', () => {
    const state = new StateDb(':memory:');
    expect(
      dispatchEvent(
        state,
        envelope({ type: 'docs.synced', data: { projectId: 'p', commitSha: 'a'.repeat(40) } }),
      ).kind,
    ).toBe('ignored');
    expect(
      dispatchEvent(
        state,
        envelope({
          type: 'claim.changed',
          data: {
            claimRequestId: 'c',
            status: 'approved',
            machineId: 'm',
            previousMachineId: null,
            projectId: 'p',
            assistant: false,
          },
        }),
      ).kind,
    ).toBe('refresh_projects');
    expect(
      dispatchEvent(
        state,
        envelope({
          type: 'project.change_decided',
          data: { requestId: 'r', projectId: 'p', machineId: 'm', status: 'approved' },
        }),
      ).kind,
    ).toBe('refresh_projects');
    expect(state.listJobs()).toHaveLength(0);
  });
});

describe('runtime events', () => {
  it('asks the desktop app to check its runtime and queues no job', () => {
    const state = new StateDb(':memory:');
    const published = dispatchEvent(
      state,
      envelope({ type: 'runtime.published', data: { version: '0.3.1' } }, null),
    );
    const pinned = dispatchEvent(
      state,
      envelope({ type: 'runtime.pinned', data: { machineId: 'machine-1', version: null } }, null),
    );
    expect([published.kind, pinned.kind]).toEqual(['runtime_changed', 'runtime_changed']);
    expect(state.listJobs(['queued', 'running'])).toHaveLength(0);
  });
});
