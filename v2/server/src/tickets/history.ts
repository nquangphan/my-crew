import { parseCursor } from '../journal/events.ts';
import type { Actor, Db, Id } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { requireTicket } from './service.ts';

export type HistoryItem = {
  cursor: string;
  type: string;
  occurredAt: string;
  actor: { kind: 'owner' | 'machine'; id: string } | null;
  data: Record<string, unknown>;
};
export type DocsLinkItem = { snapshotId: Id; path: string };
type Paged<T> = { items: T[]; nextCursor: string | null };

const readOnly = 'isolation level repeatable read read only';

/**
 * Ordered timeline of the journal events attached to one ticket. The journal cursor is the
 * chronology authority. Comment and decision bodies are not copied: only ids and the actor are
 * exposed, so the page reveals nothing the per-resource reads and `/v2/events` do not already allow.
 */
export async function readTicketHistory(
  db: Db,
  ticketId: Id,
  actor: Actor,
  after: string,
  limit: number,
): Promise<Paged<HistoryItem>> {
  const cursor = parseCursor(after);
  const ownerView = actor.kind === 'owner';
  const machineId = ownerView ? null : actor.id;
  return db.begin(readOnly, async (tx) => {
    await requireTicket(tx, ticketId, actor);
    const rows = await tx`select e.cursor, e.type, e.occurred_at, e.data,
        coalesce(c.actor_kind, d.actor_kind) as actor_kind, coalesce(c.actor_id, d.actor_id) as actor_id
      from events e
      left join comments c on e.type = 'comment.created' and c.id::text = lower(e.data->>'commentId')
        and c.ticket_id = e.ticket_id
      left join decisions d on e.type = 'decision.created' and d.id::text = lower(e.data->>'decisionId')
        and d.ticket_id = e.ticket_id
      where e.ticket_id = ${ticketId} and e.cursor > ${cursor}::bigint
        and (${ownerView} or e.audience_machine_id is null or e.audience_machine_id = ${machineId}::uuid)
      order by e.cursor limit ${limit + 1}`;
    const items = rows.slice(0, limit).map((row) => ({
      cursor: String(row.cursor),
      type: String(row.type),
      occurredAt: (row.occurred_at as Date).toISOString(),
      actor: row.actor_kind
        ? { kind: row.actor_kind as 'owner' | 'machine', id: String(row.actor_id) }
        : null,
      data: row.data as Record<string, unknown>,
    }));
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.cursor ?? null) : null };
  });
}

function encodeDocsCursor(item: DocsLinkItem): string {
  return Buffer.from(JSON.stringify([item.snapshotId, item.path]), 'utf8').toString('base64url');
}
function decodeDocsCursor(value: string): DocsLinkItem {
  const invalid = () => new ApiError('CURSOR_INVALID', 400, 'Con trỏ docs không hợp lệ');
  if (!/^[A-Za-z0-9_-]{1,8192}$/.test(value)) throw invalid();
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed[0]) ||
      typeof parsed[1] !== 'string' ||
      !parsed[1] ||
      parsed[1].length > 4096
    )
      throw invalid();
    return { snapshotId: parsed[0].toLowerCase(), path: parsed[1] };
  } catch (error) {
    throw error instanceof ApiError ? error : invalid();
  }
}

/** Docs pages linked to a ticket (the read side of PUT docs-links), keyset-paged by snapshot and path. */
export async function readTicketDocsLinks(
  db: Db,
  ticketId: Id,
  actor: Actor,
  cursor: string | null,
  limit: number,
): Promise<Paged<DocsLinkItem>> {
  const after = cursor === null ? null : decodeDocsCursor(cursor);
  return db.begin(readOnly, async (tx) => {
    await requireTicket(tx, ticketId, actor);
    const rows = await tx`select snapshot_id, path from ticket_docs where ticket_id = ${ticketId}
      and (${after === null} or (snapshot_id, path collate "C") > (${after?.snapshotId ?? null}::uuid, ${after?.path ?? null}::text collate "C"))
      order by snapshot_id, path collate "C" limit ${limit + 1}`;
    const items = rows.slice(0, limit).map((row) => ({
      snapshotId: row.snapshot_id as Id,
      path: String(row.path),
    }));
    const last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last ? encodeDocsCursor(last) : null };
  });
}
