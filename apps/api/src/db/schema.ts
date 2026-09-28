import {
  AgentRole,
  CommentAuthorKind,
  Complexity,
  DocsStatus,
  Effort,
  ModelAlias,
  ProjectPlatform,
  TicketPriority,
  TicketStatus,
  TicketType,
  type UiTestMcp,
} from '@crew/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  boolean,
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
export const modelAliasEnum = pgEnum('model_alias', enumValues(ModelAlias));
export const effortEnum = pgEnum('effort', enumValues(Effort));
export const projectPlatformEnum = pgEnum('project_platform', enumValues(ProjectPlatform));
export const docsStatusEnum = pgEnum('docs_status', enumValues(DocsStatus));
export const commentAuthorKindEnum = pgEnum('comment_author_kind', enumValues(CommentAuthorKind));
export const budgetHoldEnum = pgEnum('budget_hold', ['children', 'cost']);

// ---------------------------------------------------------------------------
// Owner auth
// ---------------------------------------------------------------------------

export const owner = pgTable('owner', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  totpSecret: text('totp_secret').notNull(),
  /** Last accepted TOTP time step; codes at or before it are rejected (replay protection). */
  totpLastStep: integer('totp_last_step'),
  /** SHA-256 hex of each unused recovery code. */
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
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
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
    index('events_target_machine_idx').on(t.targetMachineId, t.id),
    index('events_ticket_idx').on(t.ticketId, t.id),
  ],
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

export type OwnerRow = typeof owner.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type MachineRow = typeof machines.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type ReportRow = typeof ticketReports.$inferSelect;
export type EventRow = typeof events.$inferSelect;
