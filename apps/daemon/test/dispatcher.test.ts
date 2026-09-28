import { randomUUID } from 'node:crypto';
import type { EventEnvelope, EventPayload } from '@crew/shared';
import { describe, expect, it } from 'vitest';
import { StateDb } from '../src/state-db.js';
import { dispatchEvent, foldWakeups } from '../src/stream/dispatcher.js';

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
