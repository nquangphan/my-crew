import type { Actor, Db, Id, Tx } from '../platform/contracts.ts';
import type { CreateTicket } from '../tickets/contracts.ts';
import type { AttachmentConfig } from './config.ts';

export type { Id } from '../platform/contracts.ts';
export type Sha256 = string;
export type UploadState =
  | 'reserved'
  | 'receiving'
  | 'ready'
  | 'rejected'
  | 'abandoned'
  | 'deleting'
  | 'deleted'
  | 'missing';
export type ExtractStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'partial'
  | 'encrypted'
  | 'corrupt'
  | 'unsupported'
  | 'blocked'
  | 'failed';
export type Problem = { code: string; message: string; unitIds: string[] };
export type AttachmentRef = { attachmentId: Id; sha256: Sha256; ownerId: 'owner' };
export type ComposeTarget =
  | { purpose: 'ticket'; projectId: Id; ticketId: null }
  | { purpose: 'comment'; projectId: Id; ticketId: Id }
  | { purpose: 'assistant_message'; projectId: null; ticketId: null; conversationId: Id };
export type ComposeSession = ComposeTarget & {
  id: Id;
  ownerId: 'owner';
  revision: number;
  state: 'open' | 'submitted' | 'abandoned';
  expiresAt: string;
};
export type UploadSpec = {
  composeSessionId: Id;
  expectedRevision: number;
  fileName: string;
  declaredMime: string;
  byteLength: number;
  sha256: Sha256;
};
export type Attachment = AttachmentRef & {
  composeSessionId: Id;
  fileName: string;
  mime: string | null;
  byteLength: number;
  state: UploadState;
  extraction: ExtractStatus;
  problems: Problem[];
};
export type Selection = { composeSessionId: Id; selectionRevision: number; attachmentIds: Id[] };
export type SourceComponent = {
  kind: 'image' | 'unsupported-visual' | 'calculated-value' | 'comment' | 'external';
  index: number;
};
export type SourceLocator =
  | { kind: 'text'; byteStart: number; byteEnd: number; lineStart: number; lineEnd: number }
  | { kind: 'pdf'; page: number; box: [number, number, number, number]; rotation: number }
  | {
      kind: 'image';
      width: number;
      height: number;
      box: [number, number, number, number];
      transform?: {
        originalWidth: number;
        originalHeight: number;
        orientation: number;
        normalizedWidth: number;
        normalizedHeight: number;
        rotation: number;
        reflected: boolean;
      };
    }
  | {
      kind: 'docx';
      part: string;
      paragraph: number;
      table: number | null;
      row: number | null;
      cell: number | null;
      component?: SourceComponent;
    }
  | {
      kind: 'sheet';
      part: string;
      sheet: string;
      range: string;
      hidden: boolean;
      component?: SourceComponent;
    }
  | { kind: 'csv'; rowStart: number; rowEnd: number; columnStart: number; columnEnd: number };
export type CoverageUnit = {
  id: string;
  locator: SourceLocator;
  needs: 'text' | 'vision';
  state: 'available' | 'missing';
  reason: string | null;
};
export type Derivative = {
  id: Id;
  original: AttachmentRef;
  extractionId: Id;
  kind: 'text' | 'image';
  mime: 'text/plain' | 'image/png';
  sha256: Sha256;
  byteLength: number;
  unitIds: string[];
  verification: 'verified' | 'failed';
  extractorVersion: string;
  configSha256: Sha256;
};
export type Extraction = {
  id: Id;
  original: AttachmentRef;
  status: ExtractStatus;
  extractorVersion: string;
  configSha256: Sha256;
  manifestSha256: Sha256;
  units: CoverageUnit[];
  derivatives: Derivative[];
  problems: Problem[];
  verification: 'verified' | 'failed';
};
export type AttemptReadContext = {
  projectId: Id;
  ticketId: Id;
  attemptId: Id;
  fence: string;
  processInstanceId: Id;
  bindingRevision: number;
};
export type RequiredInput = { original: AttachmentRef; unitIds: string[] };
export type InputManifest = {
  version: 1;
  id: Id;
  artifactId: Id;
  selectionDecisionId: Id;
  ticketId: Id;
  inputRevision: string;
  snapshotId: Id;
  snapshotSha256: Sha256;
  originals: AttachmentRef[];
  extractions: Extraction[];
  required: RequiredInput[];
  comments: { id: Id; ticketId: Id; sha256: Sha256 }[];
  selectedDerivativeIds: Id[];
  missing: Problem[];
  sha256: Sha256;
};
export type InputReceipt = {
  manifestId: Id;
  manifestSha256: Sha256;
  context: AttemptReadContext;
  runtime: 'claude' | 'codex' | 'api';
  modelKey: string;
  consumed: { derivativeId: Id; sha256: Sha256; unitIds: string[]; modality: 'text' | 'vision' }[];
  status: 'consumed' | 'partial' | 'failed';
  reason: string | null;
};
export type BlobHandle = { key: string; sha256: Sha256; byteLength: number };
export type WorkerResult = {
  version: 1;
  jobId: Id;
  generation: string;
  original: AttachmentRef;
  extractorVersion: string;
  configSha256: Sha256;
  status: ExtractStatus;
  units: CoverageUnit[];
  files: {
    relativeName: string;
    kind: 'text' | 'image';
    mime: 'text/plain' | 'image/png';
    sha256: Sha256;
    byteLength: number;
    unitIds: string[];
  }[];
  problems: Problem[];
};
export interface BlobStore {
  publishDerivative(
    input: {
      attachmentId: Id;
      extractionId: Id;
      derivativeId: Id;
      generation: string;
      expectedBytes: number;
      expectedSha256: Sha256;
    },
    body: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<BlobHandle>;
  receive(
    input: { attachmentId: Id; generation: string; expectedBytes: number; expectedSha256: Sha256 },
    body: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<BlobHandle>;
  verify(blob: BlobHandle): Promise<'present' | 'missing' | 'corrupt'>;
  open(blob: BlobHandle): Promise<AsyncIterable<Uint8Array>>;
  removeOwned(input: { key: string; ownershipNonce: string }): Promise<'removed' | 'absent'>;
}
export type ServerWriterIdentity = {
  instanceId: Id;
  storageHostId: Id;
  linuxBootId: string;
  procNamespaceInode: string;
  pid: number;
  startTicks: string;
};
export type ReceiverRegistration = {
  id: Id;
  attachmentId: Id;
  generation: string;
  identity: ServerWriterIdentity;
  stageKey: string;
  operationNonce: Id;
  state: 'registered' | 'writing' | 'closing' | 'closed';
  abortRequested: boolean;
};
export type WriterStopProof = {
  receiverId: Id;
  generation: string;
  kind: 'closed-ack' | 'native-process-gone';
  identity: ServerWriterIdentity;
  proofSha256: Sha256;
  observedAt: string;
};
export interface ReceiverRegistry {
  register(tx: Tx, attachmentId: Id, generation: string): Promise<ReceiverRegistration>;
  requestAbort(tx: Tx, receiverId: Id): Promise<void>;
  closeAndAcknowledge(receiverId: Id): Promise<WriterStopProof>;
  proveStopped(receiverId: Id): Promise<WriterStopProof | null>;
}
export type StageServices = {
  createCompose(tx: Tx, input: ComposeTarget, actor: Actor): Promise<ComposeSession>;
  reserve(
    tx: Tx,
    input: UploadSpec,
    actor: Actor,
  ): Promise<{ attachment: Attachment; selectionRevision: number }>;
  receive(id: Id, actor: Actor, body: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<Attachment>;
  abandonUpload(
    tx: Tx,
    input: { composeSessionId: Id; attachmentId: Id; expectedRevision: number },
    actor: Actor,
  ): Promise<number>;
  abandonCompose(
    tx: Tx,
    input: { composeSessionId: Id; expectedRevision: number },
    actor: Actor,
  ): Promise<ComposeSession>;
  readCompose(db: Db, id: Id, actor: Actor): Promise<{ session: ComposeSession; attachments: Attachment[] }>;
};
export type StageFactoryInput = {
  db: Db;
  store: BlobStore;
  receivers: ReceiverRegistry;
  now: () => Date;
  config: AttachmentConfig;
};

export type InputTarget =
  | { kind: 'message'; messageId: Id }
  | { kind: 'ticket'; ticketId: Id; projectId: Id };
export type AssistantMessage = {
  id: Id;
  conversationId: Id;
  ownerId: 'owner';
  text: string;
  attachmentIds: Id[];
  inputRevision: string;
  routeRevision: number;
  createdAt: string;
};
export type MessageSubmission = {
  conversationId: Id;
  clientMessageId: Id;
  text: string;
  selection: Selection;
  assistantRead: 'selected-inputs' | 'none';
};
export type MessageRoute = {
  id: Id;
  messageId: Id;
  revision: number;
  projectId: Id;
  ticketId: Id;
  decisionId: Id;
  supersedesRouteId: Id | null;
  revokedAt: string | null;
};
export type RouteMessageInput = {
  messageId: Id;
  expectedInputRevision: string;
  expectedRouteRevision: number;
  decisionId: Id;
  ticket: CreateTicket;
};
export type InputRoutingAuthority = (tx: Tx, actor: Actor, input: RouteMessageInput) => Promise<void>;
export type RouteRetirementAuthority = (tx: Tx, route: MessageRoute, actor: Actor) => Promise<void>;

export type SnapshotAccess =
  | { kind: 'owner' }
  | { kind: 'bound-project'; projectId: Id; bindingRevision: number }
  | { kind: 'assistant-grant'; grantId: Id; designationRevision: number };
export type InputSnapshot = {
  version: 1;
  id: Id;
  target: InputTarget;
  inputRevision: string;
  routeRevision: number;
  originals: AttachmentRef[];
  extractions: Extraction[];
  required: RequiredInput[];
  comments: { id: Id; ticketId: Id; sha256: Sha256 }[];
  selectedDerivativeIds: Id[];
  requiredCapabilities: ('text' | 'vision')[];
  state: 'ready' | 'waiting';
  problems: Problem[];
  sha256: Sha256;
  createdAt: string;
};
export type DispatchInputPin = {
  snapshotId: Id;
  snapshotSha256: Sha256;
  inputRevision: string;
  selectionSha256: Sha256;
};
export type PreclaimSelectionAuthority = (
  tx: Tx,
  actor: Actor,
  input: { target: InputTarget; requestedUnitIds: string[] | null; scopeDecisionId: Id | null },
) => Promise<void>;

export type OwnerInputAuthorization = {
  id: Id;
  ownerId: 'owner';
  target: InputTarget;
  originals: AttachmentRef[];
  allowOriginal: boolean;
  expiresAt: string;
  revokedAt: string | null;
};

export type AssistantDesignation = { id: Id; ownerId: 'owner'; machineId: Id; revision: number };
export type AssistantReadGrant = {
  id: Id;
  authorizationId: Id;
  target: InputTarget;
  originals: AttachmentRef[];
  inputRevision: string;
  routeRevision: number;
  designationId: Id;
  designationRevision: number;
  machineId: Id;
  snapshotId: Id | null;
  snapshotSha256: Sha256 | null;
  derivativeIds: Id[];
  allowOriginal: boolean;
  expiresAt: string;
  revokedAt: string | null;
};
export type AssistantTurnAdmission = {
  id: Id;
  admittedAt: string;
  modelConfigRevision: number;
  sourceEnabledAtAdmission: true;
};
export type AssistantReadSession = {
  id: Id;
  grantId: Id;
  snapshotId: Id;
  snapshotSha256: Sha256;
  admission: AssistantTurnAdmission;
  designationRevision: number;
  machineId: Id;
  runtime: 'claude' | 'codex' | 'api';
  modelKey: string;
  modelSelectionId: Id;
  policyReceiptId: Id;
  processInstanceId: Id;
  state: 'reserved' | 'running' | 'stopped' | 'unknown';
  expiresAt: string;
};
export interface AssistantInputAuthority {
  designation(tx: Tx): Promise<AssistantDesignation | null>;
  authorizeIssue(
    tx: Tx,
    actor: Actor,
    input: { authorizationId: Id; target: InputTarget; inputRevision: string },
  ): Promise<void>;
  authorizeSession(
    tx: Tx,
    actor: Actor,
    input: { grantId: Id; snapshotId: Id; modelSelectionId: Id },
  ): Promise<{
    runtime: 'claude' | 'codex' | 'api';
    modelKey: string;
    policyReceiptId: Id;
    processInstanceId: Id;
    admission: AssistantTurnAdmission;
  }>;
  assertSessionCurrent(tx: Tx, session: AssistantReadSession): Promise<void>;
}

export type AssistantReadReceipt = {
  sessionId: Id;
  grantId: Id;
  snapshotId: Id;
  snapshotSha256: Sha256;
  runtime: 'claude' | 'codex' | 'api';
  modelKey: string;
  delivered: { derivativeId: Id; sha256: Sha256; unitIds: string[]; modality: 'text' | 'vision' }[];
  status: 'delivered' | 'partial' | 'failed';
  transportEvidenceSha256: Sha256;
};
export interface AssistantRepresentationTransport {
  deliver(
    session: AssistantReadSession,
    snapshot: InputSnapshot,
    parts: AsyncIterable<{
      original: AttachmentRef;
      derivative: Derivative;
      bytes: AsyncIterable<Uint8Array>;
    }>,
  ): Promise<AssistantReadReceipt>;
}
