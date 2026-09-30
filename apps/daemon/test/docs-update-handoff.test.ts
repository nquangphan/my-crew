import { describe, expect, it } from 'vitest';
import { afterDevRun, afterDocsRun } from '../src/roles/docs-update-handoff.js';
import { decideFailure, MAX_ATTEMPTS } from '../src/roles/failure-policy.js';
import { type AgentRunResult, emptyResult } from '../src/runner/agent-runner.js';
import { type JobRow, StateDb } from '../src/state-db.js';

function job(patch: Partial<JobRow> = {}): JobRow {
  const state = new StateDb(':memory:');
  const row = state.insertJob({ ticketId: 't', projectId: null, role: 'dev', trigger: 'ticket.assigned' });
  return {
    ...state.updateJob(row.id, { worktree: '/repo/.crew/worktrees/WEB-1', sessionId: 's-dev' }),
    ...patch,
  };
}

const result = (patch: Partial<AgentRunResult> = {}): AgentRunResult => ({
  ...emptyResult(),
  resultSubtype: 'success',
  ...patch,
});

const HANDOFF = { summaryMd: 'Thêm /health', files: ['src/health.ts'], tests: [], flows: ['app'] };

describe('docs-update handoff', () => {
  it('queues a docs_update job on the same worktree in a fresh session after handoff_docs', () => {
    const verdict = afterDevRun({
      job: job({ handoff: HANDOFF }),
      result: result({ endedBy: 'handoff_docs' }),
    });
    expect(verdict).toEqual({
      kind: 'next',
      followUp: {
        kind: 'docs_update',
        trigger: 'handoff',
        sessionId: null,
        worktree: '/repo/.crew/worktrees/WEB-1',
        failedAttempts: 0,
      },
    });
  });

  it('treats a dev run without handoff_docs or ask_owner as a failed attempt', () => {
    expect(afterDevRun({ job: job(), result: result() })).toEqual({ kind: 'failed', reason: 'no_handoff' });
    expect(afterDevRun({ job: job({ askedOwner: true }), result: result({ endedBy: 'ask_owner' }) })).toEqual(
      {
        kind: 'ok',
      },
    );
    expect(afterDevRun({ job: job(), result: result({ isError: true }) })).toEqual({
      kind: 'failed',
      reason: 'runner_error',
    });
  });

  it('closes the docs job only with the ticket done; a refused commit goes back to dev', () => {
    const docs = job({ kind: 'docs_update' });
    expect(afterDocsRun({ job: docs, result: result(), ticketStatus: 'done' })).toEqual({ kind: 'ok' });
    expect(afterDocsRun({ job: docs, result: result(), ticketStatus: 'in_progress' })).toEqual({
      kind: 'failed',
      reason: 'not_finished',
    });
    const rejected = { ...docs, returnToDev: { summaryMd: 'R7', output: 'R7 src/config.ts: secret' } };
    expect(
      afterDocsRun({
        job: rejected,
        result: result({ endedBy: 'return_to_dev' }),
        ticketStatus: 'in_progress',
      }),
    ).toEqual({ kind: 'failed', reason: 'docs_rejected' });
  });

  it('returns a refused docs commit to a dev job on the dev session, within the attempt cap', () => {
    const docs = job({ kind: 'docs_update', sessionId: 's-docs' });
    const first = decideFailure({ job: docs, reason: 'docs_rejected', costUsd: 0.01, devSessionId: 's-dev' });
    expect(first).toMatchObject({
      action: 'retry',
      followUp: { kind: 'agent', trigger: 'retry:docs_rejected', failedAttempts: 1, sessionId: 's-dev' },
    });
    const again = decideFailure({
      job: { ...docs, failedAttempts: 1 },
      reason: 'docs_rejected',
      costUsd: 0,
      devSessionId: 's-dev',
    });
    expect(again.action).toBe('block');
    expect(again.comment).toContain(`${MAX_ATTEMPTS}/${MAX_ATTEMPTS}`);
  });

  it('blocks at once on the job budget and retries other failures once', () => {
    expect(decideFailure({ job: job(), reason: 'budget', costUsd: 5 }).action).toBe('block');
    const retry = decideFailure({ job: job(), reason: 'no_handoff', costUsd: 0.2 });
    expect(retry).toMatchObject({ action: 'retry', followUp: { kind: 'agent', sessionId: 's-dev' } });
    // The comment names the server settings revision the run started with (a bad prompt edit shows up).
    expect(
      decideFailure({ job: job({ settingsRevision: '3f9a1c2b' }), reason: 'no_handoff', costUsd: 0.2 })
        .comment,
    ).toContain('chi phí lượt này 0.2000 USD, cài đặt bản 3f9a1c2b');
    const docsRetry = decideFailure({
      job: job({ kind: 'docs_update' }),
      reason: 'not_finished',
      costUsd: 0,
    });
    expect(docsRetry).toMatchObject({ action: 'retry', followUp: { kind: 'docs_update', sessionId: null } });
    expect(
      decideFailure({ job: job({ failedAttempts: 1 }), reason: 'runner_error', costUsd: 0 }).action,
    ).toBe('block');
  });
});
