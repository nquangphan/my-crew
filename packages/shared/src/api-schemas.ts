import { z } from 'zod';
import {
  AgentActivity,
  AgentRole,
  Complexity,
  Effort,
  ModelAlias,
  SelectableModel,
} from './agent-schemas.js';
import { CommentMention } from './comment-mentions.js';
import { DocsPageSummary, DocsSnapshotInfo } from './docs-schemas.js';
import { EventEnvelope } from './event-schemas.js';
import { DocsStatus, McpServerName } from './project-schemas.js';
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
  /** An owner comment tags `@pm` on a ticket that has no open pm_task tree to wake. */
  'PM_NOT_AVAILABLE',
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

/** Owner login: username and password; the response is the new session. */
export const LoginRequest = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const SessionResponse = z.object({
  owner: z.object({ username: z.string() }),
  csrfToken: z.string(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/** Shortest owner password the seed CLI and the change-password route accept. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

const CurrentPassword = z.string().min(1).max(MAX_PASSWORD_LENGTH);
const NewPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `passwords have at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH);

/**
 * Owner password change: the current password and a new password that differs from it. The response is
 * the rotated session. Unknown fields (such as a code from an older client) are ignored.
 */
export const ChangePasswordRequest = z
  .object({ currentPassword: CurrentPassword, newPassword: NewPassword })
  .refine((body) => body.newPassword !== body.currentPassword, {
    path: ['newPassword'],
    message: 'the new password must differ from the current one',
  });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

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
  /** The PM's one-line reason for `complexity` (dev and QC subtasks; a bug inherits its dev's). */
  complexityReason: z.string().nullable(),
  /** A stored override; a legacy ticket may still carry `fable`, which runs on opus. */
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
  /**
   * Owner reads only (ticket list and detail): what an agent machine reports doing with the ticket, or null
   * when no agent is expected to work on it. Absent from daemon responses.
   */
  agentActivity: AgentActivity.nullable().optional(),
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

/** The PM's one-line reason for a complexity rating. */
const ComplexityReason = z.string().trim().min(1).max(500);

/** Types whose model the PM chooses by rating the subtask's complexity: there is no default model. */
const RATED_TYPES: readonly string[] = ['dev', 'qc'];

const SubtaskFields = z.object({
  type: z.enum(['pm_task', 'dev', 'qc', 'docs_init']),
  parentId: z.uuid(),
  /** Required for pm_task; children inherit the parent's project. */
  projectId: z.uuid().optional(),
  title: Title,
  description: Description.default(''),
  priority: TicketPriority.optional(),
  complexity: Complexity.optional(),
  /** Required with `complexity` for dev and qc: why the PM rated it so (one line). */
  complexityReason: ComplexityReason.optional(),
  model: SelectableModel.optional(),
  effort: Effort.optional(),
  requiredSkills: z.array(SkillName).max(50).default([]),
  requiredMcps: z.array(McpServerName).max(50).default([]),
  /** Sibling ticket ids. */
  dependsOn: z.array(z.uuid()).max(50).default([]),
  /** Required for qc: the dev or bug ticket it verifies. */
  pairsWith: z.uuid().optional(),
  flows: z.array(FlowRef).max(100).default([]),
});

/**
 * Agents create pm_task (under a request) and dev/qc/bug/docs_init (under a pm_task). A dev or QC subtask
 * needs `complexity` and a one-line `complexityReason`: the run's model comes from that rating.
 */
export const CreateSubtaskRequest = SubtaskFields.superRefine((data, ctx) => {
  if (!RATED_TYPES.includes(data.type)) return;
  if (!data.complexity) {
    ctx.addIssue({
      code: 'custom',
      path: ['complexity'],
      message:
        `Subtask ${data.type} bắt buộc có complexity (trivial | small | medium | large): PM đánh giá độ ` +
        'phức tạp để chọn model, không có model mặc định cho dev và QC.',
    });
  }
  if (!data.complexityReason) {
    ctx.addIssue({
      code: 'custom',
      path: ['complexityReason'],
      message: `Subtask ${data.type} bắt buộc có complexityReason: một dòng lý do cho mức complexity đã chọn.`,
    });
  }
});
export type CreateSubtaskRequest = z.input<typeof CreateSubtaskRequest>;

/**
 * `POST /v1/daemon/tickets/:id/rate-subtask`, where `:id` is the PM's pm_task: the PM rates (or re-rates) one
 * of its open dev, qc or bug subtasks in place. The rating replaces the previous one, including any model or
 * effort override; a running job keeps its model and the next run uses the new rating.
 */
export const RateSubtaskRequest = z.object({
  /** Id or key of the subtask. */
  ticket: z.string().trim().min(1).max(100),
  complexity: z.enum(Complexity.options, {
    error: 'complexity bắt buộc: trivial | small | medium | large (PM đánh giá độ phức tạp để chọn model).',
  }),
  complexityReason: z
    .string({ error: 'complexityReason bắt buộc: một dòng lý do cho mức complexity đã chọn.' })
    .trim()
    .min(1, 'complexityReason bắt buộc: một dòng lý do cho mức complexity đã chọn.')
    .max(500),
  model: SelectableModel.optional(),
  effort: Effort.optional(),
});
export type RateSubtaskRequest = z.input<typeof RateSubtaskRequest>;

/**
 * `POST /v1/daemon/tickets/:id/retry-subtask`: the PM (`:id` is its pm_task) moves one of its blocked
 * subtasks back to `in_progress` and wakes its agent, when the owner asked it to with `@pm`.
 */
export const RetrySubtaskRequest = z.object({
  /** Id or key of the subtask. */
  ticket: z.string().trim().min(1).max(100),
});
export type RetrySubtaskRequest = z.infer<typeof RetrySubtaskRequest>;

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

/** A project filter (ids, comma-separated, at most 100); absent means every project. */
const ProjectIdsFilter = CsvList(z.uuid())
  .refine((ids) => ids.length <= 100, 'at most 100 projects')
  .optional();

export const TicketSortField = z.enum(['createdAt', 'updatedAt', 'priority', 'title']);

/** Query string of `GET /v1/tickets`. List filters accept comma-separated values. */
export const ListTicketsQuery = z.object({
  projectId: z.uuid().optional(),
  /**
   * Tickets of any of these projects, plus the request tickets routed to one of them (a pm_task child in
   * the project) or hinted at one: the cross-project board and list.
   */
  projectIds: ProjectIdsFilter,
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

/**
 * `GET /v1/tickets/:id/tree`: every descendant of a ticket, open or closed, parents before their children
 * (level by level, oldest first). `truncated` is set when the tree has more than the server's limit.
 */
export const TicketTreeResponse = z.object({ items: z.array(Ticket), truncated: z.boolean() });
export type TicketTreeResponse = z.infer<typeof TicketTreeResponse>;

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
  /**
   * Tags the owner wrote (`@pm`), read from the text outside code; always empty for agent and system
   * comments. A tagged owner comment is only stored when the server woke that tree's PM.
   */
  mentions: z.array(CommentMention).default([]),
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

/**
 * Query string of `GET /v1/search`. `projectIds` keeps the tickets of those projects, the requests routed
 * or hinted to one of them, and their docs pages.
 */
export const SearchQuery = z.object({ q: z.string().trim().min(1).max(200), projectIds: ProjectIdsFilter });
export type SearchQuery = z.input<typeof SearchQuery>;

export const SearchResponse = z.object({
  tickets: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      title: z.string(),
      type: TicketType,
      status: TicketStatus,
      /** Null for requests (they belong to no project). */
      projectId: z.string().nullable().default(null),
    }),
  ),
  docs: z.array(z.object({ projectId: z.string(), path: z.string(), title: z.string() })),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

/** The newest docs_init ticket of a project: why its docs space is still empty. */
export const DocsInitTicketInfo = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  status: TicketStatus,
  updatedAt: z.iso.datetime(),
});
export type DocsInitTicketInfo = z.infer<typeof DocsInitTicketInfo>;

/** One project on the docs home: its docs status, latest snapshot (if any) and docs-init ticket. */
export const DocsOverviewItem = z.object({
  projectId: z.string(),
  docsStatus: DocsStatus,
  snapshot: DocsSnapshotInfo.nullable(),
  /** Files in the latest snapshot (0 before the first sync). */
  fileCount: z.number().int().min(0),
  docsInit: DocsInitTicketInfo.nullable(),
});
export type DocsOverviewItem = z.infer<typeof DocsOverviewItem>;

/** `GET /v1/docs`: every project's docs status, in project key order. */
export const DocsOverviewResponse = z.object({ items: z.array(DocsOverviewItem) });
export type DocsOverviewResponse = z.infer<typeof DocsOverviewResponse>;

/** Query string of `GET /v1/docs/search`: every project's docs, or only `projectIds`. */
export const CrossDocsSearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  projectIds: ProjectIdsFilter,
});
export type CrossDocsSearchQuery = z.input<typeof CrossDocsSearchQuery>;

/** `GET /v1/docs/search`: matching pages across projects, each with its project and a text snippet. */
export const CrossDocsSearchResponse = z.object({
  items: z.array(DocsPageSummary.extend({ projectId: z.string(), snippet: z.string() })),
});
export type CrossDocsSearchResponse = z.infer<typeof CrossDocsSearchResponse>;

export const HealthResponse = z.object({ status: z.literal('ok'), db: z.literal('ok') });
export type HealthResponse = z.infer<typeof HealthResponse>;
