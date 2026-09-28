import type { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { ApiError } from '../errors.js';
import type { EventBus } from '../realtime/event-bus.js';

export interface RouteDeps {
  db: Database;
  config: AppConfig;
  bus: EventBus;
  /** SSE heartbeat interval; the token or session is re-checked on each one. */
  streamHeartbeatMs: number;
}

/** Validates external input at the route boundary; failures become 400 VALIDATION_FAILED. */
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'invalid request',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

/** `:id` path params accept a uuid or a ticket/project key. */
export function idParam(params: unknown): string {
  const id = (params as { id?: unknown }).id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
    throw new ApiError('VALIDATION_FAILED', 'invalid id');
  }
  return id;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `:id` path params that must be a uuid. */
export function uuidParam(params: unknown, what: string): string {
  const id = idParam(params);
  if (!UUID_RE.test(id)) throw new ApiError('VALIDATION_FAILED', `invalid ${what} id`);
  return id;
}
