import type {
  AssistantDesignation,
  AssistantRepresentationTransport,
  AssistantTurnAdmission,
  DispatchInputPin,
  InputSnapshot,
  MessageRoute,
  Sha256,
} from '../attachments/contracts.ts';
import type { Command, CreateCommand } from '../execution/contracts.ts';
import type { DispatchSelection, ProjectionPin, SourcePin } from '../gateway/contracts.ts';
import {
  digestSchema,
  objectSchema,
  projectionSchema,
  sourceSchema,
  uuidSchema,
} from '../gateway/contracts.ts';
import type { Capability, ModelDispatchChoice, ModelKey } from '../models/contracts.ts';
import { capabilities, modelKeySchema } from '../models/contracts.ts';
import type { Actor, DispatchPermit, Id, ServerOptions, Tx } from '../platform/contracts.ts';
import type { CreateTicket, DecisionInput, SourceRef, Ticket } from '../tickets/contracts.ts';

export type { Sha256 } from '../attachments/contracts.ts';

export type TurnFence = {
  turnId: Id;
  designationId: Id;
  designationRevision: number;
  generation: string;
  processInstanceId: Id;
};
export type AssistantConfig = {
  designation: AssistantDesignation | null;
  revision: number;
  preferred: ModelKey | null;
  policy: AssistantPolicy;
};
export type AssistantPolicy = {
  maxJobs: number;
  telemetryMaxAgeMs: number;
  maxLoadPerCpu: number;
  minMemoryBytes: string;
  minDiskBytes: string;
  maxTurnsPerRun: number;
  maxToolsPerTurn: number;
  maxCostUsdPerRun: number;
  maxTurnMs: number;
  maxRecoveryAttempts: number;
  parallelApprovalId: Id | null;
};
export type AssistantModelSelection = {
  id: Id;
  turnId: Id;
  key: ModelKey;
  modelConfigRevision: number;
  probeReceiptId: Id;
  policyReceiptId: Id;
  required: Capability[];
  rationale: string;
  createdAt: string;
};
export type RoutingPolicyReceipt = {
  id: Id;
  deploymentId: Id;
  challengeId: Id;
  verifierBuildSha256: Sha256;
  machineId: Id;
  key: ModelKey;
  osVersion: string;
  binarySha256: Sha256;
  policySha256: Sha256;
  probeContextSha256: Sha256;
  status: 'PASS' | 'FAIL' | 'UNVERIFIED';
  evidenceIds: Id[];
  expiresAt: string;
  revokedAt: string | null;
};
export type AssistantTurn = {
  fence: TurnFence;
  conversationId: Id;
  messageId: Id | null;
  selection: AssistantModelSelection;
  admission: AssistantTurnAdmission | null;
  readSessionId: Id | null;
  state: 'reserved' | 'running' | 'uncertain' | 'finalizing' | 'stopped';
  checkpointArtifactId: Id | null;
};
export type OrchestrationProof = { fence: TurnFence; scopeId: Id; operationId: Id };
export type OrchestrationAction = 'create_ticket' | 'decision' | 'dependency' | 'command' | 'signal';
export interface ProjectOrchestrationAuthority {
  verify(
    tx: Tx,
    actor: Actor,
    proof: OrchestrationProof,
    action: OrchestrationAction,
    targetSha256: Sha256,
  ): Promise<void>;
}
export interface ProjectOrchestrationPort {
  createTicket(tx: Tx, actor: Actor, proof: OrchestrationProof, input: CreateTicket): Promise<Ticket>;
  decision(tx: Tx, actor: Actor, proof: OrchestrationProof, ticketId: Id, input: DecisionInput): Promise<Id>;
  dependency(
    tx: Tx,
    actor: Actor,
    proof: OrchestrationProof,
    ticketId: Id,
    predecessorId: Id,
    expectedRevision: number,
  ): Promise<void>;
  command(tx: Tx, actor: Actor, proof: OrchestrationProof, input: CreateCommand): Promise<Command>;
  signal(
    tx: Tx,
    actor: Actor,
    proof: OrchestrationProof,
    ticketId: Id,
    signal: 'dependencies_ready' | 'wait_owner',
    expectedRevision: number,
  ): Promise<Ticket>;
}
export type DocRead = {
  projectId: Id;
  snapshotId: Id;
  path: string;
  sha256: Sha256;
  sourceCommit: string | null;
  receivedAt: string;
  auditState: 'unverified' | 'invalid' | 'verified';
  contentClass: 'implemented' | 'workflow_artifact';
  text: string;
  state: 'current' | 'stale' | 'unverified';
};
export type Assessment = {
  id: Id;
  ticketId: Id;
  candidateReadOperationId: Id;
  input: DispatchInputPin;
  complexity: 'bounded' | 'integration' | 'architectural';
  risk: string[];
  uncertainty: string[];
  required: Capability[];
  strengthRationale: string;
  sources: SourceRef[];
  candidateReasons: { key: ModelKey; reason: string }[];
};
export type SkillStep = {
  id: Id;
  ticketId: Id;
  skill: string;
  sourcePath: string;
  sourceSha256: Sha256;
  predecessorIds: Id[];
  acceptance: string[];
  outputKinds: string[];
  gateIds: Id[];
  ownershipKeys: string[];
  role: 'implement' | 'review' | 'fix' | 'research';
};
export type WorkflowRun = {
  id: Id;
  rootTicketId: Id;
  source: SourcePin;
  projection: ProjectionPin;
  definitionSha256: Sha256;
  customizationSha256: Sha256;
  renderedArtifactId: Id | null;
  path: 'architectural' | 'bounded' | 'bug' | 'spike' | 'bmad-dispatch' | 'bmad-oneshot';
  revision: number;
  steps: SkillStep[];
  parallelApprovalId: Id | null;
};
export type OwnerQuestion = {
  id: Id;
  conversationId: Id;
  ticketId: Id | null;
  runId: Id | null;
  stepId: Id | null;
  gateId: Id | null;
  cycleId: Id | null;
  artifactSha256: Sha256 | null;
  question: string;
  options: string[];
  scopeSha256: Sha256;
  revision: number;
  state: 'open' | 'answered' | 'superseded';
};
export type RoutingCandidate = {
  key: ModelKey;
  requiredSupported: Capability[];
  sourceDesired: boolean;
  sourceApplied: boolean;
  modelConfigRevision: number;
  probeReceiptId: Id;
  probeContextSha256: Sha256;
  binarySha256: Sha256;
  probeExpiresAt: string;
  available: boolean;
  reason: string | null;
};
export interface RoutingModelPort {
  candidates(tx: Tx, machineId: Id): Promise<RoutingCandidate[]>;
  assertCurrent(tx: Tx, selection: AssistantModelSelection, receipt: RoutingPolicyReceipt): Promise<void>;
}
export type CapacityRequest = {
  id: Id;
  machineId: Id;
  ticketId: Id;
  kind: 'implement' | 'review' | 'fix';
  ownershipKeys: string[];
  bootGeneration: string;
  requestedAt: string;
  expiresAt: string;
};
export type AssistantTelemetry = {
  sampleId: Id;
  bootGeneration: string;
  sampleAgeMs: number;
  cpuLoad1: number;
  cpuCount: number;
  memoryAvailableBytes: string;
  memoryPressure: 'normal' | 'warn' | 'critical';
  diskAvailableBytes: string;
  activeJobs: number;
  configuredMaxJobs: number;
};
export type CapacityReceipt = {
  id: Id;
  requestId: Id;
  machineId: Id;
  bootGeneration: string;
  ticketId: Id;
  kind: 'implement' | 'review' | 'fix';
  ownershipKeys: string[];
  telemetry: AssistantTelemetry;
  receivedAt: string;
  expiresAt: string;
  allowed: boolean;
  reason: string;
};
export type PreparedDispatch = {
  command: Command;
  permit: DispatchPermit;
  selection: DispatchSelection;
  modelChoice: ModelDispatchChoice;
  inputSnapshot: DispatchInputPin;
};
export interface FinalEvidencePort {
  verify(tx: Tx, input: Parameters<ServerOptions['verifyFinalResult']>[1]): Promise<void>;
  requestDocsSync(
    tx: Tx,
    input: { ticketId: Id; mergedCommit: string; operationId: Id },
  ): Promise<{ commandId: Id }>;
}
export interface AssistantDriver {
  start(
    turn: AssistantTurn,
    policy: RoutingPolicyReceipt,
    input: { snapshot: InputSnapshot; docs: DocRead[]; executionContext: ExecutionCandidateScope | null },
  ): AsyncIterable<RoutingEvent>;
  resolve(turn: AssistantTurn, providerCallId: string, result: RoutingToolResult): Promise<void>;
  deliver: AssistantRepresentationTransport['deliver'];
  checkpoint(turn: AssistantTurn): Promise<{ artifactId: Id; sha256: Sha256 }>;
  stop(turn: AssistantTurn): Promise<{ state: 'stopped' | 'unknown'; stopEvidenceId: Id | null }>;
}

export type RoutingCertificationContext = {
  deploymentId: Id;
  machineId: Id;
  key: ModelKey;
  binarySha256: Sha256;
  policySha256: Sha256;
  observerSha256: Sha256;
  osVersion: string;
};
export type RoutingCertificationChallenge = {
  id: Id;
  context: RoutingCertificationContext;
  nonce: string;
  expiresAt: string;
  maxTurns: number;
  maxTools: number;
  maxCostUsd: number;
  maxMs: number;
  fixtureSha256: Sha256;
};
export type RoutingCertificationLaunch = {
  challengeId: Id;
  turnId: Id;
  generation: string;
  processInstanceId: Id;
  context: RoutingCertificationContext;
};
export type RoutingCertificationEvidence = {
  launch: RoutingCertificationLaunch;
  traceArtifactIds: Id[];
  stopEvidenceId: Id;
  surfaces: {
    name: 'docs' | 'input' | 'tool' | 'native-read' | 'child' | 'absolute-path' | 'symlink' | 'network';
    allowedTrace: Sha256;
    deniedTrace: Sha256;
  }[];
  usage: { turns: number; tools: number; costUsd: number; elapsedMs: number };
};
export interface CertificationSupervisor {
  launch(
    launch: RoutingCertificationLaunch,
    challenge: RoutingCertificationChallenge,
  ): AsyncIterable<RoutingEvent>;
  stop(
    launch: RoutingCertificationLaunch,
  ): Promise<{ state: 'stopped' | 'unknown'; stopEvidenceId: Id | null }>;
}
export interface RoutingCertificationAuthority {
  issue(
    tx: Tx,
    actor: Actor,
    input: {
      context: RoutingCertificationContext;
      maxTurns: number;
      maxTools: number;
      maxCostUsd: number;
      maxMs: number;
    },
  ): Promise<RoutingCertificationChallenge>;
  admit(
    tx: Tx,
    actor: Actor,
    input: { challengeId: Id; nonce: string; processInstanceId: Id },
  ): Promise<RoutingCertificationLaunch>;
  verify(tx: Tx, actor: Actor, evidence: RoutingCertificationEvidence): Promise<RoutingPolicyReceipt>;
}

export type ExecutionCandidateScope = {
  ticketId: Id;
  projectId: Id;
  machineId: Id;
  bindingRevision: number;
  runId: Id;
  runRevision: number;
  definitionSha256: Sha256;
  input: DispatchInputPin;
  source: Pick<
    SourcePin,
    'name' | 'version' | 'sourceRevision' | 'sourceManifestSha256' | 'sourceTreeSha256'
  >;
};
export type ExecutionCandidate = {
  key: ModelKey;
  declared: Capability[];
  capabilities: Capability[];
  available: boolean;
  reason: string | null;
  sourceDesired: boolean;
  sourceApplied: boolean;
  probe: {
    receiptId: Id | null;
    contextSha256: Sha256 | null;
    status: 'pass' | 'fail' | 'unverified';
    receivedAt: string | null;
    expiresAt: string | null;
  };
  projection:
    | (Pick<ProjectionPin, 'runtime' | 'sourceTreeSha256' | 'manifestSha256' | 'treeSha256'> & {
        derivationSha256: Sha256;
      })
    | null;
  installReportId: Id | null;
  certificationReceiptId: Id | null;
};
export type ExecutionCandidateSnapshot = {
  scope: ExecutionCandidateScope;
  observedAt: string;
  sha256: Sha256;
  modelConfigRevision: number;
  modelAppliedRevision: number | null;
  gatewayConfigRevision: number;
  gatewayAppliedRevision: number | null;
  inventoryReportId: Id | null;
  bootGeneration: string;
  entries: ExecutionCandidate[];
};
export interface ExecutionCandidateReader {
  read(
    actor: Actor,
    request: RoutingToolRequest & {
      call: { name: 'read_execution_candidates'; input: { ticketId: Id; runId: Id } };
    },
  ): Promise<RoutingToolResult>;
}
export type AssessmentProposal = Omit<Assessment, 'id'> & { chosen: ModelKey; choiceRationale: string };
export type QuestionProposal = Omit<OwnerQuestion, 'id' | 'revision' | 'state'>;
export type RoutingTool =
  | { name: 'read_catalog'; input: Record<string, never> }
  | { name: 'read_docs'; input: { projectId: Id; snapshotId: Id; path: string } }
  | {
      name: 'route_message';
      input: {
        messageId: Id;
        expectedInputRevision: string;
        expectedRouteRevision: number;
        ticket: CreateTicket;
        confidence: number;
        rationale: string;
        docReadIds: Id[];
      };
    }
  | { name: 'read_execution_candidates'; input: { ticketId: Id; runId: Id } }
  | { name: 'assess_ticket'; input: AssessmentProposal }
  | { name: 'ask_owner'; input: QuestionProposal }
  | { name: 'create_run'; input: { rootTicketId: Id; path: WorkflowRun['path']; definitionSha256: Sha256 } }
  | {
      name: 'request_dispatch';
      input: { stepId: Id; assessmentId: Id; chosen: ModelKey; priorAttemptId: Id | null };
    }
  | { name: 'request_review'; input: { runId: Id; implementationStepId: Id; implementationAttemptId: Id } }
  | {
      name: 'publish_reply';
      input: {
        messageId: Id;
        inputRevision: string;
        snapshotId: Id;
        receiptIds: Id[];
        text: string;
        sources: SourceRef[];
      };
    };
export type RoutingEvent =
  | { kind: 'tool'; providerCallId: string; sequence: string; call: RoutingTool }
  | { kind: 'finished'; outcome: 'completed' | 'failed' | 'interrupted' };
export type RoutingToolValue =
  | {
      kind: 'catalog';
      items: {
        projectId: Id;
        key: string;
        name: string;
        latestSnapshotId: Id | null;
        sourceCommit: string | null;
      }[];
    }
  | { kind: 'execution_candidates'; snapshot: ExecutionCandidateSnapshot }
  | { kind: 'docs'; page: DocRead; readReceiptId: Id }
  | { kind: 'route'; route: MessageRoute }
  | { kind: 'assessment'; assessment: Assessment }
  | { kind: 'question'; question: OwnerQuestion }
  | { kind: 'run'; run: WorkflowRun }
  | { kind: 'review'; step: SkillStep }
  | { kind: 'capacity'; request: CapacityRequest }
  | { kind: 'dispatch'; dispatch: PreparedDispatch }
  | { kind: 'reply'; decisionId: Id };
export type RoutingToolResult = {
  operationId: Id;
  state: 'completed' | 'pending' | 'rejected';
  result: RoutingToolValue | null;
  errorCode: string | null;
};
export type RoutingToolRequest = {
  fence: TurnFence;
  operationId: Id;
  clientSequence: string;
  inputSnapshot: DispatchInputPin;
  call: RoutingTool;
};
export type RoutingToolConsumer = (
  tx: Tx,
  actor: Actor,
  request: RoutingToolRequest,
) => Promise<RoutingToolResult>;
export interface AssistantWorkService {
  bootstrap(
    tx: Tx,
    actor: Actor,
    input: { workId: Id; processInstanceId: Id },
  ): Promise<{
    turn: AssistantTurn;
    snapshot: InputSnapshot;
    grantId: Id;
    scopeId: Id | null;
    executionContext: ExecutionCandidateScope | null;
  }>;
}

export type LaunchAuthorization = {
  id: Id;
  commandId: Id;
  processInstanceId: Id;
  bootGeneration: string;
  generation: string;
  expiresAt: string;
};
export type UnclaimedStopProof =
  | { kind: 'never-authorized'; commandId: Id; retirementId: Id }
  | {
      kind: 'journal-no-launch' | 'process-stopped';
      commandId: Id;
      launchAuthorizationId: Id;
      processInstanceId: Id;
      bootGeneration: string;
      generation: string;
      journalSha256: Sha256;
      stopEvidenceId: Id;
    };

const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
const positive = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const nonnegative = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
// Canonical decimal, bounded to PostgreSQL signed bigint without JS rounding.
const maxCounter = '9223372036854775807';
const counterAlternatives = ['[1-9][0-9]{0,17}', maxCounter];
for (let index = 0; index < maxCounter.length; index++) {
  const digit = Number(maxCounter[index]);
  const minimum = index === 0 ? 1 : 0;
  if (digit > minimum)
    counterAlternatives.push(
      `${maxCounter.slice(0, index)}[${minimum}-${digit - 1}][0-9]{${maxCounter.length - index - 1}}`,
    );
}
const counter = { type: 'string', pattern: `^(${counterAlternatives.join('|')})$` };
const bytes = { type: 'string', pattern: `^(0|${counterAlternatives.join('|')})$` };
const timestamp = { type: 'string', format: 'date-time', maxLength: 40 };
const short = { type: 'string', minLength: 1, maxLength: 200 };
const ids = { type: 'array', items: uuidSchema, uniqueItems: true, maxItems: 1000 };
const requiredCapabilities = {
  type: 'array',
  uniqueItems: true,
  maxItems: capabilities.length,
  items: { enum: capabilities },
};
export const turnFenceSchema = objectSchema({
  turnId: uuidSchema,
  designationId: uuidSchema,
  designationRevision: positive,
  generation: counter,
  processInstanceId: uuidSchema,
});
export const assistantPolicySchema = objectSchema({
  maxJobs: positive,
  telemetryMaxAgeMs: { ...positive, maximum: 15000 },
  maxLoadPerCpu: { type: 'number', exclusiveMinimum: 0 },
  minMemoryBytes: bytes,
  minDiskBytes: bytes,
  maxTurnsPerRun: positive,
  maxToolsPerTurn: positive,
  maxCostUsdPerRun: { type: 'number', minimum: 0 },
  maxTurnMs: positive,
  maxRecoveryAttempts: nonnegative,
  parallelApprovalId: nullable(uuidSchema),
});
export const assistantConfigSchema = objectSchema({
  designation: nullable(
    objectSchema({ id: uuidSchema, ownerId: { const: 'owner' }, machineId: uuidSchema, revision: positive }),
  ),
  revision: positive,
  preferred: nullable(modelKeySchema),
  policy: assistantPolicySchema,
});
export const assistantModelSelectionSchema = objectSchema({
  id: uuidSchema,
  turnId: uuidSchema,
  key: modelKeySchema,
  modelConfigRevision: positive,
  probeReceiptId: uuidSchema,
  policyReceiptId: uuidSchema,
  required: requiredCapabilities,
  rationale: { type: 'string', maxLength: 32768 },
  createdAt: timestamp,
});
export const routingCertificationContextSchema = objectSchema({
  deploymentId: uuidSchema,
  machineId: uuidSchema,
  key: modelKeySchema,
  binarySha256: digestSchema,
  policySha256: digestSchema,
  observerSha256: digestSchema,
  osVersion: short,
});
export const routingPolicyReceiptSchema = objectSchema({
  id: uuidSchema,
  deploymentId: uuidSchema,
  challengeId: uuidSchema,
  verifierBuildSha256: digestSchema,
  machineId: uuidSchema,
  key: modelKeySchema,
  osVersion: short,
  binarySha256: digestSchema,
  policySha256: digestSchema,
  probeContextSha256: digestSchema,
  status: { enum: ['PASS', 'FAIL', 'UNVERIFIED'] },
  evidenceIds: ids,
  expiresAt: timestamp,
  revokedAt: nullable(timestamp),
});
export const dispatchInputPinSchema = objectSchema({
  snapshotId: uuidSchema,
  snapshotSha256: digestSchema,
  inputRevision: counter,
  selectionSha256: digestSchema,
});
export const assistantTelemetrySchema = objectSchema({
  sampleId: uuidSchema,
  bootGeneration: counter,
  sampleAgeMs: { ...nonnegative, maximum: 15000 },
  cpuLoad1: { type: 'number', minimum: 0 },
  cpuCount: positive,
  memoryAvailableBytes: bytes,
  memoryPressure: { enum: ['normal', 'warn', 'critical'] },
  diskAvailableBytes: bytes,
  activeJobs: nonnegative,
  configuredMaxJobs: positive,
});
export const capacityRequestSchema = objectSchema({
  id: uuidSchema,
  machineId: uuidSchema,
  ticketId: uuidSchema,
  kind: { enum: ['implement', 'review', 'fix'] },
  ownershipKeys: { type: 'array', items: short, uniqueItems: true, maxItems: 1000 },
  bootGeneration: counter,
  requestedAt: timestamp,
  expiresAt: timestamp,
});
export const launchAuthorizationSchema = objectSchema({
  id: uuidSchema,
  commandId: uuidSchema,
  processInstanceId: uuidSchema,
  bootGeneration: counter,
  generation: counter,
  expiresAt: timestamp,
});

// Transport shapes only. Record-valued fields below reflect the actual accepted
// CreateTicket/Command DTOs; their services still enforce business authority and
// safeTicketJson depth. All other objects reject undeclared fields recursively.
const bool = { type: 'boolean' };
const prose = { type: 'string', maxLength: 32768 };
const pathSchema = { type: 'string', minLength: 1, maxLength: 4096 };
const list = (items: unknown, maxItems = 1000) => ({ type: 'array', items, maxItems });
const textList = list(prose);
const jsonKey = { not: { enum: ['__proto__', 'prototype', 'constructor'] } };
const jsonDefinitions = {
  jsonValue: {
    anyOf: [
      { type: 'null' },
      { type: 'boolean' },
      { type: 'number' },
      { type: 'string' },
      { type: 'array', items: { $ref: '#/definitions/jsonValue' } },
      { type: 'object', propertyNames: jsonKey, additionalProperties: { $ref: '#/definitions/jsonValue' } },
    ],
  },
};
const dto = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  ...objectSchema(properties, required),
  definitions: jsonDefinitions,
});
const union = (variants: unknown[]) => ({ oneOf: variants, definitions: jsonDefinitions });
const jsonRecord = {
  type: 'object',
  propertyNames: jsonKey,
  additionalProperties: { $ref: '#/definitions/jsonValue' },
};
const workflowPath = { enum: ['architectural', 'bounded', 'bug', 'spike', 'bmad-dispatch', 'bmad-oneshot'] };
const executionKind = { enum: ['implement', 'review', 'fix'] };
const runtimeSchema = { enum: ['claude', 'codex', 'api'] };
const workflowPinSchema = dto({
  workflow: { enum: ['superpowers', 'bmad'] },
  version: { type: 'string', minLength: 1 },
  revision: { type: 'string', minLength: 1 },
  checksum: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
});
const createTicketProperties = {
  projectId: uuidSchema,
  parentId: nullable(uuidSchema),
  level: { enum: ['request', 'step', 'task'] },
  kind: { enum: ['code', 'research', 'docs', 'deploy'] },
  title: short,
  description: { type: 'string', maxLength: 65536 },
  mandatory: bool,
  criteria: jsonRecord,
  inputs: jsonRecord,
  outputs: jsonRecord,
  skill: nullable(short),
  workflowPin: nullable(workflowPinSchema),
  deployApprovalDecisionId: nullable(uuidSchema),
};
// workflowPin is required by the serialized DTO. The existing ticket HTTP route
// may omit it and its producer normalizes that input before returning CreateTicket.
const createTicketSchema = dto(
  createTicketProperties,
  Object.keys(createTicketProperties).filter((key) => key !== 'deployApprovalDecisionId'),
);
const sourceRefSchema = dto(
  {
    kind: { enum: ['docs', 'ticket', 'artifact', 'owner_decision'] },
    id: uuidSchema,
    path: pathSchema,
    locator: { type: 'string', minLength: 1, maxLength: 2048 },
  },
  ['kind', 'id'],
);
const sourcesSchema = list(sourceRefSchema, 100);
export const orchestrationActionSchema = {
  enum: ['create_ticket', 'decision', 'dependency', 'command', 'signal'],
};
export const orchestrationProofSchema = dto({
  fence: turnFenceSchema,
  scopeId: uuidSchema,
  operationId: uuidSchema,
});
export const assistantTurnSchema = dto({
  fence: turnFenceSchema,
  conversationId: uuidSchema,
  messageId: nullable(uuidSchema),
  selection: assistantModelSelectionSchema,
  admission: nullable(
    dto({
      id: uuidSchema,
      admittedAt: timestamp,
      modelConfigRevision: positive,
      sourceEnabledAtAdmission: { const: true },
    }),
  ),
  readSessionId: nullable(uuidSchema),
  state: { enum: ['reserved', 'running', 'uncertain', 'finalizing', 'stopped'] },
  checkpointArtifactId: nullable(uuidSchema),
});
export const docReadSchema = dto({
  projectId: uuidSchema,
  snapshotId: uuidSchema,
  path: pathSchema,
  sha256: digestSchema,
  sourceCommit: nullable({ type: 'string' }),
  receivedAt: timestamp,
  auditState: { enum: ['unverified', 'invalid', 'verified'] },
  contentClass: { enum: ['implemented', 'workflow_artifact'] },
  text: { type: 'string' },
  state: { enum: ['current', 'stale', 'unverified'] },
});
const assessmentFields = {
  ticketId: uuidSchema,
  candidateReadOperationId: uuidSchema,
  input: dispatchInputPinSchema,
  complexity: { enum: ['bounded', 'integration', 'architectural'] },
  risk: textList,
  uncertainty: textList,
  required: requiredCapabilities,
  strengthRationale: prose,
  sources: sourcesSchema,
  candidateReasons: list(dto({ key: modelKeySchema, reason: prose })),
};
export const assessmentSchema = dto({ id: uuidSchema, ...assessmentFields });
export const assessmentProposalSchema = dto({
  ...assessmentFields,
  chosen: modelKeySchema,
  choiceRationale: prose,
});
export const skillStepSchema = dto({
  id: uuidSchema,
  ticketId: uuidSchema,
  skill: short,
  sourcePath: pathSchema,
  sourceSha256: digestSchema,
  predecessorIds: ids,
  acceptance: textList,
  outputKinds: list(short),
  gateIds: ids,
  ownershipKeys: list(pathSchema),
  role: { enum: ['implement', 'review', 'fix', 'research'] },
});
export const workflowRunSchema = dto({
  id: uuidSchema,
  rootTicketId: uuidSchema,
  source: sourceSchema,
  projection: projectionSchema,
  definitionSha256: digestSchema,
  customizationSha256: digestSchema,
  renderedArtifactId: nullable(uuidSchema),
  path: workflowPath,
  revision: positive,
  steps: list(skillStepSchema),
  parallelApprovalId: nullable(uuidSchema),
});
const questionFields = {
  conversationId: uuidSchema,
  ticketId: nullable(uuidSchema),
  runId: nullable(uuidSchema),
  stepId: nullable(uuidSchema),
  gateId: nullable(uuidSchema),
  cycleId: nullable(uuidSchema),
  artifactSha256: nullable(digestSchema),
  question: prose,
  options: textList,
  scopeSha256: digestSchema,
};
export const questionProposalSchema = dto(questionFields);
export const ownerQuestionSchema = dto({
  id: uuidSchema,
  ...questionFields,
  revision: positive,
  state: { enum: ['open', 'answered', 'superseded'] },
});
export const routingCandidateSchema = dto({
  key: modelKeySchema,
  requiredSupported: requiredCapabilities,
  sourceDesired: bool,
  sourceApplied: bool,
  modelConfigRevision: positive,
  probeReceiptId: uuidSchema,
  probeContextSha256: digestSchema,
  binarySha256: digestSchema,
  probeExpiresAt: timestamp,
  available: bool,
  reason: nullable(prose),
});
export const capacityReceiptSchema = dto({
  id: uuidSchema,
  requestId: uuidSchema,
  machineId: uuidSchema,
  bootGeneration: counter,
  ticketId: uuidSchema,
  kind: executionKind,
  ownershipKeys: list(short),
  telemetry: assistantTelemetrySchema,
  receivedAt: timestamp,
  expiresAt: timestamp,
  allowed: bool,
  reason: prose,
});
const commandSchema = dto({
  id: uuidSchema,
  machineId: uuidSchema,
  ticketId: uuidSchema,
  type: { enum: ['start', 'pause', 'cancel', 'resume', 'reconcile'] },
  payload: jsonRecord,
  state: { enum: ['queued', 'received', 'completed'] },
  result: nullable(jsonRecord),
  createdAt: timestamp,
});
const dispatchPermitSchema = dto({
  commandId: uuidSchema,
  ticketId: uuidSchema,
  machineId: uuidSchema,
  bindingRevision: positive,
  ticketRevision: positive,
  workflow: workflowPinSchema,
  checkedAt: timestamp,
  expiresAt: timestamp,
  telemetryId: uuidSchema,
  decisionId: uuidSchema,
});
const dispatchSelectionSchema = dto({
  runtime: runtimeSchema,
  sourceTreeSha256: digestSchema,
  projectionManifestSha256: digestSchema,
  projectionTreeSha256: digestSchema,
  installReportId: uuidSchema,
  configRevision: positive,
  decisionId: uuidSchema,
});
const modelChoiceSchema = dto({
  model: modelKeySchema,
  modelConfigRevision: positive,
  probeReceiptId: uuidSchema,
  probeContextSha256: digestSchema,
  certificationReceiptId: nullable(uuidSchema),
  required: requiredCapabilities,
});
export const preparedDispatchSchema = dto({
  command: commandSchema,
  permit: dispatchPermitSchema,
  selection: dispatchSelectionSchema,
  modelChoice: modelChoiceSchema,
  inputSnapshot: dispatchInputPinSchema,
});
export const routingCertificationChallengeSchema = dto({
  id: uuidSchema,
  context: routingCertificationContextSchema,
  nonce: { type: 'string', minLength: 1, maxLength: 4096 },
  expiresAt: timestamp,
  maxTurns: positive,
  maxTools: positive,
  maxCostUsd: { type: 'number', minimum: 0 },
  maxMs: positive,
  fixtureSha256: digestSchema,
});
export const routingCertificationLaunchSchema = dto({
  challengeId: uuidSchema,
  turnId: uuidSchema,
  generation: counter,
  processInstanceId: uuidSchema,
  context: routingCertificationContextSchema,
});
export const routingCertificationEvidenceSchema = dto({
  launch: routingCertificationLaunchSchema,
  traceArtifactIds: ids,
  stopEvidenceId: uuidSchema,
  surfaces: list(
    dto({
      name: {
        enum: ['docs', 'input', 'tool', 'native-read', 'child', 'absolute-path', 'symlink', 'network'],
      },
      allowedTrace: digestSchema,
      deniedTrace: digestSchema,
    }),
    8,
  ),
  usage: dto({
    turns: nonnegative,
    tools: nonnegative,
    costUsd: { type: 'number', minimum: 0 },
    elapsedMs: nonnegative,
  }),
});
const candidateSourceSchema = dto({
  name: { enum: ['superpowers', 'bmad'] },
  version: sourceSchema.properties.version,
  sourceRevision: sourceSchema.properties.sourceRevision,
  sourceManifestSha256: digestSchema,
  sourceTreeSha256: digestSchema,
});
export const executionCandidateScopeSchema = dto({
  ticketId: uuidSchema,
  projectId: uuidSchema,
  machineId: uuidSchema,
  bindingRevision: positive,
  runId: uuidSchema,
  runRevision: positive,
  definitionSha256: digestSchema,
  input: dispatchInputPinSchema,
  source: candidateSourceSchema,
});
export const executionCandidateSchema = dto({
  key: modelKeySchema,
  declared: requiredCapabilities,
  capabilities: requiredCapabilities,
  available: bool,
  reason: nullable(prose),
  sourceDesired: bool,
  sourceApplied: bool,
  probe: dto({
    receiptId: nullable(uuidSchema),
    contextSha256: nullable(digestSchema),
    status: { enum: ['pass', 'fail', 'unverified'] },
    receivedAt: nullable(timestamp),
    expiresAt: nullable(timestamp),
  }),
  projection: nullable(
    dto({
      runtime: runtimeSchema,
      sourceTreeSha256: digestSchema,
      manifestSha256: digestSchema,
      treeSha256: digestSchema,
      derivationSha256: digestSchema,
    }),
  ),
  installReportId: nullable(uuidSchema),
  certificationReceiptId: nullable(uuidSchema),
});
export const executionCandidateSnapshotSchema = dto({
  scope: executionCandidateScopeSchema,
  observedAt: timestamp,
  sha256: digestSchema,
  modelConfigRevision: positive,
  modelAppliedRevision: nullable(positive),
  gatewayConfigRevision: positive,
  gatewayAppliedRevision: nullable(positive),
  inventoryReportId: nullable(uuidSchema),
  bootGeneration: counter,
  entries: list(executionCandidateSchema),
});
const toolVariant = (name: string, input: unknown) => dto({ name: { const: name }, input });
export const routingToolSchema = union([
  toolVariant('read_catalog', dto({})),
  toolVariant('read_docs', dto({ projectId: uuidSchema, snapshotId: uuidSchema, path: pathSchema })),
  toolVariant(
    'route_message',
    dto({
      messageId: uuidSchema,
      expectedInputRevision: counter,
      expectedRouteRevision: nonnegative,
      ticket: createTicketSchema,
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale: prose,
      docReadIds: ids,
    }),
  ),
  toolVariant('read_execution_candidates', dto({ ticketId: uuidSchema, runId: uuidSchema })),
  toolVariant('assess_ticket', assessmentProposalSchema),
  toolVariant('ask_owner', questionProposalSchema),
  toolVariant(
    'create_run',
    dto({ rootTicketId: uuidSchema, path: workflowPath, definitionSha256: digestSchema }),
  ),
  toolVariant(
    'request_dispatch',
    dto({
      stepId: uuidSchema,
      assessmentId: uuidSchema,
      chosen: modelKeySchema,
      priorAttemptId: nullable(uuidSchema),
    }),
  ),
  toolVariant(
    'request_review',
    dto({ runId: uuidSchema, implementationStepId: uuidSchema, implementationAttemptId: uuidSchema }),
  ),
  toolVariant(
    'publish_reply',
    dto({
      messageId: uuidSchema,
      inputRevision: counter,
      snapshotId: uuidSchema,
      receiptIds: ids,
      text: prose,
      sources: sourcesSchema,
    }),
  ),
]);
export const routingEventSchema = union([
  dto({
    kind: { const: 'tool' },
    providerCallId: { type: 'string', minLength: 1, maxLength: 4096 },
    sequence: counter,
    call: routingToolSchema,
  }),
  dto({ kind: { const: 'finished' }, outcome: { enum: ['completed', 'failed', 'interrupted'] } }),
]);
const messageRouteSchema = dto({
  id: uuidSchema,
  messageId: uuidSchema,
  revision: positive,
  projectId: uuidSchema,
  ticketId: uuidSchema,
  decisionId: uuidSchema,
  supersedesRouteId: nullable(uuidSchema),
  revokedAt: nullable(timestamp),
});
const valueVariant = (kind: string, fields: Record<string, unknown>) =>
  dto({ kind: { const: kind }, ...fields });
export const routingToolValueSchema = union([
  valueVariant('catalog', {
    items: list(
      dto({
        projectId: uuidSchema,
        key: short,
        name: short,
        latestSnapshotId: nullable(uuidSchema),
        sourceCommit: nullable({ type: 'string' }),
      }),
    ),
  }),
  valueVariant('execution_candidates', { snapshot: executionCandidateSnapshotSchema }),
  valueVariant('docs', { page: docReadSchema, readReceiptId: uuidSchema }),
  valueVariant('route', { route: messageRouteSchema }),
  valueVariant('assessment', { assessment: assessmentSchema }),
  valueVariant('question', { question: ownerQuestionSchema }),
  valueVariant('run', { run: workflowRunSchema }),
  valueVariant('review', { step: skillStepSchema }),
  valueVariant('capacity', { request: capacityRequestSchema }),
  valueVariant('dispatch', { dispatch: preparedDispatchSchema }),
  valueVariant('reply', { decisionId: uuidSchema }),
]);
export const routingToolResultSchema = dto({
  operationId: uuidSchema,
  state: { enum: ['completed', 'pending', 'rejected'] },
  result: nullable(routingToolValueSchema),
  errorCode: nullable(short),
});
export const routingToolRequestSchema = dto({
  fence: turnFenceSchema,
  operationId: uuidSchema,
  clientSequence: counter,
  inputSnapshot: dispatchInputPinSchema,
  call: routingToolSchema,
});
export const unclaimedStopProofSchema = union([
  dto({ kind: { const: 'never-authorized' }, commandId: uuidSchema, retirementId: uuidSchema }),
  dto({
    kind: { enum: ['journal-no-launch', 'process-stopped'] },
    commandId: uuidSchema,
    launchAuthorizationId: uuidSchema,
    processInstanceId: uuidSchema,
    bootGeneration: counter,
    generation: counter,
    journalSha256: digestSchema,
    stopEvidenceId: uuidSchema,
  }),
]);
