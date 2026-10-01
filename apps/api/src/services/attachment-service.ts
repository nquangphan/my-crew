import {
  type Attachment,
  AttachmentMimeType,
  MAX_ATTACHMENT_BYTES,
  type UploadAttachmentRequest,
} from '@crew/shared';
import { and, eq, isNull, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Executor } from '../db/client.js';
import { type AttachmentRow, attachments, type TicketRow, tickets } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { getTicketRow } from './ticket-service.js';

/** A draft attachment (`ticket_id` still null) unclaimed for longer than this is deleted as orphaned. */
export const DRAFT_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;
export const DRAFT_ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function toAttachmentDto(row: Pick<AttachmentRow, 'id' | 'mimeType' | 'sizeBytes'>): Attachment {
  return {
    id: row.id,
    url: `/v1/attachments/${row.id}`,
    mimeType: row.mimeType as AttachmentMimeType,
    sizeBytes: row.sizeBytes,
  };
}

/**
 * Detail message for an over-size pasted image, shared with `attachmentRoutes`: a raw upload large enough
 * that Fastify's route `bodyLimit` rejects it never reaches `decodeImage()` below to throw this itself, so
 * the route catches that rejection separately and reports the same `ApiError` message.
 */
export const ATTACHMENT_TOO_LARGE_MESSAGE = `ảnh vượt quá ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB`;

/**
 * Decodes and validates a pasted image before it is stored: the mime whitelist is enforced again here (not
 * just at the zod boundary, since `mimeType` and `content` must agree), and the size limit is checked on the
 * decoded bytes, not the base64 string length.
 */
function decodeImage(input: UploadAttachmentRequest): Buffer {
  if (!AttachmentMimeType.safeParse(input.mimeType).success) {
    throw new ApiError('VALIDATION_FAILED', `mime type không được hỗ trợ: ${input.mimeType}`);
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.content, 'base64');
  } catch {
    throw new ApiError('VALIDATION_FAILED', 'content không phải base64 hợp lệ');
  }
  if (buffer.length === 0) throw new ApiError('VALIDATION_FAILED', 'ảnh trống');
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new ApiError('ATTACHMENT_TOO_LARGE', ATTACHMENT_TOO_LARGE_MESSAGE);
  }
  return buffer;
}

/** Inserts a decoded attachment row, ticket-bound or draft, and returns its DTO. */
async function insertAttachment(
  db: Executor,
  ticketId: string | null,
  ownerId: string,
  input: UploadAttachmentRequest,
): Promise<Attachment> {
  const content = decodeImage(input);
  const [row] = await db
    .insert(attachments)
    .values({
      ticketId,
      ownerId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: content.length,
      content,
    })
    .returning({ id: attachments.id, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes });
  if (!row) throw new Error('attachment insert returned no row');
  return toAttachmentDto(row);
}

/**
 * Stores a pasted image for a ticket (description or comment paste-to-upload). `ticketIdOrKey` accepts a
 * uuid or a ticket key (`AST-1`), like every other ticket route. 404 when the ticket does not exist; the
 * mime whitelist and 10MB size cap are enforced before anything is written.
 */
export async function uploadAttachment(
  db: Executor,
  ticketIdOrKey: string,
  ownerId: string,
  input: UploadAttachmentRequest,
): Promise<Attachment> {
  const ticket = await getTicketRow(db, ticketIdOrKey);
  return insertAttachment(db, ticket.id, ownerId, input);
}

/**
 * Stores a pasted image before its ticket exists (the "Create ticket" dialog): `ticket_id` is null. It is
 * claimed (its `ticket_id` set) when `createRequestTicket()` finds it referenced in the new ticket's
 * description, or deleted by `deleteOrphanedDraftAttachments()` if it stays unclaimed for 24 hours.
 */
export async function uploadDraftAttachment(
  db: Executor,
  ownerId: string,
  input: UploadAttachmentRequest,
): Promise<Attachment> {
  return insertAttachment(db, null, ownerId, input);
}

export interface AttachmentContent {
  mimeType: string;
  content: Buffer;
}

/** The stored bytes and mime type of an attachment, for `GET /v1/attachments/:id`. 404 when unknown. */
export async function getAttachmentContent(db: Executor, id: string): Promise<AttachmentContent> {
  const [row] = await db
    .select({ mimeType: attachments.mimeType, content: attachments.content })
    .from(attachments)
    .where(eq(attachments.id, id));
  if (!row) throw notFound('attachment');
  return row;
}

export interface AttachmentWithTicket extends AttachmentContent {
  ticket: TicketRow;
}

/**
 * The stored bytes, mime type, and the ticket the attachment belongs to (`attachments.ticket_id`), for
 * `GET /v1/daemon/attachments/:id`: the caller checks the ticket's machine scope before streaming the bytes
 * back, so an attachment is never leaked (bytes or mime) to a machine outside that scope. 404 when unknown.
 */
export async function getAttachmentWithTicket(db: Executor, id: string): Promise<AttachmentWithTicket> {
  const [row] = await db
    .select({ mimeType: attachments.mimeType, content: attachments.content, ticket: tickets })
    .from(attachments)
    .innerJoin(tickets, eq(tickets.id, attachments.ticketId))
    .where(eq(attachments.id, id));
  if (!row) throw notFound('attachment');
  return row;
}

// ---------------------------------------------------------------------------
// Orphaned draft cleanup
// ---------------------------------------------------------------------------

/**
 * Deletes draft attachments (`ticket_id IS NULL`) never claimed by a ticket within
 * `DRAFT_ATTACHMENT_TTL_MS`: an owner who pasted an image then abandoned the "create ticket" dialog. A draft
 * claimed by `createRequestTicket()` has `ticket_id` set, so it is never a candidate here again, no matter
 * how old; returns the deleted ids.
 */
export async function deleteOrphanedDraftAttachments(db: Executor, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - DRAFT_ATTACHMENT_TTL_MS);
  const deleted = await db
    .delete(attachments)
    .where(and(isNull(attachments.ticketId), lt(attachments.createdAt, cutoff)))
    .returning({ id: attachments.id });
  return deleted.map((row) => row.id);
}

/** Runs the orphaned-draft-attachment cleanup every `intervalMs`; returns a stop function. */
export function startDraftAttachmentCleanup(
  db: Executor,
  log: Pick<FastifyBaseLogger, 'error' | 'warn'>,
  intervalMs = DRAFT_ATTACHMENT_CLEANUP_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    deleteOrphanedDraftAttachments(db).then(
      (ids) => {
        if (ids.length > 0) log.warn({ attachments: ids }, 'orphaned draft attachments deleted');
      },
      (error: unknown) => log.error({ err: error }, 'draft attachment cleanup failed'),
    );
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
