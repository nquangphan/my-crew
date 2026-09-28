import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import {
  type AgentRole,
  Complexity,
  type CreateSubtaskRequest,
  Effort,
  McpServerName,
  ModelAlias,
  type SkillInventory,
  TicketPriority,
  TicketStatus,
} from '@crew/shared';
import { z } from 'zod';
import { type VpsClient, VpsError } from '../api/vps-client.js';
import { runCrewDocs } from '../git/docs-kit-bridge.js';
import type { ResourceReport } from '../runner/resource-report.js';
import { scrubSecrets } from '../runner/secret-scrubber.js';
import type { JobKind, StateDb } from '../state-db.js';
import { TICKET_SERVER, TICKET_TOOL_NAMES, type TicketToolName, ticketToolsFor } from './tool-scopes.js';

/** Fields of a report the daemon records itself from the tool log, never from agent input. */
export interface DaemonReportFields {
  skillsUsed: string[];
  skillsMissing: string[];
  mcpsUsed: string[];
  mcpsMissing: string[];
  docsFirst: boolean;
  leftResources: boolean;
}

/** What `handoff_docs` records on the job; the daemon then queues the docs-update job. */
export const DocsHandoff = z.object({
  summaryMd: z.string().trim().min(1).max(50_000),
  files: z.array(z.string().min(1).max(1_000)).max(5_000).default([]),
  tests: z.array(z.string().min(1).max(1_000)).max(1_000).default([]),
  flows: z.array(z.string().min(1).max(200)).max(200).default([]),
});
export type DocsHandoff = z.infer<typeof DocsHandoff>;

/** Why a tool asked the runner to end the run. */
export type EndReason = 'ask_owner' | 'handoff_docs';

export interface TicketToolContext {
  jobId: string;
  ticketId: string;
  role: AgentRole;
  kind: JobKind;
  cwd: string;
  vps: VpsClient;
  state: StateDb;
  /** Absolute crew-docs bundle and runtime, or null when crew-docs is not installed. */
  crewDocs: { bundle: string; runtime: string } | null;
  /** Machine resources, running jobs and the capability inventory for this run's cwd. */
  contextBlock: () => Promise<Record<string, unknown>>;
  inventory: () => SkillInventory;
  reportFields: () => Promise<DaemonReportFields>;
  /** PM only. */
  resources?: {
    report: () => Promise<ResourceReport>;
    cleanup: (items: string[]) => Promise<{ cleaned: string[]; refused: { item: string; reason: string }[] }>;
  };
  /** Ends the run after the current tool result (ask_owner, handoff_docs). */
  requestEnd: (reason: EndReason) => void;
}

type CallToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;

/**
 * A tool definition of any input shape. Each tool's handler arguments are checked where `tool()` builds
 * it; a list of tools with different shapes needs the handler parameter widened, as the SDK's own
 * `createSdkMcpServer` signature does.
 */
export type AnyToolDefinition = Omit<SdkMcpToolDefinition, 'handler'> & {
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous tool input shapes (see above).
  handler: (args: any, extra: unknown) => Promise<CallToolResult>;
};

const text = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

const failure = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

function errorText(error: unknown): string {
  if (error instanceof VpsError)
    return `Lỗi từ server (${error.code}, HTTP ${error.status}): ${error.message}`;
  return `Lỗi: ${(error as Error).message}`;
}

/**
 * Runs daemon writes one at a time per job. Each write uses `<jobId>:<seq>` as its Idempotency-Key, where
 * `seq` is the job's committed write count + 1. The count is committed only after the server answered, so
 * a write whose answer was lost (network, crash) is re-sent with the same key and the server replays it
 * instead of creating a second record. A key the server already used for a different body moves on.
 */
export class JobWriter {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly state: StateDb,
    private readonly jobId: string,
  ) {}

  write<T>(send: (idempotencyKey: string) => Promise<T>): Promise<T> {
    const next = this.chain.then(() => this.writeNow(send));
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async writeNow<T>(send: (idempotencyKey: string) => Promise<T>): Promise<T> {
    let seq = this.state.requireJob(this.jobId).toolSeq + 1;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await send(`${this.jobId}:${seq}`);
        this.state.updateJob(this.jobId, { toolSeq: seq });
        return result;
      } catch (error) {
        if (error instanceof VpsError && error.code === 'IDEMPOTENCY_KEY_REUSED') {
          seq += 1;
          continue;
        }
        // A definitive refusal consumed the key; a transient failure keeps it for the retry.
        if (error instanceof VpsError && !error.transient) this.state.updateJob(this.jobId, { toolSeq: seq });
        throw error;
      }
    }
    throw new Error('no free idempotency key after 5 attempts');
  }
}

const scrub = (body: string) => scrubSecrets(body).text;

const SubtaskShape = {
  type: z.enum(['dev', 'qc', 'docs_init']).describe('Loại subtask'),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(100_000).default(''),
  priority: TicketPriority.optional(),
  complexity: Complexity.optional(),
  model: ModelAlias.optional(),
  effort: Effort.optional(),
  requiredSkills: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  requiredMcps: z.array(McpServerName).max(50).default([]),
  dependsOn: z.array(z.uuid()).max(50).default([]).describe('Id các ticket anh em phải xong trước'),
  pairsWith: z.uuid().optional().describe('Bắt buộc cho qc: ticket dev/bug mà QC kiểm tra'),
  flows: z.array(z.string()).max(100).default([]),
};

const ReportShape = {
  summaryMd: z.string().trim().min(1).max(200_000).describe('Tóm tắt kết quả bằng tiếng Việt (markdown)'),
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
  skillsSelected: z
    .array(z.object({ name: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(500) }))
    .max(100)
    .default([]),
  mcpsSelected: z
    .array(z.object({ server: McpServerName, reason: z.string().trim().min(1).max(500) }))
    .max(100)
    .default([]),
  testsRun: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(500),
        passed: z.boolean(),
        summary: z.string().max(5_000).optional(),
      }),
    )
    .max(1_000)
    .default([]),
  bugsFiled: z.array(z.uuid()).max(100).default([]),
};

/** The role-scoped ticket tools of one run, as SDK tool definitions (also callable directly by tests). */
export function buildTicketTools(ctx: TicketToolContext): AnyToolDefinition[] {
  const writer = new JobWriter(ctx.state, ctx.jobId);
  const allowed = new Set<TicketToolName>(ticketToolsFor(ctx.role, ctx.kind));
  const all: Record<TicketToolName, AnyToolDefinition> = {
    get_ticket: tool(
      'get_ticket',
      'Đọc ticket hiện tại (hoặc ticket khác theo id/key): mô tả, con, bình luận, report, cùng khối ngữ cảnh gồm tài nguyên máy, job đang chạy và toàn bộ skill + MCP server có trong thư mục làm việc này.',
      {
        id: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe('Id hoặc key; mặc định là ticket của lượt chạy'),
      },
      async ({ id }) => {
        const detail = await ctx.vps.getTicket(id ?? ctx.ticketId);
        return text({ ...detail, context: await ctx.contextBlock() });
      },
    ),
    list_children: tool('list_children', 'Liệt kê các ticket con và trạng thái của chúng.', {}, async () => {
      const detail = await ctx.vps.getTicket(ctx.ticketId);
      return text(
        detail.children.map((child) => ({
          id: child.id,
          key: child.key,
          type: child.type,
          title: child.title,
          status: child.status,
          assigneeRole: child.assigneeRole,
          dependsOn: child.dependsOn,
          pairsWith: child.pairsWith,
        })),
      );
    }),
    comment: tool(
      'comment',
      'Viết bình luận (tiếng Việt) vào ticket. Credential bị ẩn tự động.',
      { body: z.string().trim().min(1).max(50_000) },
      async ({ body }) => {
        const comment = await writer.write((key) =>
          ctx.vps.comment(ctx.ticketId, { body: scrub(body), role: ctx.role }, key),
        );
        return text({ commentId: comment.id });
      },
    ),
    ask_owner: tool(
      'ask_owner',
      'Hỏi chủ dự án: đăng câu hỏi, chuyển ticket sang needs_input rồi kết thúc lượt chạy. Câu trả lời sẽ tiếp tục đúng phiên này.',
      { question: z.string().trim().min(1).max(50_000) },
      async ({ question }) => {
        await writer.write((key) =>
          ctx.vps.comment(ctx.ticketId, { body: scrub(question), role: ctx.role }, key),
        );
        const detail = await ctx.vps.getTicket(ctx.ticketId);
        if (detail.ticket.status !== 'needs_input') {
          await writer.write((key) => ctx.vps.transition(ctx.ticketId, 'needs_input', key));
        }
        ctx.state.updateJob(ctx.jobId, { askedOwner: true });
        ctx.requestEnd('ask_owner');
        return text(
          'Đã gửi câu hỏi và chuyển ticket sang needs_input. Dừng lại ngay, không gọi thêm công cụ nào.',
        );
      },
    ),
    update_status: tool(
      'update_status',
      'Chuyển trạng thái ticket (theo luồng hợp lệ; done cần report trước).',
      { to: TicketStatus },
      async ({ to }) => {
        const ticket = await writer.write((key) => ctx.vps.transition(ctx.ticketId, to, key));
        return text({ key: ticket.key, status: ticket.status });
      },
    ),
    submit_report: tool(
      'submit_report',
      'Nộp report của ticket (tiếng Việt). Skill/MCP đã dùng, docs-first và tài nguyên để lại do daemon ghi từ nhật ký công cụ.',
      ReportShape,
      async (input) => {
        const fields = await ctx.reportFields();
        const report = await writer.write((key) =>
          ctx.vps.submitReport(
            ctx.ticketId,
            {
              ...input,
              summaryMd: scrub(input.summaryMd),
              testsRun: input.testsRun.map((test) => ({
                ...test,
                summary: test.summary === undefined ? undefined : scrub(test.summary),
              })),
              ...fields,
              // Cost is booked once per run through agent-meta when the run ends.
              costUsd: 0,
            },
            key,
          ),
        );
        return text({ reportId: report.id, version: report.version });
      },
    ),
    docs_flow: tool(
      'docs_flow',
      'crew-docs flow <id>: liệt kê đúng các file của một flow.',
      { id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/) },
      async ({ id }) => crewDocs(ctx, ['flow', id]),
    ),
    docs_where: tool(
      'docs_where',
      'crew-docs where <file>: flow nào sở hữu file này.',
      { file: z.string().trim().min(1).max(1_000) },
      async ({ file }) => crewDocs(ctx, ['where', file]),
    ),
    create_subtask: tool(
      'create_subtask',
      'PM: tạo subtask dev/qc/docs_init dưới ticket này (mỗi dev có một qc đi kèm qua pairsWith).',
      SubtaskShape,
      async (input) => {
        const body: CreateSubtaskRequest = { ...input, parentId: ctx.ticketId };
        const ticket = await writer.write((key) => ctx.vps.createSubtask(body, key));
        return text({ id: ticket.id, key: ticket.key, status: ticket.status });
      },
    ),
    resource_report: tool(
      'resource_report',
      'PM: tài nguyên máy (CPU, RAM, tải, slot trống, đĩa), job đang chạy, tiến trình được gắn thẻ theo job cùng cổng và RAM, thư mục tạm, worktree, container Docker do job tạo, và các lần dọn gần đây.',
      {},
      async () => {
        if (!ctx.resources) return failure('resource_report chỉ dành cho PM');
        return text(await ctx.resources.report());
      },
    ),
    cleanup_resources: tool(
      'cleanup_resources',
      'PM: dọn các mục mà resource_report vừa liệt kê là có thể dọn (theo id của mục).',
      { items: z.array(z.string().trim().min(1).max(300)).min(1).max(200) },
      async ({ items }) => {
        if (!ctx.resources) return failure('cleanup_resources chỉ dành cho PM');
        return text(await ctx.resources.cleanup(items));
      },
    ),
    file_bug: tool(
      'file_bug',
      'QC: tạo ticket bug cho dev (kèm ticket QC retest), mỗi lỗi một lần gọi.',
      {
        title: z.string().trim().min(1).max(300),
        description: z.string().max(100_000).default(''),
        priority: TicketPriority.optional(),
        requiredSkills: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
        flows: z.array(z.string()).max(100).default([]),
      },
      async (input) => {
        const result = await writer.write((key) =>
          ctx.vps.fileBug(ctx.ticketId, { ...input, description: scrub(input.description) }, key),
        );
        return text({ bug: result.bug.key, bugId: result.bug.id, retest: result.retest.key });
      },
    ),
    handoff_docs: tool(
      'handoff_docs',
      'Dev: kết thúc lượt chạy và bàn giao cho job cập nhật docs (không tự sửa hay commit docs). Ticket vẫn in_progress.',
      DocsHandoff.shape,
      async (input) => {
        const handoff = DocsHandoff.parse({ ...input, summaryMd: scrub(input.summaryMd) });
        ctx.state.updateJob(ctx.jobId, { handoff });
        ctx.requestEnd('handoff_docs');
        return text('Đã ghi bàn giao docs. Dừng lại ngay, không gọi thêm công cụ nào.');
      },
    ),
    get_project_catalog: tool(
      'get_project_catalog',
      'Trợ lý: danh mục project (chỉ mô tả do chủ dự án nhập) để định tuyến yêu cầu.',
      {},
      async () => text(await ctx.vps.catalog()),
    ),
    create_pm_ticket: tool(
      'create_pm_ticket',
      'Trợ lý: tạo ticket pm_task dưới yêu cầu này cho project đã chọn.',
      {
        projectId: z.uuid(),
        title: z.string().trim().min(1).max(300),
        description: z.string().max(100_000).default(''),
        priority: TicketPriority.optional(),
      },
      async (input) => {
        const ticket = await writer.write((key) =>
          ctx.vps.createSubtask({ ...input, type: 'pm_task', parentId: ctx.ticketId }, key),
        );
        return text({ id: ticket.id, key: ticket.key });
      },
    ),
  };
  return TICKET_TOOL_NAMES.filter((name) => allowed.has(name)).map((name) => guarded(all[name]));
}

/** Turns thrown errors into tool errors the agent can read, instead of failing the run. */
function guarded(definition: AnyToolDefinition): AnyToolDefinition {
  return {
    ...definition,
    handler: async (args, extra) => {
      try {
        return await definition.handler(args, extra);
      } catch (error) {
        return failure(errorText(error));
      }
    },
  };
}

function crewDocs(ctx: TicketToolContext, args: string[]): CallToolResult {
  if (!ctx.crewDocs) return failure('crew-docs chưa được cài trên máy này (chạy crewd doctor)');
  const result = runCrewDocs(ctx.crewDocs.bundle, args, ctx.cwd, ctx.crewDocs.runtime);
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
  return result.code === 0
    ? text(output)
    : failure(`crew-docs ${args.join(' ')} (exit ${result.code}):\n${output}`);
}

export function createTicketMcpServer(tools: AnyToolDefinition[]): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: TICKET_SERVER, version: '1.0.0', tools });
}

/**
 * Daemon-internal (never an agent tool): creates the docs-init child of a pm_task, which every other
 * subtask of that pm_task then depends on.
 */
export function createDocsInitTicket(
  vps: VpsClient,
  input: { pmTaskId: string; title: string; description: string },
  idempotencyKey: string,
) {
  return vps.createSubtask(
    {
      type: 'docs_init',
      parentId: input.pmTaskId,
      title: input.title,
      description: input.description,
      model: 'sonnet',
      effort: 'high',
    },
    idempotencyKey,
  );
}
