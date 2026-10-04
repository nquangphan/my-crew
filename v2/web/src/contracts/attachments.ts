/**
 * Attachment DTOs mirrored from `v2/server/src/attachments/contracts.ts`. The HTTP routes
 * (`attachments/routes.ts:328`) are reviewed but not mounted in `buildApp` until gate G2.
 */

import { arr, type Infer, int, lit, matching, nul, nullable, obj, oneOf, str, uuid } from './http.ts';
import { decodeComment, decodeTicket } from './tickets.ts';

const sha256 = matching(/^[0-9a-f]{64}$/, 'sha256');

/** `UploadState`/`ExtractStatus`, `contracts.ts:7,16`. */
export const uploadState = lit(
  'reserved',
  'receiving',
  'ready',
  'rejected',
  'abandoned',
  'deleting',
  'deleted',
  'missing',
);
export const extractStatus = lit(
  'pending',
  'running',
  'complete',
  'partial',
  'encrypted',
  'corrupt',
  'unsupported',
  'blocked',
  'failed',
);

const problem = obj({ code: str, message: str, unitIds: arr(str) });

/** `ComposeTarget`/`ComposeSession`, `contracts.ts:28,32`. */
const sessionFields = {
  id: uuid,
  ownerId: lit('owner'),
  revision: int,
  state: lit('open', 'submitted', 'abandoned'),
  expiresAt: str,
};
const ticketCompose = obj({ purpose: lit('ticket'), projectId: uuid, ticketId: nul, ...sessionFields });
const commentCompose = obj({ purpose: lit('comment'), projectId: uuid, ticketId: uuid, ...sessionFields });
const assistantCompose = obj({
  purpose: lit('assistant_message'),
  projectId: nul,
  ticketId: nul,
  conversationId: uuid,
  ...sessionFields,
});
export const decodeComposeSession = oneOf<
  Infer<typeof ticketCompose> | Infer<typeof commentCompose> | Infer<typeof assistantCompose>
>(ticketCompose, commentCompose, assistantCompose);
export type ComposeSession = Infer<typeof decodeComposeSession>;

/** `Attachment`, `contracts.ts:47`. Returned by reserve and PUT content. */
export const decodeAttachment = obj({
  attachmentId: uuid,
  sha256,
  ownerId: lit('owner'),
  composeSessionId: uuid,
  fileName: str,
  mime: nullable(str),
  byteLength: int,
  state: uploadState,
  extraction: extractStatus,
  problems: arr(problem),
});
export type Attachment = Infer<typeof decodeAttachment>;

/** `Selection`, `contracts.ts:56`. */
export type Selection = { composeSessionId: string; selectionRevision: number; attachmentIds: string[] };

/** GET `/v2/attachment-compose/:id` → `{session, attachments}`. */
export const decodeComposeView = obj({ session: decodeComposeSession, attachments: arr(decodeAttachment) });

/** POST `/v2/attachment-compose/:id/uploads` → `{attachment, selectionRevision}`, `routes.ts:386`. */
export const decodeReserveResult = obj({ attachment: decodeAttachment, selectionRevision: int });

/** DELETE upload → `{selectionRevision}`, `routes.ts:424`. */
export const decodeSelectionRevision = obj({ selectionRevision: int });

/** Atomic submissions, `routes.ts:453/461`. */
export const decodeTicketSubmission = obj({ ticket: decodeTicket, attachmentIds: arr(uuid) });
export const decodeCommentSubmission = obj({ comment: decodeComment, attachmentIds: arr(uuid) });

/** GET `/v2/attachment-policy`, `routes.ts:344` with `AttachmentConfig` minus `storageRoot` (`config.ts:22`). */
export const decodeAttachmentPolicy = obj({
  policySha256: sha256,
  maxFileBytes: int,
  maxComposeFiles: int,
  maxComposeBytes: int,
  maxOwnerStagingBytes: int,
  stagingTtlMs: int,
  cleanupGraceMs: int,
  uploadLeaseMs: int,
  uploadHeartbeatMs: int,
  uploadMaxWallMs: int,
  chunkBytes: int,
  workerConcurrency: int,
  workerMemoryMiB: int,
  workerCpu: int,
  workerPids: int,
  workerWallMs: int,
  allowedExtensions: arr(str),
  limits: obj({
    maxExpandedBytes: int,
    maxEntryBytes: int,
    maxZipEntries: int,
    maxCompressionRatio: int,
    maxXmlDepth: int,
    maxTextNodeBytes: int,
    maxTextBytes: int,
    maxCsvRows: int,
    maxCsvColumns: int,
    maxCsvFieldBytes: int,
    maxPdfPages: int,
    pdfDpi: int,
    maxPagePixels: int,
    maxImagePixels: int,
    maxOutputBytes: int,
  }),
  supportedMime: arr(str),
  extractionCapabilities: arr(lit('text', 'vision')),
});
export type AttachmentPolicy = Infer<typeof decodeAttachmentPolicy>;
