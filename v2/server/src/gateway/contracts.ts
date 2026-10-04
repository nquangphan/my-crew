import type { Pin } from '../../../src/workflow-policy.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';

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
export type DesiredWorkflow = { source: SourcePin; projections: Record<Runtime, ProjectionPin | null> };
export type GatewayConfig = {
  revision: number;
  desired: Record<Workflow, DesiredWorkflow>;
  maxJobs: number;
  enabled: boolean;
};
export type ConfigInput = Omit<GatewayConfig, 'revision'> & { expectedRevision: number };
export type BundleState = 'missing' | 'installing' | 'current' | 'mismatch' | 'error';
export type SlotStatus<T> = {
  state: BundleState;
  installed: T | null;
  lastError: { code: string; message: string } | null;
  observedAt: string | null;
};
/** Workflow definition the gateway derived from an installed projection (additive install-report field). */
export type ProjectionDefinition = {
  sha256: string;
  skills: { path: string; sha256: string }[];
  customizationSha256: string;
  render?: Record<string, unknown>;
};
export type ProjectionSlotStatus = SlotStatus<ProjectionPin> & { definition?: ProjectionDefinition };
export type WorkflowStatus = {
  source: SlotStatus<SourcePin>;
  projections: Record<Runtime, ProjectionSlotStatus>;
};
export type WorkflowInventory = Record<Workflow, WorkflowStatus>;
export type GatewayHeartbeat = {
  bootId: Id;
  bootGeneration: string;
  sequence: string;
  observedAt: string;
  hostVersion: string;
  appVersion: string | null;
  telemetry: {
    cpuLoad1: number;
    cpuCount: number;
    memoryAvailableBytes: string;
    memoryPressure: 'normal' | 'warn' | 'critical';
    diskAvailableBytes: string;
    activeJobs: number;
    configuredMaxJobs: number;
  };
  inventory: WorkflowInventory;
  processes: {
    attemptId: Id;
    processInstanceId: Id;
    fence: string;
    observation: 'running' | 'stopped' | 'unknown';
  }[];
};
export type InstallReport = {
  reportId: Id;
  bootId: Id;
  bootGeneration: string;
  configRevision: number;
  reportedAt: string;
  results: WorkflowInventory;
};
export type InstallReportResponse = {
  accepted: boolean;
  appliedRevision: number;
  workflows: WorkflowInventory;
};
export type DispatchSelection = {
  runtime: Runtime;
  sourceTreeSha256: string;
  projectionManifestSha256: string;
  projectionTreeSha256: string;
  installReportId: Id;
  configRevision: number;
  decisionId: Id;
};
export type AttemptProjectionPin = {
  attemptId: Id;
  fence: string;
  processInstanceId: Id;
  sourceTreeSha256: string;
  runtime: Runtime;
  projectionManifestSha256: string;
  projectionTreeSha256: string;
  installReportId: Id;
};
export type ProjectionInput = Omit<AttemptProjectionPin, 'attemptId'>;
export type GatewayProjectionPolicy = {
  authorize(tx: Tx, input: { attemptId: Id; actor: Actor }): Promise<DispatchSelection>;
};
export type GatewayAck = {
  phase: 'received' | 'completed';
  result?: { ok: boolean; code?: string; details?: Record<string, unknown> };
};
export type GatewayCommand = {
  id: Id;
  machineId: Id;
  type: 'sync_workflows' | 'probe' | 'reconcile_host';
  payload: Record<string, unknown>;
  state: 'queued' | 'received' | 'completed';
  result: GatewayAck['result'] | null;
  cursor: string;
  createdAt: string;
  receivedAt: string | null;
  completedAt: string | null;
};
export type GatewayApplied = { revision: number; workflows: WorkflowInventory; appliedAt: string | null };
export type GatewayStatus = {
  machineId: Id;
  bootId: Id | null;
  bootGeneration: string | null;
  serverConnection: 'unconfigured' | 'offline' | 'online';
  desiredConfigRevision: number | null;
  appliedConfigRevision: number | null;
  workflows: WorkflowInventory;
  desiredConfig: GatewayConfig | null;
  applied: GatewayApplied | null;
  receivedAt: string | null;
  lastTelemetryAt: string | null;
  /** From the live boot's last heartbeat; null when no heartbeat of the current boot exists. */
  hostVersion: string | null;
  appVersion: string | null;
  /** Host-reported time, informational only; liveness uses receivedAt. */
  observedAt: string | null;
  telemetry: GatewayHeartbeat['telemetry'] | null;
  activeProcesses: GatewayHeartbeat['processes'];
  uncertainProcesses: GatewayHeartbeat['processes'];
  commands: GatewayCommand[];
};
export type WorkflowRetryResult = { created: boolean; configRevision: number; command: GatewayCommand };
/** Per-slot comparison of desired against what the install report says is installed. */
export type CatalogueVerdict =
  | 'match'
  | 'mismatch'
  | 'not_installed'
  | 'installing'
  | 'error'
  | 'not_desired';
export type CatalogueSource = {
  desired: SourcePin | null;
  installed: SourcePin | null;
  state: BundleState;
  verdict: CatalogueVerdict;
  versionMismatch: boolean;
  lastError: SlotStatus<SourcePin>['lastError'];
  observedAt: string | null;
};
export type CatalogueProjection = {
  desired: ProjectionPin | null;
  installed: ProjectionPin | null;
  state: BundleState;
  verdict: CatalogueVerdict;
  /** Present only when the stored definition is provably tied to the exact current desired pins. */
  definition: ProjectionDefinition | null;
  lastError: SlotStatus<ProjectionPin>['lastError'];
  observedAt: string | null;
};
export type WorkflowCatalogue = {
  machineId: Id;
  desiredConfigRevision: number | null;
  appliedConfigRevision: number | null;
  latestReport: { reportId: Id; configRevision: number; accepted: boolean; receivedAt: string } | null;
  official: Record<Workflow, { version: string; sourceRevision: string; allowedSourceUrls: string[] }>;
  workflows: Record<Workflow, { source: CatalogueSource; projections: Record<Runtime, CatalogueProjection> }>;
};
export const toDomainPin = (source: SourcePin): Pin => ({
  workflow: source.name,
  version: source.version,
  revision: source.sourceRevision,
  checksum: source.sourceTreeSha256,
});

export const retrySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { expectedRevision: { type: 'integer', minimum: 1, maximum: 2147483646 } },
  required: ['expectedRevision'],
} as const;
export const workflows: Workflow[] = ['bmad', 'superpowers'];
export const runtimes: Runtime[] = ['claude', 'codex', 'api'];
export const uuidSchema = { type: 'string', format: 'uuid' } as const;
export const digestSchema = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;
export const counterSchema = { type: 'string', pattern: '^[1-9][0-9]{0,18}$' } as const;
export const cursorSchema = { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' } as const;
const shortString = { type: 'string', minLength: 1, maxLength: 200 } as const;
const timestamp = { type: 'string', format: 'date-time', maxLength: 40 } as const;
export const objectSchema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
export const sourceSchema = objectSchema({
  name: { enum: workflows },
  version: shortString,
  sourceRevision: { type: 'string', pattern: '^[0-9a-f]{40}$' },
  sourceUrl: { type: 'string', minLength: 1, maxLength: 2048 },
  payloadSha256: digestSchema,
  packageIntegrity: nullable({ type: 'string', pattern: '^sha512-[A-Za-z0-9+/]{86}==$' }),
  sourceManifestSha256: digestSchema,
  sourceTreeSha256: digestSchema,
});
export const projectionSchema = objectSchema({
  runtime: { enum: runtimes },
  sourceTreeSha256: digestSchema,
  manifestSha256: digestSchema,
  treeSha256: digestSchema,
  derivation: objectSchema({
    tool: shortString,
    version: shortString,
    options: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 4096 } },
    layoutSchema: shortString,
    policySha256: digestSchema,
  }),
});
const projectionSlots = Object.fromEntries(runtimes.map((runtime) => [runtime, nullable(projectionSchema)]));
const desiredWorkflowSchema = objectSchema({
  source: sourceSchema,
  projections: objectSchema(projectionSlots),
});
export const configSchema = objectSchema({
  expectedRevision: { type: 'integer', minimum: 0, maximum: 2147483646 },
  desired: objectSchema({ bmad: desiredWorkflowSchema, superpowers: desiredWorkflowSchema }),
  maxJobs: { type: 'integer', minimum: 1, maximum: 64 },
  enabled: { type: 'boolean' },
});
const slotSchema = (pin: unknown) =>
  objectSchema({
    state: { enum: ['missing', 'installing', 'current', 'mismatch', 'error'] },
    installed: nullable(pin),
    lastError: nullable(
      objectSchema({
        code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,63}$' },
        message: { type: 'string', maxLength: 2000 },
      }),
    ),
    observedAt: nullable(timestamp),
  });
const statusSchema = (projectionSlot: unknown) =>
  objectSchema({
    source: slotSchema(sourceSchema),
    projections: objectSchema(Object.fromEntries(runtimes.map((runtime) => [runtime, projectionSlot]))),
  });
const inventorySchema = (projectionSlot: unknown) => {
  const status = statusSchema(projectionSlot);
  return objectSchema({ bmad: status, superpowers: status });
};
// Mirrors the gateway RenderDefinition: pinned source/projection, selected projection hashes, seven layers.
const renderLayerPaths = [
  '_bmad/config.toml',
  '_bmad/config.user.toml',
  '_bmad/custom/config.toml',
  '_bmad/custom/config.user.toml',
  '_bmad/custom/bmad-build.toml',
  '_bmad/custom/bmad-build.user.toml',
  '.claude/skills/bmad-build/customize.toml',
];
const renderSchema = objectSchema({
  source: sourceSchema,
  projection: projectionSchema,
  selectedProjectionSha256: {
    type: 'object',
    maxProperties: 2000,
    propertyNames: { minLength: 1, maxLength: 1024 },
    additionalProperties: digestSchema,
  },
  layers: objectSchema(
    Object.fromEntries(renderLayerPaths.map((path) => [path, nullable(digestSchema)])),
    [],
  ),
});
const definitionSchema = objectSchema(
  {
    sha256: digestSchema,
    skills: {
      type: 'array',
      maxItems: 2000,
      items: objectSchema({ path: { type: 'string', minLength: 1, maxLength: 1024 }, sha256: digestSchema }),
    },
    customizationSha256: digestSchema,
    render: renderSchema,
  },
  ['sha256', 'skills', 'customizationSha256'],
);
const heartbeatInventorySchema = inventorySchema(slotSchema(projectionSchema));
const reportInventorySchema = inventorySchema(
  (() => {
    const slot = slotSchema(projectionSchema);
    return { ...slot, properties: { ...slot.properties, definition: definitionSchema } };
  })(),
);
export const heartbeatSchema = objectSchema({
  bootId: uuidSchema,
  bootGeneration: counterSchema,
  sequence: counterSchema,
  observedAt: timestamp,
  hostVersion: shortString,
  appVersion: nullable(shortString),
  telemetry: objectSchema({
    cpuLoad1: { type: 'number', minimum: 0, maximum: 100000 },
    cpuCount: { type: 'integer', minimum: 1, maximum: 4096 },
    memoryAvailableBytes: cursorSchema,
    memoryPressure: { enum: ['normal', 'warn', 'critical'] },
    diskAvailableBytes: cursorSchema,
    activeJobs: { type: 'integer', minimum: 0, maximum: 10000 },
    configuredMaxJobs: { type: 'integer', minimum: 1, maximum: 64 },
  }),
  inventory: heartbeatInventorySchema,
  processes: {
    type: 'array',
    maxItems: 1000,
    items: objectSchema({
      attemptId: uuidSchema,
      processInstanceId: uuidSchema,
      fence: counterSchema,
      observation: { enum: ['running', 'stopped', 'unknown'] },
    }),
  },
});
export const installReportSchema = objectSchema({
  reportId: uuidSchema,
  bootId: uuidSchema,
  bootGeneration: counterSchema,
  configRevision: { type: 'integer', minimum: 1, maximum: 2147483647 },
  reportedAt: timestamp,
  results: reportInventorySchema,
});
export const projectionInputSchema = objectSchema({
  fence: counterSchema,
  processInstanceId: uuidSchema,
  sourceTreeSha256: digestSchema,
  runtime: { enum: runtimes },
  projectionManifestSha256: digestSchema,
  projectionTreeSha256: digestSchema,
  installReportId: uuidSchema,
});
export const ackSchema = objectSchema(
  {
    phase: { enum: ['received', 'completed'] },
    result: objectSchema(
      {
        ok: { type: 'boolean' },
        code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,63}$' },
        details: {
          type: 'object',
          maxProperties: 20,
          propertyNames: { pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,63}$' },
          additionalProperties: true,
        },
      },
      ['ok'],
    ),
  },
  ['phase'],
);
