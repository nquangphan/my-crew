import {
  type Attachment,
  AttachmentMimeType,
  MAX_ATTACHMENT_BYTES,
  type UploadAttachmentRequest,
} from '@crew/shared';
import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { type AttachmentRow, attachments } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { getTicketRow } from './ticket-service.js';

function toAttachmentDto(row: Pick<AttachmentRow, 'id' | 'mimeType' | 'sizeBytes'>): Attachment {
  return {
    id: row.id,
    url: `/v1/attachments/${row.id}`,
    mimeType: row.mimeType as AttachmentMimeType,
    sizeBytes: row.sizeBytes,
  };
}

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
    throw new ApiError('VALIDATION_FAILED', `ảnh vượt quá ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB`);
  }
  return buffer;
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
  const content = decodeImage(input);
  const ticket = await getTicketRow(db, ticketIdOrKey);
  const [row] = await db
    .insert(attachments)
    .values({
      ticketId: ticket.id,
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
