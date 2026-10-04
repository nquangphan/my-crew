import type { RenderPrerequisites } from '../assistant/render-executor.ts';
import type { WorkflowDefinition } from '../assistant/workflow-manifest.ts';
import type {
  ProjectionPin,
  Runtime,
  SlotStatus,
  SourcePin,
  Workflow,
  WorkflowStatus,
} from '../host/status.ts';
export type DomainPin = { workflow: Workflow; version: string; revision: string; checksum: string };
export const toDomainPin = (source: SourcePin): DomainPin => ({
  workflow: source.name,
  version: source.version,
  revision: source.sourceRevision,
  checksum: source.sourceTreeSha256,
});
export type GatewayConfig = {
  revision: number;
  desired: Record<Workflow, { source: SourcePin; projections: Record<Runtime, ProjectionPin | null> }>;
  maxJobs: number;
  enabled: boolean;
};
export type Inventory = Record<Workflow, WorkflowStatus>;
/**
 * Install-report-only slot: a current projection may additionally carry its derived workflow definition
 * and, beside a BMAD render definition, the measured `uv`/Python render prerequisites. Both are additive.
 */
export type ReportedProjectionSlot = SlotStatus<ProjectionPin> & {
  definition?: WorkflowDefinition;
  prerequisites?: RenderPrerequisites;
};
export type ReportedInventory = Record<
  Workflow,
  { source: WorkflowStatus['source']; projections: Record<Runtime, ReportedProjectionSlot> }
>;
export type InstallReport = {
  reportId: string;
  bootId: string;
  bootGeneration: string;
  configRevision: number;
  reportedAt: string;
  results: ReportedInventory;
};
export type GatewayCommand = {
  id: string;
  machineId: string;
  type: string;
  payload: Record<string, unknown>;
  state: string;
  result: unknown;
  cursor: string;
};
export type Selection = {
  runtime: Runtime;
  sourceTreeSha256: string;
  projectionManifestSha256: string;
  projectionTreeSha256: string;
  installReportId: string;
  configRevision: number;
  decisionId: string;
};
export type Command = {
  id: string;
  machineId: string;
  ticketId: string;
  type: string;
  payload: Record<string, unknown>;
  state: string;
  result: unknown;
};
export type Permit = {
  commandId: string;
  ticketId: string;
  machineId: string;
  bindingRevision: number;
  ticketRevision: number;
  workflow: DomainPin;
  checkedAt: string;
  expiresAt: string;
  telemetryId: string;
  decisionId: string;
};
export type ResultInput = {
  fence: string;
  processInstanceId: string;
  outcome: 'passed' | 'retry' | 'needs_input';
  evidenceIds: string[];
  reason: string | null;
};
export type Attempt = {
  id: string;
  commandId: string;
  machineId: string;
  ticketId: string;
  fence: string;
  processInstanceId: string;
  state: 'active' | 'uncertain' | 'finalizing' | 'stopped';
  workflowPin: DomainPin;
  finalizedAt: string | null;
  stoppedAt: string | null;
  terminalResult: ResultInput | null;
};
export type ReadTransport = (route: string) => Promise<unknown>;
