/**
 * Owner session state machine.
 *
 * bootstrapping → GET session → authenticated | guest
 * authenticated → (any 401) → expired → login + GET verify (same owner) → authenticated
 * authenticated → logout (DELETE with CSRF) → logging_out → guest
 *
 * The CSRF token lives only in this object's memory. Each authenticated epoch owns an AbortController that
 * cancels every GET and the event stream when the epoch ends. The password is never stored here.
 */
import { ContractError, decodeApiErrorBody, decodeSession, type SessionDto } from '../contracts/http.ts';

export type { SessionDto } from '../contracts/http.ts';
export type SessionState = 'bootstrapping' | 'guest' | 'authenticated' | 'expired' | 'logging_out';
export type SessionError =
  | 'INVALID_CREDENTIALS'
  | 'LOGIN_THROTTLED'
  | 'OWNER_NOT_BOOTSTRAPPED'
  | 'PASSWORD_INVALID'
  | 'OWNER_MISMATCH'
  | 'ORIGIN_INVALID'
  | 'UNAVAILABLE';
export type SessionSnapshot = {
  state: SessionState;
  ownerId: 'owner' | null;
  error: SessionError | null;
  busy: boolean;
};
export type HttpFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SessionClient {
  restore(signal?: AbortSignal): Promise<SessionDto>;
  login(password: string, signal?: AbortSignal): Promise<SessionDto>;
  logout(signal?: AbortSignal): Promise<void>;
}

export const passwordLimits = { min: 1, max: 4096 } as const;
export const appBasePath = '/crew-v2/';
const sessionPath = '/v2/auth/session';

/** Thrown by the session client with the producer error code when one exists. */
export class SessionRequestError extends Error {
  readonly status: number | null;
  readonly code: string;

  constructor(status: number | null, code: string) {
    super(code);
    this.name = 'SessionRequestError';
    this.status = status;
    this.code = code;
  }
}

export function validatePassword(password: string): 'PASSWORD_INVALID' | null {
  return typeof password === 'string' &&
    password.length >= passwordLimits.min &&
    password.length <= passwordLimits.max
    ? null
    : 'PASSWORD_INVALID';
}

/** Only an internal `/crew-v2/` path is a valid return target; anything else falls back to the app root. */
export function safeReturnPath(raw: string | null | undefined): string {
  if (
    typeof raw !== 'string' ||
    !raw.startsWith(appBasePath) ||
    raw.includes('\\') ||
    [...raw].some((char) => char.charCodeAt(0) < 0x20)
  )
    return appBasePath;
  let url: URL;
  try {
    url = new URL(raw, 'http://crew.invalid');
  } catch {
    return appBasePath;
  }
  if (url.origin !== 'http://crew.invalid' || !url.pathname.startsWith(appBasePath)) return appBasePath;
  const decoded = (() => {
    try {
      return decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  })();
  if (decoded === null || decoded.split('/').some((segment) => segment === '..' || segment === '.'))
    return appBasePath;
  const normalized = `${url.pathname}${url.search}${url.hash}`;
  return normalized === raw ? normalized : appBasePath;
}

async function errorCode(response: Response): Promise<string> {
  try {
    return decodeApiErrorBody(await response.json()).error.code;
  } catch {
    return response.status >= 500 ? 'SERVICE_UNAVAILABLE' : `HTTP_${response.status}`;
  }
}

async function sessionResponse(response: Response): Promise<SessionDto> {
  if (!response.ok) throw new SessionRequestError(response.status, await errorCode(response));
  try {
    return decodeSession(await response.json());
  } catch (error) {
    throw new SessionRequestError(
      response.status,
      error instanceof ContractError ? 'OWNER_MISMATCH' : 'RESPONSE_INVALID',
    );
  }
}

/**
 * HTTP client for `/v2/auth/session`. Login is the only unauthenticated write: JSON `{password}`, the
 * browser sets Origin; no CSRF, Idempotency-Key or PendingOperation. Logout sends the CSRF header only.
 */
export function createSessionClient(options: {
  fetch?: HttpFetch;
  csrf: () => string | null;
}): SessionClient {
  const send: HttpFetch = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    async restore(signal) {
      return sessionResponse(
        await send(sessionPath, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal }),
      );
    },
    async login(password, signal) {
      if (validatePassword(password)) throw new SessionRequestError(null, 'PASSWORD_INVALID');
      return sessionResponse(
        await send(sessionPath, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
          signal,
        }),
      );
    },
    async logout(signal) {
      const token = options.csrf();
      if (!token) throw new SessionRequestError(null, 'SESSION_REQUIRED');
      const response = await send(sessionPath, {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'x-csrf-token': token },
        signal,
      });
      if (response.status !== 204 && !response.ok)
        throw new SessionRequestError(response.status, await errorCode(response));
    },
  };
}

function loginError(error: unknown): SessionError {
  if (error instanceof SessionRequestError) {
    if (
      error.code === 'INVALID_CREDENTIALS' ||
      error.code === 'LOGIN_THROTTLED' ||
      error.code === 'OWNER_NOT_BOOTSTRAPPED' ||
      error.code === 'PASSWORD_INVALID' ||
      error.code === 'OWNER_MISMATCH' ||
      error.code === 'ORIGIN_INVALID'
    )
      return error.code;
  }
  return 'UNAVAILABLE';
}

export class SessionController {
  readonly #client: SessionClient;
  readonly #listeners = new Set<() => void>();
  readonly #expireHooks = new Set<() => void>();
  readonly #logoutHooks = new Set<() => void>();
  #snapshot: SessionSnapshot = { state: 'bootstrapping', ownerId: null, error: null, busy: false };
  #csrf: string | null = null;
  #epoch = new AbortController();
  #bootstrapping: Promise<void> | null = null;

  constructor(options: { fetch?: HttpFetch; client?: SessionClient } = {}) {
    this.#client = options.client ?? createSessionClient({ fetch: options.fetch, csrf: () => this.#csrf });
  }

  snapshot(): SessionSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Memory-only CSRF token of the current authenticated epoch. */
  csrf(): string | null {
    return this.#snapshot.state === 'authenticated' ? this.#csrf : null;
  }

  /** Aborted as soon as the current authenticated epoch ends (expiry or logout). */
  signal(): AbortSignal {
    return this.#epoch.signal;
  }

  isAuthenticated(): boolean {
    return this.#snapshot.state === 'authenticated' && this.#csrf !== null;
  }

  onExpire(listener: () => void): () => void {
    this.#expireHooks.add(listener);
    return () => this.#expireHooks.delete(listener);
  }

  onLogout(listener: () => void): () => void {
    this.#logoutHooks.add(listener);
    return () => this.#logoutHooks.delete(listener);
  }

  /** Single-flight: repeated calls (for example React StrictMode effects) share one GET. */
  bootstrap(): Promise<void> {
    if (this.#snapshot.state !== 'bootstrapping') return Promise.resolve();
    this.#bootstrapping ??= this.#restoreInitial();
    return this.#bootstrapping;
  }

  async #restoreInitial(): Promise<void> {
    try {
      this.#authenticate(await this.#client.restore(AbortSignal.timeout(15_000)));
    } catch (error) {
      const code = error instanceof SessionRequestError ? error.code : null;
      this.#set({
        state: 'guest',
        ownerId: null,
        error: code === 'UNAUTHENTICATED' ? null : code === 'OWNER_NOT_BOOTSTRAPPED' ? code : 'UNAVAILABLE',
        busy: false,
      });
    }
  }

  /**
   * Login from guest or expired. After POST the session is re-read with GET to verify the owner before any
   * write is unlocked. Returns true only when authenticated. 429 is reported, never retried here.
   */
  async login(password: string, signal?: AbortSignal): Promise<boolean> {
    const state = this.#snapshot.state;
    if ((state !== 'guest' && state !== 'expired') || this.#snapshot.busy) return false;
    const invalid = validatePassword(password);
    if (invalid) {
      this.#set({ ...this.#snapshot, error: invalid });
      return false;
    }
    this.#set({ ...this.#snapshot, busy: true, error: null });
    try {
      await this.#client.login(password, signal);
      const verified = await this.#client.restore(signal);
      this.#authenticate(verified);
      return true;
    } catch (error) {
      this.#csrf = null;
      this.#set({ state, ownerId: null, error: loginError(error), busy: false });
      return false;
    }
  }

  /** Any producer 401: end the epoch, wipe CSRF, suspend writes. Pending operations are kept by the hooks. */
  expire(): void {
    if (this.#snapshot.state !== 'authenticated') return;
    this.#endEpoch();
    this.#set({ state: 'expired', ownerId: null, error: null, busy: false });
    for (const hook of this.#expireHooks) hook();
  }

  /** Explicit logout: DELETE with CSRF, then abort requests/stream and run wipe hooks even if DELETE failed. */
  async logout(): Promise<void> {
    if (this.#snapshot.state !== 'authenticated') return;
    this.#set({ ...this.#snapshot, state: 'logging_out', busy: true, error: null });
    let error: SessionError | null = null;
    try {
      await this.#client.logout(AbortSignal.timeout(10_000));
    } catch (caught) {
      const status = caught instanceof SessionRequestError ? caught.status : null;
      error = status === 401 ? null : 'UNAVAILABLE';
    }
    this.#endEpoch();
    for (const hook of this.#logoutHooks) hook();
    this.#set({ state: 'guest', ownerId: null, error, busy: false });
  }

  #authenticate(session: SessionDto): void {
    if (session.owner.id !== 'owner') throw new SessionRequestError(null, 'OWNER_MISMATCH');
    this.#csrf = session.csrfToken;
    if (this.#epoch.signal.aborted) this.#epoch = new AbortController();
    this.#set({ state: 'authenticated', ownerId: session.owner.id, error: null, busy: false });
  }

  #endEpoch(): void {
    this.#csrf = null;
    this.#epoch.abort(new DOMException('Phiên đăng nhập đã kết thúc', 'AbortError'));
  }

  #set(next: SessionSnapshot): void {
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}
