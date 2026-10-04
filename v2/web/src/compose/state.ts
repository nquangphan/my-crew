/**
 * Pure contract of the shared composer (ticket create, ticket comment, Assistant message).
 *
 * Invariants:
 * - The submission is a controlled discriminated value owned by the form (Task3/Task6). This module never
 *   infers title/kind/workflow from the target or the description.
 * - The HTTP body is built from the submission plus the exact selection, validated, and serialized once into
 *   a `PendingOperation` (Task2). `kind`, `target`, `draftKey` and callbacks never enter the body.
 * - Persisted draft metadata holds IDs, revision, file name/size/SHA and the operation key only: no text, no
 *   File bytes, no credentials. The frozen body itself lives in the Task2 `PendingStore`.
 */
import {
  type ComposeSession,
  decodeCommentSubmission,
  decodeTicketSubmission,
  type Selection,
} from '../contracts/attachments.ts';
import { arr, type Infer, int, isUuid, lit, matching, obj, str, uuid } from '../contracts/http.ts';
import type { Comment, CreateTicket, Ticket } from '../contracts/tickets.ts';
import type { PendingOperation } from '../lib/pending-operation.ts';

type SessionFields = 'id' | 'ownerId' | 'revision' | 'state' | 'expiresAt';
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** `ComposeTarget`, `v2/server/src/attachments/contracts.ts:28`, derived from the Task2 session decoder. */
export type ComposeTarget = DistributiveOmit<ComposeSession, SessionFields>;

/**
 * `AssistantMessage`, `v2/server/src/attachments/contracts.ts:270`. Task2 contracts have no decoder for it
 * yet; it lives here until the controller moves it into `contracts/attachments.ts`.
 */
export const decodeAssistantMessage = obj({
  id: uuid,
  conversationId: uuid,
  ownerId: lit('owner'),
  text: str,
  attachmentIds: arr(uuid),
  inputRevision: matching(/^\d+$/, 'decimal revision'),
  routeRevision: int,
  createdAt: str,
});
export type AssistantMessage = Infer<typeof decodeAssistantMessage>;

export type DraftFileState =
  | 'selected'
  | 'hashing'
  | 'reserved'
  | 'uploading'
  | 'ready'
  | 'failed'
  | 'removing'
  | 'unknown';

export type DraftFile = {
  localId: string;
  name: string;
  size: number;
  sha256: string | null;
  uploadId: string | null;
  state: DraftFileState;
  errorCode: string | null;
};

export type ComposeSubmission =
  | { kind: 'ticket'; target: Extract<ComposeTarget, { purpose: 'ticket' }>; ticket: CreateTicket }
  | { kind: 'comment'; target: Extract<ComposeTarget, { purpose: 'comment' }>; text: string }
  | {
      kind: 'assistant_message';
      target: Extract<ComposeTarget, { purpose: 'assistant_message' }>;
      conversationId: string;
      clientMessageId: string;
      text: string;
    };

export type ComposeDraft = {
  submission: ComposeSubmission;
  sessionId: string | null;
  selectionRevision: number | null;
  files: DraftFile[];
  submitOperation: PendingOperation | null;
  state: 'editing' | 'sending' | 'ambiguous' | 'suspended' | 'accepted';
};

export type ComposeReceipt =
  | { kind: 'ticket'; ticket: Ticket; attachmentIds: string[] }
  | { kind: 'comment'; comment: Comment; attachmentIds: string[] }
  | { kind: 'assistant_message'; message: AssistantMessage };

export type AssistantRead = 'none' | 'selected-inputs';

/** Validation failure of a submission or selection; `code` is stable for UI and tests. */
export class ComposeValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ComposeValidationError';
    this.code = code;
  }
}

/** Limits of the strict producer schemas, `v2/server/src/attachments/routes.ts:117,453,461,685`. */
export const submissionLimits = {
  titleMin: 1,
  titleMax: 200,
  descriptionMax: 65536,
  textMax: 32768,
  skillMax: 200,
  selectionMax: 100,
} as const;

const ticketLevels = new Set(['request', 'step', 'task']);
const ticketKinds = new Set(['code', 'research', 'docs', 'deploy']);
const workflows = new Set(['superpowers', 'bmad']);

/** JSON-schema `maxLength` counts code points, not UTF-16 units. */
export function codePoints(value: string): number {
  let count = 0;
  for (const _ of value) count++;
  return count;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameTarget(a: ComposeTarget, b: ComposeTarget): boolean {
  if (a.purpose !== b.purpose || a.projectId !== b.projectId || a.ticketId !== b.ticketId) return false;
  if (a.purpose === 'assistant_message' && b.purpose === 'assistant_message')
    return a.conversationId === b.conversationId;
  return true;
}

export function targetKey(target: ComposeTarget): string {
  return target.purpose === 'assistant_message'
    ? `assistant_message:${target.conversationId}`
    : `${target.purpose}:${target.projectId}:${target.ticketId ?? ''}`;
}

export function sameComposeTarget(a: ComposeTarget, b: ComposeTarget): boolean {
  return sameTarget(a, b);
}

/** Target for POST `/v2/attachment-compose`: exactly the three strict variants, no extra keys. */
export function composeTargetBody(target: ComposeTarget): ComposeTarget {
  if (target.purpose === 'ticket') {
    if (!isUuid(target.projectId) || target.ticketId !== null)
      throw new ComposeValidationError('TARGET_INVALID');
    return { purpose: 'ticket', projectId: target.projectId, ticketId: null };
  }
  if (target.purpose === 'comment') {
    if (!isUuid(target.projectId) || !isUuid(target.ticketId))
      throw new ComposeValidationError('TARGET_INVALID');
    return { purpose: 'comment', projectId: target.projectId, ticketId: target.ticketId };
  }
  if (target.purpose === 'assistant_message') {
    if (target.projectId !== null || target.ticketId !== null || !isUuid(target.conversationId))
      throw new ComposeValidationError('TARGET_INVALID');
    return {
      purpose: 'assistant_message',
      projectId: null,
      ticketId: null,
      conversationId: target.conversationId,
    };
  }
  throw new ComposeValidationError('TARGET_INVALID');
}

function validateTicket(ticket: CreateTicket, target: Extract<ComposeTarget, { purpose: 'ticket' }>): void {
  if (!plainObject(ticket)) throw new ComposeValidationError('TICKET_INVALID');
  if (!isUuid(ticket.projectId) || ticket.projectId !== target.projectId)
    throw new ComposeValidationError('TARGET_MISMATCH');
  if (ticket.parentId !== null && !isUuid(ticket.parentId))
    throw new ComposeValidationError('TICKET_INVALID');
  if (!ticketLevels.has(ticket.level)) throw new ComposeValidationError('TICKET_LEVEL_INVALID');
  if (!ticketKinds.has(ticket.kind)) throw new ComposeValidationError('TICKET_KIND_INVALID');
  if (typeof ticket.title !== 'string') throw new ComposeValidationError('TITLE_INVALID');
  const title = codePoints(ticket.title);
  if (title < submissionLimits.titleMin || ticket.title.trim() === '')
    throw new ComposeValidationError('TITLE_REQUIRED');
  if (title > submissionLimits.titleMax) throw new ComposeValidationError('TITLE_TOO_LONG');
  if (
    typeof ticket.description !== 'string' ||
    codePoints(ticket.description) > submissionLimits.descriptionMax
  )
    throw new ComposeValidationError('DESCRIPTION_TOO_LONG');
  if (typeof ticket.mandatory !== 'boolean') throw new ComposeValidationError('TICKET_INVALID');
  if (!plainObject(ticket.criteria) || !plainObject(ticket.inputs) || !plainObject(ticket.outputs))
    throw new ComposeValidationError('TICKET_INVALID');
  if (
    ticket.skill !== null &&
    (typeof ticket.skill !== 'string' || codePoints(ticket.skill) > submissionLimits.skillMax)
  )
    throw new ComposeValidationError('TICKET_INVALID');
  const pin = ticket.workflowPin;
  if (
    pin !== null &&
    (!plainObject(pin) ||
      !workflows.has(pin.workflow) ||
      typeof pin.version !== 'string' ||
      !pin.version ||
      typeof pin.revision !== 'string' ||
      !pin.revision ||
      !/^[0-9a-f]{64}$/.test(pin.checksum))
  )
    throw new ComposeValidationError('WORKFLOW_INVALID');
  const deploy = ticket.deployApprovalDecisionId;
  if (deploy !== undefined && deploy !== null && !isUuid(deploy))
    throw new ComposeValidationError('TICKET_INVALID');
}

/**
 * Validates the controlled submission against its target. `fileCount` is the number of selected files:
 * comment/message text may be empty only when at least one file is selected.
 */
export function validateSubmission(submission: ComposeSubmission, fileCount: number): void {
  if (!submission || typeof submission !== 'object') throw new ComposeValidationError('SUBMISSION_INVALID');
  const target = composeTargetBody(submission.target);
  if (submission.kind === 'ticket') {
    if (target.purpose !== 'ticket') throw new ComposeValidationError('TARGET_MISMATCH');
    validateTicket(submission.ticket, target);
    return;
  }
  if (submission.kind === 'comment') {
    if (target.purpose !== 'comment') throw new ComposeValidationError('TARGET_MISMATCH');
  } else if (submission.kind === 'assistant_message') {
    if (target.purpose !== 'assistant_message' || submission.conversationId !== target.conversationId)
      throw new ComposeValidationError('TARGET_MISMATCH');
    if (!isUuid(submission.clientMessageId)) throw new ComposeValidationError('CLIENT_MESSAGE_ID_INVALID');
  } else throw new ComposeValidationError('SUBMISSION_INVALID');
  if (typeof submission.text !== 'string') throw new ComposeValidationError('TEXT_INVALID');
  if (codePoints(submission.text) > submissionLimits.textMax)
    throw new ComposeValidationError('TEXT_TOO_LONG');
  if (submission.text.trim() === '' && fileCount === 0)
    throw new ComposeValidationError('TEXT_OR_FILES_REQUIRED');
}

function validateSelection(selection: Selection): Selection {
  if (
    !selection ||
    !isUuid(selection.composeSessionId) ||
    !Number.isSafeInteger(selection.selectionRevision) ||
    selection.selectionRevision < 1 ||
    !Array.isArray(selection.attachmentIds) ||
    selection.attachmentIds.length > submissionLimits.selectionMax ||
    !selection.attachmentIds.every(isUuid) ||
    new Set(selection.attachmentIds).size !== selection.attachmentIds.length
  )
    throw new ComposeValidationError('SELECTION_INVALID');
  return {
    composeSessionId: selection.composeSessionId,
    selectionRevision: selection.selectionRevision,
    attachmentIds: [...selection.attachmentIds],
  };
}

/** Copies exactly the `CreateTicket` keys; unknown form fields never reach the strict schema. */
function ticketBody(ticket: CreateTicket): CreateTicket {
  const body: CreateTicket = {
    projectId: ticket.projectId,
    parentId: ticket.parentId,
    level: ticket.level,
    kind: ticket.kind,
    title: ticket.title,
    description: ticket.description,
    mandatory: ticket.mandatory,
    criteria: ticket.criteria,
    inputs: ticket.inputs,
    outputs: ticket.outputs,
    skill: ticket.skill,
    workflowPin: ticket.workflowPin,
  };
  if (ticket.deployApprovalDecisionId !== undefined)
    body.deployApprovalDecisionId = ticket.deployApprovalDecisionId;
  return body;
}

/** Exact path and body of the atomic submission routes (`attachments/routes.ts:453,461,685`). */
export function submissionRequest(
  submission: ComposeSubmission,
  selection: Selection,
  assistantRead: AssistantRead,
): { path: string; body: Record<string, unknown> } {
  const exact = validateSelection(selection);
  validateSubmission(submission, exact.attachmentIds.length);
  if (assistantRead !== 'none' && assistantRead !== 'selected-inputs')
    throw new ComposeValidationError('ASSISTANT_READ_INVALID');
  if (submission.kind === 'ticket')
    return {
      path: '/v2/attachment-submissions/tickets',
      body: { ticket: ticketBody(submission.ticket), selection: exact, assistantRead },
    };
  if (submission.kind === 'comment')
    return {
      path: `/v2/tickets/${submission.target.ticketId}/attachment-comments`,
      body: { text: submission.text, selection: exact, assistantRead },
    };
  return {
    path: '/v2/attachment-submissions/messages',
    body: {
      conversationId: submission.conversationId,
      clientMessageId: submission.clientMessageId,
      text: submission.text,
      selection: exact,
      assistantRead,
    },
  };
}

/**
 * Freezes one submit intent into a `PendingOperation` with the given key. The body is serialized once;
 * `PendingStore.begin` with the same intent/path/body yields byte-identical `bodyJson`.
 */
export function freezeSubmission(input: {
  submission: ComposeSubmission;
  selection: Selection;
  assistantRead: AssistantRead;
  operationId: string;
  intentId: string;
}): PendingOperation {
  if (typeof input.operationId !== 'string' || !input.operationId)
    throw new ComposeValidationError('OPERATION_ID_INVALID');
  if (typeof input.intentId !== 'string' || !input.intentId)
    throw new ComposeValidationError('INTENT_ID_INVALID');
  const request = submissionRequest(input.submission, input.selection, input.assistantRead);
  return Object.freeze({
    id: input.operationId,
    intentId: input.intentId,
    ownerId: 'owner',
    method: 'POST',
    path: request.path,
    bodyJson: JSON.stringify(request.body),
    storage: 'tab',
    state: 'pending',
  });
}

/** Decodes the 201 response of the route matching the submission kind. */
export function decodeComposeReceipt(kind: ComposeSubmission['kind'], value: unknown): ComposeReceipt {
  if (kind === 'ticket') {
    const decoded = decodeTicketSubmission(value);
    return { kind, ticket: decoded.ticket, attachmentIds: decoded.attachmentIds };
  }
  if (kind === 'comment') {
    const decoded = decodeCommentSubmission(value);
    return { kind, comment: decoded.comment, attachmentIds: decoded.attachmentIds };
  }
  return { kind, message: decodeAssistantMessage(value) };
}

/** Active (non-removed) files are the selection; every one must be ready with a server upload ID. */
export function selectionOf(draft: ComposeDraft): Selection | null {
  if (draft.sessionId === null || draft.selectionRevision === null) return null;
  if (draft.files.some((file) => file.state !== 'ready' || file.uploadId === null)) return null;
  return {
    composeSessionId: draft.sessionId,
    selectionRevision: draft.selectionRevision,
    attachmentIds: draft.files.map((file) => file.uploadId as string),
  };
}

/**
 * True when the draft may be sent now: a new submit while editing with a valid submission and every active
 * file ready, or a retry of the same frozen operation while ambiguous/suspended.
 */
export function canSubmit(draft: ComposeDraft): boolean {
  if (draft.state === 'sending' || draft.state === 'accepted') return false;
  if (draft.state === 'ambiguous' || draft.state === 'suspended') return draft.submitOperation !== null;
  if (draft.submitOperation !== null) return false;
  // Without files the compose session may still be unopened; submit opens it before freezing.
  const unopened = draft.files.length === 0 && draft.sessionId === null;
  if (!unopened && selectionOf(draft) === null) return false;
  try {
    validateSubmission(draft.submission, draft.files.length);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// File intake and policy

/** Accepted subset of the attachment policy needed before hashing. */
export type IntakePolicy = {
  maxFileBytes: number;
  maxComposeFiles: number;
  maxComposeBytes: number;
  allowedExtensions: readonly string[];
};

/** Browser-side budget for one in-memory SHA-256 (WebCrypto has no streaming digest). */
export const clientHashBudgetBytes = 256 * 1024 * 1024;

const binaryMime: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const textMime: Record<string, string> = { csv: 'text/csv', md: 'text/markdown' };
const imageExtension: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Declared MIME sent at reserve; the server checks it against the extension and sniffs the bytes again. */
export function declaredMimeFor(name: string): string {
  const extension = fileExtension(name);
  return binaryMime[extension] ?? textMime[extension] ?? 'text/plain';
}

/** Server-side name rule (`staging.ts:184`): 1–255 code points, no control chars, no path separators. */
export function validFileName(name: string): boolean {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) return false;
  if (codePoints(name) > 255) return false;
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return false;
  }
  return true;
}

const clockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Local name for a file: clipboard images often arrive unnamed or as the generic `image.png`, so they get a
 * readable timestamped name in Asia/Ho_Chi_Minh with the extension of their MIME type.
 */
export function localFileName(
  file: { name: string; type: string },
  source: 'clipboard' | 'drop' | 'input',
  index: number,
  now: Date,
): string {
  const generic = !file.name || (source === 'clipboard' && /^image\.(png|jpe?g)$/i.test(file.name));
  if (!generic) return file.name;
  const parts = Object.fromEntries(clockFormat.formatToParts(now).map((part) => [part.type, part.value]));
  const stamp = `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
  const extension = imageExtension[file.type] ?? fileExtension(file.name) ?? '';
  const base = file.type.startsWith('image/') ? 'anh-dan' : 'tep-dan';
  return `${base}-${stamp}-${index + 1}${extension ? `.${extension}` : ''}`;
}

/**
 * Checks one candidate before hashing against the visible policy and the files already selected. Returns an
 * error code or null. Policy bounds are used as published; a bound above the browser hash budget is reported
 * as a client processing limit, never skipped silently.
 */
export function checkIntake(
  policy: IntakePolicy,
  existing: readonly Pick<DraftFile, 'size' | 'state'>[],
  candidate: { name: string; size: number },
): string | null {
  if (!validFileName(candidate.name)) return 'ATTACHMENT_FILE_NAME_INVALID';
  if (!policy.allowedExtensions.includes(fileExtension(candidate.name))) return 'ATTACHMENT_TYPE_UNSUPPORTED';
  if (!Number.isSafeInteger(candidate.size) || candidate.size < 0) return 'ATTACHMENT_LIMIT_INVALID';
  if (candidate.size > policy.maxFileBytes) return 'ATTACHMENT_FILE_TOO_LARGE';
  if (candidate.size > clientHashBudgetBytes) return 'CLIENT_HASH_LIMIT';
  const active = existing.filter((file) => file.state !== 'removing');
  if (active.length >= policy.maxComposeFiles) return 'ATTACHMENT_COMPOSE_QUOTA';
  const bytes = active.reduce((total, file) => total + file.size, 0);
  if (bytes + candidate.size > policy.maxComposeBytes) return 'ATTACHMENT_COMPOSE_QUOTA';
  return null;
}

type TransferItem = { kind: string; type: string; getAsFile(): File | null };
type TransferLike = {
  items?: ArrayLike<TransferItem> | null;
  files?: ArrayLike<File> | null;
  getData?(format: string): string;
};

/**
 * One intake path for clipboard, drop and `<input multiple>`: returns the files and, for paste, the plain
 * text that came with them so both are kept.
 */
export function filesFromTransfer(transfer: TransferLike | null): { files: File[]; text: string } {
  if (!transfer) return { files: [], text: '' };
  const files: File[] = [];
  const items = transfer.items ? Array.from(transfer.items) : [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length === 0 && transfer.files) files.push(...Array.from(transfer.files));
  const text = transfer.getData ? transfer.getData('text/plain') : '';
  return { files, text };
}

// ---------------------------------------------------------------------------------------------------------
// Persisted draft metadata (sessionStorage, tab scope)

export const draftStoragePrefix = 'crew-v2:compose:';
const draftVersion = 1;

export type DraftRecord = {
  version: 1;
  intentId: string;
  targetKey: string | null;
  sessionId: string | null;
  selectionRevision: number | null;
  submitOperationId: string | null;
  files: Pick<DraftFile, 'localId' | 'name' | 'size' | 'sha256' | 'uploadId'>[];
};

export function serializeDraftRecord(record: DraftRecord): string {
  return JSON.stringify({
    version: draftVersion,
    intentId: record.intentId,
    targetKey: record.targetKey,
    sessionId: record.sessionId,
    selectionRevision: record.selectionRevision,
    submitOperationId: record.submitOperationId,
    files: record.files.map(({ localId, name, size, sha256, uploadId }) => ({
      localId,
      name,
      size,
      sha256,
      uploadId,
    })),
  });
}

export function parseDraftRecord(raw: string | null): DraftRecord | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!plainObject(value) || value.version !== draftVersion || typeof value.intentId !== 'string')
    return null;
  const nullableUuid = (item: unknown) => (isUuid(item) ? item : null);
  const files = (Array.isArray(value.files) ? value.files : []).flatMap((item): DraftRecord['files'] => {
    if (!plainObject(item) || typeof item.localId !== 'string' || typeof item.name !== 'string') return [];
    if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 0) return [];
    const sha256 = typeof item.sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.sha256) ? item.sha256 : null;
    return [
      {
        localId: item.localId,
        name: item.name,
        size: item.size,
        sha256,
        uploadId: nullableUuid(item.uploadId),
      },
    ];
  });
  const revision = value.selectionRevision;
  return {
    version: 1,
    intentId: value.intentId,
    targetKey: typeof value.targetKey === 'string' ? value.targetKey : null,
    sessionId: nullableUuid(value.sessionId),
    selectionRevision: typeof revision === 'number' && Number.isSafeInteger(revision) ? revision : null,
    submitOperationId: typeof value.submitOperationId === 'string' ? value.submitOperationId : null,
    files,
  };
}

/**
 * Owner-facing confirmation of an accepted submission. It states what the server stored; it never claims
 * that the Assistant or a model has read the files (that needs a read receipt, not this response).
 */
export function receiptSummary(receipt: ComposeReceipt): string {
  if (receipt.kind === 'ticket') {
    const files = receipt.attachmentIds.length;
    return `Đã tạo ticket “${receipt.ticket.title}”${files ? ` kèm ${files} tệp` : ''}.`;
  }
  if (receipt.kind === 'comment') {
    const files = receipt.attachmentIds.length;
    return `Đã gửi bình luận${files ? ` kèm ${files} tệp` : ''}.`;
  }
  const files = receipt.message.attachmentIds.length;
  return `Đã gửi tin nhắn cho Trợ lý${files ? ` kèm ${files} tệp` : ''}. Trợ lý chưa trả lời.`;
}
