import type { Id, Tx } from '../platform/contracts.ts';
import { liveLinkIds } from './access.ts';

export type TicketAttachmentRef = {
  linkId: Id;
  attachmentId: Id;
  sha256: string;
  ownerId: 'owner';
  fileName: string;
  mime: string | null;
  byteLength: number;
};
export type CommentAttachmentGroup = { commentId: Id; attachments: TicketAttachmentRef[] };
export type Page<T> = { items: T[]; nextCursor: Id | null };

/** Same DTO as the flattened ticket list; callers select link_id/id/expected_sha256/file_name/detected_mime/expected_bytes. */
export function ticketAttachmentRef(row: Record<string, unknown>): TicketAttachmentRef {
  return {
    linkId: String(row.link_id),
    attachmentId: String(row.id),
    sha256: String(row.expected_sha256),
    ownerId: 'owner',
    fileName: String(row.file_name),
    mime: row.detected_mime === null ? null : String(row.detected_mime),
    byteLength: Number(row.expected_bytes),
  };
}

/**
 * Live comment-scoped refs of one ticket grouped by commentId. Caller has already
 * authorized the ticket scope inside `tx`. Groups are keyset-paged by commentId
 * (UUID order, matching other UUID cursors); refs inside a group are ordered by
 * linkId. Inherited and route links never carry comment_id, so they stay only in
 * the flattened list.
 */
export async function readCommentAttachmentGroups(
  tx: Tx,
  ticketId: Id,
  page: { limit: number; cursor: Id | null },
): Promise<Page<CommentAttachmentGroup>> {
  const live = await liveLinkIds(tx, ticketId);
  if (!live.length) return { items: [], nextCursor: null };
  const comments =
    await tx`select distinct l.comment_id from attachment_links l join comments c on c.id=l.comment_id and c.ticket_id=l.ticket_id where l.ticket_id=${ticketId} and l.id in ${tx(live)} and (${page.cursor}::uuid is null or l.comment_id>${page.cursor}::uuid) order by l.comment_id limit ${page.limit + 1}`;
  const ids = comments.slice(0, page.limit).map((row) => String(row.comment_id));
  if (!ids.length) return { items: [], nextCursor: null };
  const rows =
    await tx`select l.comment_id,l.id as link_id,u.id,u.expected_sha256,u.file_name,u.detected_mime,u.expected_bytes from attachment_links l join attachment_uploads u on u.id=l.attachment_id where l.ticket_id=${ticketId} and l.id in ${tx(live)} and l.comment_id in ${tx(ids)} order by l.comment_id,l.id`;
  const groups = new Map<Id, TicketAttachmentRef[]>(ids.map((id) => [id, []]));
  for (const row of rows) groups.get(String(row.comment_id))?.push(ticketAttachmentRef(row));
  const items = ids.map((commentId) => ({ commentId, attachments: groups.get(commentId) ?? [] }));
  return { items, nextCursor: comments.length > page.limit ? (ids.at(-1) ?? null) : null };
}
