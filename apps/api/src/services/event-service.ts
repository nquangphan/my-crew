import { type AgentRole, type EventEnvelope, EventPayload } from '@crew/shared';
import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { type EventRow, events } from '../db/schema.js';

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
 * Payloads are validated against the shared contract before they are stored.
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
  return tx.insert(events).values(rows).returning();
}

export function toEventEnvelope(row: EventRow): EventEnvelope {
  return {
    id: row.id.toString(),
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
    .where(eq(events.ticketId, ticketId))
    .orderBy(asc(events.id))
    .limit(limit);
  return rows.map(toEventEnvelope);
}
