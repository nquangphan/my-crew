import { NOTICE_EVENT_TYPES, type NoticeListResponse } from '@crew/shared';
import { and, eq, inArray, isNotNull, lte, type SQL, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { events, noticeReads } from '../db/schema.js';
import { appendEvents, listNotices } from './event-service.js';

const isNotice = and(inArray(events.type, [...NOTICE_EVENT_TYPES]), isNotNull(events.seq));

/** Unread notices of the owner in the whole history. */
async function unreadCount(db: Executor, ownerId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(
      and(
        isNotice,
        sql`not exists (select 1 from ${noticeReads} where ${noticeReads.ownerId} = ${ownerId} and ${noticeReads.eventSeq} = ${events.seq})`,
      ),
    );
  return row?.count ?? 0;
}

/** The newest notices with the owner's read state, plus the unread count. */
export async function listOwnerNotices(
  db: Executor,
  ownerId: string,
  limit: number,
): Promise<NoticeListResponse> {
  const items = await listNotices(db, limit);
  const seqs = items.map((item) => BigInt(item.id));
  const read =
    seqs.length === 0
      ? []
      : await db
          .select({ seq: noticeReads.eventSeq })
          .from(noticeReads)
          .where(and(eq(noticeReads.ownerId, ownerId), inArray(noticeReads.eventSeq, seqs)));
  const readSet = new Set(read.map((row) => row.seq.toString()));
  return {
    items: items.map((item) => ({ ...item, read: readSet.has(item.id) })),
    unread: await unreadCount(db, ownerId),
  };
}

/**
 * Marks notices read: the given ids, or every notice up to `throughSeq` (all of them when absent). Ids that
 * are not notices are ignored. Emits `inbox.read` so the owner's other devices refresh.
 */
async function markRead(db: Executor, ownerId: string, where: SQL | undefined): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into ${noticeReads} (owner_id, event_seq)
      select ${ownerId}::uuid, ${events.seq} from ${events} where ${and(isNotice, where)}
      on conflict do nothing`);
    const unread = await unreadCount(tx, ownerId);
    await appendEvents(tx, [{ payload: { type: 'inbox.read', data: { unread } } }]);
    return unread;
  });
}

export async function markNoticesRead(
  db: Executor,
  ownerId: string,
  ids: readonly string[],
): Promise<number> {
  return markRead(
    db,
    ownerId,
    inArray(
      events.seq,
      ids.map((id) => BigInt(id)),
    ),
  );
}

export async function markAllNoticesRead(db: Executor, ownerId: string, throughId?: string): Promise<number> {
  return markRead(db, ownerId, throughId === undefined ? undefined : lte(events.seq, BigInt(throughId)));
}
