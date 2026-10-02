import { randomUUID } from 'node:crypto';

export type BundleState = 'missing' | 'installing' | 'current' | 'mismatch' | 'error';
export type SlotStatus<T> = {
  state: BundleState;
  installed: T | null;
  lastError: { code: string; message: string } | null;
  observedAt: string | null;
};
export type Workflow = 'bmad' | 'superpowers';
export type Runtime = 'claude' | 'codex' | 'api';
export type SourcePin = {
  name: Workflow;
  version: string;
  sourceRevision: string;
  sourceUrl: string;
  payloadSha256: string;
  packageIntegrity: string | null;
  sourceManifestSha256: string;
  sourceTreeSha256: string;
};
export type ProjectionPin = {
  runtime: Runtime;
  sourceTreeSha256: string;
  manifestSha256: string;
  treeSha256: string;
  derivation: {
    tool: string;
    version: string;
    options: string[];
    layoutSchema: string;
    policySha256: string;
  };
};
export type WorkflowStatus = {
  source: SlotStatus<SourcePin>;
  projections: Record<Runtime, SlotStatus<ProjectionPin>>;
};
export type GatewayStatus = {
  bootId: string;
  bootGeneration: string | null;
  serverConnection: 'unconfigured' | 'offline' | 'online';
  desiredConfigRevision: number | null;
  appliedConfigRevision: number | null;
  workflows: Record<Workflow, WorkflowStatus>;
  activeProcesses: { attemptId: string; processInstanceId: string }[];
  uncertainProcesses: { attemptId: string; processInstanceId: string }[];
  lastTelemetryAt: string | null;
  backgroundService: { permission: 'not_requested' | 'pending' | 'enabled' | 'denied'; enabled: boolean };
};

const missing = <T>(): SlotStatus<T> => ({
  state: 'missing',
  installed: null,
  lastError: null,
  observedAt: null,
});
const missingWorkflow = (): WorkflowStatus => ({
  source: missing(),
  projections: { claude: missing(), codex: missing(), api: missing() },
});

export function initialStatus(): GatewayStatus {
  return {
    bootId: randomUUID(),
    bootGeneration: null,
    serverConnection: 'unconfigured',
    desiredConfigRevision: null,
    appliedConfigRevision: null,
    workflows: { bmad: missingWorkflow(), superpowers: missingWorkflow() },
    activeProcesses: [],
    uncertainProcesses: [],
    lastTelemetryAt: null,
    backgroundService: { permission: 'not_requested', enabled: false },
  };
}
