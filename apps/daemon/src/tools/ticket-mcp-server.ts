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
  type Report,
  type RoleStage,
  type SkillInventory,
  TicketPriority,
  TicketStatus,
  type TicketType,
} from '@crew/shared';
import { z } from 'zod';
import { type VpsClient, VpsError } from '../api/vps-client.js';
import type { ProjectConfig } from '../config.js';
import { runCrewDocs } from '../git/docs-kit-bridge.js';
import { mergeAndPush } from '../roles/merge-policy.js';
import { mergeChoices } from '../roles/skill-enforcement.js';
import { wrapTicketDetail, wrapUntrusted } from '../roles/untrusted-wrap.js';
import type { ResourceReport } from '../runner/resource-report.js';
import { scrubSecrets } from '../runner/secret-scrubber.js';
import { mcpServersUsed } from '../runner/skill-usage.js';
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

/** What a successful `merge_and_push` records on the PM job: the pushed head and the commits it brought in. */
export interface MergeHandoff {
  kind: 'merge';
  head: string;
  commits: string[];
}

/** Why a tool asked the runner to end the run. */
export type EndReason = 'ask_owner' | 'handoff_docs' | 'return_to_dev' | 'blocked';

/** What the docs job's `return_to_dev` records: the commit was refused for a reason outside `docs/`. */
export const ReturnToDev = z.object({
  summaryMd: z.string().trim().min(1).max(20_000),
  output: z.string().trim().min(1).max(50_000),
});

/** The preflight picks a report carries. */
export interface ReportSelections {
  skillsSelected: { name: string; reason: string }[];
  mcpsSelected: { server: string; reason: string }[];
}

/** The parts of the agent's report the daemon checks before storing it. */
export interface ReportDraft extends ReportSelections {
  summaryMd: string;
}

/** What the daemon adds to (or refuses in) a report the agent files. */
export interface ReportOverlay extends ReportSelections {
  fields: DaemonReportFields;
  /** Recorded from the worktree, overriding the agent's values. */
  headSha?: string | null;
  commits?: string[];
  /** Appended to the summary (e.g. the resource cleanup section of the PM report). */
  summaryAppend?: string | null;
  /** The report is refused with this message (e.g. uncommitted changes in the worktree). */
  refusal?: string | null;
  /** Posted as a comment after the report is stored (skills or MCP servers left unused). */
  warning?: string | null;
}

export interface TicketToolContext {
  jobId: string;
  ticketId: string;
  ticketType: TicketType;
  /** MCP servers the ticket requires (QC's UI-test servers must be used before QC closes). */
  requiredMcps?: readonly string[];
  role: AgentRole;
  kind: JobKind;
  stage: RoleStage | null;
  cwd: string;
  vps: VpsClient;
  state: StateDb;
  /** The local project of the ticket, null for assistant runs. */
  project: ProjectConfig | null;
  /** The run's env (job tag, temp dir); daemon-run commands such as the pre-push gate use it too. */
  env: Record<string, string | undefined>;
  /** Absolute crew-docs bundle and runtime, or null when crew-docs is not installed. */
  crewDocs: { bundle: string; runtime: string } | null;
  /** Machine resources, running jobs and the capability inventory for this run's cwd. */
  contextBlock: () => Promise<Record<string, unknown>>;
  inventory: () => SkillInventory;
  reportOverlay: (draft: ReportDraft) => Promise<ReportOverlay>;
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
  if (error instanceof VpsError) {
    // The details (e.g. which field failed validation) let the agent fix its input instead of guessing.
    const details = error.details === undefined ? '' : ` ${JSON.stringify(error.details).slice(0, 2_000)}`;
    return `Lỗi từ server (${error.code}, HTTP ${error.status}): ${error.message}${details}`;
  }
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
  type: z.enum(['dev', 'qc']).describe('Loại subtask (docs_init do daemon tạo)'),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(100_000).default(''),
  priority: TicketPriority.optional(),
  complexity: Complexity.describe(
    'Bắt buộc: độ phức tạp PM đánh giá riêng cho subtask này (dev: việc triển khai; QC: công kiểm thử); model lấy theo bảng của máy',
  ),
  complexityReason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe('Bắt buộc: một dòng lý do cho mức complexity (và cho model nếu bạn tự đặt model)'),
  model: ModelAlias.optional().describe(
    'Chỉ đặt khi cố ý ghi đè bảng complexity, nêu lý do trong complexityReason',
  ),
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

const Selection = {
  skills: z
    .array(z.object({ name: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(500) }))
    .max(100)
    .default([]),
  mcps: z
    .array(z.object({ server: McpServerName, reason: z.string().trim().min(1).max(500) }))
    .max(100)
    .default([]),
  noneReason: z.string().trim().min(1).max(500).optional().describe('Lý do một dòng khi không chọn gì'),
};

/** A dev-stage run writes code only: the docs job files the report and closes the ticket. */
const codeOnlyRun = (ctx: TicketToolContext) => ctx.stage === 'dev';

/** Caps and holds the server answers by parking the pm_task for the owner. */
const OWNER_HOLDS = new Set(['CHILD_CAP_EXCEEDED', 'BUDGET_HOLD', 'BUDGET_EXCEEDED', 'BUG_CYCLE_CAP']);

/** The role-scoped ticket tools of one run, as SDK tool definitions (also callable directly by tests). */
export function buildTicketTools(ctx: TicketToolContext): AnyToolDefinition[] {
  const writer = new JobWriter(ctx.state, ctx.jobId);
  const allowed = new Set<TicketToolName>(ticketToolsFor(ctx.role, ctx.kind));
  const disabledMcps = new Set(ctx.project?.disabledMcpServers ?? []);
  const endForOwner = (why: string) => {
    ctx.state.updateJob(ctx.jobId, { askedOwner: true });
    ctx.requestEnd('ask_owner');
    return text(`${why} Ticket chờ chủ dự án duyệt. Dừng lại ngay, không gọi thêm công cụ nào.`);
  };
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
        const detail = wrapTicketDetail(await ctx.vps.getTicket(id ?? ctx.ticketId));
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
          title: wrapUntrusted(`ticket ${child.key} title`, child.title),
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
        if (codeOnlyRun(ctx) && (to === 'done' || to === 'in_review')) {
          return failure(
            'Dev không đóng ticket: gọi handoff_docs, job docs_update sẽ commit, nộp report và chuyển done.',
          );
        }
        if (ctx.stage === 'qc' && to === 'done') {
          const skipped = unusedUiServers(ctx);
          if (skipped.length > 0) {
            return failure(
              `QC không được bỏ qua kiểm thử UI: chưa gọi công cụ nào của MCP bắt buộc ${skipped.map((s) => `\`${s}\``).join(', ')}. ` +
                'Chạy ứng dụng, kiểm tra các tiêu chí nghiệm thu bằng các công cụ đó, ghi kết quả vào report rồi mới đóng. ' +
                'Nếu server không dùng được, bình luận lý do rồi chuyển ticket sang blocked.',
            );
          }
        }
        if (ctx.role === 'pm' && (to === 'done' || to === 'in_review') && ctx.resources) {
          const orphans = await treeOrphans(ctx);
          if (orphans.length > 0) {
            return failure(
              `Còn tiến trình của cây ticket này: ${orphans.join('; ')}. Gọi cleanup_resources rồi resource_report lại trước khi đóng.`,
            );
          }
        }
        const ticket = await writer.write((key) => ctx.vps.transition(ctx.ticketId, to, key));
        return text({ key: ticket.key, status: ticket.status });
      },
    ),
    submit_report: tool(
      'submit_report',
      'Nộp report của ticket (tiếng Việt). Skill/MCP đã dùng, docs-first, tài nguyên để lại và (với job commit) headSha, commits do daemon ghi.',
      ReportShape,
      async (input) => {
        if (codeOnlyRun(ctx)) {
          return failure(
            'Dev không nộp report: gọi handoff_docs, job docs_update sẽ nộp report sau khi commit.',
          );
        }
        const summary = scrub(input.summaryMd);
        const overlay = await ctx.reportOverlay({
          summaryMd: summary,
          skillsSelected: input.skillsSelected,
          mcpsSelected: input.mcpsSelected,
        });
        if (overlay.refusal) return failure(overlay.refusal);
        const report = await writer.write((key) =>
          ctx.vps.submitReport(
            ctx.ticketId,
            {
              ...input,
              summaryMd: overlay.summaryAppend ? `${summary}\n\n${overlay.summaryAppend}` : summary,
              testsRun: input.testsRun.map((test) => ({
                ...test,
                summary: test.summary === undefined ? undefined : scrub(test.summary),
              })),
              skillsSelected: overlay.skillsSelected,
              mcpsSelected: overlay.mcpsSelected,
              ...overlay.fields,
              ...(overlay.headSha !== undefined ? { headSha: overlay.headSha } : {}),
              ...(overlay.commits !== undefined ? { commits: overlay.commits } : {}),
              // Cost is booked once per run through agent-meta when the run ends.
              costUsd: 0,
            },
            key,
          ),
        );
        if (overlay.warning) {
          const warning = overlay.warning;
          await writer.write((key) => ctx.vps.comment(ctx.ticketId, { body: warning, role: ctx.role }, key));
        }
        return text({
          reportId: report.id,
          version: report.version,
          headSha: report.headSha,
          docsFirst: report.docsFirst,
          skillsMissing: report.skillsMissing,
          mcpsMissing: report.mcpsMissing,
        });
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
      'PM: tạo subtask dev/qc dưới ticket này (mỗi dev có một qc đi kèm qua pairsWith); mỗi subtask bắt buộc có complexity và complexityReason.',
      SubtaskShape,
      async (input) => {
        const off = input.requiredMcps.filter((server) => disabledMcps.has(server));
        if (off.length > 0) {
          return failure(`MCP server đã bị chủ dự án tắt cho dự án này: ${off.join(', ')}. Chọn cái khác.`);
        }
        // Every subtask of a pm_task depends on its docs-init ticket (it runs first).
        const parent = await ctx.vps.getTicket(ctx.ticketId);
        const docsInit = parent.children.find(
          (child) => child.type === 'docs_init' && child.status !== 'cancelled',
        );
        const dependsOn = docsInit ? [...new Set([...input.dependsOn, docsInit.id])] : input.dependsOn;
        const body: CreateSubtaskRequest = {
          ...input,
          description: scrub(input.description),
          dependsOn,
          parentId: ctx.ticketId,
        };
        try {
          const ticket = await writer.write((key) => ctx.vps.createSubtask(body, key));
          return text({
            id: ticket.id,
            key: ticket.key,
            status: ticket.status,
            requiredMcps: ticket.requiredMcps,
          });
        } catch (error) {
          if (error instanceof VpsError && OWNER_HOLDS.has(error.code)) {
            return endForOwner(`Server từ chối tạo subtask (${error.code}): ${error.message}.`);
          }
          throw error;
        }
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
        try {
          const result = await writer.write((key) =>
            ctx.vps.fileBug(ctx.ticketId, { ...input, description: scrub(input.description) }, key),
          );
          return text({ bug: result.bug.key, bugId: result.bug.id, retest: result.retest.key });
        } catch (error) {
          if (error instanceof VpsError && error.code === 'BUG_CYCLE_CAP') {
            return failure(
              `Chuỗi sửa lỗi đã đạt giới hạn 3 vòng (${error.message}); server đã chuyển PM task cho chủ dự án. ` +
                'Ghi lỗi này vào report của bạn rồi kết thúc ticket như bình thường.',
            );
          }
          throw error;
        }
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
        complexity: Complexity.optional().describe(
          'large: việc lớn hoặc ảnh hưởng nhiều phần (PM dùng opus)',
        ),
      },
      async (input) => {
        const ticket = await writer.write((key) =>
          ctx.vps.createSubtask(
            { ...input, description: scrub(input.description), type: 'pm_task', parentId: ctx.ticketId },
            key,
          ),
        );
        return text({ id: ticket.id, key: ticket.key });
      },
    ),
    select_capabilities: tool(
      'select_capabilities',
      'Bước kiểm tra skill/MCP: ghi các skill và MCP server bạn chọn cho bước này, mỗi mục một lý do; không chọn gì thì gửi noneReason.',
      Selection,
      async (input) => {
        const inventory = ctx.inventory();
        const skills = new Set(inventory.skills.map((skill) => skill.name));
        const servers = new Set(
          inventory.mcpServers.map((server) => server.name).filter((name) => !disabledMcps.has(name)),
        );
        const unknownSkills = input.skills
          .map((s) => s.name)
          .filter((name) => !skills.has(name.replace(/^\//, '')));
        const unknownMcps = input.mcps.map((m) => m.server).filter((name) => !servers.has(name));
        if (unknownSkills.length + unknownMcps.length > 0) {
          return failure(
            `Không có trong kho của máy (hoặc đã bị tắt): ${[...unknownSkills, ...unknownMcps].join(', ')}. ` +
              'Chỉ chọn từ context.capabilities của get_ticket.',
          );
        }
        if (input.skills.length + input.mcps.length === 0 && !input.noneReason) {
          return failure('Không chọn skill hay MCP nào thì cần noneReason (một dòng).');
        }
        const job = ctx.state.requireJob(ctx.jobId);
        const merged = mergeChoices([
          job.capabilities,
          { skills: input.skills, mcps: input.mcps, noneReason: input.noneReason ?? null },
        ]);
        ctx.state.updateJob(ctx.jobId, { capabilities: merged });
        return text({
          recorded: merged,
          next: 'Gọi từng skill đã chọn bằng công cụ Skill trước khi làm việc, và dùng công cụ của các MCP server đã chọn.',
        });
      },
    ),
    return_to_dev: tool(
      'return_to_dev',
      'Job docs: commit bị hook từ chối vì lỗi ngoài docs/ (test, R6, R7 trong code): trả việc về cho dev kèm nguyên văn output của hook, rồi kết thúc lượt chạy.',
      ReturnToDev.shape,
      async (input) => {
        const note = ReturnToDev.parse({ summaryMd: scrub(input.summaryMd), output: scrub(input.output) });
        ctx.state.updateJob(ctx.jobId, { returnToDev: note });
        await writer.write((key) =>
          ctx.vps.comment(
            ctx.ticketId,
            {
              role: ctx.role,
              body: `Commit bị hook từ chối vì lỗi ngoài docs, trả việc về cho dev.\n\n${note.summaryMd}\n\n\`\`\`\n${note.output.slice(0, 8_000)}\n\`\`\``,
            },
            key,
          ),
        );
        ctx.requestEnd('return_to_dev');
        return text('Đã trả việc về cho dev. Dừng lại ngay, không gọi thêm công cụ nào.');
      },
    ),
    reject_work: tool(
      'reject_work',
      'PM: từ chối một ticket dev/bug đã xong (thiếu skill, docs_first=false, sai tiêu chí): tạo ticket bug cho dev kèm QC kiểm thử lại.',
      {
        ticketId: z.uuid().describe('Id ticket dev hoặc bug bị từ chối'),
        title: z.string().trim().min(1).max(300),
        description: z.string().max(100_000).default(''),
        priority: TicketPriority.optional(),
        requiredSkills: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
      },
      async ({ ticketId, ...input }) => {
        const pm = await ctx.vps.getTicket(ctx.ticketId);
        const target = pm.children.find((child) => child.id === ticketId);
        if (!target || (target.type !== 'dev' && target.type !== 'bug')) {
          return failure('Chỉ từ chối được ticket dev hoặc bug là con của PM task này.');
        }
        const result = await writer.write((key) =>
          ctx.vps.fileBug(ticketId, { ...input, description: scrub(input.description) }, key),
        );
        return text({ bug: result.bug.key, bugId: result.bug.id, retest: result.retest.key });
      },
    ),
    merge_and_push: tool(
      'merge_and_push',
      'PM nghiệm thu: merge head_sha của mọi ticket dev/bug/docs-init đã xong vào crew/<pm-key> theo thứ tự phụ thuộc, crew-docs generate và commit, chạy cổng pre-push (test, crew-docs check --range, đường dẫn được bảo vệ), push lên nhánh mặc định và đồng bộ docs.',
      {
        acceptedExceptions: z
          .array(z.object({ ticketId: z.uuid(), reason: z.string().trim().min(1).max(500) }))
          .max(50)
          .default([])
          .describe('Ticket thiếu skill mà PM chấp nhận lời giải thích của dev'),
      },
      async ({ acceptedExceptions }) => {
        const project = ctx.project;
        if (!project) return failure('Ticket này không thuộc dự án nào trên máy này.');
        const pm = await ctx.vps.getTicket(ctx.ticketId);
        const reports = new Map<string, Report>();
        for (const child of pm.children) {
          if (!['dev', 'bug', 'docs_init'].includes(child.type) || child.status !== 'done') continue;
          const report = (await ctx.vps.getTicket(child.id)).report;
          if (report) reports.set(child.id, report);
        }
        const outcome = await mergeAndPush({
          cwd: ctx.cwd,
          project,
          pmKey: pm.ticket.key,
          children: pm.children,
          reports,
          exceptions: acceptedExceptions,
          crewDocs: ctx.crewDocs,
          env: ctx.env as NodeJS.ProcessEnv,
          syncDocs: async (snapshot) => {
            await writer.write((key) => ctx.vps.syncDocs(project.key, snapshot, key));
          },
        });
        if (outcome.status === 'gate_failed') {
          await writer.write((key) =>
            ctx.vps.comment(
              ctx.ticketId,
              {
                role: ctx.role,
                body: `Cổng pre-push thất bại, không push. Ticket chuyển sang blocked cho chủ dự án.\n\n${scrub(outcome.output)}`,
              },
              key,
            ),
          );
          const fresh = await ctx.vps.getTicket(ctx.ticketId);
          if (fresh.ticket.status === 'in_progress') {
            await writer.write((key) => ctx.vps.transition(ctx.ticketId, 'blocked', key));
          }
          ctx.requestEnd('blocked');
          return text({ ...outcome, next: 'Ticket đã bị chặn. Dừng lại ngay.' });
        }
        if (outcome.status === 'merged') {
          // The PM report carries what was pushed; the daemon fills it from here (see the report overlay).
          const merged: MergeHandoff = { kind: 'merge', head: outcome.head, commits: outcome.commits };
          ctx.state.updateJob(ctx.jobId, { handoff: merged });
        }
        return text(outcome);
      },
    ),
  };
  return TICKET_TOOL_NAMES.filter((name) => allowed.has(name)).map((name) => guarded(all[name]));
}

/** Required MCP servers of a QC ticket that none of its runs has called a tool of. */
function unusedUiServers(ctx: TicketToolContext): string[] {
  const ticket = ctx.state.jobsForTicket(ctx.ticketId);
  const log = ticket.flatMap((job) => ctx.state.toolLog(job.id));
  const required = ctx.requiredMcps ?? [];
  const used = new Set(mcpServersUsed(log, required));
  return required.filter((server) => !used.has(server));
}

/** Live processes of this pm_task's children (the PM must clean them before closing). */
async function treeOrphans(ctx: TicketToolContext): Promise<string[]> {
  if (!ctx.resources) return [];
  const detail = await ctx.vps.getTicket(ctx.ticketId);
  const keys = new Map(detail.children.map((child) => [child.id, child.key]));
  const report = await ctx.resources.report();
  return report.processes
    .filter((proc) => proc.ticketId !== null && keys.has(proc.ticketId))
    .map(
      (proc) =>
        `${keys.get(proc.ticketId as string)}: pid ${proc.pid}${proc.ports.length ? ` cổng ${proc.ports.join(',')}` : ''}`,
    );
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
