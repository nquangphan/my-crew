import type { Selection } from '../commands/contracts.ts';
import type { ProjectionPin, Runtime, SourcePin } from '../host/status.ts';
import type { AttemptProjectionPin } from '../journal/process-journal.ts';
import type { Capability, ModelKey, ProbeResult } from '../models/contracts.ts';
export type EffectId = string;
export type ModelDispatchChoice = {
  model: ModelKey;
  modelConfigRevision: number;
  probeReceiptId: string;
  probeContextSha256: string;
  certificationReceiptId: string | null;
  required: Capability[];
};
export type RuntimeAdmission =
  | { kind: 'certified'; receiptId: string }
  | { kind: 'test-certification'; challengeId: string; nonce: string };
export type RuntimePin = {
  runId: string;
  attemptId: string;
  commandId: string;
  processInstanceId: string;
  fence: string;
  source: SourcePin;
  projection: ProjectionPin;
  attemptProjection: AttemptProjectionPin;
  selection: Selection;
  modelChoice: ModelDispatchChoice;
  admission: RuntimeAdmission;
  isolationPolicyHash: string;
  workspaceCommit: string;
  credentialRef: string | null;
};
export type RuntimeCheckpoint = {
  sequence: string;
  step: string;
  artifactIds: string[];
  commit: string | null;
  processInstanceId: string;
  sourceTreeSha256: string;
  projectionTreeSha256: string;
  toolReceiptIds: string[];
  logicalEffectIds: EffectId[];
  attachmentIds: string[];
  runtimeSession: { runtime: Runtime; id: string } | null;
};
export type RuntimeInput = { skillName: string; skillPath: string; checkpoint: RuntimeCheckpoint | null };
export type LogicalEffect = {
  effectId: EffectId;
  runId: string;
  stepId: string;
  stepOperationId: string;
  actionKind: string;
  targetIdentity: string;
  preconditionSha256: string;
  state: 'pending' | 'done' | 'uncertain';
  receiptSha256: string | null;
  artifactIds: string[];
};
export type ToolInvocation = {
  attemptId: string;
  fence: string;
  toolCallId: string;
  argsSha256: string;
  effectId: EffectId;
  stepOperationId: string;
};
export type EffectReceipt = { sha256: string; artifactIds: string[] };
export interface EffectLedger {
  reserve(
    effect: LogicalEffect,
    call: ToolInvocation,
  ): Promise<'execute' | 'return-receipt' | 'reconcile' | 'wait'>;
  complete(effectId: EffectId, call: ToolInvocation, receipt: EffectReceipt): Promise<void>;
  reconcile(effectId: EffectId): Promise<'done' | 'pending' | 'uncertain'>;
}
export interface RuntimeAdapter {
  readonly runtime: Runtime;
  inventory(source: SourcePin, projection: ProjectionPin): Promise<ProbeResult[]>;
  prepareIsolation(
    pin: RuntimePin,
  ): Promise<{ policyHash: string; evidenceDigest: string; certified: boolean }>;
  start(pin: RuntimePin, input: RuntimeInput): Promise<{ sessionId: string; processIdentity: string }>;
  sendInput(pin: RuntimePin, input: { text: string; attachmentIds: string[] }): Promise<void>;
  checkpoint(pin: RuntimePin): Promise<RuntimeCheckpoint>;
  cancel(
    pin: RuntimePin,
    reason: 'pause' | 'cancel' | 'timeout',
  ): Promise<{ requested: boolean; stopped: boolean }>;
  reconcile(
    pin: RuntimePin,
  ): Promise<{ observation: 'running' | 'stopped' | 'unknown'; checkpoint: RuntimeCheckpoint | null }>;
}
