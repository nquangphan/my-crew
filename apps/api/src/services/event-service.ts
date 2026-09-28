import { type AgentRole, type EventEnvelope, EventPayload, NOTICE_EVENT_TYPES } from '@crew/shared';
import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { type EventRow, events } from '../db/schema.js';

/** Postgres channel notified when events commit; the payload is empty (readers query by sequence). */
export const EVENTS_CHANNEL = 'events_new';

export interface NewEvent {
  payload: EventPayload;
  ticketId?: string | null;
  projectId?: string | null;
  /** Null sends the event to the owner stream only. */
  targetMachineId?: string | null;
  targetRole?: AgentRole | null;
}

/**
 * Appends events inside the caller's transaction, so they commit or roll back with the business write.
 * Payloads are validated against the shared contract before they are stored. The NOTIFY is delivered only
 * when the transaction commits, after the commit-time trigger has assigned each event its `seq`.
 */
export async function appendEvents(tx: Executor, list: readonly NewEvent[]): Promise<EventRow[]> {
  if (list.length === 0) return [];
  const rows = list.map((event) => {
    const payload = EventPayload.parse(event.payload);
    return {
      type: payload.type,
      ticketId: event.ticketId ?? null,
      projectId: event.projectId ?? null,
      targetMachineId: event.targetMachineId ?? null,
      targetRole: event.targetRole ?? null,
      payload,
    };
  });
  const inserted = await tx.insert(events).values(rows).returning();
  await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, '')`);
  return inserted;
}

/** Envelope of a committed event; its `id` is the delivery sequence, which is also the SSE cursor. */
export function toEventEnvelope(row: EventRow): EventEnvelope {
  if (row.seq === null) throw new Error(`event ${row.id} has no delivery sequence yet (uncommitted)`);
  return {
    id: row.seq.toString(),
    type: row.type,
    ticketId: row.ticketId,
    projectId: row.projectId,
    targetMachineId: row.targetMachineId,
    targetRole: row.targetRole,
    payload: row.payload as EventPayload,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listTicketEvents(
  db: Executor,
  ticketId: string,
  limit = 500,
): Promise<EventEnvelope[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.ticketId, ticketId), isNotNull(events.seq)))
    .orderBy(asc(events.seq))
    .limit(limit);
  return rows.map(toEventEnvelope);
}

/**
 * Committed events after `cursor`, in delivery order: every event for the owner stream (`machineId`
 * undefined), or only the events targeted at one machine.
 */
export async function listEventsAfter(
  db: Executor,
  args: { cursor: bigint; machineId?: string; limit: number },
): Promise<EventEnvelope[]> {
  const after = gt(events.seq, args.cursor);
  const rows = await db
    .select()
    .from(events)
    .where(args.machineId ? and(eq(events.targetMachineId, args.machineId), after) : after)
    .orderBy(asc(events.seq))
    .limit(args.limit);
  return rows.map(toEventEnvelope);
}

/** Highest committed delivery sequence, or 0 when there are no events. */
export async function latestEventSeq(db: Executor): Promise<bigint> {
  const [row] = await db.select({ max: sql<string | null>`max(${events.seq})::text` }).from(events);
  return BigInt(row?.max ?? '0');
}

/** The newest committed machine and budget notices, for the owner inbox. */
export async function listNotices(db: Executor, limit: number): Promise<EventEnvelope[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(inArray(events.type, [...NOTICE_EVENT_TYPES]), isNotNull(events.seq)))
    .orderBy(desc(events.seq))
    .limit(limit);
  return rows.map(toEventEnvelope);
}
