import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SessionResponse } from '@crew/shared';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Executor } from '../db/client.js';
import { type OwnerRow, owner, sessions } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { assertAllowedOrigin, assertCsrfToken, CSRF_COOKIE, csrfTokenFor, isMutating } from './csrf.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password.js';
import { hashRecoveryCode, verifyTotp } from './totp.js';

export const SESSION_COOKIE = 'crew_session';
export const SESSION_IDLE_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** last_seen_at is written at most this often, to keep reads cheap. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export interface OwnerSession {
  ownerId: string;
  username: string;
  sessionIdHash: string;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    ownerSession?: OwnerSession;
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------------------
// Login step 1: password -> signed, short-lived challenge
// ---------------------------------------------------------------------------

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`login:${payload}`).digest('base64url');
}

export function issueChallenge(secret: string, ownerId: string, now = Date.now()) {
  const expiresAt = now + LOGIN_CHALLENGE_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ o: ownerId, e: expiresAt })).toString('base64url');
  return { challenge: `${payload}.${sign(secret, payload)}`, expiresAt: new Date(expiresAt).toISOString() };
}

function readChallenge(secret: string, challenge: string): string {
  const [payload, signature] = challenge.split('.');
  const expected = payload ? sign(secret, payload) : '';
  if (
    !payload ||
    !signature ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw new ApiError('UNAUTHORIZED', 'invalid or expired login challenge');
  }
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { o?: unknown; e?: unknown };
  if (typeof data.o !== 'string' || typeof data.e !== 'number' || data.e < Date.now()) {
    throw new ApiError('UNAUTHORIZED', 'invalid or expired login challenge');
  }
  return data.o;
}

export async function checkPassword(db: Executor, username: string, password: string): Promise<OwnerRow> {
  const [row] = await db.select().from(owner).where(eq(owner.username, username));
  const ok = row ? await verifyPassword(row.passwordHash, password) : await verifyAgainstDummy(password);
  if (!row || !ok) throw new ApiError('UNAUTHORIZED', 'invalid username or password');
  return row;
}

// ---------------------------------------------------------------------------
// Login step 2: TOTP or recovery code -> session
// ---------------------------------------------------------------------------

/**
 * Checks a TOTP code for the owner and records its time step, so the same code cannot be used twice.
 * Also used to re-confirm the owner before sensitive actions such as creating a pairing code.
 */
export async function verifyOwnerTotp(db: Executor, ownerId: string, code: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(owner).where(eq(owner.id, ownerId)).for('update');
    if (!row) return false;
    const step = verifyTotp(row.totpSecret, code, row.totpLastStep);
    if (step === null) return false;
    await tx.update(owner).set({ totpLastStep: step, updatedAt: new Date() }).where(eq(owner.id, ownerId));
    return true;
  });
}

/** Consumes a recovery code; each works once. */
async function consumeRecoveryCode(db: Executor, ownerId: string, code: string): Promise<boolean> {
  const codeHash = hashRecoveryCode(code);
  const updated = await db
    .update(owner)
    .set({
      recoveryCodeHashes: sql`array_remove(${owner.recoveryCodeHashes}, ${codeHash})`,
      updatedAt: new Date(),
    })
    .where(and(eq(owner.id, ownerId), sql`${codeHash} = any(${owner.recoveryCodeHashes})`))
    .returning({ id: owner.id });
  return updated.length === 1;
}

export async function completeLogin(
  db: Executor,
  config: AppConfig,
  input: { challenge: string; code?: string; recoveryCode?: string },
): Promise<{ sessionId: string; session: SessionResponse }> {
  const ownerId = readChallenge(config.sessionSecret, input.challenge);
  const ok = input.code
    ? await verifyOwnerTotp(db, ownerId, input.code)
    : input.recoveryCode
      ? await consumeRecoveryCode(db, ownerId, input.recoveryCode)
      : false;
  if (!ok) throw new ApiError('UNAUTHORIZED', 'invalid verification code');
  return issueSession(db, config, ownerId);
}

/** Stores a new session for the owner and returns its id (for the cookie) and the session response. */
async function issueSession(
  db: Executor,
  config: AppConfig,
  ownerId: string,
): Promise<{ sessionId: string; session: SessionResponse }> {
  const sessionId = randomBytes(32).toString('base64url');
  const sessionIdHash = sha256(sessionId);
  const now = Date.now();
  await db.insert(sessions).values({
    idHash: sessionIdHash,
    ownerId,
    lastSeenAt: new Date(now),
    expiresAt: new Date(now + SESSION_ABSOLUTE_TTL_MS),
  });
  const [row] = await db.select().from(owner).where(eq(owner.id, ownerId));
  if (!row) throw new ApiError('UNAUTHORIZED', 'owner no longer exists');
  return {
    sessionId,
    session: {
      owner: { username: row.username },
      csrfToken: csrfTokenFor(config.sessionSecret, sessionIdHash),
      recoveryCodesLeft: row.recoveryCodeHashes.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

const PASSWORD_CHANGE_REJECTED = 'invalid password or verification code';

/**
 * Changes the owner's password. The current password is checked first, so a stolen session alone cannot
 * burn TOTP steps or recovery codes; then the TOTP code (no reuse) or a recovery code (consumed). Either
 * failure gives the same 401. On success every session of the owner is deleted and a new one is issued,
 * so other devices are signed out and the calling device continues under a new session id.
 */
export async function changeOwnerPassword(
  db: Executor,
  config: AppConfig,
  ownerId: string,
  input: { currentPassword: string; newPassword: string; code?: string; recoveryCode?: string },
): Promise<{ sessionId: string; session: SessionResponse }> {
  const [row] = await db.select().from(owner).where(eq(owner.id, ownerId));
  if (!row || !(await verifyPassword(row.passwordHash, input.currentPassword))) {
    throw new ApiError('UNAUTHORIZED', PASSWORD_CHANGE_REJECTED);
  }
  const confirmed = input.code
    ? await verifyOwnerTotp(db, ownerId, input.code)
    : input.recoveryCode
      ? await consumeRecoveryCode(db, ownerId, input.recoveryCode)
      : false;
  if (!confirmed) throw new ApiError('UNAUTHORIZED', PASSWORD_CHANGE_REJECTED);

  const passwordHash = await hashPassword(input.newPassword);
  return db.transaction(async (tx) => {
    // Matching the hash that was verified makes two concurrent changes resolve to one winner.
    const updated = await tx
      .update(owner)
      .set({ passwordHash, updatedAt: new Date() })
      .where(and(eq(owner.id, ownerId), eq(owner.passwordHash, row.passwordHash)))
      .returning({ id: owner.id });
    if (updated.length !== 1) throw new ApiError('UNAUTHORIZED', PASSWORD_CHANGE_REJECTED);
    await tx.delete(sessions).where(eq(sessions.ownerId, ownerId));
    return issueSession(tx, config, ownerId);
  });
}

// ---------------------------------------------------------------------------
// Session lookup, cookies and the owner guard
// ---------------------------------------------------------------------------

export async function destroySession(db: Executor, sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  await db.delete(sessions).where(eq(sessions.idHash, sha256(sessionId)));
}

/** Resolves a live session: within both the absolute TTL and the idle TTL. */
async function resolveSession(
  db: Executor,
  config: AppConfig,
  sessionId: string,
): Promise<OwnerSession | null> {
  const idHash = sha256(sessionId);
  const [row] = await db
    .select({ session: sessions, username: owner.username })
    .from(sessions)
    .innerJoin(owner, eq(owner.id, sessions.ownerId))
    .where(eq(sessions.idHash, idHash));
  if (!row) return null;
  const now = Date.now();
  if (
    row.session.expiresAt.getTime() <= now ||
    now - row.session.lastSeenAt.getTime() > SESSION_IDLE_TTL_MS
  ) {
    await db.delete(sessions).where(eq(sessions.idHash, idHash));
    return null;
  }
  if (now - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(sessions.idHash, idHash));
  }
  return {
    ownerId: row.session.ownerId,
    username: row.username,
    sessionIdHash: idHash,
    csrfToken: csrfTokenFor(config.sessionSecret, idHash),
  };
}

/**
 * True while a session is within both TTLs. Does not extend it, so an open owner stream alone never keeps
 * an idle session alive.
 */
export async function sessionStillValid(db: Executor, sessionIdHash: string): Promise<boolean> {
  const [row] = await db.select().from(sessions).where(eq(sessions.idHash, sessionIdHash));
  const now = Date.now();
  return (
    row !== undefined &&
    row.expiresAt.getTime() > now &&
    now - row.lastSeenAt.getTime() <= SESSION_IDLE_TTL_MS
  );
}

export function setSessionCookies(
  reply: FastifyReply,
  config: AppConfig,
  sessionId: string,
  csrfToken: string,
) {
  const base = {
    path: '/',
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
    maxAge: SESSION_ABSOLUTE_TTL_MS / 1000,
  };
  reply.setCookie(SESSION_COOKIE, sessionId, { ...base, httpOnly: true });
  reply.setCookie(CSRF_COOKIE, csrfToken, { ...base, httpOnly: false });
}

export function clearSessionCookies(reply: FastifyReply, config: AppConfig) {
  const base = { path: '/', sameSite: 'lax' as const, secure: config.cookieSecure };
  reply.clearCookie(SESSION_COOKIE, { ...base, httpOnly: true });
  reply.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
}

/**
 * onRequest guard for owner routes: a live session cookie, and for mutating methods an allowed Origin plus
 * a valid double-submit CSRF token. Bearer tokens are ignored here; daemon routes have their own guard.
 */
export function ownerGuard(db: Executor, config: AppConfig) {
  return async (request: FastifyRequest): Promise<void> => {
    const sessionId = request.cookies[SESSION_COOKIE];
    const session = sessionId ? await resolveSession(db, config, sessionId) : null;
    if (!session) throw new ApiError('UNAUTHORIZED', 'login required');
    if (isMutating(request.method)) {
      assertAllowedOrigin(request, config.allowedOrigins);
      assertCsrfToken(request, session.csrfToken);
    }
    request.ownerSession = session;
  };
}

export async function recoveryCodesLeft(db: Executor, ownerId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`cardinality(${owner.recoveryCodeHashes})` })
    .from(owner)
    .where(eq(owner.id, ownerId));
  return row?.n ?? 0;
}

/** Removes sessions past their absolute or idle TTL. */
export async function purgeExpiredSessions(db: Executor): Promise<number> {
  const idleCutoff = new Date(Date.now() - SESSION_IDLE_TTL_MS);
  const removed = await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, new Date()), lt(sessions.lastSeenAt, idleCutoff)))
    .returning({ id: sessions.idHash });
  return removed.length;
}
