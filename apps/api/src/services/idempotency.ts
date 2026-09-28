import { createHash } from 'node:crypto';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKey } from '@crew/shared';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Executor, Transaction } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';
import { ApiError } from '../errors.js';

/** Stored responses are replayed for this long, then purged. */
export const IDEMPOTENCY_TTL_DAYS = 7;

export interface StoredResponse {
  statusCode: number;
  body: unknown;
}

export interface IdempotentResult extends StoredResponse {
  /** True when the response came from storage instead of running the handler. */
  replayed: boolean;
}

/** Reads and validates the `Idempotency-Key` header that every daemon write must carry. */
export function readIdempotencyKey(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers[IDEMPOTENCY_KEY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new ApiError('IDEMPOTENCY_KEY_REQUIRED', `the ${IDEMPOTENCY_KEY_HEADER} header is required`);
  }
  const parsed = IdempotencyKey.safeParse(value);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED', `invalid ${IDEMPOTENCY_KEY_HEADER} header`);
  return parsed.data;
}

/**
 * Runs a daemon write at most once per `(machineId, key)`. The handler runs in the same transaction that
 * stores its response, so a crash never leaves a write without its stored response (or the reverse).
 * Concurrent retries of one key are serialised by a transaction-scoped advisory lock.
 *
 * Errors thrown by the handler roll everything back and are not stored, so a retry re-runs it; errors that
 * carry committed side effects (`sideEffectsCommitted`) are stored and replayed like any response.
 */
export async function withIdempotency(
  db: Executor,
  args: { machineId: string; key: string; fingerprint: string },
  handler: (tx: Transaction) => Promise<StoredResponse>,
): Promise<IdempotentResult> {
  const { machineId, key, fingerprint } = args;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${machineId}:${key}`}, 0))`);
    const [existing] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.machineId, machineId), eq(idempotencyKeys.key, key)));
    if (existing && !isExpired(existing.createdAt)) {
      if (existing.fingerprint !== fingerprint) {
        throw new ApiError('IDEMPOTENCY_KEY_REUSED', 'this idempotency key was used for a different request');
      }
      return { statusCode: existing.statusCode, body: existing.response, replayed: true };
    }
    if (existing) {
      await tx
        .delete(idempotencyKeys)
        .where(and(eq(idempotencyKeys.machineId, machineId), eq(idempotencyKeys.key, key)));
    }

    let response: StoredResponse;
    try {
      response = await handler(tx);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.sideEffectsCommitted) throw error;
      response = { statusCode: error.statusCode, body: error.toBody() };
    }
    await tx.insert(idempotencyKeys).values({
      machineId,
      key,
      fingerprint,
      statusCode: response.statusCode,
      response: response.body ?? null,
    });
    return { ...response, replayed: false };
  });
}

/**
 * Fastify glue for daemon write routes: reads the key, fingerprints the request (method, route pattern and
 * body), runs the handler once and replays the stored status and body on retries.
 */
export async function replyIdempotent(
  db: Executor,
  request: FastifyRequest,
  reply: FastifyReply,
  machineId: string,
  handler: (tx: Transaction) => Promise<StoredResponse>,
): Promise<FastifyReply> {
  const key = readIdempotencyKey(request.headers);
  const bodyHash = createHash('sha256')
    .update(JSON.stringify(request.body ?? null))
    .digest('hex');
  const fingerprint = `${request.method} ${request.routeOptions.url ?? request.url} ${bodyHash}`;
  const result = await withIdempotency(db, { machineId, key, fingerprint }, handler);
  if (result.replayed) reply.header('idempotent-replayed', 'true');
  return reply.status(result.statusCode).send(result.body);
}

function isExpired(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > IDEMPOTENCY_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/** Deletes stored responses older than the TTL. Returns the number of rows removed. */
export async function purgeExpiredIdempotencyKeys(db: Executor): Promise<number> {
  const removed = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, sql`now() - make_interval(days => ${IDEMPOTENCY_TTL_DAYS})`))
    .returning({ key: idempotencyKeys.key });
  return removed.length;
}
