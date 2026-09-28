import type { AgentRunResult } from '../runner/agent-runner.js';
import type { JobRow, NewJob } from '../state-db.js';
import type { FailureReason } from './failure-policy.js';

/** What the end of a dev or docs-update run leads to. */
export type HandoffVerdict =
  /** Queue this job next on the same ticket and worktree. */
  | { kind: 'next'; followUp: Omit<NewJob, 'ticketId' | 'projectId' | 'role'> }
  /** A failed attempt, handled by the failure policy. */
  | { kind: 'failed'; reason: FailureReason }
  /** Nothing to queue: the run finished its part, or it waits for the owner. */
  | { kind: 'ok' };

/**
 * After a dev (or bug) run. The dev model never writes or commits docs: a run that ends with `handoff_docs`
 * queues a `docs_update` job on the same ticket and worktree, which runs on sonnet in a fresh session and
 * commits code, tests and docs together. The one-active-job-per-ticket index holds because the docs job is
 * inserted in the transaction that ends the dev job. A run that ends without `handoff_docs` or `ask_owner`
 * is a failed attempt.
 */
export function afterDevRun(input: { job: JobRow; result: AgentRunResult }): HandoffVerdict {
  const { job, result } = input;
  if (result.isError) return { kind: 'failed', reason: 'runner_error' };
  if (result.endedBy === 'ask_owner' || job.askedOwner) return { kind: 'ok' };
  if (result.endedBy === 'handoff_docs' && job.handoff) {
    return {
      kind: 'next',
      followUp: {
        kind: 'docs_update',
        trigger: 'handoff',
        sessionId: null,
        worktree: job.worktree,
        failedAttempts: job.failedAttempts,
      },
    };
  }
  return { kind: 'failed', reason: 'no_handoff' };
}

/**
 * After a docs-update run: it must leave the ticket `done` with one commit holding code, tests and docs. A
 * commit refused for a reason outside `docs/` comes back through `return_to_dev` and becomes a new dev job
 * (via the failure policy, so it counts against the attempt cap).
 */
export function afterDocsRun(input: {
  job: JobRow;
  result: AgentRunResult;
  ticketStatus: string;
}): HandoffVerdict {
  const { job, result, ticketStatus } = input;
  if (result.isError) return { kind: 'failed', reason: 'runner_error' };
  if (result.endedBy === 'return_to_dev' || job.returnToDev)
    return { kind: 'failed', reason: 'docs_rejected' };
  if (result.endedBy === 'ask_owner' || job.askedOwner) return { kind: 'ok' };
  if (ticketStatus === 'done') return { kind: 'ok' };
  return { kind: 'failed', reason: 'not_finished' };
}
