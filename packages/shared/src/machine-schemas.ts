import { z } from 'zod';
import { AgentRole, Effort } from './agent-schemas.js';
import { CreateCommentRequest, TotpCode } from './api-schemas.js';
import {
  CreateProjectRequest,
  DocsStatus,
  ProjectKey,
  ProjectPlatform,
  UiTestMcp,
} from './project-schemas.js';

// ---------------------------------------------------------------------------
// Pairing and device tokens
// ---------------------------------------------------------------------------

/** Machine tokens start with this prefix, so secret scanners (R7) can recognise a leaked token. */
export const MACHINE_TOKEN_PREFIX = 'crew_mt_';
export const PAIRING_CODE_TTL_MINUTES = 10;
export const MACHINE_TOKEN_TTL_DAYS = 90;

/** 12 base32 characters, shown as ABCD-EFGH-IJKL; case and dashes are ignored on input. */
export const PairingCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z2-7]{4}-?[A-Za-z2-7]{4}-?[A-Za-z2-7]{4}$/, 'pairing codes look like ABCD-EFGH-IJKL');

/** Owner, from the web: re-confirms the TOTP before a pairing code is shown. */
export const CreatePairingCodeRequest = z.object({ code: TotpCode });
export type CreatePairingCodeRequest = z.infer<typeof CreatePairingCodeRequest>;

export const PairingCodeResponse = z.object({ pairingCode: z.string(), expiresAt: z.iso.datetime() });
export type PairingCodeResponse = z.infer<typeof PairingCodeResponse>;

export const MachineHardware = z.object({
  cpus: z.number().int().min(1).max(1_024),
  memGb: z.number().positive().max(65_536),
  arch: z.string().trim().min(1).max(50).optional(),
});
export type MachineHardware = z.infer<typeof MachineHardware>;

const SkillText = z.string().trim().min(1).max(200);

/** One skill as the agents on the machine see it (from the SDK init message plus its SKILL.md). */
export const InventorySkill = z.object({
  /** Fully namespaced, e.g. `ak:scout`. */
  name: SkillText,
  source: z.enum(['user', 'project', 'plugin']),
  description: z.string().max(5_000).default(''),
});
export type InventorySkill = z.infer<typeof InventorySkill>;

export const InventoryMcpServer = z.object({
  name: SkillText,
  source: z.enum(['user', 'local', 'project', 'plugin', 'connector']),
  /** Connection status reported by the SDK, e.g. `connected`, `failed`, `needs-auth`. */
  status: z.string().trim().min(1).max(50),
  tools: z
    .array(z.object({ name: SkillText, description: z.string().max(5_000).optional() }))
    .max(1_000)
    .default([]),
  /** The owner switched the server off for this project: agents never get its tools, and tickets cannot require it. */
  disabled: z.boolean().optional(),
});
export type InventoryMcpServer = z.infer<typeof InventoryMcpServer>;

export const SkillInventory = z.object({
  skills: z.array(InventorySkill).max(2_000).default([]),
  mcpServers: z.array(InventoryMcpServer).max(200).default([]),
});
export type SkillInventory = z.infer<typeof SkillInventory>;

/** `POST /v1/machines/pair`: sent by the desktop app or `crewd pair --code`. */
export const PairMachineRequest = z.object({
  code: PairingCode,
  name: z.string().trim().min(1).max(100),
  hostname: z.string().trim().min(1).max(255),
  os: z.string().trim().min(1).max(100),
  hardware: MachineHardware,
  /** Machine-level inventory (skills and MCP servers that are not tied to one project). */
  inventory: SkillInventory.optional(),
});
export type PairMachineRequest = z.input<typeof PairMachineRequest>;

/** Returned once by pairing and by rotation. The server keeps only the SHA-256 of `token`. */
export const MachineTokenResponse = z.object({
  machineId: z.string(),
  token: z.string(),
  expiresAt: z.iso.datetime(),
});
export type MachineTokenResponse = z.infer<typeof MachineTokenResponse>;

// ---------------------------------------------------------------------------
// Heartbeat and inventory
// ---------------------------------------------------------------------------

export const HealthStatus = z.enum(['green', 'yellow', 'red']);
export type HealthStatus = z.infer<typeof HealthStatus>;

/** Summary of the desktop app's health checks, carried by the heartbeat. */
export const HealthSummary = z.object({
  status: HealthStatus,
  failing: z
    .array(z.object({ id: z.string().trim().min(1).max(100), title: z.string().trim().min(1).max(300) }))
    .max(100)
    .default([]),
});
export type HealthSummary = z.infer<typeof HealthSummary>;

export const MachineResources = z.object({
  cpus: z.number().int().min(1).max(1_024),
  loadAvg1: z.number().min(0).max(100_000),
  freeMemGb: z.number().min(0).max(65_536),
  totalMemGb: z.number().min(0).max(65_536),
  diskFreeGb: z.number().min(0).max(1_000_000).optional(),
  /** Orphan processes, temp dirs and worktrees removed by the last sweep. */
  orphansCleaned: z.number().int().min(0).max(1_000_000).optional(),
});
export type MachineResources = z.infer<typeof MachineResources>;

export const RunningJob = z.object({
  ticketId: z.uuid(),
  role: AgentRole,
  kind: z.enum(['agent', 'docs_update', 'docs_init']),
  startedAt: z.iso.datetime().optional(),
});
export type RunningJob = z.infer<typeof RunningJob>;

/** `POST /v1/daemon/heartbeat`, every 30 s. A heartbeat replaces the previous state. */
export const HeartbeatRequest = z.object({
  resources: MachineResources,
  runningJobs: z.array(RunningJob).max(200).default([]),
  cliVersion: z.string().trim().min(1).max(50),
  appVersion: z.string().trim().min(1).max(50).optional(),
  paused: z.boolean().default(false),
  health: HealthSummary.optional(),
});
export type HeartbeatRequest = z.input<typeof HeartbeatRequest>;

export const HeartbeatResponse = z.object({
  serverTime: z.iso.datetime(),
  /** Expiry of the token used for this request; rotate before it. */
  tokenExpiresAt: z.iso.datetime(),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponse>;

/** `PUT /v1/daemon/skills`: replaces the inventory of one owned project, or the machine-level one. */
export const PutSkillsRequest = SkillInventory.extend({
  /** Null for the machine-level inventory. */
  projectKey: ProjectKey.nullable(),
});
export type PutSkillsRequest = z.input<typeof PutSkillsRequest>;

// ---------------------------------------------------------------------------
// Owner view of machines
// ---------------------------------------------------------------------------

export const Machine = z.object({
  id: z.string(),
  name: z.string(),
  hostname: z.string().nullable(),
  os: z.string().nullable(),
  hardware: MachineHardware.nullable(),
  hostsAssistant: z.boolean(),
  online: z.boolean(),
  /** An SSE stream of this machine is open on this server right now. */
  streamConnected: z.boolean(),
  lastSeenAt: z.iso.datetime().nullable(),
  lastHeartbeatAt: z.iso.datetime().nullable(),
  paused: z.boolean(),
  health: HealthSummary.nullable(),
  resources: MachineResources.nullable(),
  runningJobs: z.array(RunningJob),
  cliVersion: z.string().nullable(),
  appVersion: z.string().nullable(),
  /** Latest expiry among the machine's live tokens; null when none is live. */
  tokenExpiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  projectKeys: z.array(z.string()),
  createdAt: z.iso.datetime(),
});
export type Machine = z.infer<typeof Machine>;

export const MachineListResponse = z.object({ items: z.array(Machine) });
export type MachineListResponse = z.infer<typeof MachineListResponse>;

export const MachineInventory = z.object({
  projectId: z.string().nullable(),
  projectKey: z.string().nullable(),
  skills: z.array(InventorySkill),
  mcpServers: z.array(InventoryMcpServer),
  updatedAt: z.iso.datetime(),
});
export type MachineInventory = z.infer<typeof MachineInventory>;

export const MachineDetailResponse = z.object({ machine: Machine, inventories: z.array(MachineInventory) });
export type MachineDetailResponse = z.infer<typeof MachineDetailResponse>;

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

/** `POST /v1/daemon/claims`: one project by key, or the assistant role. */
export const ClaimTarget = z.union([
  z.object({ projectKey: ProjectKey }).strict(),
  z.object({ hostsAssistant: z.literal(true) }).strict(),
]);
export type ClaimTarget = z.infer<typeof ClaimTarget>;

/**
 * Body of a claim. `pending` (HTTP 202): another machine holds the target, and the claim request waits for
 * the owner's approval on the web.
 */
export const ClaimResponse = z.object({
  status: z.enum(['granted', 'already_owned', 'pending']),
  claimRequestId: z.string().nullable(),
});
export type ClaimResponse = z.infer<typeof ClaimResponse>;

export const ReleaseClaimResponse = z.object({ status: z.enum(['released', 'withdrawn']) });
export type ReleaseClaimResponse = z.infer<typeof ReleaseClaimResponse>;

/**
 * `granted`: bound at once (nobody held it). `pending`, `approved`, `rejected`: a takeover. `withdrawn`: the
 * requesting machine gave up, or was revoked, before a decision.
 */
export const ClaimRequestStatus = z.enum(['pending', 'approved', 'rejected', 'granted', 'withdrawn']);
export type ClaimRequestStatus = z.infer<typeof ClaimRequestStatus>;

export const ClaimRequest = z.object({
  id: z.string(),
  machineId: z.string(),
  machineName: z.string(),
  projectId: z.string().nullable(),
  projectKey: z.string().nullable(),
  assistant: z.boolean(),
  /** The holder when the request was decided (or now, while pending). */
  previousMachineId: z.string().nullable(),
  status: ClaimRequestStatus,
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ClaimRequest = z.infer<typeof ClaimRequest>;

export const ClaimRequestListQuery = z.object({ status: ClaimRequestStatus.optional() });
export const ClaimRequestListResponse = z.object({ items: z.array(ClaimRequest) });
export type ClaimRequestListResponse = z.infer<typeof ClaimRequestListResponse>;

/** Approving or rejecting a takeover needs a fresh TOTP code. */
export const ClaimDecisionRequest = z.object({ code: TotpCode });
export type ClaimDecisionRequest = z.infer<typeof ClaimDecisionRequest>;

/** Owner reassigns a project, or the assistant role, to the machine in the path. */
export const OwnerAssignRequest = z.union([
  z.object({ projectId: z.uuid() }).strict(),
  z.object({ hostsAssistant: z.literal(true) }).strict(),
]);
export type OwnerAssignRequest = z.infer<typeof OwnerAssignRequest>;

// ---------------------------------------------------------------------------
// Project type and UI-test MCP changes from the owning machine
// ---------------------------------------------------------------------------

/** The project settings that decide which UI-test MCP servers QC tickets must carry. */
export const ProjectTestSetup = z.object({ platform: ProjectPlatform, uiTestMcp: UiTestMcp });
export type ProjectTestSetup = z.infer<typeof ProjectTestSetup>;

/**
 * `POST /v1/daemon/projects/:projectKey/change-requests`: the owning machine asks to change its project's
 * type and UI-test MCP mapping. Nothing changes until the owner approves it on the web with a TOTP.
 */
export const ProjectChangeBody = ProjectTestSetup.strict();
export type ProjectChangeBody = z.input<typeof ProjectChangeBody>;

/**
 * `pending` (HTTP 202): the request waits for the owner. `unchanged` (HTTP 200): the values are already the
 * project's, so nothing was requested.
 */
export const ProjectChangeResponse = z.object({
  status: z.enum(['pending', 'unchanged']),
  requestId: z.string().nullable(),
});
export type ProjectChangeResponse = z.infer<typeof ProjectChangeResponse>;

export const ProjectChangeStatus = z.enum(['pending', 'approved', 'rejected']);
export type ProjectChangeStatus = z.infer<typeof ProjectChangeStatus>;

export const PendingProjectChange = ProjectTestSetup.extend({ requestId: z.string() });
export type PendingProjectChange = z.infer<typeof PendingProjectChange>;

export const ProjectChangeRequest = z.object({
  id: z.string(),
  projectId: z.string(),
  projectKey: z.string(),
  machineId: z.string(),
  machineName: z.string(),
  /** The project's values when the machine asked. */
  current: ProjectTestSetup,
  requested: ProjectTestSetup,
  status: ProjectChangeStatus,
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ProjectChangeRequest = z.infer<typeof ProjectChangeRequest>;

export const ProjectChangeListQuery = z.object({ status: ProjectChangeStatus.optional() });
export const ProjectChangeListResponse = z.object({ items: z.array(ProjectChangeRequest) });
export type ProjectChangeListResponse = z.infer<typeof ProjectChangeListResponse>;

// ---------------------------------------------------------------------------
// Daemon project views
// ---------------------------------------------------------------------------

export const OwnerState = z.enum(['mine', 'unowned', 'other']);
export type OwnerState = z.infer<typeof OwnerState>;

export const DaemonProject = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  repoUrl: z.string(),
  defaultBranch: z.string(),
  platform: ProjectPlatform,
  uiTestMcp: UiTestMcp,
  docsStatus: DocsStatus,
  ownerState: OwnerState,
  /** Name of the owning machine when it is another one. */
  ownerMachineName: z.string().nullable(),
  /** This machine has a takeover request waiting for the owner. */
  pendingClaim: z.boolean(),
  /** This machine's type and UI-test MCP change waiting for the owner's confirmation. */
  pendingChange: PendingProjectChange.nullable().default(null),
});
export type DaemonProject = z.infer<typeof DaemonProject>;

export const DaemonProjectsResponse = z.object({
  items: z.array(DaemonProject),
  assistant: z.object({
    state: OwnerState,
    hostName: z.string().nullable(),
    pendingClaim: z.boolean(),
  }),
});
export type DaemonProjectsResponse = z.infer<typeof DaemonProjectsResponse>;

/**
 * `POST /v1/daemon/projects`: a project created from a local folder, owned by the calling machine. The owner
 * types the description in the app; it is never prefilled from repo content.
 */
export const DaemonCreateProjectRequest = CreateProjectRequest.pick({
  key: true,
  name: true,
  description: true,
  repoUrl: true,
  defaultBranch: true,
  platform: true,
  uiTestMcp: true,
});
export type DaemonCreateProjectRequest = z.input<typeof DaemonCreateProjectRequest>;

/** Triage catalog: owner-entered text only, so repo content cannot inject instructions into routing. */
export const ProjectCatalogResponse = z.object({
  items: z.array(z.object({ id: z.string(), key: z.string(), name: z.string(), description: z.string() })),
});
export type ProjectCatalogResponse = z.infer<typeof ProjectCatalogResponse>;

// ---------------------------------------------------------------------------
// Daemon ticket writes
// ---------------------------------------------------------------------------

/** Agent comment. `role` defaults to the ticket's assignee role (QC commenting on a dev ticket sets `qc`). */
export const AgentCommentRequest = CreateCommentRequest.extend({ role: AgentRole.optional() });
export type AgentCommentRequest = z.infer<typeof AgentCommentRequest>;

/**
 * `PATCH /v1/daemon/tickets/:id/agent-meta`, after each run.
 *
 * Cost contract: every run's cost is booked exactly once. A run that submits a report books its cost in the
 * report's `costUsd`; a run that ends without a report (for example `ask_owner`) books it here as
 * `costDeltaUsd`. Both are added to the ticket and the project's daily usage; neither is a running total.
 */
export const AgentMetaRequest = z
  .object({
    sessionId: z.string().trim().min(1).max(200),
    /** The model id the run used, e.g. `claude-sonnet-...` or an alias. */
    model: z.string().trim().min(1).max(100),
    effort: Effort,
    costDeltaUsd: z.number().min(0).max(100_000),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'at least one field is required');
export type AgentMetaRequest = z.infer<typeof AgentMetaRequest>;

const BudgetLine = z.object({
  spentUsd: z.number(),
  /** Null means no limit (the default). */
  limitUsd: z.number().nullable(),
  remainingUsd: z.number().nullable(),
});

/** `GET /v1/daemon/budget/:ticketId`, checked before a job starts. */
export const BudgetStatusResponse = z.object({
  ticketId: z.string(),
  pmTaskId: z.string().nullable(),
  projectId: z.string().nullable(),
  ticketCostUsd: z.number(),
  /** The pm_task tree budget (the pm_task plus its children). */
  tree: BudgetLine,
  daily: BudgetLine.extend({ day: z.string() }),
  hold: z.enum(['children', 'cost']).nullable(),
  /** The owner approved going past the cost budgets for this pm_task tree. */
  costBudgetLifted: z.boolean(),
  /** True when a job for this ticket must not start: a cost hold, or a budget used up and not lifted. */
  overBudget: z.boolean(),
});
export type BudgetStatusResponse = z.infer<typeof BudgetStatusResponse>;
