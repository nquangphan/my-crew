import { z } from 'zod';
import { AgentRole, Complexity, Effort, ModelAlias } from './agent-schemas.js';
import { EventEnvelope } from './event-schemas.js';
import { McpServerName } from './project-schemas.js';
import { TicketPriority, TicketStatus, TicketType } from './ticket-schemas.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ApiErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'CSRF_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'ILLEGAL_TRANSITION',
  'REPORT_REQUIRED',
  'BUDGET_HOLD',
  'CHILD_CAP_EXCEEDED',
  'BUDGET_EXCEEDED',
  'BUG_CYCLE_CAP',
  'INVALID_HIERARCHY',
  'INVALID_DEPENDENCY',
  'PARENT_CLOSED',
  'TICKET_CLOSED',
  'QC_ALREADY_PAIRED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'RATE_LIMITED',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** Body of every non-2xx response. */
export const ApiErrorBody = z.object({
  error: z.object({ code: ApiErrorCode, message: z.string(), details: z.unknown().optional() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

// ---------------------------------------------------------------------------
// Owner auth
// ---------------------------------------------------------------------------

/** Header carrying the double-submit CSRF token on every mutating owner request. */
export const CSRF_HEADER = 'x-csrf-token';

export const TotpCode = z.string().regex(/^\d{6}$/, 'TOTP codes are 6 digits');
export const RecoveryCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z2-7]{4}(-?[A-Za-z2-7]{4}){3}$/, 'recovery codes look like ABCD-EFGH-IJKL-MNOP');

/** Step 1: password. Returns a short-lived challenge for the TOTP step. */
export const LoginPasswordRequest = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(1024),
});
export type LoginPasswordRequest = z.infer<typeof LoginPasswordRequest>;

export const LoginPasswordResponse = z.object({ challenge: z.string(), expiresAt: z.iso.datetime() });
export type LoginPasswordResponse = z.infer<typeof LoginPasswordResponse>;

/** Step 2: a TOTP code or a one-time recovery code. */
export const LoginTotpRequest = z.union([
  z.object({ challenge: z.string().min(1).max(2000), code: TotpCode }),
  z.object({ challenge: z.string().min(1).max(2000), recoveryCode: RecoveryCode }),
]);
export type LoginTotpRequest = z.infer<typeof LoginTotpRequest>;

export const SessionResponse = z.object({
  owner: z.object({ username: z.string() }),
  csrfToken: z.string(),
  recoveryCodesLeft: z.number().int(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

const SkillName = z.string().trim().min(1).max(200);
const FlowRef = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'flow ids are kebab-case');
const Title = z.string().trim().min(1).max(300);
const Description = z.string().max(100_000);

export const Ticket = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
  type: TicketType,
  parentId: z.string().nullable(),
  projectId: z.string().nullable(),
  projectHintId: z.string().nullable(),
  assigneeRole: AgentRole,
  assigneeMachineId: z.string().nullable(),
  status: TicketStatus,
  priority: TicketPriority,
  allowConfigChange: z.boolean(),
  complexity: Complexity.nullable(),
  model: ModelAlias.nullable(),
  effort: Effort.nullable(),
  requiredSkills: z.array(z.string()),
  requiredMcps: z.array(z.string()),
  dependsOn: z.array(z.string()),
  pairsWith: z.string().nullable(),
  originDevId: z.string().nullable(),
  bugCycle: z.number().int(),
  flows: z.array(z.string()),
  agentSessionId: z.string().nullable(),
  /** Model and effort of the latest agent run, as reported by the daemon (the planned ones are above). */
  agentModel: z.string().nullable(),
  agentEffort: Effort.nullable(),
  costUsd: z.number(),
  /** Set while the ticket waits for the owner because a cap or budget was hit. */
  budgetHold: z.enum(['children', 'cost']).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Ticket = z.infer<typeof Ticket>;

/** Owner creates `request` tickets from the web. */
export const CreateRequestTicket = z.object({
  title: Title,
  description: Description.default(''),
  priority: TicketPriority.default('medium'),
  /** Optional owner hint for triage. */
  projectHintId: z.uuid().nullable().default(null),
  /** "cho phép sửa config": lets agents change protected config paths for this ticket tree. */
  allowConfigChange: z.boolean().default(false),
});
export type CreateRequestTicket = z.input<typeof CreateRequestTicket>;

/** Agents create pm_task (under a request) and dev/qc/bug/docs_init (under a pm_task). */
export const CreateSubtaskRequest = z.object({
  type: z.enum(['pm_task', 'dev', 'qc', 'docs_init']),
  parentId: z.uuid(),
  /** Required for pm_task; children inherit the parent's project. */
  projectId: z.uuid().optional(),
  title: Title,
  description: Description.default(''),
  priority: TicketPriority.optional(),
  complexity: Complexity.optional(),
  model: ModelAlias.optional(),
  effort: Effort.optional(),
  requiredSkills: z.array(SkillName).max(50).default([]),
  requiredMcps: z.array(McpServerName).max(50).default([]),
  /** Sibling ticket ids. */
  dependsOn: z.array(z.uuid()).max(50).default([]),
  /** Required for qc: the dev or bug ticket it verifies. */
  pairsWith: z.uuid().optional(),
  flows: z.array(FlowRef).max(100).default([]),
});
export type CreateSubtaskRequest = z.input<typeof CreateSubtaskRequest>;

/** `PATCH /v1/tickets/:id`: owner inline edits (title, description, priority). */
export const UpdateTicketRequest = z
  .object({ title: Title, description: Description, priority: TicketPriority })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'at least one field is required');
export type UpdateTicketRequest = z.infer<typeof UpdateTicketRequest>;

export const TransitionRequest = z.object({ to: TicketStatus });
export type TransitionRequest = z.infer<typeof TransitionRequest>;

export const FileBugRequest = z.object({
  title: Title,
  description: Description.default(''),
  priority: TicketPriority.optional(),
  requiredSkills: z.array(SkillName).max(50).default([]),
  flows: z.array(FlowRef).max(100).default([]),
});
export type FileBugRequest = z.input<typeof FileBugRequest>;

export const FileBugResponse = z.object({ bug: Ticket, retest: Ticket });
export type FileBugResponse = z.infer<typeof FileBugResponse>;

const CsvList = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((value) =>
      (Array.isArray(value) ? value : value.split(','))
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    )
    .pipe(z.array(item));

export const TicketSortField = z.enum(['createdAt', 'updatedAt', 'priority', 'title']);

/** Query string of `GET /v1/tickets`. List filters accept comma-separated values. */
export const ListTicketsQuery = z.object({
  projectId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  status: CsvList(TicketStatus).optional(),
  type: CsvList(TicketType).optional(),
  role: CsvList(AgentRole).optional(),
  priority: CsvList(TicketPriority).optional(),
  flow: FlowRef.optional(),
  /** Tickets assigned to one machine, e.g. the affected tickets of an offline machine. */
  machineId: z.uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort: TicketSortField.default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListTicketsQuery = z.input<typeof ListTicketsQuery>;

export const TicketListResponse = z.object({ items: z.array(Ticket), nextCursor: z.string().nullable() });
export type TicketListResponse = z.infer<typeof TicketListResponse>;

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const CommentAuthorKind = z.enum(['owner', 'agent', 'system']);
export type CommentAuthorKind = z.infer<typeof CommentAuthorKind>;

export const CreateCommentRequest = z.object({ body: z.string().trim().min(1).max(50_000) });
export type CreateCommentRequest = z.infer<typeof CreateCommentRequest>;

export const Comment = z.object({
  id: z.string(),
  ticketId: z.string(),
  authorKind: CommentAuthorKind,
  authorRole: AgentRole.nullable(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type Comment = z.infer<typeof Comment>;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const Reason = z.string().trim().min(1).max(500);

export const SkillSelection = z.object({ name: SkillName, reason: Reason });
export const McpSelection = z.object({ server: McpServerName, reason: Reason });
export const TestRun = z.object({
  name: z.string().trim().min(1).max(500),
  passed: z.boolean(),
  summary: z.string().max(5_000).optional(),
});

/**
 * Report body sent by the daemon. `skillsUsed`, `skillsMissing`, `mcpsUsed`, `mcpsMissing`, `docsFirst` and
 * `leftResources` are recorded by the daemon from the run's tool log, never taken from agent input.
 */
export const SubmitReportRequest = z.object({
  summaryMd: z.string().trim().min(1).max(200_000),
  filesChanged: z.array(z.string().min(1).max(1_000)).max(5_000).default([]),
  commits: z
    .array(z.string().regex(/^[0-9a-f]{7,64}$/))
    .max(1_000)
    .default([]),
  headSha: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/)
    .nullable()
    .default(null),
  skillsSelected: z.array(SkillSelection).max(100).default([]),
  mcpsSelected: z.array(McpSelection).max(100).default([]),
  skillsUsed: z.array(SkillName).max(200).default([]),
  skillsMissing: z.array(SkillName).max(200).default([]),
  mcpsUsed: z.array(McpServerName).max(200).default([]),
  mcpsMissing: z.array(McpServerName).max(200).default([]),
  docsFirst: z.boolean(),
  testsRun: z.array(TestRun).max(1_000).default([]),
  /** Ids of the bug tickets this run filed. */
  bugsFiled: z.array(z.uuid()).max(100).default([]),
  leftResources: z.boolean().default(false),
  /** Cost of the runs this report covers; added to the ticket and the project's daily usage. */
  costUsd: z.number().min(0).max(100_000).default(0),
});
export type SubmitReportRequest = z.input<typeof SubmitReportRequest>;

export const Report = z.object({
  id: z.string(),
  ticketId: z.string(),
  version: z.number().int(),
  isCurrent: z.boolean(),
  summaryMd: z.string(),
  filesChanged: z.array(z.string()),
  commits: z.array(z.string()),
  headSha: z.string().nullable(),
  skillsSelected: z.array(z.object({ name: z.string(), reason: z.string() })),
  mcpsSelected: z.array(z.object({ server: z.string(), reason: z.string() })),
  skillsUsed: z.array(z.string()),
  skillsMissing: z.array(z.string()),
  mcpsUsed: z.array(z.string()),
  mcpsMissing: z.array(z.string()),
  docsFirst: z.boolean(),
  testsRun: z.array(TestRun),
  bugsFiled: z.array(z.string()),
  leftResources: z.boolean(),
  costUsd: z.number(),
  createdAt: z.iso.datetime(),
});
export type Report = z.infer<typeof Report>;

export const ReportResponse = z.object({ current: Report.nullable(), history: z.array(Report) });
export type ReportResponse = z.infer<typeof ReportResponse>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const TicketDetailResponse = z.object({
  ticket: Ticket,
  children: z.array(Ticket),
  comments: z.array(Comment),
  report: Report.nullable(),
  events: z.array(EventEnvelope),
});
export type TicketDetailResponse = z.infer<typeof TicketDetailResponse>;

export const SearchQuery = z.object({ q: z.string().trim().min(1).max(200) });

export const SearchResponse = z.object({
  tickets: z.array(
    z.object({ id: z.string(), key: z.string(), title: z.string(), type: TicketType, status: TicketStatus }),
  ),
  docs: z.array(z.object({ projectId: z.string(), path: z.string(), title: z.string() })),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

export const HealthResponse = z.object({ status: z.literal('ok'), db: z.literal('ok') });
export type HealthResponse = z.infer<typeof HealthResponse>;
