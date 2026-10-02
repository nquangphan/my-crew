import type { Pin } from '../../../src/workflow-policy.ts';
import type { Id } from '../platform/contracts.ts';

export type CommandType = 'start' | 'pause' | 'cancel' | 'resume' | 'reconcile';
export type Command = {
  id: Id;
  machineId: Id;
  ticketId: Id;
  type: CommandType;
  payload: Record<string, unknown>;
  state: 'queued' | 'received' | 'completed';
  result: Record<string, unknown> | null;
  createdAt: string;
};
export type CreateCommand = Pick<Command, 'machineId' | 'ticketId' | 'type' | 'payload'>;
export type Checkpoint = {
  sequence: string;
  step: string;
  artifactIds: Id[];
  commit: string | null;
  processInstanceId: string;
};
export type TerminalIntent = 'complete' | 'retry' | 'pause' | 'cancel' | 'needs_input';
export type AttemptResultInput = {
  fence: string;
  processInstanceId: string;
  outcome: 'passed' | 'retry' | 'needs_input';
  evidenceIds: Id[];
  reason: string | null;
};
export type Attempt = {
  id: Id;
  ticketId: Id;
  machineId: Id;
  commandId: Id;
  fence: string;
  bindingRevision: number;
  processInstanceId: string;
  state: 'active' | 'uncertain' | 'finalizing' | 'stopped';
  leaseExpiresAt: string;
  workflowPin: Pin;
  checkpoint: Checkpoint;
  terminalIntent: TerminalIntent;
  terminalReason: string | null;
  terminalResult: AttemptResultInput | null;
  stoppedAt: string | null;
  finalizedAt: string | null;
};
