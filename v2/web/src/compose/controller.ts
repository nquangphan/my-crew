/**
 * Framework-free controller of one composer draft (`draftKey`). It owns the compose session, the file
 * pipeline (hash → reserve → PUT bytes) and the submit operation; the form owns the submission object.
 *
 * Invariants:
 * - Every server call that changes the selection revision runs in one serialized queue, so a reserve or
 *   remove always carries the revision the previous step returned.
 * - Each mutation is a Task2 `PendingOperation` with a deterministic intent per draft/file. While its outcome
 *   is unresolved the same key and bytes are retried; a new reservation or submission is never issued for
 *   that intent. GET compose is the proof that resolves an unconfirmed reserve/remove.
 * - The selection is exactly the server's active uploads: a failed, missing or unknown file blocks submit;
 *   nothing is filtered out to make a send possible.
 * - Persisted metadata (sessionStorage) has IDs, revision, file name/size/SHA and the operation key; File
 *   bytes stay in memory and must be reselected (same size and SHA) after a reload.
 */
import {
  type Attachment,
  type AttachmentPolicy,
  type ComposeSession,
  decodeAttachment,
  decodeComposeSession,
  decodeComposeView,
  decodeReserveResult,
  decodeSelectionRevision,
} from '../contracts/attachments.ts';
import { ContractError, type Decoder } from '../contracts/http.ts';
import { ApiFailure, type OwnerClient } from '../lib/api.ts';
import {
  IntentUnresolvedError,
  type PendingOperation,
  PendingSerializationError,
  type PendingStore,
  type RecoveryTombstone,
  type TabStorage,
} from '../lib/pending-operation.ts';
import { type FileHasher, HashError } from './file-hash.ts';
import {
  type AssistantRead,
  type ComposeDraft,
  type ComposeReceipt,
  type ComposeSubmission,
  ComposeValidationError,
  canSubmit,
  checkIntake,
  clientHashBudgetBytes,
  composeTargetBody,
  type DraftFile,
  declaredMimeFor,
  decodeComposeReceipt,
  draftStoragePrefix,
  localFileName,
  parseDraftRecord,
  selectionOf,
  serializeDraftRecord,
  submissionRequest,
  targetKey,
  validateSubmission,
} from './state.ts';

export type ComposeView = {
  draft: ComposeDraft;
  /** Last error code for the owner (validation, policy, transport or server code). */
  errorCode: string | null;
  /** Producer message behind an unconfirmed 5xx (for example why the server is not ready). */
  errorMessage: string | null;
  /** The submit key survives only as a payload-free tombstone (after logout): re-enter the same content. */
  needsPayload: boolean;
  /** Submit button state: new submit, retry of the frozen operation, or re-entry for a tombstone. */
  submittable: boolean;
  receipt: ComposeReceipt | null;
  /** Consent frozen into the unresolved submit (re-entry must reproduce it); null when nothing is frozen. */
  assistantRead: AssistantRead | null;
  /** The owner may drop this local draft explicitly (re-entry or a submit that can no longer be resent). */
  discardable: boolean;
};

export type DiscardResult = 'discarded' | 'blocked' | 'unconfirmed';

export type ComposeControllerOptions = {
  draftKey: string;
  submission: ComposeSubmission;
  client: OwnerClient;
  pending: PendingStore;
  storage: TabStorage | null;
  hasher: FileHasher;
  loadPolicy: (signal: AbortSignal) => Promise<AttachmentPolicy>;
  newId?: () => string;
  now?: () => Date;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

type FileSource = 'clipboard' | 'drop' | 'input';

const uploadBackoff = [1000, 2000, 4000] as const;
/**
 * Clock-skew allowance before a compose is treated as expired from this tab. The owner API exposes no
 * server clock, so an `expiresAt` is trusted as past only after this margin on the client clock.
 */
export const expirySkewMs = 5 * 60_000;
const definitiveUpload = new Set([
  'ATTACHMENT_CONTENT_INVALID',
  'ATTACHMENT_MAGIC_MISMATCH',
  'ATTACHMENT_BINARY_TEXT',
  'ATTACHMENT_REPLAY_MISMATCH',
  'ATTACHMENT_DATA_LOSS',
  'ATTACHMENT_UPLOAD_EXPIRED',
  'ATTACHMENT_UPLOAD_CONFLICT',
  'ATTACHMENT_NOT_FOUND',
]);
const reconcileAfterSubmit = new Set([
  'SELECTION_CHANGED',
  'ATTACHMENT_SELECTION_STALE',
  'ATTACHMENT_NOT_READY',
  'NOT_FOUND',
  'COMPOSE_ALREADY_SUBMITTED',
]);
const sessionCodes = new Set(['UNAUTHENTICATED', 'SESSION_REQUIRED', 'SESSION_ENDED']);

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ApiFailure(null, 'ABORTED', 'aborted'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new ApiFailure(null, 'ABORTED', 'aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function errorCode(error: unknown): string {
  if (error instanceof ApiFailure || error instanceof ComposeValidationError || error instanceof HashError)
    return error.code;
  if (error instanceof PendingSerializationError)
    return error.message.replace('PENDING_NOT_SERIALIZABLE:', '');
  if (error instanceof IntentUnresolvedError) return 'INTENT_UNRESOLVED';
  return 'UNEXPECTED';
}

/** Producer message behind an unconfirmed 5xx (the code itself is replaced by `UNCONFIRMED`). */
function serverMessage(error: unknown): string | null {
  if (!(error instanceof ApiFailure) || error.status === null || error.status < 500) return null;
  return error.message && error.message !== error.code ? error.message : null;
}

function isOperation(entry: PendingOperation | RecoveryTombstone | undefined): entry is PendingOperation {
  return entry !== undefined && 'bodyJson' in entry;
}

/** `expectedRevision` of an unresolved reserve/remove (operation body or tombstone). */
function expectedRevisionOf(entry: PendingOperation | RecoveryTombstone): number | null {
  if (!isOperation(entry)) return entry.expectedRevision;
  try {
    const body: unknown = JSON.parse(entry.bodyJson);
    const value =
      body && typeof body === 'object' ? (body as { expectedRevision?: unknown }).expectedRevision : null;
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
  } catch {
    return null;
  }
}

/** Server upload state → draft file state. */
function fromServer(attachment: Attachment): Pick<DraftFile, 'state' | 'errorCode'> {
  switch (attachment.state) {
    case 'ready':
      return { state: 'ready', errorCode: null };
    case 'reserved':
      return { state: 'reserved', errorCode: null };
    case 'receiving':
      return { state: 'uploading', errorCode: null };
    case 'rejected':
      return { state: 'failed', errorCode: attachment.problems[0]?.code ?? 'ATTACHMENT_REJECTED' };
    case 'deleting':
      return { state: 'removing', errorCode: null };
    case 'missing':
      return { state: 'failed', errorCode: 'ATTACHMENT_MISSING' };
    default:
      return { state: 'failed', errorCode: 'UPLOAD_ABANDONED' };
  }
}

export class ComposeController {
  readonly #options: ComposeControllerOptions;
  readonly #client: OwnerClient;
  readonly #pending: PendingStore;
  readonly #newId: () => string;
  readonly #now: () => Date;
  readonly #sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly #storageKey: string;
  readonly #life = new AbortController();
  readonly #listeners = new Set<() => void>();
  readonly #bytes = new Map<string, File>();
  readonly #aborts = new Map<string, AbortController>();
  #draft: ComposeDraft;
  #intentId: string;
  #sessionTarget: string | null;
  #tombstoneId: string | null = null;
  /** Exact bytes of the current submit intent (memory only); a lost key is replaced by the same body. */
  #frozen: { path: string; bodyJson: string } | null = null;
  /** Consent frozen into the submit intent (persisted, non-secret). */
  #assistantRead: AssistantRead | null = null;
  /**
   * The submit outcome is unknown and cannot be resent from this tab: `SUBMIT_UNCONFIRMED` (reload after
   * the key vanished) or `SUBMITTED_ELSEWHERE` (the compose was submitted without a local key).
   */
  #lockReason: string | null = null;
  #receiptTaken = false;
  /** Key of the latest submit of this intent, kept while its outcome is not proven. */
  #lastSubmitId: string | null = null;
  /** Bumped by `startNew`; a send that finishes under an older generation no longer owns the draft. */
  #generation = 0;
  /** Set for the whole of `discard()`: no submit may start while the draft is being dropped. */
  #discarding = false;
  readonly #offPending: () => void;
  #errorCode: string | null = null;
  #errorMessage: string | null = null;
  #receipt: ComposeReceipt | null = null;
  #policy: Promise<AttachmentPolicy> | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #fileChain: Promise<unknown> = Promise.resolve();
  #view: ComposeView | null = null;

  constructor(options: ComposeControllerOptions) {
    this.#options = options;
    this.#client = options.client;
    this.#pending = options.pending;
    this.#newId = options.newId ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => new Date());
    this.#sleep = options.sleep ?? delay;
    this.#storageKey = `${draftStoragePrefix}${options.draftKey}`;
    let raw: string | null = null;
    try {
      raw = options.storage?.getItem(this.#storageKey) ?? null;
    } catch {
      raw = null;
    }
    const record = parseDraftRecord(raw);
    this.#intentId = record?.intentId ?? this.#newId();
    this.#sessionTarget = record?.sessionId ? record.targetKey : null;
    this.#assistantRead = record?.assistantRead ?? null;
    const restoredSession = record?.sessionId ?? null;
    this.#draft = {
      submission: options.submission,
      sessionId: record?.sessionId ?? null,
      selectionRevision: record?.sessionId ? record.selectionRevision : null,
      files: (record?.files ?? []).map((file) => this.#restoredFile(file, restoredSession)),
      submitOperation: null,
      state: 'editing',
    };
    const operationId = record?.submitOperationId ?? null;
    this.#lastSubmitId = operationId;
    if (operationId) {
      const operation = this.#pending.get(operationId);
      if (operation) {
        this.#draft.submitOperation = operation;
        this.#draft.state = operation.state === 'suspended' ? 'suspended' : 'ambiguous';
      } else if (this.#pending.tombstones().some((tombstone) => tombstone.id === operationId)) {
        this.#tombstoneId = operationId;
        this.#draft.state = 'suspended';
      } else {
        // The key was resolved elsewhere (accepted or rejected); GET compose decides which.
        this.#lockReason = 'SUBMIT_UNCONFIRMED';
        this.#draft.state = 'ambiguous';
      }
    }
    this.#offPending = this.#pending.subscribe(() => this.#onPendingChange());
  }

  // ---- observation ------------------------------------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Stable snapshot until the next change (safe for `useSyncExternalStore`). */
  view(): ComposeView {
    this.#view ??= Object.freeze({
      draft: this.#draft,
      errorCode: this.#errorCode,
      errorMessage: this.#errorMessage,
      needsPayload: this.#tombstoneId !== null,
      submittable: this.#submittable(),
      receipt: this.#receipt,
      assistantRead: this.#assistantRead,
      discardable:
        !this.#discarding &&
        this.#draft.state !== 'sending' &&
        (this.#tombstoneId !== null || this.#lockReason !== null),
    });
    return this.#view;
  }

  /** In-memory bytes of a file selected in this tab (for local preview); null after reload. */
  localFile(localId: string): File | null {
    return this.#bytes.get(localId) ?? null;
  }

  /** True while a pipeline step for this file is running in this tab. */
  isActive(localId: string): boolean {
    return this.#aborts.has(localId);
  }

  /** The accepted receipt, handed out exactly once. */
  takeReceipt(): ComposeReceipt | null {
    if (!this.#receipt || this.#receiptTaken) return null;
    this.#receiptTaken = true;
    return this.#receipt;
  }

  /** Explicit owner decision to drop the local draft; unresolved keys stay in the PendingStore. */
  async discard(): Promise<void> {
    if (this.#tombstoneId === null && this.#lockReason === null) return;
    await this.discardDraft();
  }

  // ---- form input -------------------------------------------------------------------------------------

  /**
   * Controlled submission update. Refused while a submit is frozen (sending/ambiguous/suspended/accepted),
   * except re-entry of content for a tombstoned key. A changed target moves files to a new compose session.
   */
  setSubmission(next: ComposeSubmission): boolean {
    const reentry = this.#tombstoneId !== null;
    if (this.#draft.state !== 'editing' && !reentry) return false;
    this.#draft = { ...this.#draft, submission: next };
    if (!reentry && this.#draft.sessionId !== null && this.#sessionTarget !== this.#safeTargetKey(next))
      void this.#enqueue(() => this.#retarget()).catch((error) => this.#fail(error));
    this.#emit();
    return true;
  }

  /** Clipboard, drop and `<input multiple>` share this intake; checks run before any hashing. */
  async addFiles(files: readonly File[], source: FileSource): Promise<void> {
    if (this.#draft.state !== 'editing' || files.length === 0) return;
    let policy: AttachmentPolicy;
    try {
      policy = await this.#loadPolicy();
    } catch (error) {
      this.#fail(error);
      return;
    }
    const now = this.#now();
    files.forEach((file, index) => {
      const name = localFileName(file, source, index, now);
      const code = checkIntake(policy, this.#draft.files, { name, size: file.size });
      const localId = this.#newId();
      this.#setFiles([
        ...this.#draft.files,
        {
          localId,
          name,
          size: file.size,
          sha256: null,
          uploadId: null,
          state: code ? 'failed' : 'selected',
          errorCode: code,
        },
      ]);
      if (!code) {
        this.#bytes.set(localId, file);
        this.#schedule(localId);
      }
    });
  }

  /** Abort local work, then DELETE the reservation with the current revision (refetch on 409). */
  async removeFile(localId: string): Promise<void> {
    const file = this.#file(localId);
    if (!file || this.#draft.state !== 'editing') return;
    this.#aborts.get(localId)?.abort(new ApiFailure(null, 'ABORTED', 'aborted'));
    this.#bytes.delete(localId);
    if (file.uploadId === null && !this.#unresolved(this.#reserveIntent(localId))) {
      this.#setFiles(this.#draft.files.filter((item) => item.localId !== localId));
      return;
    }
    this.#patch(localId, { state: 'removing', errorCode: null });
    await this.#enqueue(() => this.#removeUpload(localId)).catch((error) => this.#fail(error));
  }

  /** Owner retry of a failed/unknown file: reconcile first, abandon a rejected reservation, then resend. */
  async retryFile(localId: string): Promise<void> {
    if (this.#draft.state !== 'editing') return;
    const before = this.#file(localId);
    if (!before) return;
    if (before.state === 'removing') {
      await this.#enqueue(() => this.#removeUpload(localId)).catch((error) => this.#fail(error));
      return;
    }
    await this.#enqueue(() => this.#refresh()).catch((error) => this.#fail(error));
    const file = this.#file(localId);
    if (!file) return;
    if (file.state === 'failed' && file.uploadId !== null && this.#bytes.has(localId)) {
      // A confirmed terminal rejection may abandon the old reservation before a new one is made.
      await this.#enqueue(() => this.#removeUpload(localId, true)).catch((error) => this.#fail(error));
    }
    const current = this.#file(localId);
    if (!current || !this.#bytes.has(localId)) return;
    // An unconfirmed reservation GET could not prove is re-sent with its original key and bytes.
    if (current.state === 'failed' && current.sha256 === null && current.errorCode !== 'HASH_ABORTED') return;
    if (current.errorCode === 'DUPLICATE_LOCAL') return;
    if (current.state === 'ready' || this.isActive(localId)) return;
    const resume = current.uploadId ? (current.state === 'uploading' ? 'uploading' : 'reserved') : 'selected';
    this.#patch(localId, { state: resume, errorCode: null });
    this.#schedule(localId);
  }

  /** After a reload the bytes are gone: the owner selects the same file again (same size and SHA-256). */
  async reselectFile(localId: string, file: File): Promise<void> {
    const entry = this.#file(localId);
    if (!entry || this.#draft.state !== 'editing') return;
    if (file.size !== entry.size) {
      this.#patch(localId, { errorCode: 'RESELECT_MISMATCH' });
      return;
    }
    try {
      const policy = await this.#loadPolicy();
      const sha256 = await this.#options.hasher.hash(file, this.#hashBudget(policy), this.#life.signal);
      if (entry.sha256 !== null && sha256 !== entry.sha256) {
        this.#patch(localId, { errorCode: 'RESELECT_MISMATCH' });
        return;
      }
      this.#bytes.set(localId, file);
      this.#patch(localId, {
        sha256,
        state: entry.uploadId ? (entry.state === 'ready' ? 'ready' : 'reserved') : 'selected',
        errorCode: null,
      });
      if (this.#file(localId)?.state !== 'ready') this.#schedule(localId);
    } catch (error) {
      this.#patch(localId, { errorCode: errorCode(error) });
    }
  }

  // ---- submit -----------------------------------------------------------------------------------------

  /**
   * Freeze and send, or retry the frozen operation with the same key/bytes. `assistantRead` is part of the
   * frozen body and only applies to a new submit.
   */
  async submit(assistantRead: AssistantRead): Promise<ComposeReceipt | null> {
    if (this.#discarding || this.#draft.state === 'sending' || this.#draft.state === 'accepted') return null;
    const generation = this.#generation;
    let operation: PendingOperation | null;
    try {
      operation = await this.#submitOperation(assistantRead);
    } catch (error) {
      this.#fail(error);
      return null;
    }
    if (operation === null || generation !== this.#generation) return null;
    this.#lastSubmitId = operation.id;
    this.#draft = { ...this.#draft, submitOperation: operation, state: 'sending' };
    this.#setError(null);
    this.#emit();
    let value: unknown;
    try {
      value = await this.#client.mutate<unknown>(operation);
    } catch (error) {
      if (generation === this.#generation) await this.#afterSubmitFailure(operation, error);
      return null;
    }
    if (generation !== this.#generation) return null;
    let receipt: ComposeReceipt;
    try {
      receipt = decodeComposeReceipt(this.#draft.submission.kind, value);
    } catch {
      // The server committed and the key is released: stay locked; resending the frozen body on the same
      // compose replays the stored response instead of creating a second entity.
      this.#draft = { ...this.#draft, submitOperation: null, state: 'ambiguous' };
      this.#setError('RESPONSE_SHAPE_INVALID');
      this.#emit();
      return null;
    }
    this.#receipt = receipt;
    this.#receiptTaken = false;
    this.#tombstoneId = null;
    this.#frozen = null;
    this.#lockReason = null;
    this.#draft = { ...this.#draft, submitOperation: null, state: 'accepted' };
    this.#emit();
    return receipt;
  }

  /** Re-read the compose session (after reload or reauthentication) and resolve unconfirmed steps. */
  async reconcile(): Promise<void> {
    if (this.#draft.sessionId === null) return;
    await this.#enqueue(() => this.#refresh()).catch((error) => this.#fail(error));
    if (this.#draft.state !== 'editing') return;
    for (const file of this.#draft.files) {
      if (file.state !== 'reserved' && file.state !== 'selected' && file.state !== 'uploading') continue;
      if (this.isActive(file.localId)) continue;
      if (this.#bytes.has(file.localId)) this.#schedule(file.localId);
      // A reservation without bytes in this tab (reload) needs the same file selected again.
      else this.#patch(file.localId, { state: 'failed', errorCode: 'NEEDS_RESELECT' });
    }
  }

  /** Explicit discard of an editing draft: abandon the compose session, then start a fresh draft. */
  async abandon(): Promise<void> {
    if (this.#draft.state !== 'editing' || this.#unresolved(this.#submitIntent())) return;
    await this.discardDraft();
  }

  /**
   * Owner “drop this draft” for the form: `blocked` while sending, `unconfirmed` when the compose DELETE
   * could not be confirmed (draft and key kept), `discarded` once the draft was reset.
   */
  async discardDraft(): Promise<DiscardResult> {
    if (this.#discarding || this.#draft.state === 'sending') return 'blocked';
    this.#discarding = true;
    this.#emit();
    const sessionId = this.#draft.sessionId;
    if (sessionId !== null) {
      // The compose and its uploads are abandoned so nothing of the dropped draft can be submitted or
      // hold quota; a submitted compose is left as is (the DELETE path reads it back and stops). An
      // unresolved submit key stays in the recovery panel, as the owner accepted.
      try {
        await this.#enqueue(() => this.#abandonSession());
      } catch (error) {
        if (this.#unresolved(`${this.#intentId}:abandon:${sessionId}`)) {
          // Unconfirmed DELETE: keep the draft and its key; the next discard resends the same key.
          this.#discarding = false;
          this.#setError('DISCARD_UNCONFIRMED', serverMessage(error));
          this.#emit();
          for (const file of this.#draft.files)
            if (this.#bytes.has(file.localId) && (file.state === 'selected' || file.state === 'reserved'))
              this.#schedule(file.localId);
          return 'unconfirmed';
        }
        // A proven rejection leaves nothing pending for this compose.
      }
      this.#releaseSessionKeys(sessionId);
    }
    this.startNew();
    return 'discarded';
  }

  /** After the receipt was delivered: fresh intent, no files, no session. */
  startNew(): void {
    for (const abort of this.#aborts.values()) abort.abort(new ApiFailure(null, 'ABORTED', 'aborted'));
    this.#aborts.clear();
    this.#bytes.clear();
    this.#generation++;
    this.#discarding = false;
    this.#intentId = this.#newId();
    this.#sessionTarget = null;
    this.#tombstoneId = null;
    this.#frozen = null;
    this.#assistantRead = null;
    this.#lockReason = null;
    this.#lastSubmitId = null;
    this.#receipt = null;
    this.#receiptTaken = false;
    this.#setError(null);
    this.#draft = {
      submission: this.#draft.submission,
      sessionId: null,
      selectionRevision: null,
      files: [],
      submitOperation: null,
      state: 'editing',
    };
    this.#emit();
  }

  /** Close: stop hashing (terminates the worker), abort uploads, drop listeners. Metadata stays persisted. */
  dispose(): void {
    this.#life.abort(new ApiFailure(null, 'ABORTED', 'aborted'));
    for (const abort of this.#aborts.values()) abort.abort(new ApiFailure(null, 'ABORTED', 'aborted'));
    this.#aborts.clear();
    this.#bytes.clear();
    this.#options.hasher.dispose();
    this.#offPending();
    this.#listeners.clear();
  }

  // ---- internals: submit ------------------------------------------------------------------------------

  async #submitOperation(assistantRead: AssistantRead): Promise<PendingOperation | null> {
    const existing = this.#draft.submitOperation
      ? this.#pending.get(this.#draft.submitOperation.id)
      : undefined;
    if (existing) return existing;
    if (this.#tombstoneId !== null) {
      // Re-entry must reproduce the original body, including the consent frozen with it.
      const request = this.#request(this.#assistantRead ?? assistantRead);
      return this.#pending.resume(this.#tombstoneId, request.body, 'tab');
    }
    if (this.#frozen) {
      // The key vanished (replayed elsewhere or the reply was unreadable): the same body on the same
      // compose replays the stored result; a new body would be a second intent.
      return this.#beginSubmit(this.#frozen.path, JSON.parse(this.#frozen.bodyJson));
    }
    if (this.#lockReason === 'SUBMIT_UNCONFIRMED') {
      // Nothing to resend from this tab: let GET compose settle the outcome first.
      await this.#enqueue(() => this.#refresh()).catch((error) => this.#fail(error));
      return null;
    }
    if (this.#lockReason !== null) throw new ComposeValidationError(this.#lockReason);
    if (this.#draft.state !== 'editing') {
      // The frozen key vanished without a body in memory (resolved by the recovery panel after a reload
      // or remount): GET compose decides between a locked submitted draft and a free editing draft.
      this.#markVanished();
      await this.#enqueue(() => this.#refresh()).catch((error) => this.#fail(error));
      return null;
    }
    if (this.#draft.files.length === 0 && this.#draft.sessionId === null)
      await this.#enqueue(() => this.#ensureSession());
    await this.#queue;
    if (!canSubmit(this.#draft)) throw new ComposeValidationError(this.#blocker());
    const request = this.#request(assistantRead);
    const operation = this.#beginSubmit(request.path, request.body);
    this.#frozen = { path: operation.path, bodyJson: operation.bodyJson };
    this.#assistantRead = assistantRead;
    return operation;
  }

  #markVanished(): void {
    this.#lockReason = 'SUBMIT_UNCONFIRMED';
    this.#setError('SUBMIT_UNCONFIRMED');
    this.#draft = { ...this.#draft, submitOperation: null, state: 'ambiguous' };
    this.#emit();
  }

  /** The frozen submit key changed outside this controller (recovery panel replay, logout tombstone). */
  #onPendingChange(): void {
    const operation = this.#draft.submitOperation;
    if (!operation || this.#draft.state === 'sending' || this.#pending.get(operation.id)) return;
    if (this.#pending.tombstones().some((tombstone) => tombstone.id === operation.id)) {
      this.#tombstoneId = operation.id;
      this.#draft = { ...this.#draft, submitOperation: null, state: 'suspended' };
      this.#emit();
      return;
    }
    if (this.#frozen) {
      // The same body can be resent on this compose to read the stored result.
      this.#draft = { ...this.#draft, submitOperation: null };
      this.#emit();
      return;
    }
    this.#markVanished();
    void this.#enqueue(() => this.#refresh()).catch((error) => this.#fail(error));
  }

  /** True when this tab still owns an unresolved submit for the draft. */
  #ownsSubmit(): boolean {
    const operation = this.#draft.submitOperation;
    return (
      (operation !== null && this.#pending.get(operation.id) !== undefined) ||
      this.#tombstoneId !== null ||
      this.#frozen !== null
    );
  }

  /** Free the unresolved draft state after GET compose proved the frozen submit did not commit. */
  #unlockUnconfirmed(): void {
    this.#lockReason = null;
    this.#setError(null);
    this.#frozen = null;
    this.#assistantRead = null;
    this.#lastSubmitId = null;
    this.#draft = { ...this.#draft, submitOperation: null, state: 'editing' };
  }

  /** Drop the submit key and frozen body of a compose that is proven unable to commit them. */
  #releaseSubmit(): void {
    const operationId = this.#draft.submitOperation?.id ?? this.#tombstoneId;
    // Clear the draft first so the PendingStore listener does not read the rejection as a vanished key.
    this.#tombstoneId = null;
    this.#unlockUnconfirmed();
    if (operationId) this.#pending.reject(operationId);
  }

  /** Reserve/remove keys of a compose this draft no longer uses. */
  #releaseSessionKeys(sessionId: string): void {
    for (const file of this.#draft.files) {
      this.#resolve(this.#reserveIntent(file.localId, sessionId), 'reject');
      if (file.uploadId) this.#resolve(this.#removeIntent(file.uploadId), 'reject');
    }
  }

  #beginSubmit(path: string, body: unknown): PendingOperation {
    try {
      return this.#pending.begin({
        intentId: this.#submitIntent(),
        method: 'POST',
        path,
        body,
        storage: 'tab',
      });
    } catch (error) {
      if (!(error instanceof IntentUnresolvedError)) throw error;
      const unresolved = this.#pending.get(error.operationId);
      if (!unresolved) throw error;
      return unresolved;
    }
  }

  #request(assistantRead: AssistantRead) {
    const selection = selectionOf(this.#draft);
    if (!selection) throw new ComposeValidationError(this.#blocker());
    return submissionRequest(this.#draft.submission, selection, assistantRead);
  }

  async #afterSubmitFailure(operation: PendingOperation, error: unknown): Promise<void> {
    const code = errorCode(error);
    const kept = this.#pending.get(operation.id);
    if (kept) {
      this.#draft = {
        ...this.#draft,
        submitOperation: kept,
        state: kept.state === 'suspended' ? 'suspended' : 'ambiguous',
      };
      this.#tombstoneId = null;
    } else if (this.#pending.tombstones().some((tombstone) => tombstone.id === operation.id)) {
      this.#draft = { ...this.#draft, submitOperation: null, state: 'suspended' };
      this.#tombstoneId = operation.id;
    } else if (code === 'COMPOSE_ALREADY_SUBMITTED') {
      // The compose was used by another body: never move files to a new compose from here.
      this.#draft = { ...this.#draft, submitOperation: null, state: 'ambiguous' };
      this.#tombstoneId = null;
      this.#frozen = null;
      this.#lockReason = 'SUBMITTED_ELSEWHERE';
    } else {
      // Proven rejection: the intent is free again.
      this.#draft = { ...this.#draft, submitOperation: null, state: 'editing' };
      this.#tombstoneId = null;
      this.#frozen = null;
      this.#assistantRead = null;
      this.#lastSubmitId = null;
    }
    this.#setError(code, serverMessage(error));
    this.#emit();
    if (!kept && this.#draft.state === 'editing' && reconcileAfterSubmit.has(code))
      await this.#enqueue(() => this.#refresh()).catch((failure) => this.#fail(failure));
  }

  #blocker(): string {
    const files = this.#draft.files;
    if (files.some((file) => file.state === 'failed' || file.state === 'unknown')) return 'FILES_NOT_READY';
    if (files.some((file) => file.state !== 'ready')) return 'FILES_PENDING';
    try {
      validateSubmission(this.#draft.submission, files.length);
    } catch (error) {
      return errorCode(error);
    }
    return 'COMPOSE_NOT_OPEN';
  }

  #submittable(): boolean {
    if (this.#discarding) return false;
    if (this.#tombstoneId !== null) {
      const selection = selectionOf(this.#draft);
      if (!selection) return false;
      try {
        validateSubmission(this.#draft.submission, this.#draft.files.length);
        return true;
      } catch {
        return false;
      }
    }
    if (this.#frozen && (this.#draft.state === 'ambiguous' || this.#draft.state === 'suspended')) return true;
    if (this.#lockReason !== null) return false;
    return canSubmit(this.#draft);
  }

  // ---- internals: compose session ---------------------------------------------------------------------

  async #ensureSession(): Promise<string> {
    if (this.#draft.sessionId !== null) return this.#draft.sessionId;
    const target = composeTargetBody(this.#draft.submission.target);
    const key = targetKey(target);
    const session = await this.#send<ComposeSession>(
      `${this.#intentId}:open:${key}`,
      'POST',
      '/v2/attachment-compose',
      target,
      decodeComposeSession,
    );
    if (session.state !== 'open' || targetKey(session) !== key)
      throw new ApiFailure(null, 'COMPOSE_TARGET_MISMATCH', 'shape');
    this.#sessionTarget = key;
    this.#draft = { ...this.#draft, sessionId: session.id, selectionRevision: session.revision };
    this.#emit();
    return session.id;
  }

  async #retarget(): Promise<void> {
    const key = this.#safeTargetKey(this.#draft.submission);
    if (this.#draft.sessionId === null || key === null || key === this.#sessionTarget) return;
    try {
      await this.#abandonSession();
    } catch {
      // The old session is never reused; the server expires it by TTL.
      this.#setError('PREVIOUS_COMPOSE_KEPT');
    }
    this.#detachFromSession('TARGET_CHANGED');
  }

  async #abandonSession(): Promise<void> {
    const sessionId = this.#draft.sessionId;
    if (sessionId === null) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.#send(
          `${this.#intentId}:abandon:${sessionId}`,
          'DELETE',
          `/v2/attachment-compose/${sessionId}`,
          { expectedRevision: this.#draft.selectionRevision },
          decodeComposeSession,
        );
        return;
      } catch (error) {
        const released = !this.#unresolved(`${this.#intentId}:abandon:${sessionId}`);
        if (released && error instanceof ApiFailure && error.code === 'ATTACHMENT_SELECTION_STALE') {
          const view = await this.#readCompose(sessionId);
          if (view.session.state !== 'open') return;
          this.#draft = { ...this.#draft, selectionRevision: view.session.revision };
          continue;
        }
        throw error;
      }
    }
  }

  /** Files leave the old session: in-memory files go through the pipeline again, others need reselect. */
  #detachFromSession(code: string): void {
    for (const abort of this.#aborts.values()) abort.abort(new ApiFailure(null, 'ABORTED', 'aborted'));
    this.#aborts.clear();
    // The old compose is closed or never reused: its unresolved reserve/remove keys can no longer matter.
    const oldSession = this.#draft.sessionId;
    if (oldSession !== null) this.#releaseSessionKeys(oldSession);
    const files = this.#draft.files
      .filter((file) => file.state !== 'removing')
      .map((file): DraftFile => {
        const bytes = this.#bytes.has(file.localId);
        if (file.state === 'failed' && file.uploadId === null && file.sha256 === null) return file;
        return {
          ...file,
          uploadId: null,
          state: bytes ? 'selected' : 'failed',
          errorCode: bytes ? null : 'NEEDS_RESELECT',
        };
      });
    this.#sessionTarget = null;
    this.#draft = { ...this.#draft, sessionId: null, selectionRevision: null, files };
    if (this.#errorCode === null) this.#setError(code);
    this.#emit();
    for (const file of files) if (file.state === 'selected') this.#schedule(file.localId);
  }

  async #readCompose(sessionId: string) {
    const value = await this.#client.get<unknown>(`/v2/attachment-compose/${sessionId}`, {
      signal: this.#life.signal,
    });
    try {
      return decodeComposeView(value);
    } catch (error) {
      throw new ApiFailure(null, 'RESPONSE_SHAPE_INVALID', 'shape', (error as Error).message);
    }
  }

  /** GET compose: server state is authoritative for every upload; unconfirmed reserve/remove get resolved. */
  async #refresh(): Promise<void> {
    const sessionId = this.#draft.sessionId;
    if (sessionId === null) return;
    const view = await this.#readCompose(sessionId);
    if (this.#draft.sessionId !== sessionId) return;
    if (view.session.state === 'submitted') {
      // Never move files to a new compose: either our frozen submit is replayed for its receipt, or the
      // compose was submitted without a local key and the draft stays locked until the owner discards it.
      if (!this.#ownsSubmit()) {
        this.#lockReason = 'SUBMITTED_ELSEWHERE';
        this.#setError('SUBMITTED_ELSEWHERE');
        this.#draft = { ...this.#draft, submitOperation: null, state: 'ambiguous' };
      }
      this.#mergeFiles(view, false);
      return;
    }
    if (view.session.state !== 'open') {
      if (this.#lockReason === 'SUBMIT_UNCONFIRMED') this.#unlockUnconfirmed();
      this.#detachFromSession('COMPOSE_CLOSED');
      return;
    }
    if (this.#expired(view.session.expiresAt)) {
      // An expired open compose can no longer be submitted, and an earlier send would have made it
      // `submitted`: any unresolved submit of it is proven not committed. Files move to a new compose.
      this.#releaseSubmit();
      this.#detachFromSession('COMPOSE_EXPIRED');
      return;
    }
    // The vanished key did not submit this still-open compose: it was rejected.
    if (this.#lockReason === 'SUBMIT_UNCONFIRMED') this.#unlockUnconfirmed();
    this.#mergeFiles(view, true);
  }

  /**
   * Expired beyond the skew margin, and no send of the frozen submit can still be running: never while this
   * tab is sending, nor while the PendingStore has the key in flight (`pending`).
   */
  #expired(expiresAt: string): boolean {
    if (this.#draft.state === 'sending') return false;
    const operation = this.#draft.submitOperation
      ? this.#pending.get(this.#draft.submitOperation.id)
      : undefined;
    if (operation?.state === 'pending') return false;
    return Date.parse(expiresAt) + expirySkewMs <= this.#now().getTime();
  }

  /** Server state is authoritative for every upload of the compose. */
  #mergeFiles(view: { session: ComposeSession; attachments: Attachment[] }, open: boolean): void {
    const revision = view.session.revision;
    const byId = new Map(view.attachments.map((attachment) => [attachment.attachmentId, attachment]));
    const files: DraftFile[] = [];
    const claimed = new Set<string>();
    for (const file of this.#draft.files) {
      if (file.uploadId !== null) {
        const server = byId.get(file.uploadId);
        claimed.add(file.uploadId);
        if (!server) {
          files.push({ ...file, state: 'failed', errorCode: 'ATTACHMENT_MISSING' });
          continue;
        }
        if (server.state === 'abandoned' || server.state === 'deleted') {
          this.#resolve(this.#removeIntent(file.uploadId), 'accept');
          if (file.state !== 'removing')
            files.push({ ...file, uploadId: null, state: 'failed', errorCode: 'UPLOAD_ABANDONED' });
          continue;
        }
        if (file.state === 'removing') {
          const entry = this.#unresolved(this.#removeIntent(file.uploadId));
          const expected = entry ? expectedRevisionOf(entry) : null;
          if (entry && expected !== null && revision > expected)
            this.#resolve(this.#removeIntent(file.uploadId), 'reject');
          files.push({ ...file, errorCode: entry ? file.errorCode : 'REMOVE_PENDING' });
          continue;
        }
        files.push(this.#stalled({ ...file, ...fromServer(server) }));
        continue;
      }
      // Not yet known to have a reservation: adopt a matching active upload (lost reserve response).
      const adopted = view.attachments.find(
        (attachment) =>
          !claimed.has(attachment.attachmentId) &&
          attachment.state !== 'abandoned' &&
          attachment.state !== 'deleted' &&
          file.sha256 !== null &&
          attachment.sha256 === file.sha256 &&
          attachment.byteLength === file.size &&
          !this.#draft.files.some((other) => other.uploadId === attachment.attachmentId),
      );
      const reserve = this.#unresolved(this.#reserveIntent(file.localId));
      if (adopted) {
        claimed.add(adopted.attachmentId);
        this.#resolve(this.#reserveIntent(file.localId), 'accept');
        files.push(this.#stalled({ ...file, uploadId: adopted.attachmentId, ...fromServer(adopted) }));
        continue;
      }
      if (reserve) {
        const expected = expectedRevisionOf(reserve);
        if (expected !== null && revision > expected) {
          // The stale revision can no longer commit and no matching row exists: proven not reserved.
          this.#resolve(this.#reserveIntent(file.localId), 'reject');
          const bytes = this.#bytes.has(file.localId);
          files.push({
            ...file,
            state: file.state === 'removing' ? 'removing' : bytes ? 'selected' : 'failed',
            errorCode: bytes || file.state === 'removing' ? null : 'NEEDS_RESELECT',
          });
          continue;
        }
        files.push({
          ...file,
          state: file.state === 'removing' ? 'removing' : 'unknown',
          errorCode: 'RESERVE_UNCONFIRMED',
        });
        continue;
      }
      files.push(file);
    }
    // Server-authoritative extras (for example a reservation that committed after its reply was lost).
    for (const attachment of view.attachments) {
      if (
        claimed.has(attachment.attachmentId) ||
        attachment.state === 'abandoned' ||
        attachment.state === 'deleted'
      )
        continue;
      files.push(
        this.#stalled({
          localId: this.#newId(),
          name: attachment.fileName,
          size: attachment.byteLength,
          sha256: attachment.sha256,
          uploadId: attachment.attachmentId,
          ...fromServer(attachment),
        }),
      );
    }
    this.#draft = {
      ...this.#draft,
      // A submitted compose keeps the revision frozen into the submit body.
      selectionRevision: open ? revision : this.#draft.selectionRevision,
      files: files.filter(
        (file) =>
          !(
            file.state === 'removing' &&
            file.uploadId === null &&
            !this.#unresolved(this.#reserveIntent(file.localId))
          ),
      ),
    };
    this.#emit();
  }

  /** `receiving` on the server with no bytes and no step in this tab: nothing will move it but a retry. */
  #stalled(file: DraftFile): DraftFile {
    if (file.state !== 'uploading' || this.#bytes.has(file.localId) || this.isActive(file.localId))
      return file;
    return { ...file, state: 'unknown', errorCode: 'UPLOAD_RECEIVING' };
  }

  // ---- internals: file pipeline -----------------------------------------------------------------------

  #schedule(localId: string): void {
    this.#fileChain = this.#fileChain.then(() => this.#process(localId)).catch(() => undefined);
  }

  async #process(localId: string): Promise<void> {
    const start = this.#file(localId);
    const file = this.#bytes.get(localId);
    if (!start || !file || this.#life.signal.aborted || this.#discarding) return;
    if (start.state !== 'selected' && start.state !== 'reserved' && start.state !== 'uploading') return;
    if (this.isActive(localId)) return;
    const abort = new AbortController();
    this.#aborts.set(localId, abort);
    const signal = AbortSignal.any([abort.signal, this.#life.signal]);
    try {
      if (start.sha256 === null) {
        this.#patch(localId, { state: 'hashing', errorCode: null });
        const policy = await this.#loadPolicy();
        const sha256 = await this.#options.hasher.hash(file, this.#hashBudget(policy), signal);
        const duplicate = this.#draft.files.some(
          (other) =>
            other.localId !== localId &&
            other.sha256 === sha256 &&
            other.size === file.size &&
            other.state !== 'removing',
        );
        this.#patch(
          localId,
          duplicate ? { sha256, state: 'failed', errorCode: 'DUPLICATE_LOCAL' } : { sha256 },
        );
        if (duplicate) return;
      }
      if (this.#file(localId)?.uploadId === null) await this.#enqueue(() => this.#reserve(localId));
      if (signal.aborted) return;
      await this.#upload(localId, signal);
    } catch (error) {
      if (signal.aborted || !this.#file(localId) || this.#file(localId)?.state === 'removing') return;
      this.#patch(localId, { state: 'failed', errorCode: errorCode(error) });
    } finally {
      if (this.#aborts.get(localId) === abort) this.#aborts.delete(localId);
    }
  }

  async #reserve(localId: string): Promise<void> {
    if (this.#discarding) return;
    await this.#ensureSession();
    for (let attempt = 0; attempt < 3; attempt++) {
      const file = this.#file(localId);
      const sessionId = this.#draft.sessionId;
      if (
        !file ||
        file.uploadId !== null ||
        file.state === 'removing' ||
        file.sha256 === null ||
        sessionId === null
      )
        return;
      const intent = this.#reserveIntent(localId);
      try {
        const result = await this.#send(
          intent,
          'POST',
          `/v2/attachment-compose/${sessionId}/uploads`,
          {
            expectedRevision: this.#draft.selectionRevision,
            fileName: file.name,
            declaredMime: declaredMimeFor(file.name),
            byteLength: file.size,
            sha256: file.sha256,
          },
          decodeReserveResult,
        );
        this.#draft = { ...this.#draft, selectionRevision: result.selectionRevision };
        this.#patch(localId, { uploadId: result.attachment.attachmentId, ...fromServer(result.attachment) });
        return;
      } catch (error) {
        if (this.#unresolved(intent)) {
          // Unconfirmed: keep the key; GET compose resolves it before any new reservation.
          this.#patch(localId, { state: 'unknown', errorCode: errorCode(error) });
          return;
        }
        if (error instanceof ApiFailure && error.code === 'RESPONSE_SHAPE_INVALID') {
          await this.#refresh();
          return;
        }
        if (error instanceof ApiFailure && error.code === 'ATTACHMENT_SELECTION_STALE') {
          await this.#refresh();
          continue;
        }
        if (error instanceof ApiFailure && error.code === 'ATTACHMENT_COMPOSE_CLOSED') {
          // Closed or expired: GET compose moves the files to a new compose and reschedules them.
          await this.#refresh();
          if (this.#draft.sessionId === sessionId) throw error;
          return;
        }
        throw error;
      }
    }
    this.#patch(localId, { state: 'failed', errorCode: 'ATTACHMENT_SELECTION_STALE' });
  }

  async #upload(localId: string, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt <= uploadBackoff.length; attempt++) {
      const file = this.#file(localId);
      if (!file || file.uploadId === null || file.state === 'ready' || file.state === 'failed') return;
      if (file.state === 'removing' || file.state === 'unknown') return;
      const bytes = this.#bytes.get(localId);
      if (!bytes) {
        this.#patch(localId, { state: 'failed', errorCode: 'NEEDS_RESELECT' });
        return;
      }
      this.#patch(localId, { state: 'uploading', errorCode: null });
      let failure: unknown;
      try {
        const value = await this.#client.upload<unknown>(file.uploadId, bytes, signal);
        this.#patch(localId, fromServer(decodeAttachment(value)));
        if (this.#file(localId)?.state === 'ready') return;
      } catch (error) {
        failure = error;
      }
      if (signal.aborted) return;
      const code = failure === undefined ? 'UPLOAD_NOT_READY' : errorCode(failure);
      if (sessionCodes.has(code)) {
        this.#patch(localId, { state: 'unknown', errorCode: code });
        return;
      }
      // Ready wins; receiving/busy waits and retries the same bytes on the same upload ID.
      try {
        await this.#enqueue(() => this.#refresh());
      } catch (error) {
        this.#patch(localId, { state: 'unknown', errorCode: errorCode(error) });
        return;
      }
      // The compose expired or closed: the file was moved to a new compose and rescheduled.
      if (signal.aborted) return;
      const after = this.#file(localId);
      if (!after || after.state === 'ready' || after.state === 'failed' || after.state === 'removing') return;
      if (after.state === 'reserved' && definitiveUpload.has(code)) {
        this.#patch(localId, { state: 'failed', errorCode: code });
        return;
      }
      if (attempt === uploadBackoff.length) break;
      try {
        await this.#sleep(uploadBackoff[attempt] ?? 4000, signal);
      } catch {
        return;
      }
    }
    this.#patch(localId, { state: 'unknown', errorCode: 'UPLOAD_UNCONFIRMED' });
  }

  /** DELETE one upload. `keepLocal` turns the entry back into a new reservation candidate. */
  async #removeUpload(localId: string, keepLocal = false): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const file = this.#file(localId);
      const sessionId = this.#draft.sessionId;
      if (!file) return;
      if (file.uploadId === null || sessionId === null) {
        if (this.#unresolved(this.#reserveIntent(localId))) await this.#refresh();
        const current = this.#file(localId);
        if (current?.uploadId) continue;
        if (!keepLocal) this.#setFiles(this.#draft.files.filter((item) => item.localId !== localId));
        return;
      }
      const intent = this.#removeIntent(file.uploadId);
      try {
        const result = await this.#send(
          intent,
          'DELETE',
          `/v2/attachment-compose/${sessionId}/uploads/${file.uploadId}`,
          { expectedRevision: this.#draft.selectionRevision },
          decodeSelectionRevision,
        );
        this.#draft = { ...this.#draft, selectionRevision: result.selectionRevision };
        if (keepLocal) this.#patch(localId, { uploadId: null, state: 'selected', errorCode: null });
        else this.#setFiles(this.#draft.files.filter((item) => item.localId !== localId));
        return;
      } catch (error) {
        if (this.#unresolved(intent)) {
          this.#patch(localId, { state: 'removing', errorCode: errorCode(error) });
          return;
        }
        if (
          error instanceof ApiFailure &&
          (error.code === 'ATTACHMENT_SELECTION_STALE' || error.code === 'ATTACHMENT_UPLOAD_CONFLICT')
        ) {
          await this.#refresh();
          if (!this.#file(localId)) return;
          continue;
        }
        this.#patch(localId, { errorCode: errorCode(error) });
        return;
      }
    }
  }

  // ---- internals: plumbing ----------------------------------------------------------------------------

  async #send<T>(
    intentId: string,
    method: PendingOperation['method'],
    path: string,
    body: unknown,
    decode: Decoder<T>,
  ): Promise<T> {
    let operation: PendingOperation;
    try {
      operation = this.#pending.begin({ intentId, method, path, body, storage: 'tab' });
    } catch (error) {
      if (!(error instanceof IntentUnresolvedError)) throw error;
      const unresolved = this.#pending.get(error.operationId);
      if (!unresolved) throw new ApiFailure(null, 'INTENT_UNRESOLVED', 'local');
      operation = unresolved;
    }
    const value = await this.#client.mutate<unknown>(operation);
    try {
      return decode(value);
    } catch (error) {
      if (error instanceof ContractError)
        throw new ApiFailure(null, 'RESPONSE_SHAPE_INVALID', 'shape', error.message);
      throw error;
    }
  }

  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(work);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  #loadPolicy(): Promise<AttachmentPolicy> {
    this.#policy ??= this.#options.loadPolicy(this.#life.signal).catch((error) => {
      this.#policy = null;
      throw error;
    });
    return this.#policy;
  }

  #hashBudget(policy: AttachmentPolicy): number {
    return Math.min(policy.maxFileBytes, clientHashBudgetBytes);
  }

  #unresolved(intentId: string): PendingOperation | RecoveryTombstone | undefined {
    return this.#pending.unresolved(intentId);
  }

  /** GET compose proved the outcome of an unconfirmed reserve/remove. */
  #resolve(intentId: string, outcome: 'accept' | 'reject'): void {
    const entry = this.#unresolved(intentId);
    if (!entry) return;
    if (outcome === 'accept') this.#pending.accept(entry.id);
    else this.#pending.reject(entry.id);
  }

  /** Reserve keys are scoped to the compose session they reserve into. */
  #reserveIntent(localId: string, sessionId: string | null = this.#draft.sessionId): string {
    return `${this.#intentId}:reserve:${sessionId ?? 'none'}:${localId}`;
  }

  #removeIntent(uploadId: string): string {
    return `${this.#intentId}:remove:${uploadId}`;
  }

  #submitIntent(): string {
    return `${this.#intentId}:submit`;
  }

  #safeTargetKey(submission: ComposeSubmission): string | null {
    try {
      return targetKey(composeTargetBody(submission.target));
    } catch {
      return null;
    }
  }

  #restoredFile(
    file: Pick<DraftFile, 'localId' | 'name' | 'size' | 'sha256' | 'uploadId'>,
    sessionId: string | null,
  ): DraftFile {
    if (file.uploadId !== null) return { ...file, state: 'unknown', errorCode: null };
    const reserve = this.#options.pending.unresolved(this.#reserveIntent(file.localId, sessionId));
    return reserve
      ? { ...file, state: 'unknown', errorCode: 'RESERVE_UNCONFIRMED' }
      : { ...file, state: 'failed', errorCode: 'NEEDS_RESELECT' };
  }

  #file(localId: string): DraftFile | undefined {
    return this.#draft.files.find((file) => file.localId === localId);
  }

  #patch(localId: string, patch: Partial<DraftFile>): void {
    if (!this.#file(localId)) return;
    this.#setFiles(
      this.#draft.files.map((file) => (file.localId === localId ? { ...file, ...patch } : file)),
    );
  }

  #setFiles(files: DraftFile[]): void {
    this.#draft = { ...this.#draft, files };
    this.#emit();
  }

  #setError(code: string | null, message: string | null = null): void {
    this.#errorCode = code;
    this.#errorMessage = code === null ? null : message;
  }

  #fail(error: unknown): void {
    this.#setError(errorCode(error), serverMessage(error));
    this.#emit();
  }

  #persist(): void {
    const storage = this.#options.storage;
    if (!storage) return;
    try {
      const draft = this.#draft;
      if (
        draft.state === 'accepted' ||
        (draft.sessionId === null &&
          draft.files.length === 0 &&
          !draft.submitOperation &&
          !this.#tombstoneId &&
          this.#lockReason === null &&
          this.#frozen === null)
      ) {
        storage.removeItem(this.#storageKey);
        return;
      }
      storage.setItem(
        this.#storageKey,
        serializeDraftRecord({
          version: 1,
          intentId: this.#intentId,
          targetKey: this.#sessionTarget,
          sessionId: draft.sessionId,
          selectionRevision: draft.selectionRevision,
          submitOperationId:
            draft.submitOperation?.id ??
            this.#tombstoneId ??
            (this.#lockReason !== null || this.#frozen !== null ? this.#lastSubmitId : null),
          assistantRead: this.#assistantRead,
          files: draft.files.filter((file) => file.state !== 'removing' || file.uploadId !== null),
        }),
      );
    } catch {
      // Storage full or blocked: the draft keeps working in memory; the PendingStore still holds the key.
    }
  }

  #emit(): void {
    this.#view = null;
    this.#persist();
    for (const listener of this.#listeners) listener();
  }
}
