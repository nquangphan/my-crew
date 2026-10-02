import type { Signal, Status } from '../../../src/ticket-policy.ts';
import type { Pin } from '../../../src/workflow-policy.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';

export type TicketLevel = 'request' | 'step' | 'task';
export type TicketKind = 'code' | 'research' | 'docs' | 'deploy';
export type CreateTicket = {
  projectId: Id;
  parentId: Id | null;
  level: TicketLevel;
  kind: TicketKind;
  title: string;
  description: string;
  mandatory: boolean;
  criteria: Record<string, unknown>;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  skill: string | null;
  workflowPin: Pin | null;
  deployApprovalDecisionId?: Id | null;
};
export type Ticket = CreateTicket & {
  id: Id;
  rootId: Id;
  status: Status;
  revision: number;
  waitReason: string | null;
  repairCycles: number;
  mergedCommit: string | null;
};
export type Dependency = { ticketId: Id; predecessorId: Id };
export type RepairLink = { checkStepId: Id; fixTicketId: Id; cycleId: Id };
export type SourceRef = {
  kind: 'docs' | 'ticket' | 'artifact' | 'owner_decision';
  id: Id;
  path?: string;
  locator?: string;
};
export type DecisionInput = {
  kind: 'assessment' | 'delegated' | 'owner_answer' | 'approval' | 'intervention' | 'dispatch';
  content: string;
  rationale: string;
  sources: SourceRef[];
  scope: Record<string, unknown>;
};
export type Comment = { id: Id; ticketId: Id; actor: Actor; text: string; createdAt: string };
export type RepairResultInput = {
  ticketId: Id;
  attemptId: Id;
  fence: string;
  cycleId: Id;
  classification: 'initial_review' | 'repair_review' | 'infrastructure' | 'model';
  passed: boolean;
  evidence: Record<string, unknown>;
};

// Task 5 supplies transaction-scoped process/fence proof. Defaults deny every execution action.
export type ExecutionAuthority = {
  verifySignal: (tx: Tx, ticketId: Id, signal: Signal, evidenceId: Id | null) => Promise<void>;
  requestTerminalIntent: (tx: Tx, ticketId: Id, intent: 'needs_input', reason: string) => Promise<void>;
  verifyRepairResult: (tx: Tx, input: RepairResultInput) => Promise<void>;
};
// Task 7 supplies verified snapshot lookup; null means no proven matching commit.
export type DocsCompletionReader = (tx: Tx, projectId: Id, commit: string | null) => Promise<string | null>;
export type DocsSourceReader = (tx: Tx, projectId: Id, snapshotId: Id, path: string) => Promise<boolean>;
export type TicketServiceDependencies = {
  execution?: ExecutionAuthority;
  docsCompletion?: DocsCompletionReader;
  docsSource?: DocsSourceReader;
};
