import type { ApiErrorBody, ApiErrorCode } from '@crew/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  ATTACHMENT_TOO_LARGE: 413,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ILLEGAL_TRANSITION: 409,
  REPORT_REQUIRED: 409,
  BUDGET_HOLD: 409,
  CHILD_CAP_EXCEEDED: 409,
  BUDGET_EXCEEDED: 409,
  BUG_CYCLE_CAP: 409,
  INVALID_HIERARCHY: 422,
  INVALID_DEPENDENCY: 422,
  PARENT_CLOSED: 409,
  TICKET_CLOSED: 409,
  QC_ALREADY_PAIRED: 409,
  PM_NOT_AVAILABLE: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly statusCode: number;

  /**
   * @param sideEffectsCommitted true when the service committed state changes (for example moving a
   * pm_task to needs_input) before refusing the request. Idempotency storage keeps those responses.
   */
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    readonly sideEffectsCommitted = false,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = STATUS_BY_CODE[code];
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const notFound = (what: string) => new ApiError('NOT_FOUND', `${what} not found`);

/**
 * Turns any error reaching a Fastify error handler into the right JSON body and status: an `ApiError` as-is,
 * a Fastify/other error with a 4xx `statusCode` into a best-guess `ApiError` (`UNAUTHORIZED`/`NOT_FOUND`/
 * `VALIDATION_FAILED`), anything else logged and reported as `INTERNAL`. Shared by the app-wide error handler
 * (`app.ts`) and any route that registers its own scoped handler to special-case an error Fastify throws
 * before the route's own code runs (for example a route-specific `bodyLimit` rejection).
 */
export function sendApiError(
  error: FastifyError | ApiError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ApiError) {
    reply.status(error.statusCode).send(error.toBody());
    return;
  }
  const status = error.statusCode ?? 500;
  if (status >= 400 && status < 500) {
    const code = status === 401 ? 'UNAUTHORIZED' : status === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED';
    reply.status(status).send(new ApiError(code, error.message).toBody());
    return;
  }
  request.log.error({ err: error }, 'unhandled error');
  reply.status(500).send(new ApiError('INTERNAL', 'internal server error').toBody());
}
