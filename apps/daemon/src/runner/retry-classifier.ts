/** Error classes after which the run is parked in `backoff` instead of failing (the CLI already retried). */
export const BACKOFF_ERRORS = ['rate_limit', 'overloaded', 'billing_error', 'account_on_hold'] as const;
export type BackoffError = (typeof BACKOFF_ERRORS)[number];

/** A job goes to `blocked` once it has been parked this many times. */
export const MAX_BACKOFF_ATTEMPTS = 4;

const BASE_DELAY_MS = 5 * 60 * 1000;
const MAX_DELAY_MS = 60 * 60 * 1000;

export function isBackoffError(error: unknown): error is BackoffError {
  return typeof error === 'string' && (BACKOFF_ERRORS as readonly string[]).includes(error);
}

/** `min(5 min · 2^attempt, 60 min)`, where `attempt` counts earlier backoffs (0 for the first). */
export function backoffDelayMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt), MAX_DELAY_MS);
}

export type RetryDecision =
  | { action: 'backoff'; retryAt: Date; attempts: number; error: BackoffError }
  | { action: 'blocked'; attempts: number; error: BackoffError };

/**
 * What to do with a run that ended on a backoff-class API error. `attempts` is the job's backoff count so
 * far; there is no retry on top of the CLI's own, only this parking with a growing delay.
 */
export function classifyRetry(error: BackoffError, attempts: number, now = new Date()): RetryDecision {
  const next = attempts + 1;
  if (next >= MAX_BACKOFF_ATTEMPTS) return { action: 'blocked', attempts: next, error };
  return {
    action: 'backoff',
    retryAt: new Date(now.getTime() + backoffDelayMs(attempts)),
    attempts: next,
    error,
  };
}
