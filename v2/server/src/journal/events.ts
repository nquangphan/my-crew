import type { Actor, Db, Event, EventInput, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { canonicalJson } from './canonical.ts';
import { validateEventInput } from './event-contracts.ts';

export type EventScopeReader = (
  db: Db | Tx,
  actor: Actor,
) => Promise<{ projectIds: Id[]; allowGlobal: boolean }>;

export const ownerOnlyEventScope: EventScopeReader = async (_db, actor) => ({
  projectIds: [],
  allowGlobal: actor.kind === 'owner',
});

const maxCursor = 9223372036854775807n;
export function parseCursor(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new ApiError('CURSOR_INVALID', 400, 'Con trỏ sự kiện không hợp lệ');
  const cursor = BigInt(value);
  if (cursor > maxCursor) throw new ApiError('CURSOR_INVALID', 400, 'Con trỏ sự kiện không hợp lệ');
  return cursor.toString();
}

function mapEvent(row: Record<string, unknown>): Event {
  return {
    cursor: String(row.cursor),
    type: String(row.type),
    projectId: row.project_id as Id | null,
    ticketId: row.ticket_id as Id | null,
    audienceMachineId: row.audience_machine_id as Id | null,
    occurredAt: (row.occurred_at as Date).toISOString(),
    data: row.data as Record<string, unknown>,
  };
}

export async function appendEvent(tx: Tx, event: EventInput): Promise<Event> {
  validateEventInput(event);
  const [cursorRow] =
    await tx`update event_cursor set value = value + 1 where singleton = true returning value`;
  if (!cursorRow) throw new Error('EVENT_CURSOR_MISSING');
  const [row] =
    await tx`insert into events (cursor, type, project_id, ticket_id, audience_machine_id, data, occurred_at) values (${cursorRow.value}, ${event.type}, ${event.projectId}, ${event.ticketId}, ${event.audienceMachineId}, ${tx.json(JSON.parse(canonicalJson(event.data)))}, now()) returning cursor, type, project_id, ticket_id, audience_machine_id, data, occurred_at`;
  if (!row) throw new Error('EVENT_INSERT_FAILED');
  return mapEvent(row);
}

export async function readEvents(
  db: Db,
  actor: Actor,
  after: string,
  limit: number,
  scope: EventScopeReader,
): Promise<Event[]> {
  const cursor = parseCursor(after);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new ApiError('LIMIT_INVALID', 400, 'Giới hạn sự kiện không hợp lệ');
  return db.begin('isolation level repeatable read read only', async (tx) => {
    const access = await scope(tx, actor);
    if (actor.kind === 'owner') {
      const rows =
        await tx`select cursor, type, project_id, ticket_id, audience_machine_id, data, occurred_at from events where cursor > ${cursor} order by cursor limit ${limit}`;
      return rows.map(mapEvent);
    }
    const ids = access.projectIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const rows =
      await tx`select cursor, type, project_id, ticket_id, audience_machine_id, data, occurred_at from events where cursor > ${cursor} and (audience_machine_id = ${actor.id} or (audience_machine_id is null and project_id = any(${tx.array(ids)}::uuid[]))) order by cursor limit ${limit}`;
    return rows.map(mapEvent);
  });
}
