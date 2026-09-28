import type { ApiErrorBody, ApiErrorCode } from '@crew/shared';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
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
