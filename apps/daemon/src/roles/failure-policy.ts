import { traceMarkdown, traceSummary } from '../runner/run-trace.js';
import type { JobKind, JobRow, NewJob } from '../state-db.js';

/** Attempts a job gets before its ticket is blocked for the owner. */
export const MAX_ATTEMPTS = 2;

/** Why an attempt failed. */
export type FailureReason =
  /** The CLI ended the run with an error result (not a rate limit or overload, which back off instead). */
  | 'runner_error'
  /** The run hit `maxBudgetUsd`. */
  | 'budget'
  /** A dev run ended without `handoff_docs` or `ask_owner`. */
  | 'no_handoff'
  /** The docs job could not commit for a reason outside `docs/` (tests, R6, R7) and returned the work to dev. */
  | 'docs_rejected'
  /** A run that must close its ticket (docs job, QC, docs-init) ended with the ticket still open. */
  | 'not_finished';

export type FailureDecision =
  | { action: 'retry'; followUp: Omit<NewJob, 'ticketId' | 'projectId' | 'role'>; comment: string }
  | { action: 'block'; comment: string };

const REASON_TEXT: Record<FailureReason, string> = {
  runner_error: 'lượt chạy gặp lỗi',
  budget: 'lượt chạy chạm giới hạn chi phí của job (maxBudgetUsd)',
  no_handoff: 'lượt dev kết thúc mà không gọi `handoff_docs`',
  docs_rejected: 'job cập nhật docs không commit được vì lỗi ngoài `docs/` (hook trả về ở trên)',
  not_finished: 'lượt chạy kết thúc mà ticket chưa xong',
};

/**
 * The heartbeat's line for a failed job: its error class, the reason in words and a short diagnosis of the
 * run (turns, duration, cost, last step and last message), at most 500 characters.
 */
export function failedJobText(job: Pick<JobRow, 'error' | 'runTrace'>): string {
  const error = job.error ?? 'không rõ lỗi';
  const reason = Object.hasOwn(REASON_TEXT, error) ? `: ${REASON_TEXT[error as FailureReason]}` : '';
  const trace = job.runTrace ? ` · ${traceSummary(job.runTrace)}` : '';
  const text = `${error}${reason}${trace}`;
  return text.length > 500 ? `${text.slice(0, 499)}…` : text;
}

/**
 * Decides what a failed attempt leads to.
 *
 * - Reaching `maxBudgetUsd` blocks the ticket at once: retrying would spend past the owner's limit.
 * - Anything else is retried until the job has used `MAX_ATTEMPTS` attempts, then the ticket is blocked for
 *   the owner, who unblocks it to resume. A docs rejection is retried as a new dev job (the dev run fixes the
 *   code, then hands off to a fresh docs job); every other retry repeats the same kind of job. A retry resumes
 *   the failed run's session only if that run did not leave it abandoned (`resumable`).
 *
 * Both comments end with the run's diagnosis (turns, duration, cost, the agent's last message and tool
 * calls) when the run left one, so the owner can tell from the web why it stopped.
 */
export function decideFailure(input: {
  job: Pick<JobRow, 'kind' | 'failedAttempts' | 'sessionId'> &
    Partial<Pick<JobRow, 'stage' | 'runTrace' | 'settingsRevision'>>;
  reason: FailureReason;
  costUsd: number;
  /** Session to resume for a dev retry after a docs rejection (the dev session, not the docs one). */
  devSessionId?: string | null;
  /**
   * Whether the retry may resume a session (`StateDb.resumeChoice`): null for one a run left abandoned, so
   * the retry starts fresh. Default: any session is resumable.
   */
  resumable?: (sessionId: string | null) => string | null;
}): FailureDecision {
  const { job, reason } = input;
  const resumable = input.resumable ?? ((sessionId: string | null) => sessionId);
  const attempt = job.failedAttempts + 1;
  // The server settings revision (prompts, rules) the run started with: a bad edit shows up here.
  const settings = job.settingsRevision ? `, cài đặt bản ${job.settingsRevision}` : '';
  const cost = `chi phí lượt này ${input.costUsd.toFixed(4)} USD${settings}`;
  const diagnosis = job.runTrace ? `\n\n${traceMarkdown(job.runTrace, job.stage ?? null)}` : '';
  if (reason === 'budget' || attempt >= MAX_ATTEMPTS) {
    return {
      action: 'block',
      comment:
        `Ticket bị chặn: ${REASON_TEXT[reason]} (lần ${attempt}/${MAX_ATTEMPTS}, lỗi \`${reason}\`, ${cost}). ` +
        `Chủ dự án xem lại rồi mở chặn (unblock) để chạy tiếp.${diagnosis}`,
    };
  }
  const kind: JobKind = reason === 'docs_rejected' ? 'agent' : job.kind;
  return {
    action: 'retry',
    followUp: {
      kind,
      trigger: `retry:${reason}`,
      failedAttempts: attempt,
      sessionId: resumable(
        reason === 'docs_rejected'
          ? (input.devSessionId ?? null)
          : job.kind === 'docs_update'
            ? null
            : job.sessionId,
      ),
    },
    comment: `Lần thử ${attempt}/${MAX_ATTEMPTS} không thành: ${REASON_TEXT[reason]} (${cost}). Daemon chạy lại một lần nữa.${diagnosis}`,
  };
}
