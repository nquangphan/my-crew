import {
  AgentRole,
  type BmadProfile,
  ClaimRequestStatus,
  CommentAuthorKind,
  Complexity,
  DocsPageKind,
  DocsStatus,
  Effort,
  type FailedJob,
  type FlowsManifest,
  type HealthSummary,
  type InventoryMcpServer,
  type InventorySkill,
  MachineCommandStatus,
  type MachineHardware,
  type MachineResources,
  type MachineRuntimeState,
  type MachineSettingsState,
  type ModelAlias,
  ProjectChangeStatus,
  ProjectPlatform,
  type RunningJob,
  type RuntimeShellRange,
  SettingsKind,
  SettingsScope,
  TicketPriority,
  TicketStatus,
  TicketType,
  type UiTestMcp,
  type WaitingJob,
} from '@crew/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** pgEnum needs a non-empty tuple of literals; zod enums expose their options as a plain array. */
const enumValues = <T extends string>(zodEnum: { options: readonly T[] }) => zodEnum.options as [T, ...T[]];
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const textArray = (name: string) => text(name).array().notNull().default(sql`'{}'::text[]`);
const usd = (name: string) => numeric(name, { precision: 14, scale: 6, mode: 'number' });

export const ticketStatusEnum = pgEnum('ticket_status', enumValues(TicketStatus));
export const ticketTypeEnum = pgEnum('ticket_type', enumValues(TicketType));
export const ticketPriorityEnum = pgEnum('ticket_priority', enumValues(TicketPriority));
export const agentRoleEnum = pgEnum('agent_role', enumValues(AgentRole));
export const complexityEnum = pgEnum('complexity', enumValues(Complexity));
/**
 * Spelled out instead of derived from ModelAlias: Postgres cannot drop an enum value safely, so the stored
 * values must never follow a changed TS enum silently. `fable` stays only for legacy rows; every input accepts
 * SelectableModel (haiku, sonnet, opus).
 */
export const modelAliasEnum = pgEnum('model_alias', ['haiku', 'sonnet', 'opus', 'fable'] satisfies [
  ModelAlias,
  ...ModelAlias[],
]);
export const effortEnum = pgEnum('effort', enumValues(Effort));
export const projectPlatformEnum = pgEnum('project_platform', enumValues(ProjectPlatform));
export const docsStatusEnum = pgEnum('docs_status', enumValues(DocsStatus));
export const commentAuthorKindEnum = pgEnum('comment_author_kind', enumValues(CommentAuthorKind));
export const budgetHoldEnum = pgEnum('budget_hold', ['children', 'cost']);
export const claimStatusEnum = pgEnum('claim_status', enumValues(ClaimRequestStatus));
export const projectChangeStatusEnum = pgEnum('project_change_status', enumValues(ProjectChangeStatus));
export const settingsKindEnum = pgEnum('settings_kind', enumValues(SettingsKind));
export const settingsScopeEnum = pgEnum('settings_scope', enumValues(SettingsScope));
export const machineCommandStatusEnum = pgEnum('machine_command_status', enumValues(MachineCommandStatus));

// ---------------------------------------------------------------------------
// Owner auth
// ---------------------------------------------------------------------------

export const owner = pgTable('owner', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /**
   * Unused since login became password only; kept (and cleared by the seed CLI) to avoid a destructive
   * migration. The next three columns belong together.
   */
  totpSecret: text('totp_secret').notNull(),
  totpLastStep: integer('totp_last_step'),
  recoveryCodeHashes: textArray('recovery_code_hashes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 hex of the cookie value; the raw id is never stored. */
    idHash: text('id_hash').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owner.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_owner_idx').on(t.ownerId)],
);

// ---------------------------------------------------------------------------
// Machines and projects
// ---------------------------------------------------------------------------

export const machines = pgTable(
  'machines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    hostname: text('hostname'),
    os: text('os'),
    hostsAssistant: boolean('hosts_assistant').notNull().default(false),
    hardware: jsonb('hardware').$type<MachineHardware>(),
    /** Set by any authenticated request; cleared by the heartbeat sweeper after 5 minutes of silence. */
    online: boolean('online').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    paused: boolean('paused').notNull().default(false),
    health: jsonb('health').$type<HealthSummary>(),
    resources: jsonb('resources').$type<MachineResources>(),
    runningJobs: jsonb('running_jobs').$type<RunningJob[]>().notNull().default([]),
    /** Queued and backoff jobs of the latest heartbeat, with their wait reasons. */
    waitingJobs: jsonb('waiting_jobs').$type<WaitingJob[]>().notNull().default([]),
    /** Tickets whose latest job on this machine failed, from the latest heartbeat. */
    failedJobs: jsonb('failed_jobs').$type<FailedJob[]>().notNull().default([]),
    cliVersion: text('cli_version'),
    appVersion: text('app_version'),
    /** The settings revision the daemon applies to new jobs, from its latest heartbeat. */
    settingsState: jsonb('settings_state').$type<MachineSettingsState>(),
    /** The app and runtime versions and runtime update state, from its latest heartbeat. */
    runtimeState: jsonb('runtime_state').$type<MachineRuntimeState>(),
    /** The runtime release the owner pinned this machine to (null: the newest its app can run). */
    runtimePinnedVersion: text('runtime_pinned_version'),
    /** A revoked machine keeps its row for history; it can never authenticate again. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('machines_single_assistant_host').on(t.hostsAssistant).where(sql`${t.hostsAssistant}`)],
);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  repoUrl: text('repo_url').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  ownerMachineId: uuid('owner_machine_id').references(() => machines.id, { onDelete: 'set null' }),
  docsStatus: docsStatusEnum('docs_status').notNull().default('unknown'),
  platform: projectPlatformEnum('platform').notNull(),
  uiTestMcp: jsonb('ui_test_mcp')
    .$type<UiTestMcp>()
    .notNull()
    .default({ maestro: 'maestro', playwright: 'playwright' }),
  maxChildrenPerTicket: integer('max_children_per_ticket').notNull().default(12),
  ticketTreeBudgetUsd: usd('ticket_tree_budget_usd'),
  dailyBudgetUsd: usd('daily_budget_usd'),
  /** The BMAD setup the owning machine reported (validated `BmadProfile`); null until one does. */
  bmadProfile: jsonb('bmad_profile').$type<BmadProfile>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/** `scope` is a project key, or `AST` for requests. `next` is the next number to hand out. */
export const ticketCounters = pgTable('ticket_counters', {
  scope: text('scope').primaryKey(),
  next: integer('next').notNull(),
});

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    type: ticketTypeEnum('type').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => tickets.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    projectHintId: uuid('project_hint_id').references(() => projects.id, { onDelete: 'set null' }),
    assigneeRole: agentRoleEnum('assignee_role').notNull(),
    assigneeMachineId: uuid('assignee_machine_id').references(() => machines.id, { onDelete: 'set null' }),
    status: ticketStatusEnum('status').notNull().default('todo'),
    priority: ticketPriorityEnum('priority').notNull().default('medium'),
    allowConfigChange: boolean('allow_config_change').notNull().default(false),
    complexity: complexityEnum('complexity'),
    /** The PM's one-line reason for `complexity`. */
    complexityReason: text('complexity_reason'),
    model: modelAliasEnum('model'),
    effort: effortEnum('effort'),
    requiredSkills: textArray('required_skills'),
    requiredMcps: textArray('required_mcps'),
    dependsOn: uuid('depends_on').array().notNull().default(sql`'{}'::uuid[]`),
    pairsWith: uuid('pairs_with').references((): AnyPgColumn => tickets.id, { onDelete: 'restrict' }),
    originDevId: uuid('origin_dev_id').references((): AnyPgColumn => tickets.id, { onDelete: 'restrict' }),
    bugCycle: integer('bug_cycle').notNull().default(0),
    flows: textArray('flows'),
    agentSessionId: text('agent_session_id'),
    agentModel: text('agent_model'),
    agentEffort: effortEnum('agent_effort'),
    costUsd: usd('cost_usd').notNull().default(0),
    /** Why the ticket waits in needs_input for the owner, when a cap or budget was hit. */
    budgetHold: budgetHoldEnum('budget_hold'),
    /** Set when the owner approved going past the child cap by commenting. */
    childCapLifted: boolean('child_cap_lifted').notNull().default(false),
    /** Set when the owner approved going past the cost budgets by commenting. */
    costBudgetLifted: boolean('cost_budget_lifted').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tickets_parent_idx').on(t.parentId),
    index('tickets_project_status_idx').on(t.projectId, t.status),
    index('tickets_assignee_machine_idx').on(t.assigneeMachineId),
    index('tickets_updated_idx').on(t.updatedAt, t.id),
    index('tickets_depends_on_idx').using('gin', t.dependsOn),
    index('tickets_flows_idx').using('gin', t.flows),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorKind: commentAuthorKindEnum('author_kind').notNull(),
    authorRole: agentRoleEnum('author_role'),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('comments_ticket_idx').on(t.ticketId, t.createdAt)],
);

export const ticketReports = pgTable(
  'ticket_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    isCurrent: boolean('is_current').notNull(),
    summaryMd: text('summary_md').notNull(),
    filesChanged: textArray('files_changed'),
    commits: textArray('commits'),
    headSha: text('head_sha'),
    skillsSelected: jsonb('skills_selected')
      .$type<{ name: string; reason: string }[]>()
      .notNull()
      .default([]),
    mcpsSelected: jsonb('mcps_selected').$type<{ server: string; reason: string }[]>().notNull().default([]),
    mcpsUsed: textArray('mcps_used'),
    mcpsMissing: textArray('mcps_missing'),
    skillsUsed: textArray('skills_used'),
    skillsMissing: textArray('skills_missing'),
    docsFirst: boolean('docs_first').notNull(),
    testsRun: jsonb('tests_run')
      .$type<{ name: string; passed: boolean; summary?: string }[]>()
      .notNull()
      .default([]),
    bugsFiled: uuid('bugs_filed').array().notNull().default(sql`'{}'::uuid[]`),
    leftResources: boolean('left_resources').notNull().default(false),
    costUsd: usd('cost_usd').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ticket_reports_version_uq').on(t.ticketId, t.version),
    uniqueIndex('ticket_reports_current_uq').on(t.ticketId).where(sql`${t.isCurrent}`),
  ],
);

// ---------------------------------------------------------------------------
// Events (audit log and delivery outbox)
// ---------------------------------------------------------------------------

export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    /**
     * Delivery sequence and SSE cursor. A deferred trigger assigns it at commit under a lock (see the
     * migration), so sequence order is commit order: null only while the inserting transaction is open.
     */
    seq: bigint('seq', { mode: 'bigint' }),
    type: text('type').notNull(),
    ticketId: uuid('ticket_id'),
    projectId: uuid('project_id'),
    /** Null means owner stream only. */
    targetMachineId: uuid('target_machine_id'),
    targetRole: agentRoleEnum('target_role'),
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('events_seq_uq').on(t.seq),
    index('events_target_seq_idx').on(t.targetMachineId, t.seq),
    index('events_ticket_idx').on(t.ticketId, t.id),
  ],
);

// ---------------------------------------------------------------------------
// Machine auth, inventory and claims
// ---------------------------------------------------------------------------

/** Single-use codes the owner creates on the web; only the SHA-256 of the code is stored. */
export const pairingCodes = pgTable('pairing_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  codeHash: text('code_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  /** The machine that used the code. */
  machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

/** Device tokens; only the SHA-256 of the token is stored. */
export const machineTokens = pgTable(
  'machine_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('machine_tokens_machine_idx').on(t.machineId)],
);

/** Skill and MCP inventory per machine and project; `project_id` null is the machine-level inventory. */
export const machineSkills = pgTable(
  'machine_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    skills: jsonb('skills').$type<InventorySkill[]>().notNull().default([]),
    mcpServers: jsonb('mcp_servers').$type<InventoryMcpServer[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [unique('machine_skills_scope_uq').on(t.machineId, t.projectId).nullsNotDistinct()],
);

/** Claims of a project (`project_id`) or of the assistant role (`assistant`), and their decisions. */
export const claimRequests = pgTable(
  'claim_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    assistant: boolean('assistant').notNull().default(false),
    /** The holder when the request was made or decided. */
    previousMachineId: uuid('previous_machine_id').references(() => machines.id, { onDelete: 'set null' }),
    status: claimStatusEnum('status').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('claim_requests_target_ck', sql`${t.assistant} = (${t.projectId} is null)`),
    uniqueIndex('claim_requests_pending_project_uq')
      .on(t.machineId, t.projectId)
      .where(sql`${t.status} = 'pending' and ${t.projectId} is not null`),
    uniqueIndex('claim_requests_pending_assistant_uq')
      .on(t.machineId)
      .where(sql`${t.status} = 'pending' and ${t.assistant}`),
    index('claim_requests_status_idx').on(t.status, t.createdAt),
  ],
);

/**
 * Type and UI-test MCP changes the owning machine asked for; the project changes only when the owner
 * approves. One pending request per project.
 */
export const projectChangeRequests = pgTable(
  'project_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    /** The project's values when the machine asked. */
    currentPlatform: projectPlatformEnum('current_platform').notNull(),
    currentUiTestMcp: jsonb('current_ui_test_mcp').$type<UiTestMcp>().notNull(),
    platform: projectPlatformEnum('platform').notNull(),
    uiTestMcp: jsonb('ui_test_mcp').$type<UiTestMcp>().notNull(),
    status: projectChangeStatusEnum('status').notNull().default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('project_change_requests_pending_uq').on(t.projectId).where(sql`${t.status} = 'pending'`),
    index('project_change_requests_status_idx').on(t.status, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Server-managed settings
// ---------------------------------------------------------------------------

/**
 * Every revision of every server setting (prompts, rules, models, budgets, machine resources, project MCP
 * switches). A setting key is (kind, scope, machine, project, name); its highest `version` is the active
 * revision. Revisions are never updated or deleted: a restore saves the old content as a new version.
 */
export const settingsRevisions = pgTable(
  'settings_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: settingsKindEnum('kind').notNull(),
    scope: settingsScopeEnum('scope').notNull(),
    machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /** Prompt name; empty for the other kinds. */
    name: text('name').notNull().default(''),
    version: integer('version').notNull(),
    /** The validated setting; null removes the override (the default or the global value applies). */
    content: jsonb('content'),
    note: text('note').notNull().default(''),
    /** `owner:<username>` or `machine:<name>`. */
    author: text('author').notNull(),
    /** The version a restore copied. */
    restoredFrom: integer('restored_from'),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'settings_revisions_scope_ck',
      sql`(${t.scope} = 'global' and ${t.machineId} is null and ${t.projectId} is null)
        or (${t.scope} = 'machine' and ${t.machineId} is not null and ${t.projectId} is null)
        or (${t.scope} = 'project' and ${t.projectId} is not null and ${t.machineId} is null)`,
    ),
    // Also the lookup index of a key's revisions (newest = highest version).
    unique('settings_revisions_version_uq')
      .on(t.kind, t.scope, t.machineId, t.projectId, t.name, t.version)
      .nullsNotDistinct(),
  ],
);

// ---------------------------------------------------------------------------
// Remote machine commands
// ---------------------------------------------------------------------------

/**
 * Whitelisted actions the owner asks a machine for from the web (pause, health check and fix, BMAD install,
 * job list, log tail, …) and their outcome. The action is validated with the shared schema at the boundary
 * (text here, so a new action needs no enum migration).
 */
export const machineCommands = pgTable(
  'machine_commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    status: machineCommandStatusEnum('status').notNull().default('pending'),
    result: jsonb('result'),
    error: text('error'),
    requestedBy: text('requested_by').notNull(),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('machine_commands_machine_idx').on(t.machineId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Runtime bundles (signed hot updates of the desktop app)
// ---------------------------------------------------------------------------

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * Signed runtime bundles machines can run, newest by version. The manifest is kept as the exact bytes that were
 * signed (the shell verifies the signature itself); the tarball lives in `runtime_bundles`.
 */
export const runtimeReleases = pgTable('runtime_releases', {
  version: text('version').primaryKey(),
  manifest: text('manifest').notNull(),
  signature: text('signature').notNull(),
  keyId: text('key_id').notNull(),
  commit: text('commit').notNull(),
  shellRange: jsonb('shell_range').$type<RuntimeShellRange>().notNull(),
  bundleSha256: text('bundle_sha256').notNull(),
  size: integer('size').notNull(),
  source: text('source').$type<'github' | 'upload'>().notNull(),
  publishedBy: text('published_by').notNull(),
  /** When CI built it (from the manifest). */
  builtAt: timestamp('built_at', { withTimezone: true }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
});

export const runtimeBundles = pgTable('runtime_bundles', {
  version: text('version')
    .primaryKey()
    .references(() => runtimeReleases.version, { onDelete: 'cascade' }),
  data: bytea('data').notNull(),
});

// ---------------------------------------------------------------------------
// Owner inbox read state
// ---------------------------------------------------------------------------

/** Notices (events, by `seq`) the owner has read; shared by every device the owner uses. */
export const noticeReads = pgTable(
  'notice_reads',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owner.id, { onDelete: 'cascade' }),
    eventSeq: bigint('event_seq', { mode: 'bigint' }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.eventSeq] })],
);

// ---------------------------------------------------------------------------
// Idempotency and budgets
// ---------------------------------------------------------------------------

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').notNull(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    /** Method and route of the first request; reusing a key elsewhere is rejected. */
    fingerprint: text('fingerprint').notNull(),
    statusCode: integer('status_code').notNull(),
    response: jsonb('response').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.machineId, t.key] }),
    index('idempotency_keys_created_idx').on(t.createdAt),
  ],
);

export const budgetsUsage = pgTable(
  'budgets_usage',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    costUsd: usd('cost_usd').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.day] })],
);

// ---------------------------------------------------------------------------
// Docs snapshots (latest per project, read-only on the web)
// ---------------------------------------------------------------------------

export const docsPageKindEnum = pgEnum('docs_page_kind', enumValues(DocsPageKind));

/** The latest synced docs tree of each project; a new sync replaces it. */
export const docsSnapshots = pgTable('docs_snapshots', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  commitSha: text('commit_sha').notNull(),
  branch: text('branch').notNull(),
  /** The machine that synced it (the project owner at that time). */
  machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
  /** Parsed `docs/flows.yaml` of the snapshot. */
  manifest: jsonb('manifest').$type<FlowsManifest>().notNull(),
  totalBytes: integer('total_bytes').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

export const docsFiles = pgTable(
  'docs_files',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => docsSnapshots.projectId, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    title: text('title').notNull(),
    kind: docsPageKindEnum('kind').notNull(),
    flowId: text('flow_id'),
    content: text('content').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.path] })],
);

export type OwnerRow = typeof owner.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type MachineRow = typeof machines.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type ReportRow = typeof ticketReports.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type MachineTokenRow = typeof machineTokens.$inferSelect;
export type ClaimRequestRow = typeof claimRequests.$inferSelect;
export type ProjectChangeRequestRow = typeof projectChangeRequests.$inferSelect;
export type DocsSnapshotRow = typeof docsSnapshots.$inferSelect;
export type DocsFileRow = typeof docsFiles.$inferSelect;
export type SettingsRevisionRow = typeof settingsRevisions.$inferSelect;
export type MachineCommandRow = typeof machineCommands.$inferSelect;
export type RuntimeReleaseRow = typeof runtimeReleases.$inferSelect;
