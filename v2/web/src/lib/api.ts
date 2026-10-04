/**
 * Same-origin owner transport for `/v2/`. GETs carry the cookie and an AbortSignal tied to the session epoch;
 * JSON mutations send the frozen `PendingOperation` bytes with `X-CSRF-Token` and `Idempotency-Key = id`.
 * Unconfirmed outcomes (transport error, abort, 5xx, unreadable 2xx) keep the operation ambiguous with the
 * same key. A stale CSRF/Origin 403 suspends it, refreshes the session once and replays the same bytes.
 * A 4xx releases the key only when it proves rejection: always for body-deterministic errors, otherwise only
 * when no earlier send of this key could have committed; a payload re-entered from a tombstone returns to the
 * tombstone instead. One send per operation is in flight at a time. Only a confirmed 2xx clears the draft.
 * A `*_NOT_CONFIGURED` answer is final for the attempt: no auto-retry, key kept, operation flagged with the
 * configuration code. The `Date` header of the latest response is exposed as `lastServerDate()`.
 */
import { type Decoder, decodeApiErrorBody, isUuid } from '../contracts/http.ts';
import type { PendingOperation, PendingStore } from './pending-operation.ts';
import type { HttpFetch, SessionController } from './session.ts';

/** `configuration`: the producer reported a missing server configuration (`*_NOT_CONFIGURED`). */
export type FailureKind = 'http' | 'transport' | 'aborted' | 'local' | 'shape' | 'configuration';

export class ApiFailure extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly kind: FailureKind;

  constructor(status: number | null, code: string, kind: FailureKind, message = code) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

export type RequestOptions = { signal?: AbortSignal; operation?: PendingOperation };

export interface OwnerClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  mutate<T>(operation: PendingOperation, options?: RequestOptions): Promise<T>;
  upload<T>(uploadId: string, file: File, signal: AbortSignal): Promise<T>;
  /**
   * Server clock from the `Date` header of the most recent owner response (success or error), or null before
   * any dated response. Optional so test doubles need not model a clock; the real client always provides it.
   */
  lastServerDate?(): Date | null;
}

export type OwnerClientOptions = {
  session: SessionController;
  pending: PendingStore;
  fetch?: HttpFetch;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  /** Retries after the first attempt for GET and unconfirmed mutations; backoff 1s/2s/4s. */
  maxRetries?: number;
};

const backoff = [1000, 2000, 4000] as const;
const pathOrigin = 'http://crew.invalid';

/** Accepts only a relative `/v2/...` path that the URL parser keeps byte-identical (no `..`, `//`, scheme). */
export function assertOwnerPath(path: string): string {
  let url: URL | null = null;
  try {
    url =
      typeof path === 'string' && path.startsWith('/v2/') && !path.includes('\\')
        ? new URL(path, pathOrigin)
        : null;
  } catch {
    url = null;
  }
  if (!url || url.origin !== pathOrigin || `${url.pathname}${url.search}` !== path || path.startsWith('//'))
    throw new ApiFailure(null, 'PATH_NOT_SAME_ORIGIN_V2', 'local');
  return path;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function failureFrom(response: Response): Promise<ApiFailure> {
  let code = response.status >= 500 ? 'SERVICE_UNAVAILABLE' : `HTTP_${response.status}`;
  let message = code;
  try {
    const body = decodeApiErrorBody(await response.json());
    code = body.error.code;
    message = body.error.message;
  } catch {
    // Non-JSON or unknown error body (for example a proxy 503 page) keeps the status-derived code.
  }
  return new ApiFailure(response.status, code, 'http', message);
}

/** 403 from `requireOwner` (`v2/server/src/auth/routes.ts:41-50`): stale CSRF or wrong Origin. */
function staleCredential(failure: ApiFailure): boolean {
  return failure.status === 403 && (failure.code === 'CSRF_INVALID' || failure.code === 'ORIGIN_INVALID');
}

/**
 * Errors decided by the request bytes alone (schema, body validation, key format, size, media type). The
 * same frozen bytes failed the earlier sends too, so the key never committed. This does not hold for a
 * payload re-entered from a tombstone, which is handled separately. Other 4xx (403/404/409/422...) can
 * come from route `authorize` callbacks that run before the idempotency lookup and depend on current state.
 */
function bodyDeterministic(failure: ApiFailure): boolean {
  return failure.status === 400 || failure.status === 413 || failure.status === 415;
}

/**
 * Deterministic missing-configuration answer (`*_NOT_CONFIGURED`, 503 or 409). Retrying cannot change it,
 * and it says nothing about earlier sends of the same key.
 */
function configurationFailure(failure: ApiFailure): ApiFailure | null {
  return /^[A-Z][A-Z0-9_]*_NOT_CONFIGURED$/.test(failure.code)
    ? new ApiFailure(failure.status, failure.code, 'configuration', failure.message)
    : null;
}

function combined(...signals: (AbortSignal | undefined)[]): AbortSignal {
  return AbortSignal.any(signals.filter((signal): signal is AbortSignal => signal !== undefined));
}

export function createOwnerClient(options: OwnerClientOptions): OwnerClient {
  const { session, pending } = options;
  const send: HttpFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? delay;
  const maxRetries = Math.max(0, Math.min(options.maxRetries ?? 3, backoff.length));
  const requireSession = (): string => {
    const csrf = session.csrf();
    if (!session.isAuthenticated() || !csrf) throw new ApiFailure(null, 'SESSION_REQUIRED', 'local');
    return csrf;
  };
  let serverDate: Date | null = null;
  const observe = (response: Response): Response => {
    const header = response.headers.get('date');
    const value = header ? new Date(header) : null;
    if (value && !Number.isNaN(value.getTime())) serverDate = value;
    return response;
  };
  const unauthorized = (status: number): ApiFailure => {
    session.expire();
    return new ApiFailure(status, 'UNAUTHENTICATED', 'http');
  };

  async function get<T>(path: string, request: RequestOptions = {}): Promise<T> {
    assertOwnerPath(path);
    requireSession();
    for (let attempt = 0; ; attempt++) {
      const signal = combined(session.signal(), request.signal);
      let response: Response;
      try {
        response = observe(
          await send(path, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
            signal,
          }),
        );
      } catch {
        if (signal.aborted) throw new ApiFailure(null, 'ABORTED', 'aborted');
        if (attempt >= maxRetries) throw new ApiFailure(null, 'NETWORK_UNAVAILABLE', 'transport');
        await sleep(backoff[attempt] ?? 4000, signal);
        continue;
      }
      if (response.status === 401) throw unauthorized(401);
      if (!response.ok) {
        const failure = await failureFrom(response);
        const configuration = configurationFailure(failure);
        if (configuration) throw configuration;
        if (response.status >= 500 && attempt < maxRetries) {
          await sleep(backoff[attempt] ?? 4000, signal);
          continue;
        }
        throw failure;
      }
      try {
        return (await response.json()) as T;
      } catch {
        throw new ApiFailure(response.status, 'RESPONSE_INVALID', 'shape');
      }
    }
  }

  /**
   * Refresh a stale CSRF token once per call. Failures keep the operation suspended with its key; a 401 or
   * owner change during the refresh is an expiry.
   */
  async function refreshCsrf(): Promise<void> {
    try {
      await session.refresh();
    } catch {
      if (!session.isAuthenticated()) throw new ApiFailure(401, 'UNAUTHENTICATED', 'http');
      throw new ApiFailure(null, 'SESSION_REFRESH_FAILED', 'transport');
    }
  }

  async function mutate<T>(operation: PendingOperation, request: RequestOptions = {}): Promise<T> {
    assertOwnerPath(operation.path);
    const current = pending.get(operation.id);
    if (!current || current.bodyJson !== operation.bodyJson)
      throw new ApiFailure(null, 'OPERATION_UNKNOWN', 'local');
    requireSession();
    if (!pending.claim(current.id)) throw new ApiFailure(null, 'OPERATION_IN_FLIGHT', 'local');
    try {
      return await deliver<T>(current, request);
    } finally {
      pending.release(current.id);
    }
  }

  async function deliver<T>(current: PendingOperation, request: RequestOptions): Promise<T> {
    // Any earlier send of this key may have committed; only body-deterministic 4xx then prove rejection.
    let uncertain = current.state !== 'pending';
    let refreshed = false;
    pending.markPending(current.id);
    for (let attempt = 0; ; attempt++) {
      let csrf: string;
      try {
        csrf = requireSession();
      } catch (error) {
        pending.markSuspended(current.id);
        throw error;
      }
      const signal = combined(session.signal(), request.signal);
      let response: Response;
      try {
        response = observe(
          await send(current.path, {
            method: current.method,
            credentials: 'same-origin',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
              'x-csrf-token': csrf,
              'idempotency-key': current.id,
            },
            body: current.bodyJson,
            signal,
          }),
        );
      } catch {
        uncertain = true;
        if (session.signal().aborted) {
          pending.markSuspended(current.id);
          throw new ApiFailure(null, 'SESSION_ENDED', 'aborted');
        }
        pending.markAmbiguous(current.id);
        if (request.signal?.aborted) throw new ApiFailure(null, 'ABORTED', 'aborted');
        if (attempt >= maxRetries) throw new ApiFailure(null, 'UNCONFIRMED', 'transport');
        await sleep(backoff[attempt] ?? 4000, request.signal);
        continue;
      }
      if (response.ok) {
        let body: T;
        try {
          body = (response.status === 204 ? undefined : await response.json()) as T;
        } catch {
          uncertain = true;
          pending.markAmbiguous(current.id);
          if (attempt >= maxRetries) throw new ApiFailure(response.status, 'UNCONFIRMED', 'shape');
          await sleep(backoff[attempt] ?? 4000, request.signal);
          continue;
        }
        pending.accept(current.id);
        return body;
      }
      if (response.status === 401) {
        pending.markSuspended(current.id);
        throw unauthorized(401);
      }
      const failure = await failureFrom(response);
      const configuration = configurationFailure(failure);
      if (configuration) {
        // Deterministic: no blind retry, keep the key (an earlier send may still have committed).
        pending.markConfigurationError(current.id, configuration.code);
        throw configuration;
      }
      if (response.status >= 500) {
        uncertain = true;
        pending.markAmbiguous(current.id);
        if (attempt >= maxRetries)
          throw new ApiFailure(failure.status, 'UNCONFIRMED', 'http', failure.message);
        await sleep(backoff[attempt] ?? 4000, request.signal);
        continue;
      }
      if (failure.code === 'IDEMPOTENCY_CONFLICT') {
        pending.conflict(current.id);
        throw failure;
      }
      if (staleCredential(failure)) {
        // `requireOwner` rejects before the idempotency lookup: say nothing about earlier commits.
        pending.markSuspended(current.id);
        if (refreshed) throw failure;
        refreshed = true;
        const aborted = () => {
          pending.markAmbiguous(current.id);
          return new ApiFailure(null, 'ABORTED', 'aborted');
        };
        if (request.signal?.aborted) throw aborted();
        await refreshCsrf();
        if (request.signal?.aborted) throw aborted();
        pending.markPending(current.id);
        attempt--;
        continue;
      }
      if (pending.isResumed(current.id)) {
        // Re-entered bytes may differ from the original send; no 4xx proves the original key never
        // committed, so the payload is dropped and the key returns to its tombstone.
        pending.conflict(current.id);
      } else if (uncertain && !bodyDeterministic(failure)) pending.markAmbiguous(current.id);
      else pending.reject(current.id);
      throw failure;
    }
  }

  async function upload<T>(uploadId: string, file: File, signal: AbortSignal): Promise<T> {
    if (!isUuid(uploadId)) throw new ApiFailure(null, 'UPLOAD_ID_INVALID', 'local');
    const csrf = requireSession();
    const combinedSignal = combined(session.signal(), signal);
    let response: Response;
    try {
      response = observe(
        await send(`/v2/attachment-uploads/${uploadId}/content`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/octet-stream',
            'x-csrf-token': csrf,
          },
          body: file,
          signal: combinedSignal,
        }),
      );
    } catch {
      throw new ApiFailure(
        null,
        combinedSignal.aborted ? 'ABORTED' : 'UNCONFIRMED',
        combinedSignal.aborted ? 'aborted' : 'transport',
      );
    }
    if (response.status === 401) throw unauthorized(401);
    if (!response.ok) {
      const failure = await failureFrom(response);
      const configuration = configurationFailure(failure);
      if (configuration) throw configuration;
      // Bytes replay is safe per upload ID; refresh the token so the caller's next attempt can succeed.
      if (staleCredential(failure)) await refreshCsrf();
      throw failure;
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiFailure(response.status, 'UNCONFIRMED', 'shape');
    }
  }

  return { get, mutate, upload, lastServerDate: () => serverDate };
}

/** GET + runtime decoding; shape mismatch surfaces as `RESPONSE_SHAPE_INVALID`. */
export async function getDecoded<T>(
  client: OwnerClient,
  path: string,
  decoder: Decoder<T>,
  signal?: AbortSignal,
): Promise<T> {
  const value = await client.get<unknown>(path, { signal });
  try {
    return decoder(value);
  } catch (error) {
    throw new ApiFailure(
      null,
      'RESPONSE_SHAPE_INVALID',
      'shape',
      error instanceof Error ? error.message : undefined,
    );
  }
}

/** Supersedes in-flight reads of one view: starting a new request aborts the previous one. */
export class LatestRequest {
  #current: AbortController | null = null;

  next(): AbortSignal {
    this.#current?.abort(new DOMException('Đã có yêu cầu mới hơn', 'AbortError'));
    this.#current = new AbortController();
    return this.#current.signal;
  }

  isCurrent(signal: AbortSignal): boolean {
    return this.#current?.signal === signal && !signal.aborted;
  }
}
