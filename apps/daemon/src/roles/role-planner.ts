import { spawnSync } from 'node:child_process';
import type { RoleStage, SkillInventory, Ticket, TicketDetailResponse, TicketStatus } from '@crew/shared';
import type { DaemonConfig, ProjectConfig } from '../config.js';
import { docsSnapshot } from '../git/docs-kit-bridge.js';
import type { AgentRunResult } from '../runner/agent-runner.js';
import {
  type AfterRunDecision,
  type AfterRunInput,
  type PlanInput,
  type PlannedRun,
  type PlannerContext,
  type PrepareInput,
  type PrepareResult,
  type ReportOverlayInput,
  type RolePlanner,
  restartNote,
} from '../runner/job-runner.js';
import type { JobKind, JobRow, StateDb, ToolLogEntry } from '../state-db.js';
import type { DocsHandoff, MergeHandoff, ReportOverlay } from '../tools/ticket-mcp-server.js';
import { docsFirst } from './docs-first-check.js';
import { docsInitGate } from './docs-init-gate.js';
import { afterDevRun, afterDocsRun } from './docs-update-handoff.js';
import { decideFailure, type FailureReason } from './failure-policy.js';
import { resolveModel } from './model-policy.js';
import { renderPrompt } from './prompt-templates.js';
import { isTerminal, resolveStage, STAGES } from './role-registry.js';
import { capabilityGaps, capabilityUse, capabilityWarning, mergeChoices } from './skill-enforcement.js';
import { ownerWroteTicketText, wrapUntrusted } from './untrusted-wrap.js';
import { baseHeadsFor, installHooksForInit, mergeBaseHeads } from './workspace-prep.js';

/** A ticket in these statuses waits for the owner: a job woken for it does nothing until they act. */
const WAITING_FOR_OWNER = new Set<TicketStatus>(['needs_input', 'blocked', 'in_review']);

const TRIGGER_TEXT: Record<string, string> = {
  'ticket.assigned': 'ticket vừa được giao cho bạn',
  'ticket.comment_added': 'chủ dự án vừa bình luận (đọc bình luận mới nhất trong get_ticket)',
  'children.all_done': 'mọi ticket con đã kết thúc',
  'ticket.reopened': 'chủ dự án mở lại ticket (đọc bình luận mới nhất)',
  'ticket.unblocked': 'chủ dự án mở chặn ticket (đọc bình luận mới nhất)',
  'dependency.resolved': 'ticket bạn phụ thuộc đã xong',
  handoff: 'dev vừa bàn giao thay đổi code cho job docs',
  wakeup: 'có sự kiện mới trong lúc lượt trước đang chạy',
  'child.resources': 'một subtask vừa kết thúc và daemon đã phải dọn tài nguyên nó để lại',
};

const RETRY_TEXT: Record<FailureReason, string> = {
  runner_error:
    'Lượt trước gặp lỗi. Kiểm tra lại trạng thái (`git status`, `get_ticket`) rồi làm tiếp từ chỗ dừng.',
  budget: 'Lượt trước chạm giới hạn chi phí.',
  no_handoff:
    'Lượt trước kết thúc mà **không gọi `handoff_docs`**. Kiểm tra `git status`, hoàn tất phần còn lại rồi kết thúc bằng `handoff_docs`.',
  docs_rejected:
    'Job docs không commit được vì hook từ chối lỗi trong code/test của bạn (output bên dưới). Sửa đúng lỗi đó, chạy lại test, rồi `handoff_docs` lần nữa.',
  not_finished:
    'Lượt trước kết thúc khi ticket chưa `done`. Kiểm tra lại trạng thái rồi hoàn tất đúng các bước (commit, report, `update_status`).',
};

const skipRun = (
  stage: RoleStage,
  reason: string,
  status: 'skipped' | 'blocked' = 'skipped',
): PlannedRun => ({
  prompt: '',
  model: 'sonnet',
  effort: 'low',
  resumeSessionId: null,
  stage,
  skip: { reason, status },
});

function gitOut(cwd: string, args: readonly string[]): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Title and description as the agent sees them: wrapped unless the owner wrote them. */
function ticketText(ticket: Ticket): { title: string; description: string } {
  if (ownerWroteTicketText(ticket)) {
    return { title: ticket.title, description: ticket.description.trim() || '(không có mô tả)' };
  }
  return {
    title: wrapUntrusted(`ticket ${ticket.key} title`, ticket.title),
    description: wrapUntrusted(
      `ticket ${ticket.key} description`,
      ticket.description.trim() || '(không có mô tả)',
    ),
  };
}

function triggerText(trigger: string): string {
  if (trigger.startsWith('retry:')) return 'daemon chạy lại sau một lần thử không thành';
  return TRIGGER_TEXT[trigger] ?? trigger;
}

function header(stage: RoleStage, ticket: Ticket, project: ProjectConfig | null, job: JobRow): string {
  const text = ticketText(ticket);
  return [
    `# ${STAGES[stage].label} — ${ticket.key}`,
    '',
    `- Ticket: **${ticket.key}** (loại \`${ticket.type}\`, trạng thái \`${ticket.status}\`, ưu tiên \`${ticket.priority}\`)`,
    `- Dự án: ${project?.key ?? '(chưa gắn dự án)'}`,
    `- Lý do lượt chạy: ${triggerText(job.trigger)}${job.eventIds.length > 1 ? ` (${job.eventIds.length} sự kiện)` : ''}`,
    `- Tiêu đề: ${text.title}`,
    '',
    '## Mô tả ticket',
    '',
    text.description,
  ].join('\n');
}

function requiredText(ticket: Ticket): string {
  const skills = ticket.requiredSkills.map((s) => `skill \`${s}\``);
  const mcps = ticket.requiredMcps.map((m) => `MCP \`${m}\``);
  return [...skills, ...mcps].join(', ') || 'không có';
}

function complexityText(config: DaemonConfig): string {
  const map = config.models.complexityMap;
  return [
    ...(['trivial', 'small', 'medium', 'large'] as const).map(
      (level) => `\`${level}\` → ${map[level].model}/${map[level].effort}`,
    ),
    `model được phép: ${config.models.allow.join(', ')}`,
  ].join('; ');
}

function uiTestText(ticket: Ticket): string {
  const lines: string[] = [];
  for (const server of ticket.requiredMcps) {
    if (/maestro/i.test(server)) {
      lines.push(
        `\`${server}\` (Maestro): chạy app trên simulator/emulator, viết và chạy Maestro flow cho từng tiêu chí nghiệm thu.`,
      );
    } else if (/playwright/i.test(server)) {
      lines.push(
        `\`${server}\` (Playwright): mở ứng dụng trong trình duyệt và kiểm tra từng tiêu chí nghiệm thu.`,
      );
    } else {
      lines.push(`\`${server}\`: dùng công cụ của server này cho các tiêu chí liên quan.`);
    }
  }
  return lines.length > 0
    ? `\n   - ${lines.join('\n   - ')}\n   Ghi lại flow hoặc script đã chạy và kết quả của chúng trong report.`
    : 'ticket không yêu cầu MCP kiểm thử UI (dự án backend hoặc thư viện).';
}

function formatHandoff(handoff: unknown): string {
  if (!handoff || typeof handoff !== 'object') return '(không tìm thấy bàn giao của dev; đọc `git diff`)';
  const h = handoff as DocsHandoff;
  const body = [
    h.summaryMd,
    '',
    `File: ${h.files.join(', ') || '(không ghi)'}`,
    `Test: ${h.tests.join('; ') || '(không ghi)'}`,
    `Flow: ${h.flows.join(', ') || '(không ghi)'}`,
  ].join('\n');
  return wrapUntrusted('handoff của dev', body);
}

/** Cleanup records of the jobs of a pm_task's children, one line per job that left something. */
export function cleanupLines(state: StateDb, children: readonly Ticket[]): string[] {
  const lines: string[] = [];
  for (const child of children) {
    for (const job of state.jobsForTicket(child.id)) {
      for (const record of state.cleanups({ jobId: job.id })) {
        if (
          record.pids.length + record.ports.length + record.containers.length === 0 &&
          record.bytesFreed < 1024
        ) {
          continue;
        }
        const parts = [
          record.pids.length > 0
            ? `dừng ${record.pids.length} tiến trình (pid ${record.pids.join(', ')})`
            : null,
          record.ports.length > 0 ? `giải phóng cổng ${record.ports.join(', ')}` : null,
          record.bytesFreed > 0 ? `xoá ${Math.ceil(record.bytesFreed / 1024)} KB file tạm` : null,
          record.containers.length > 0 ? `container còn lại: ${record.containers.join(', ')}` : null,
        ].filter(Boolean);
        lines.push(
          `- ${child.key} (job ${job.id.slice(0, 8)}, ${job.stage ?? job.kind}): ${parts.join('; ')}`,
        );
      }
    }
  }
  return lines;
}

/**
 * The owner's own request above a pm_task, verbatim: the owner wrote it, so it is the authoritative
 * requirement (the pm_task description is the assistant's summary and is wrapped as untrusted).
 */
async function ownerRequest(ctx: PlannerContext, requestId: string): Promise<string> {
  const request = await ctx.vps.getTicket(requestId);
  const owner = request.comments.filter((comment) => comment.authorKind === 'owner');
  return [
    `## Yêu cầu gốc của chủ dự án (${request.ticket.key}, do chủ dự án viết)`,
    '',
    `**${request.ticket.title}**`,
    '',
    request.ticket.description.trim() || '(không có mô tả)',
    ...(owner.length > 0
      ? ['', 'Bình luận của chủ dự án:', ...owner.map((comment) => `- ${comment.body}`)]
      : []),
  ].join('\n');
}

/** Session to resume: the job's own, else the ticket's latest of the same kind; docs jobs start fresh. */
function resumeSession(job: JobRow, kind: JobKind, state: StateDb, ticketId: string): string | null {
  if (job.resumeMode === 'restart_fresh') return null;
  if (job.sessionId) return job.sessionId;
  if (kind === 'docs_update' || job.trigger === 'ticket.assigned') return null;
  return state.latestSession(ticketId, kind === 'docs_init' ? 'docs_init' : 'agent');
}

/** Required MCP servers of a QC ticket that are not connected (or are switched off) on this machine. */
export function missingUiServers(
  ticket: Pick<Ticket, 'requiredMcps'>,
  inventory: SkillInventory,
  project: Pick<ProjectConfig, 'disabledMcpServers'> | null,
): { server: string; status: string }[] {
  const disabled = new Set(project?.disabledMcpServers ?? []);
  return ticket.requiredMcps.flatMap((server) => {
    if (disabled.has(server)) return [{ server, status: 'đã bị tắt cho dự án' }];
    const found = inventory.mcpServers.find((entry) => entry.name === server);
    if (!found) return [{ server, status: 'không có trên máy' }];
    return found.status === 'connected' ? [] : [{ server, status: found.status }];
  });
}

async function blockQc(ctx: PlannerContext, ticket: Ticket, missing: { server: string; status: string }[]) {
  const list = missing.map((m) => `\`${m.server}\` (${m.status})`).join(', ');
  await ctx.writer.write((key) =>
    ctx.vps.comment(
      ticket.id,
      {
        role: 'qc',
        body:
          `QC không chạy được: MCP server kiểm thử UI bắt buộc chưa kết nối trên máy này: ${list}. ` +
          'Mở 2P Crew → Sức khỏe (hoặc `crewd doctor`) để sửa kết nối, rồi mở chặn ticket. ' +
          'QC không bỏ qua kiểm thử UI.',
      },
      key,
    ),
  );
  let status = ticket.status;
  if (status === 'todo')
    status = (await ctx.writer.write((key) => ctx.vps.transition(ticket.id, 'in_progress', key))).status;
  if (status === 'in_progress')
    await ctx.writer.write((key) => ctx.vps.transition(ticket.id, 'blocked', key));
}

async function reportOf(ctx: PlannerContext, ticketId: string) {
  return (await ctx.vps.getTicket(ticketId)).report;
}

/** Heads of finished siblings, for the tickets a dev or bug worktree builds on. */
async function siblingHeads(ctx: PlannerContext, siblings: readonly Ticket[]): Promise<Map<string, string>> {
  const heads = new Map<string, string>();
  for (const sibling of siblings) {
    if (sibling.status !== 'done' || !['dev', 'bug', 'docs_init'].includes(sibling.type)) continue;
    const report = await reportOf(ctx, sibling.id);
    if (report?.headSha) heads.set(sibling.id, report.headSha);
  }
  return heads;
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

async function plan(input: PlanInput): Promise<PlannedRun> {
  const { job, kind, detail, config, project, inventory, ctx } = input;
  const { ticket } = detail;
  const stage = resolveStage({ job, kind, detail, state: ctx.state });

  if (WAITING_FOR_OWNER.has(ticket.status)) {
    return skipRun(stage, `ticket đang ${ticket.status}: chờ chủ dự án`);
  }
  if (stage === 'pm_analyze' && project) {
    const gate = await docsInitGate({
      pm: detail,
      project,
      crewDocs: ctx.crewDocs,
      vps: ctx.vps,
      writer: ctx.writer,
    });
    if (gate.action === 'wait') return skipRun(stage, `chờ docs-init ${gate.docsInit.key}`);
  }
  if (stage === 'qc') {
    const missing = missingUiServers(ticket, inventory, project);
    if (missing.length > 0) {
      await blockQc(ctx, ticket, missing);
      return skipRun(
        stage,
        `MCP bắt buộc chưa kết nối: ${missing.map((m) => m.server).join(', ')}`,
        'blocked',
      );
    }
  }

  const choice = resolveModel({ config, stage, ticket });
  const vars = await promptVars({ stage, job, kind, detail, config, project, ctx });
  const prompt = renderPrompt(STAGES[stage].prompt, vars);
  let worktreeBase: string | undefined = project?.defaultBranch;
  if (ticket.type === 'bug' && ticket.parentId) {
    const siblings = (await ctx.vps.getTicket(ticket.parentId)).children;
    const heads = baseHeadsFor({ ticket, siblings, headOf: await siblingHeads(ctx, siblings) });
    worktreeBase = heads.at(-1)?.sha ?? worktreeBase;
  }
  return {
    prompt,
    model: choice.model,
    effort: choice.effort,
    resumeSessionId: resumeSession(job, kind, ctx.state, ticket.id),
    ...(worktreeBase ? { worktreeBase } : {}),
    stage,
    notices: choice.notice ? [choice.notice] : [],
  };
}

async function promptVars(input: {
  stage: RoleStage;
  job: JobRow;
  kind: JobKind;
  detail: TicketDetailResponse;
  config: DaemonConfig;
  project: ProjectConfig | null;
  ctx: PlannerContext;
}): Promise<Record<string, string>> {
  const { stage, job, detail, config, project, ctx } = input;
  const { ticket } = detail;
  const notes: string[] = [];
  const restart = restartNote(job, detail);
  if (restart) notes.push(`## Khởi động lại\n\n${restart}`);
  if (job.trigger.startsWith('retry:')) {
    const reason = job.trigger.slice('retry:'.length) as FailureReason;
    notes.push(`## Lần thử ${job.failedAttempts + 1}\n\n${RETRY_TEXT[reason] ?? RETRY_TEXT.runner_error}`);
    if (reason === 'docs_rejected') {
      const rejected = ctx.state
        .jobsForTicket(ticket.id)
        .filter((other) => other.kind === 'docs_update' && other.returnToDev)
        .at(-1)?.returnToDev;
      if (rejected) {
        notes.push(
          wrapUntrusted('output hook của commit bị từ chối', `${rejected.summaryMd}\n\n${rejected.output}`),
        );
      }
    }
  }

  const vars: Record<string, string> = {
    header: header(stage, ticket, project, job),
    stage_label: STAGES[stage].label,
    required_capabilities: requiredText(ticket),
    project_key: project?.key ?? '(chưa chọn)',
    ticket_key: ticket.key,
    default_branch: project?.defaultBranch ?? 'main',
    complexity_map: complexityText(config),
    flows: ticket.flows.map((flow) => `\`${flow}\``).join(', ') || '(chưa ghi flow; dùng `docs_where`)',
    test_command: project?.testCommand
      ? `\`${project.testCommand}\``
      : 'lệnh test của repo (xem `AGENTS.md`)',
    close_status: config.autoCloseRequests ? 'done' : 'in_review',
    standard: ctx.standardPath
      ? `\`${ctx.standardPath}\` (đọc hết trước khi viết).`
      : 'chạy `crew-docs init` và làm đúng checklist nó in ra.',
    hooks_note: 'daemon cài hook và chép file hook vào worktree trước lượt chạy, xem ghi chú cuối',
    review_base: project?.defaultBranch ?? 'main',
    ui_test: uiTestText(ticket),
    handoff: '',
    paired_head: '(chưa có)',
    paired_key: '(chưa có)',
    cleanup_notes: '',
    notes: '',
  };

  if (stage === 'docs_update') {
    const dev = ctx.state
      .jobsForTicket(ticket.id)
      .filter((other) => other.kind === 'agent' && other.handoff)
      .at(-1);
    vars.handoff = formatHandoff(dev?.handoff);
  }
  if (stage === 'qc' && ticket.pairsWith) {
    const paired = await ctx.vps.getTicket(ticket.pairsWith);
    vars.paired_key = paired.ticket.key;
    vars.paired_head = paired.report?.headSha ?? '(dev chưa có head_sha)';
  }
  if (stage === 'pm_monitor' || stage === 'pm_accept') {
    const lines = cleanupLines(ctx.state, detail.children);
    vars.cleanup_notes = lines.length > 0 ? lines.join('\n') : '- chưa ghi nhận tài nguyên nào bị để lại';
  }
  if (stage.startsWith('pm_') && ticket.parentId) {
    vars.header = `${vars.header}\n\n${await ownerRequest(ctx, ticket.parentId)}`;
  }
  if (stage === 'pm_analyze') {
    const docsInit = detail.children.find((child) => child.type === 'docs_init' && child.status === 'done');
    if (docsInit) {
      notes.push(
        `## Docs vừa được khởi tạo\n\nTicket ${docsInit.key} đã viết docs; worktree của bạn có sẵn commit đó. Mọi subtask bạn tạo tự phụ thuộc vào ${docsInit.key}.`,
      );
    }
  }
  vars.notes = notes.join('\n\n');
  return vars;
}

// ---------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------

async function prepare(input: PrepareInput): Promise<PrepareResult> {
  const { stage, detail, project, cwd, ctx } = input;
  if (!project || !stage) return {};
  const { ticket } = detail;
  if (stage === 'docs_init') {
    return {
      note: `## Hook git\n\n${installHooksForInit({ repo: project.repoPath, cwd, crewDocs: ctx.crewDocs })}`,
    };
  }
  if (stage === 'dev' && ticket.parentId) {
    const siblings = (await ctx.vps.getTicket(ticket.parentId)).children;
    const heads = baseHeadsFor({ ticket, siblings, headOf: await siblingHeads(ctx, siblings) });
    const { merged, note } = mergeBaseHeads(cwd, heads);
    if (merged.length > 0)
      ctx.log('info', 'merged base heads into the worktree', { ticket: ticket.key, merged });
    return note ? { note } : {};
  }
  if (stage.startsWith('pm_')) {
    const docsInit = detail.children.find((child) => child.type === 'docs_init' && child.status === 'done');
    const sha = docsInit ? (await reportOf(ctx, docsInit.id))?.headSha : null;
    if (docsInit && sha) {
      const { note } = mergeBaseHeads(cwd, [{ key: docsInit.key, sha }]);
      return note ? { note } : {};
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// report overlay
// ---------------------------------------------------------------------------

/** Jobs of the ticket whose cleanup found processes or ports left behind. */
function leftBehindCount(state: StateDb, jobs: readonly JobRow[], currentJobId: string): number {
  return jobs.filter(
    (job) =>
      job.id !== currentJobId &&
      state.cleanups({ jobId: job.id }).some((record) => record.pids.length + record.ports.length > 0),
  ).length;
}

async function reportOverlay(input: ReportOverlayInput): Promise<ReportOverlay> {
  const { job, kind, ticket, inventory, project, cwd, draft, liveProcesses, ctx } = input;
  const { state } = ctx;
  const knownSkills = new Set(inventory.skills.map((skill) => skill.name));
  const disabled = new Set(project?.disabledMcpServers ?? []);
  const knownMcps = new Set(
    inventory.mcpServers.map((server) => server.name).filter((name) => !disabled.has(name)),
  );
  const unknown = [
    ...draft.skillsSelected.map((s) => s.name).filter((name) => !knownSkills.has(name.replace(/^\//, ''))),
    ...draft.mcpsSelected.map((m) => m.server).filter((name) => !knownMcps.has(name)),
  ];
  const jobs = state.jobsForTicket(ticket.id);
  const logs: ToolLogEntry[] = jobs.flatMap((other) => state.toolLog(other.id));
  const use = capabilityUse(
    logs,
    jobs.flatMap((other) => other.skillsInvoked),
    [...new Set([...inventory.mcpServers.map((server) => server.name), ...ticket.requiredMcps])],
  );
  const selected = mergeChoices([
    { skills: draft.skillsSelected, mcps: draft.mcpsSelected, noneReason: null },
    ...jobs.map((other) => other.capabilities),
  ]);
  const required = { skills: ticket.requiredSkills, mcps: ticket.requiredMcps };
  // Required skills belong to the ticket's work: on a dev ticket only the dev runs count, not the docs job.
  const workJobs = kind === 'docs_update' ? jobs.filter((other) => other.kind === 'agent') : jobs;
  const workUse = capabilityUse(
    workJobs.flatMap((other) => state.toolLog(other.id)),
    workJobs.flatMap((other) => other.skillsInvoked),
    [...new Set([...inventory.mcpServers.map((server) => server.name), ...ticket.requiredMcps])],
  );
  const none = { skills: [], mcps: [], noneReason: null };
  const missingRequired = capabilityGaps({ required, selected: none, used: workUse });
  const missingSelected = capabilityGaps({ required: { skills: [], mcps: [] }, selected, used: use });
  const gaps = {
    skillsMissing: [...new Set([...missingRequired.skillsMissing, ...missingSelected.skillsMissing])],
    mcpsMissing: [...new Set([...missingRequired.mcpsMissing, ...missingSelected.mcpsMissing])],
  };
  const overlay: ReportOverlay = {
    fields: {
      skillsUsed: use.skillsUsed,
      skillsMissing: gaps.skillsMissing,
      mcpsUsed: use.mcpsUsed,
      mcpsMissing: gaps.mcpsMissing,
      docsFirst: docsFirst(logs, cwd),
      leftResources: leftBehindCount(state, jobs, job.id) + (liveProcesses > 0 ? 1 : 0) >= 2,
    },
    skillsSelected: selected.skills,
    mcpsSelected: selected.mcps,
    warning: capabilityWarning({ gaps, preflightDone: jobs.some((other) => other.capabilities), required }),
  };

  if (unknown.length > 0) {
    return {
      ...overlay,
      refusal:
        `Không có trong kho skill/MCP của lượt chạy này (hoặc đã bị tắt): ${unknown.join(', ')}. ` +
        'skillsSelected và mcpsSelected chỉ ghi những gì bạn thật sự có trong context.capabilities.',
    };
  }
  if ((kind === 'docs_update' || kind === 'docs_init') && project) {
    const dirty = gitOut(cwd, ['status', '--porcelain']);
    if (dirty) {
      return {
        ...overlay,
        refusal: `Worktree còn thay đổi chưa commit, chưa nộp report được:\n${dirty.slice(0, 2_000)}\nCommit qua hook (git add -A && git commit) trước.`,
      };
    }
    const head = gitOut(cwd, ['rev-parse', 'HEAD']);
    const base = gitOut(cwd, ['merge-base', 'HEAD', project.defaultBranch]);
    overlay.headSha = head;
    overlay.commits =
      head && base
        ? (gitOut(cwd, ['rev-list', '--max-count=1000', `${base}..HEAD`]) ?? '').split('\n').filter(Boolean)
        : [];
  }

  const merge = job.handoff as MergeHandoff | null;
  if (job.stage === 'pm_accept' && merge?.kind === 'merge') {
    overlay.headSha = merge.head;
    overlay.commits = merge.commits.slice(0, 1_000);
  }
  if (job.stage === 'pm_accept' && !/^##\s*Dọn dẹp tài nguyên/m.test(draft.summaryMd)) {
    const children = (await ctx.vps.getTicket(ticket.id)).children;
    const lines = cleanupLines(state, children);
    overlay.summaryAppend = [
      '## Dọn dẹp tài nguyên',
      '',
      '(daemon ghi từ nhật ký dọn dẹp)',
      ...(lines.length > 0 ? lines : ['- Không subtask nào để lại tiến trình, cổng hay file tạm đáng kể.']),
      '- Worktree của ticket đã xong được gỡ khi ticket đóng.',
    ].join('\n');
  }
  return overlay;
}

// ---------------------------------------------------------------------------
// after run
// ---------------------------------------------------------------------------

function failureDecision(input: {
  job: JobRow;
  reason: FailureReason;
  result: AgentRunResult;
  state: StateDb;
  ticketId: string;
}): AfterRunDecision {
  const { job, reason, result, state, ticketId } = input;
  const decision = decideFailure({
    job,
    reason,
    costUsd: result.totalCostUsd,
    devSessionId: state.latestSession(ticketId, 'agent'),
  });
  if (decision.action === 'retry') {
    return { followUp: decision.followUp, comments: [decision.comment], error: reason, status: 'failed' };
  }
  return { block: true, comments: [decision.comment], error: reason, status: 'failed' };
}

const filedReport = (log: readonly ToolLogEntry[]) =>
  log.some((entry) => entry.tool === 'mcp__tickets__submit_report' && entry.decision === 'allow');

async function afterRun(input: AfterRunInput): Promise<AfterRunDecision> {
  const { job, ticket, result, toolLog, ctx } = input;
  if (!ctx) return {};
  const stage = job.stage;
  const comments: string[] = [];
  const with_ = (decision: AfterRunDecision): AfterRunDecision => ({
    ...decision,
    comments: [...comments, ...(decision.comments ?? [])],
  });

  // Capability warnings for runs that filed no report (a report carries its own warning).
  const handedOff = result.endedBy === 'handoff_docs';
  if (!result.isError && !filedReport(toolLog) && !handedOff && input.inventory) {
    const doesTicketWork = stage === 'dev' || stage === 'qc' || stage === 'docs_init';
    const required = doesTicketWork
      ? { skills: ticket.requiredSkills, mcps: ticket.requiredMcps }
      : { skills: [], mcps: [] };
    const selected = mergeChoices([job.capabilities]);
    const use = capabilityUse(toolLog, result.slashCommands, [
      ...new Set([...input.inventory.mcpServers.map((server) => server.name), ...ticket.requiredMcps]),
    ]);
    // The preflight belongs to the session: a run that resumes it (an owner answer) already has one.
    const sessionPreflight = ctx.state
      .jobsForTicket(ticket.id)
      .some(
        (other) =>
          other.capabilities !== null &&
          (other.id === job.id || (job.sessionId !== null && other.sessionId === job.sessionId)),
      );
    const warning = capabilityWarning({
      gaps: capabilityGaps({ required, selected, used: use }),
      preflightDone: sessionPreflight,
      required,
    });
    if (warning && !job.askedOwner) comments.push(warning);
  }

  const failed = (reason: FailureReason) =>
    with_(failureDecision({ job, reason, result, state: ctx.state, ticketId: ticket.id }));
  const budgetHit = result.resultSubtype === 'error_max_budget_usd';
  if (result.isError) return failed(budgetHit ? 'budget' : 'runner_error');

  switch (stage) {
    case 'dev': {
      const verdict = afterDevRun({ job, result });
      if (verdict.kind === 'next') return with_({ followUp: verdict.followUp });
      if (verdict.kind === 'failed') return failed(verdict.reason);
      return with_({});
    }
    case 'docs_update': {
      const status = (await ctx.vps.getTicket(ticket.id)).ticket.status;
      const verdict = afterDocsRun({ job, result, ticketStatus: status });
      if (verdict.kind === 'failed') return failed(verdict.reason);
      return with_({});
    }
    case 'qc':
    case 'docs_init': {
      if (job.askedOwner) return with_({});
      const detail = await ctx.vps.getTicket(ticket.id);
      if (!isTerminal(detail.ticket) && detail.ticket.status !== 'blocked') return failed('not_finished');
      if (
        stage === 'docs_init' &&
        detail.ticket.status === 'done' &&
        detail.report?.headSha &&
        input.project
      ) {
        await syncInitDocs(ctx, input.project, detail.report.headSha);
      }
      return with_({});
    }
    case 'pm_accept':
      return with_(result.endedBy === 'blocked' ? { status: 'blocked', error: 'pre-push gate failed' } : {});
    default:
      return with_({});
  }
}

/** Shows the fresh docs on the web right after docs-init (the default branch gets them at PM accept). */
async function syncInitDocs(ctx: PlannerContext, project: ProjectConfig, head: string): Promise<void> {
  try {
    const snapshot = { ...docsSnapshot(project.repoPath, head), branch: project.defaultBranch };
    await ctx.writer.write((key) => ctx.vps.syncDocs(project.key, snapshot, key));
  } catch (error) {
    ctx.log('warn', 'docs sync after docs-init failed', { error: (error as Error).message });
  }
}

/** The role workflow: per-stage prompts, gates, model policy, report checks and follow-ups. */
export const rolePlanner: RolePlanner = { plan, prepare, reportOverlay, afterRun };
