import { createHash, randomBytes } from 'node:crypto';
import { MACHINE_TOKEN_PREFIX } from '@crew/shared';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Executor } from '../db/client.js';
import { machines, machineTokens, projects, type TicketRow, tickets } from '../db/schema.js';
import { ApiError } from '../errors.js';

/** Authenticated machines touch `last_seen_at` at most this often. */
const TOUCH_INTERVAL_SECONDS = 30;

export interface MachineContext {
  machineId: string;
  machineName: string;
  tokenId: string;
  /** SHA-256 of the bearer token, kept so long-lived streams can re-check it. */
  tokenHash: string;
  tokenExpiresAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    machine?: MachineContext;
  }
}

export const hashMachineToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** A 256-bit opaque token with a recognisable prefix. */
export function generateMachineToken(): string {
  return `${MACHINE_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

const BEARER_RE = /^Bearer ([A-Za-z0-9_-]{16,200})$/;

/**
 * Resolves a token hash to its machine when the token is neither revoked nor expired and the machine is not
 * revoked. Marks the machine seen and online (throttled), which is how an offline machine comes back.
 */
export async function authenticateTokenHash(db: Executor, tokenHash: string): Promise<MachineContext | null> {
  const [row] = await db
    .select({
      tokenId: machineTokens.id,
      machineId: machines.id,
      machineName: machines.name,
      expiresAt: machineTokens.expiresAt,
      online: machines.online,
    })
    .from(machineTokens)
    .innerJoin(machines, eq(machines.id, machineTokens.machineId))
    .where(
      and(
        eq(machineTokens.tokenHash, tokenHash),
        isNull(machineTokens.revokedAt),
        gt(machineTokens.expiresAt, sql`now()`),
        isNull(machines.revokedAt),
      ),
    );
  if (!row) return null;

  const stale = sql`now() - make_interval(secs => ${TOUCH_INTERVAL_SECONDS})`;
  await db
    .update(machineTokens)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(
        eq(machineTokens.id, row.tokenId),
        or(isNull(machineTokens.lastSeenAt), lt(machineTokens.lastSeenAt, stale)),
      ),
    );
  await db
    .update(machines)
    .set({ lastSeenAt: sql`now()`, online: true })
    .where(
      and(
        eq(machines.id, row.machineId),
        or(isNull(machines.lastSeenAt), lt(machines.lastSeenAt, stale), eq(machines.online, false)),
      ),
    );
  return {
    machineId: row.machineId,
    machineName: row.machineName,
    tokenId: row.tokenId,
    tokenHash,
    tokenExpiresAt: row.expiresAt,
  };
}

/**
 * onRequest guard for daemon routes: `Authorization: Bearer <token>` checked against the stored hash,
 * revocation and expiry on every request. Cookies are ignored, so an owner session never authorises a
 * daemon route.
 */
export function machineGuard(db: Executor) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? BEARER_RE.exec(header) : null;
    if (!match?.[1]) throw new ApiError('UNAUTHORIZED', 'machine token required');
    const machine = await authenticateTokenHash(db, hashMachineToken(match[1]));
    if (!machine) throw new ApiError('UNAUTHORIZED', 'invalid, expired or revoked machine token');
    request.machine = machine;
  };
}

export function requireMachine(request: FastifyRequest): MachineContext {
  if (!request.machine) throw new ApiError('UNAUTHORIZED', 'machine token required');
  return request.machine;
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export async function isAssistantHost(db: Executor, machineId: string): Promise<boolean> {
  const [row] = await db
    .select({ hosts: machines.hostsAssistant })
    .from(machines)
    .where(eq(machines.id, machineId));
  return row?.hosts ?? false;
}

export async function assertAssistantHost(db: Executor, machineId: string): Promise<void> {
  if (!(await isAssistantHost(db, machineId))) {
    throw new ApiError('FORBIDDEN', 'only the machine hosting the assistant may do this');
  }
}

/**
 * A machine may read or write a ticket whose project it owns, or a `request` ticket when it hosts the
 * assistant. Ownership is read fresh, so a claim moved to another machine takes effect at once.
 */
/**
 * Read access: the write scope, plus the request above a pm_task of a project this machine owns, so its PM
 * reads the owner's own words. Writes on that request stay with the assistant host.
 */
export async function assertTicketReadable(
  db: Executor,
  machineId: string,
  ticket: TicketRow,
): Promise<void> {
  if (ticket.type === 'request') {
    const [owned] = await db
      .select({ id: tickets.id })
      .from(tickets)
      .innerJoin(projects, eq(projects.id, tickets.projectId))
      .where(
        and(
          eq(tickets.parentId, ticket.id),
          eq(tickets.type, 'pm_task'),
          eq(projects.ownerMachineId, machineId),
        ),
      )
      .limit(1);
    if (owned) return;
  }
  await assertTicketInScope(db, machineId, ticket);
}

export async function assertTicketInScope(db: Executor, machineId: string, ticket: TicketRow): Promise<void> {
  if (ticket.type === 'request') {
    if (await isAssistantHost(db, machineId)) return;
  } else if (ticket.projectId) {
    const [project] = await db
      .select({ owner: projects.ownerMachineId })
      .from(projects)
      .where(eq(projects.id, ticket.projectId));
    if (project?.owner === machineId) return;
  }
  throw new ApiError('FORBIDDEN', `ticket ${ticket.key} is outside this machine's projects`);
}
