import { mkdirSync } from 'node:fs';
import {
  type AgentRole,
  type Complexity,
  canTransition,
  type Effort,
  type ModelAlias,
  type RoleStage,
  type SelectableModel,
  type SkillInventory,
  type Ticket,
  type TicketDetailResponse,
} from '@crew/shared';
import type { VpsClient } from '../api/vps-client.js';
import type { DaemonConfig, ProjectConfig } from '../config.js';
import { MissingComplexityError } from '../roles/model-policy.js';
import type {
  CleanupRecord,
  JobKind,
  JobPatch,
  JobRow,
  JobStatus,
  NewJob,
  StateDb,
  ToolLogEntry,
} from '../state-db.js';
import { foldWakeups } from '../stream/dispatcher.js';
import {
  buildTicketTools,
  createTicketMcpServer,
  type DaemonReportFields,
  JobWriter,
  type ReportDraft,
  type ReportOverlay,
  type TicketToolContext,
} from '../tools/ticket-mcp-server.js';
import { allowedToolsFor } from '../tools/tool-scopes.js';
import {
  type AgentRunner,
  type AgentRunResult,
  agentEnv,
  emptyResult,
  type InitInfo,
  RunControl,
} from './agent-runner.js';
import { createGuardHook } from './guard-hook.js';
import { cleanupJob, jobTmpDir } from './job-cleanup.js';
import type { ResourceTracker } from './resource-tracker.js';
import { classifyRetry, isBackoffError } from './retry-classifier.js';
import { ScriptedCrash } from './scripted-runner.js';
import { scrubSecrets } from './secret-scrubber.js';
import { mcpServersUsed, skillsInvoked } from './skill-usage.js';

// ---------------------------------------------------------------------------
// Role planning: the extension point the role workflow builds on
// ---------------------------------------------------------------------------

/** Daemon services a role planner may use (writes go through the job's own idempotent writer). */
export interface PlannerContext {
  vps: VpsClient;
  state: StateDb;
  crewDocs: { bundle: string; runtime: string } | null;
  /** Writes keyed on this job (`<jobId>:<seq>`), so a restarted job never repeats one. */
  writer: JobWriter;
  /** The docs standard (`STANDARD.md`) installed next to crew-docs, or null. */
  standardPath: string | null;
  log: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
}

export interface PlanInput {
  job: JobRow;
  kind: JobKind;
  detail: TicketDetailResponse;
  config: DaemonConfig;
  project: ProjectConfig | null;
  inventory: SkillInventory;
  ctx: PlannerContext;
}

export interface PlannedRun {
  prompt: string;
  model: SelectableModel;
  effort: Effort;
  /** Session to resume, or null for a fresh session. */
  resumeSessionId: string | null;
  /** Base of a new worktree (default: the project's default branch; QC passes the dev `head_sha`). */
  worktreeBase?: string;
  appendSystemPrompt?: string;
  /** The role step this run performs (recorded on the job). */
  stage?: RoleStage;
  /** Comments to post before the run (e.g. a model clamped to the allowlist). */
  notices?: string[];
  /**
   * The MCP servers this run must use, when narrower than the ticket's `requiredMcps` (QC of a docs-only diff:
   * none). The ticket keeps its list; the done-gate, the report fields and the capability warnings use this.
   */
  requiredMcps?: string[];
  /**
   * Do not run: the planner already did what the job needed (a gate that waits or blocks). The job ends with
   * this status and reason.
   */
  skip?: { reason: string; status?: Extract<JobStatus, 'skipped' | 'blocked'> };
}

export interface PrepareInput {
  job: JobRow;
  kind: JobKind;
  stage: RoleStage | undefined;
  detail: TicketDetailResponse;
  config: DaemonConfig;
  project: ProjectConfig | null;
  cwd: string;
  ctx: PlannerContext;
}

export interface PrepareResult {
  /** Appended to the prompt (e.g. merge conflicts left for the agent). */
  note?: string;
  skip?: PlannedRun['skip'];
}

export interface ReportOverlayInput {
  job: JobRow;
  kind: JobKind;
  ticket: Ticket;
  toolLog: ToolLogEntry[];
  inventory: SkillInventory;
  project: ProjectConfig | null;
  cwd: string;
  draft: ReportDraft;
  /** Processes of this job still alive when the report is filed. */
  liveProcesses: number;
  ctx: PlannerContext;
}

export interface AfterRunInput {
  job: JobRow;
  kind: JobKind;
  ticket: Ticket;
  result: AgentRunResult;
  toolLog: ToolLogEntry[];
  inventory?: SkillInventory;
  project?: ProjectConfig | null;
  cwd?: string;
  ctx?: PlannerContext;
}

export interface AfterRunDecision {
  /** A job to queue for the same ticket right after this one (e.g. the docs job after a dev handoff). */
  followUp?: Omit<NewJob, 'ticketId' | 'projectId' | 'role'> & { role?: AgentRole };
  /** Comments to post on the ticket (warnings, failure notes). */
  comments?: string[];
  /** Move the ticket to `blocked` for the owner. */
  block?: boolean;
  /** The job's final status when the run itself succeeded (default `done`). */
  status?: Extract<JobStatus, 'done' | 'failed' | 'blocked'>;
  error?: string;
}

/** Role behaviour plugged into the runtime: prompts, model policy, report checks and follow-ups. */
export interface RolePlanner {
  plan(input: PlanInput): Promise<PlannedRun>;
  /** After the workspace exists and before the run (e.g. merge dependency heads, install hooks). */
  prepare?(input: PrepareInput): Promise<PrepareResult>;
  reportFields?(input: {
    job: JobRow;
    kind: JobKind;
    ticket: Ticket;
    toolLog: ToolLogEntry[];
  }): DaemonReportFields;
  /** Report fields the daemon records itself, when the agent files a report. Replaces `reportFields`. */
  reportOverlay?(input: ReportOverlayInput): Promise<ReportOverlay>;
  afterRun?(input: AfterRunInput): Promise<AfterRunDecision>;
}

/** Models of the roles that have a default; dev and QC run on the PM's complexity rating only. */
const ROLE_DEFAULTS: Record<'assistant' | 'pm', { model: SelectableModel; effort: Effort }> = {
  assistant: { model: 'haiku', effort: 'medium' },
  pm: { model: 'sonnet', effort: 'high' },
};

/**
 * Model and effort for a run: docs work is always sonnet/high; otherwise the ticket, its complexity, the
 * role. A dev or QC ticket without a complexity rating throws MissingComplexityError (no default model).
 */
export function chooseModel(
  config: DaemonConfig,
  kind: JobKind,
  role: AgentRole,
  ticket: { model: ModelAlias | null; effort: Effort | null; complexity: Complexity | null },
): { model: SelectableModel; effort: Effort } {
  if (kind === 'docs_init' || kind === 'docs_update') return { model: 'sonnet', effort: 'high' };
  const fromComplexity = ticket.complexity ? config.models.complexityMap[ticket.complexity] : null;
  let fallback: { model: SelectableModel; effort: Effort };
  if (role === 'dev' || role === 'qc') {
    if (!fromComplexity) throw new MissingComplexityError(role);
    fallback = fromComplexity;
  } else {
    fallback = fromComplexity ?? ROLE_DEFAULTS[role];
  }
  // Fable is not used at all: a legacy ticket that still names it runs on opus.
  const model = ticket.model === 'fable' ? 'opus' : (ticket.model ?? fallback.model);
  const effort = ticket.effort ?? fallback.effort;
  return { model: config.models.allow.includes(model) ? model : 'sonnet', effort };
}

export function restartNote(job: JobRow, detail: TicketDetailResponse): string {
  if (job.resumeMode === 'restart_resume') {
    return [
      'Daemon vừa khởi động lại giữa lượt chạy trước của bạn.',
      'Trước tiên chạy `git status` và đọc lại ticket (get_ticket) để biết việc nào đã xong, rồi làm tiếp từ chỗ dừng.',
      'Không làm lại việc đã xong, không tạo lại ticket, bình luận hay report đã có.',
    ].join('\n');
  }
  if (job.resumeMode === 'restart_fresh') {
    const children = detail.children.map((c) => `- ${c.key} [${c.type}, ${c.status}] ${c.title}`).join('\n');
    const comments = detail.comments
      .slice(-10)
      .map((c) => `- (${c.authorKind}${c.authorRole ? `/${c.authorRole}` : ''}) ${c.body.slice(0, 500)}`)
      .join('\n');
    return [
      'Một lượt chạy trước cho ticket này đã bị dừng giữa chừng. Hòa giải với những gì đã có, không tạo lại.',
      `Ticket con hiện có:\n${children || '- (chưa có)'}`,
      `Bình luận gần nhất:\n${comments || '- (chưa có)'}`,
      `Report hiện tại: ${detail.report ? detail.report.summaryMd.slice(0, 1_000) : '(chưa có)'}`,
    ].join('\n\n');
  }
  return '';
}

/**
 * The runtime's default planner: a generic Vietnamese prompt per trigger plus the restart prompts. The
 * role workflow replaces it with per-role prompts and policies.
 */
export const defaultPlanner: RolePlanner = {
  async plan({ job, kind, detail, config, project }) {
    const { ticket } = detail;
    const { model, effort } = chooseModel(config, kind, job.role, ticket);
    const resume =
      job.resumeMode === 'restart_fresh'
        ? null
        : (job.sessionId ?? (job.trigger === 'ticket.assigned' ? null : ticket.agentSessionId));
    const lines = [
      `Bạn là agent vai trò ${job.role} của 2P Crew, làm ticket ${ticket.key}: ${ticket.title}.`,
      `Lý do lượt chạy: ${job.trigger}${job.eventIds.length > 1 ? ` (${job.eventIds.length} sự kiện)` : ''}.`,
      'Đọc ticket bằng công cụ get_ticket trước tiên. Bình luận, câu hỏi và report viết bằng tiếng Việt.',
      restartNote(job, detail),
    ].filter(Boolean);
    return {
      prompt: lines.join('\n\n'),
      model,
      effort,
      resumeSessionId: resume,
      worktreeBase: project?.defaultBranch,
    };
  },
};

// ---------------------------------------------------------------------------
// Report fields recorded by the daemon
// ---------------------------------------------------------------------------

const DOCS_ENTRY_TOOLS = ['mcp__tickets__docs_flow', 'mcp__tickets__docs_where'];

/** True when the first Read/Grep of a non-docs file came after a docs lookup or a Read of `docs/index.md`. */
export function docsReadFirst(log: readonly ToolLogEntry[]): boolean {
  for (const entry of log) {
    if (entry.decision !== 'allow') continue;
    if (DOCS_ENTRY_TOOLS.includes(entry.tool)) return true;
    if (entry.tool === 'Read' && entry.target && /(^|\/)docs\/index\.md$/.test(entry.target)) return true;
    if (
      (entry.tool === 'Read' || entry.tool === 'Grep') &&
      entry.target &&
      !/(^|\/)docs\//.test(entry.target)
    ) {
      return false;
    }
  }
  return true;
}

export function defaultReportFields(
  ticket: Ticket,
  log: readonly ToolLogEntry[],
  inventory: SkillInventory,
  leftResources: boolean,
): DaemonReportFields {
  const used = skillsInvoked(log);
  const mcpsUsed = mcpServersUsed(log, [
    ...new Set([...inventory.mcpServers.map((s) => s.name), ...ticket.requiredMcps]),
  ]);
  return {
    skillsUsed: used,
    skillsMissing: ticket.requiredSkills.filter((skill) => !used.includes(skill)),
    mcpsUsed,
    mcpsMissing: ticket.requiredMcps.filter((server) => !mcpsUsed.includes(server)),
    docsFirst: docsReadFirst(log),
    leftResources,
  };
}

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

export interface JobWorkspace {
  cwd: string;
  sharedPaths: string[];
  worktreeKey: string | null;
}

export interface JobRunnerDeps {
  state: StateDb;
  vps: VpsClient;
  runner: AgentRunner;
  planner: RolePlanner;
  tracker: ResourceTracker;
  config: () => DaemonConfig;
  tmpRoot: string;
  binDir: string;
  crewDocs: () => { bundle: string; runtime: string } | null;
  /** Local project of a server project id (null for assistant jobs or an unmapped project). */
  projectFor: (projectId: string | null) => ProjectConfig | null;
  inventoryFor: (projectKey: string | null) => SkillInventory;
  /** Prepares the job's working directory (a worktree for project jobs). */
  workspace: (input: {
    job: JobRow;
    ticket: Ticket;
    project: ProjectConfig | null;
    base: string | undefined;
  }) => JobWorkspace;
  /** Called after a run whose ticket closed: removes its worktree. */
  releaseWorkspace: (input: { job: JobRow; ticket: Ticket; project: ProjectConfig | null }) => void;
  contextBlock: (job: JobRow, cwd: string) => Promise<Record<string, unknown>>;
  resourceOps?: (job: JobRow) => NonNullable<TicketToolContext['resources']>;
  /** The docs standard installed next to crew-docs (for the docs-init prompt), or null. */
  standardPath?: () => string | null;
  /** After a job's cleanup: the daemon wakes the PM when a finished child left processes behind. */
  onCleaned?: (job: JobRow, ticket: Ticket, record: CleanupRecord) => void;
  onInit?: (job: JobRow, init: InitInfo, project: ProjectConfig | null) => void;
  onJobChanged?: (job: JobRow) => void;
  log: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
  /** True once the daemon is stopping gracefully (aborted runs are re-queued, not failed). */
  stopping: () => boolean;
  /** True once the daemon was halted as a crash stand-in (nothing more is written). */
  halted: () => boolean;
  cleanupGraceMs?: number;
}

const nowIso = () => new Date().toISOString();

/**
 * One line naming an unexpected error for the ticket and the owner: its class (and errno code, e.g.
 * `ENOENT`) and message, with credential-shaped strings removed.
 */
export function crashText(error: Error): string {
  const code = (error as NodeJS.ErrnoException).code;
  const name = `${error.name || 'Error'}${typeof code === 'string' ? ` ${code}` : ''}`;
  return scrubSecrets(`${name}: ${error.message}`).text.slice(0, 500);
}

function formatSaigon(date: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

/**
 * Runs one job end to end: plan, workspace, the agent run with its guard, tools and tagged env, then the
 * outcome (done, backoff, blocked, failed, cancelled), cost booking, wake-up folding and cleanup.
 */
export class JobRunner {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly deps: JobRunnerDeps) {}

  runningJobIds(): Set<string> {
    return new Set(this.controllers.keys());
  }

  abort(jobId: string): boolean {
    const controller = this.controllers.get(jobId);
    controller?.abort();
    return controller !== undefined;
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  /** Marks the job running (synchronously, so the scheduler counts it) and runs it in the background. */
  launch(job: JobRow): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const running = this.update(job.id, {
      status: 'running',
      startedAt: nowIso(),
      endedAt: null,
      retryAt: null,
      waitingDeps: false,
      waitReason: null,
      waitDetail: null,
      pgid: null,
    });
    const done = this.execute(running, controller)
      .catch(async (error: Error) => {
        this.deps.log('error', 'job crashed', { jobId: job.id, error: error.message });
        if (this.deps.halted() || error instanceof ScriptedCrash) return;
        // An unexpected error (planner, prompt, workspace, API) must not leave the job "running" forever,
        // and the owner must see it on the ticket, like a failed run.
        const { state } = this.deps;
        const text = crashText(error);
        const failed = state.transaction(() => {
          const ended = state.updateJob(job.id, { status: 'failed', error: text, endedAt: nowIso() });
          foldWakeups(state, ended);
          return ended;
        });
        this.deps.onJobChanged?.(failed);
        await this.reportCrash(failed, text);
        await this.cleanup(failed);
      })
      .finally(() => this.controllers.delete(job.id));
    this.pending.add(done);
    void done.finally(() => this.pending.delete(done));
    return Promise.resolve();
  }

  private readonly pending = new Set<Promise<void>>();

  /**
   * The failure policy of a run error, for a crash outside the agent run: a comment with the error, then
   * `blocked` when the ticket's status allows an agent to block it. The owner's unblock (or, while the
   * ticket cannot be blocked, a comment) queues a new job.
   */
  private async reportCrash(job: JobRow, text: string): Promise<void> {
    let ticket: Ticket;
    try {
      ticket = (await this.deps.vps.getTicket(job.ticketId)).ticket;
    } catch (error) {
      this.deps.log('warn', 'crash report failed', { jobId: job.id, error: (error as Error).message });
      return;
    }
    if (ticket.status === 'done' || ticket.status === 'cancelled') return;
    const block = canTransition('agent', ticket.status, 'blocked');
    const writer = new JobWriter(this.deps.state, job.id);
    await this.comment(
      writer,
      ticket.id,
      job.role,
      `Job gặp lỗi trên máy trước khi agent chạy xong: \`${text}\`. ` +
        (block
          ? 'Ticket bị chặn; chủ dự án xem lại rồi mở chặn (unblock) để chạy lại.'
          : 'Chủ dự án bình luận vào ticket để chạy lại.'),
    );
    if (block) await this.transition(writer, ticket, 'blocked');
  }

  /** Resolves when every launched job has finished. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  private update(jobId: string, patch: JobPatch): JobRow {
    const job = this.deps.state.updateJob(jobId, patch);
    this.deps.onJobChanged?.(job);
    return job;
  }

  private context(job: JobRow): PlannerContext {
    return {
      vps: this.deps.vps,
      state: this.deps.state,
      crewDocs: this.deps.crewDocs(),
      writer: new JobWriter(this.deps.state, job.id),
      standardPath: this.deps.standardPath?.() ?? null,
      log: this.deps.log,
    };
  }

  private async execute(started: JobRow, controller: AbortController): Promise<void> {
    const { state, vps } = this.deps;
    let job = started;
    let detail: TicketDetailResponse;
    try {
      detail = await vps.getTicket(job.ticketId);
    } catch (error) {
      // The API is unreachable: put the job back; the scheduler tries again shortly.
      this.update(job.id, {
        status: 'queued',
        retryAt: new Date(Date.now() + 30_000).toISOString(),
        error: (error as Error).message,
      });
      return;
    }
    const ticket = detail.ticket;
    const kind: JobKind = ticket.type === 'docs_init' && job.kind === 'agent' ? 'docs_init' : job.kind;
    const project = this.deps.projectFor(ticket.projectId);
    const inventory = this.deps.inventoryFor(project?.key ?? null);
    const config = this.deps.config();
    const ctx = this.context(job);
    const plan = await this.deps.planner.plan({ job, kind, detail, config, project, inventory, ctx });
    if (plan.stage) job = this.update(job.id, { stage: plan.stage, kind });
    if (plan.skip) {
      await this.finish(
        job,
        ticket,
        null,
        { status: plan.skip.status ?? 'skipped', error: plan.skip.reason },
        project,
      );
      return;
    }

    // A failed worktree preparation is a crash (reported on the ticket by `launch`).
    const workspace: JobWorkspace = this.deps.workspace({
      job,
      ticket,
      project,
      base: (await this.qcBase(ticket)) ?? plan.worktreeBase,
    });
    const prepared = await this.deps.planner.prepare?.({
      job,
      kind,
      stage: plan.stage,
      detail,
      config,
      project,
      cwd: workspace.cwd,
      ctx,
    });
    if (prepared?.skip) {
      await this.finish(
        job,
        ticket,
        null,
        { status: prepared.skip.status ?? 'skipped', error: prepared.skip.reason },
        project,
      );
      return;
    }
    const prompt = prepared?.note ? `${plan.prompt}\n\n${prepared.note}` : plan.prompt;
    // The ticket as this run's report checks see it: the MCP servers the run must use may be narrower.
    const runTicket: Ticket = plan.requiredMcps ? { ...ticket, requiredMcps: plan.requiredMcps } : ticket;
    for (const notice of plan.notices ?? []) await this.comment(ctx.writer, ticket.id, job.role, notice);

    const tmpDir = jobTmpDir(this.deps.tmpRoot, job.id);
    mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    job = this.update(job.id, {
      kind,
      worktree: workspace.cwd,
      model: plan.model,
      effort: plan.effort,
      sessionId: plan.resumeSessionId,
      error: null,
    });

    const control = new RunControl();
    const env = agentEnv(process.env, {
      CREW_JOB_ID: job.id,
      TMPDIR: tmpDir,
      TMP: tmpDir,
      TEMP: tmpDir,
      PATH: `${this.deps.binDir}:${process.env.PATH ?? ''}`,
    });
    const reportOverlay = async (draft: ReportDraft): Promise<ReportOverlay> => {
      const current = state.requireJob(job.id);
      const log = state.toolLog(job.id);
      if (this.deps.planner.reportOverlay) {
        return this.deps.planner.reportOverlay({
          job: current,
          kind,
          ticket: runTicket,
          toolLog: log,
          inventory,
          project,
          cwd: workspace.cwd,
          draft,
          liveProcesses: this.liveProcesses(current),
          ctx,
        });
      }
      const fields =
        this.deps.planner.reportFields?.({ job: current, kind, ticket: runTicket, toolLog: log }) ??
        defaultReportFields(runTicket, log, inventory, false);
      return { fields, skillsSelected: draft.skillsSelected, mcpsSelected: draft.mcpsSelected };
    };
    const tools: TicketToolContext = {
      jobId: job.id,
      ticketId: ticket.id,
      ticketType: ticket.type,
      requiredMcps: runTicket.requiredMcps,
      role: job.role,
      kind,
      stage: plan.stage ?? null,
      cwd: workspace.cwd,
      vps,
      state,
      project,
      env,
      crewDocs: ctx.crewDocs,
      contextBlock: () => this.deps.contextBlock(job, workspace.cwd),
      inventory: () => inventory,
      reportOverlay,
      ...(job.role === 'pm' && this.deps.resourceOps ? { resources: this.deps.resourceOps(job) } : {}),
      requestEnd: (reason) => control.requestEnd(reason),
    };
    const ticketTools = buildTicketTools(tools);
    const server = createTicketMcpServer(ticketTools);
    const disabled = project?.disabledMcpServers ?? [];
    const mcpNames = inventory.mcpServers.map((server) => server.name);
    const projectServers = inventory.mcpServers.filter((s) => s.source === 'project').map((s) => s.name);
    const budget = config.budgets.perJobUsd;

    let result: AgentRunResult;
    try {
      result = await this.deps.runner({
        jobId: job.id,
        ticketId: ticket.id,
        ticketKey: ticket.key,
        role: job.role,
        kind,
        ...(plan.stage ? { stage: plan.stage } : {}),
        cwd: workspace.cwd,
        model: plan.model,
        effort: plan.effort,
        prompt,
        resumeSessionId: plan.resumeSessionId,
        allowedTools: allowedToolsFor({
          role: job.role,
          kind,
          mcpServers: mcpNames,
          disabledMcpServers: disabled,
        }),
        maxBudgetUsd: budget,
        abortSignal: controller.signal,
        env,
        mcpServers: { tickets: server },
        ticketTools,
        preToolUse: createGuardHook({
          jobId: job.id,
          state,
          cwd: workspace.cwd,
          kind,
          sharedPaths: workspace.sharedPaths,
          tmpDir,
          codeOnly: plan.stage === 'dev',
        }),
        enabledMcpjsonServers: projectServers.filter((name) => !disabled.includes(name)),
        disabledMcpjsonServers: projectServers.filter((name) => disabled.includes(name)),
        ...(plan.appendSystemPrompt ? { appendSystemPrompt: plan.appendSystemPrompt } : {}),
        control,
        onSpawn: (pid) => {
          if (!this.deps.halted()) job = this.update(job.id, { pgid: pid });
        },
        onInit: (init) => {
          if (this.deps.halted()) return;
          job = this.update(job.id, { sessionId: init.sessionId, skillsListed: init.skills });
          this.deps.onInit?.(job, init, project);
        },
      });
    } catch (error) {
      if (error instanceof ScriptedCrash || this.deps.halted()) return;
      result = { ...emptyResult(), isError: true, errors: [(error as Error).message] };
    }
    if (this.deps.halted()) return;
    job = state.requireJob(job.id);

    // Graceful daemon stop: re-queue so the next start resumes the session.
    if (result.aborted && !job.cancelRequested && this.deps.stopping()) {
      await this.bookCost(job, ticket, result, plan);
      this.update(job.id, {
        status: 'queued',
        resumeMode: job.sessionId ? 'restart_resume' : 'restart_fresh',
        costUsd: result.totalCostUsd,
      });
      await this.cleanup(state.requireJob(job.id));
      return;
    }

    await this.bookCost(job, ticket, result, plan);
    const log = state.toolLog(job.id);
    const skills = skillsInvoked(log, result.slashCommands);
    const base: JobPatch = {
      costUsd: result.totalCostUsd,
      resultSubtype: result.resultSubtype,
      modelUsage: result.modelUsage,
      skillsInvoked: skills,
      ...(result.sessionId ? { sessionId: result.sessionId } : {}),
    };

    if (job.cancelRequested || result.aborted) {
      await this.finish(
        job,
        ticket,
        result,
        { ...base, status: 'cancelled', error: 'ticket cancelled' },
        project,
      );
      return;
    }

    if (result.isError && isBackoffError(result.apiError)) {
      const decision = classifyRetry(result.apiError, job.attempts);
      const writer = new JobWriter(state, job.id);
      if (decision.action === 'backoff') {
        await this.comment(
          writer,
          ticket.id,
          job.role,
          `Lượt chạy tạm dừng do lỗi API \`${decision.error}\` (lần ${decision.attempts}). Daemon sẽ tự chạy lại lúc ${formatSaigon(decision.retryAt)}.`,
        );
        this.update(job.id, {
          ...base,
          status: 'backoff',
          attempts: decision.attempts,
          retryAt: decision.retryAt.toISOString(),
          error: decision.error,
        });
        await this.cleanup(state.requireJob(job.id));
        return;
      }
      await this.comment(
        writer,
        ticket.id,
        job.role,
        `Lượt chạy bị chặn: lỗi API \`${decision.error}\` lặp lại ${decision.attempts} lần. Chủ dự án mở lại (unblock) khi đã sẵn sàng.`,
      );
      await this.transition(writer, ticket, 'blocked');
      await this.finish(
        job,
        ticket,
        result,
        { ...base, status: 'blocked', attempts: decision.attempts, error: decision.error },
        project,
      );
      return;
    }

    job = state.updateJob(job.id, { skillsInvoked: skills });
    const afterRun = await this.deps.planner.afterRun?.({
      job,
      kind,
      ticket: runTicket,
      result,
      toolLog: log,
      inventory,
      project,
      cwd: workspace.cwd,
      ctx,
    });
    const writer = new JobWriter(state, job.id);
    if (result.isError) {
      this.deps.log('warn', 'run failed', {
        jobId: job.id,
        subtype: result.resultSubtype,
        errors: result.errors,
      });
      const errorClass = result.resultSubtype ?? 'runner_error';
      await this.comment(
        writer,
        ticket.id,
        job.role,
        `Lượt chạy lỗi (\`${errorClass}\`), chi phí ${result.totalCostUsd.toFixed(4)} USD: ${result.errors.join('; ').slice(0, 2_000) || 'không rõ lỗi'}`,
      );
      for (const body of afterRun?.comments ?? []) await this.comment(writer, ticket.id, job.role, body);
      if (!afterRun?.followUp) await this.transition(writer, ticket, 'blocked');
      await this.finish(
        job,
        ticket,
        result,
        { ...base, status: 'failed', error: errorClass },
        project,
        afterRun,
      );
      return;
    }
    for (const body of afterRun?.comments ?? []) await this.comment(writer, ticket.id, job.role, body);
    if (afterRun?.block) {
      await this.transition(writer, ticket, 'blocked');
      await this.finish(
        job,
        ticket,
        result,
        { ...base, status: 'blocked', error: afterRun.error ?? 'blocked' },
        project,
      );
      return;
    }
    await this.finish(
      job,
      ticket,
      result,
      { ...base, status: afterRun?.status ?? 'done', ...(afterRun?.error ? { error: afterRun.error } : {}) },
      project,
      afterRun,
    );
  }

  /** Processes of a running job that are still alive (its process group, its tag, their children). */
  private liveProcesses(job: JobRow): number {
    try {
      const groups = new Map<number, string>();
      if (job.pgid && job.pgid > 1) groups.set(job.pgid, job.id);
      return this.deps.tracker
        .jobProcesses(groups)
        .filter((proc) => proc.jobId === job.id && proc.pid !== job.pgid).length;
    } catch {
      return 0;
    }
  }

  /** A QC worktree starts at the paired dev (or bug) report's `head_sha`, so QC tests exactly what dev built. */
  private async qcBase(ticket: Ticket): Promise<string | undefined> {
    if (ticket.type !== 'qc' || !ticket.pairsWith) return undefined;
    const paired = await this.deps.vps.getTicket(ticket.pairsWith);
    return paired.report?.headSha ?? undefined;
  }

  /** Books this run's cost once: the session's final total minus what earlier runs of it already booked. */
  private async bookCost(
    job: JobRow,
    ticket: Ticket,
    result: AgentRunResult,
    plan: PlannedRun,
  ): Promise<void> {
    const { state } = this.deps;
    const sessionId = result.sessionId ?? job.sessionId;
    const earlier = sessionId
      ? state
          .jobsForTicket(job.ticketId)
          .filter((other) => other.id !== job.id && other.sessionId === sessionId)
          .reduce((max, other) => Math.max(max, other.costUsd), 0)
      : 0;
    const delta = Math.max(0, result.totalCostUsd - Math.max(earlier, job.costUsd));
    const writer = new JobWriter(state, job.id);
    try {
      await writer.write((key) =>
        this.deps.vps.agentMeta(
          ticket.id,
          {
            ...(sessionId ? { sessionId } : {}),
            model: plan.model,
            effort: plan.effort,
            ...(delta > 0 ? { costDeltaUsd: Math.round(delta * 1e6) / 1e6 } : {}),
          },
          key,
        ),
      );
    } catch (error) {
      this.deps.log('warn', 'agent-meta failed', { jobId: job.id, error: (error as Error).message });
    }
  }

  private async comment(writer: JobWriter, ticketId: string, role: AgentRole, body: string): Promise<void> {
    try {
      await writer.write((key) => this.deps.vps.comment(ticketId, { body, role }, key));
    } catch (error) {
      this.deps.log('warn', 'comment failed', { ticketId, error: (error as Error).message });
    }
  }

  private async transition(writer: JobWriter, ticket: Ticket, to: 'blocked'): Promise<void> {
    try {
      const fresh = (await this.deps.vps.getTicket(ticket.id)).ticket;
      if (!canTransition('agent', fresh.status, to)) return;
      await writer.write((key) => this.deps.vps.transition(ticket.id, to, key));
    } catch (error) {
      this.deps.log('warn', 'transition failed', {
        ticketId: ticket.id,
        to,
        error: (error as Error).message,
      });
    }
  }

  /** Terminal status, follow-up and folded wake-ups in one transaction, then cleanup and workspace release. */
  private async finish(
    job: JobRow,
    ticket: Ticket,
    _result: AgentRunResult | null,
    patch: JobPatch,
    project: ProjectConfig | null,
    afterRun?: AfterRunDecision,
  ): Promise<void> {
    const { state } = this.deps;
    const followUps = state.transaction(() => {
      const ended = state.updateJob(job.id, { ...patch, endedAt: nowIso() });
      const created: JobRow[] = [];
      if (afterRun?.followUp && patch.status !== 'cancelled') {
        const { role, ...rest } = afterRun.followUp;
        created.push(
          state.insertJob({
            ...rest,
            ticketId: job.ticketId,
            projectId: job.projectId,
            role: role ?? job.role,
          }),
        );
      }
      if (patch.status === 'cancelled') state.dropWakeups(job.ticketId);
      else {
        const folded = foldWakeups(state, ended);
        if (folded && !created.some((row) => row.id === folded.id)) created.push(folded);
      }
      return { ended, created };
    });
    this.deps.onJobChanged?.(followUps.ended);
    for (const row of followUps.created) this.deps.onJobChanged?.(row);
    const record = await this.cleanup(followUps.ended);
    if (record) {
      try {
        this.deps.onCleaned?.(followUps.ended, ticket, record);
      } catch (error) {
        this.deps.log('warn', 'cleanup notice failed', { jobId: job.id, error: (error as Error).message });
      }
    }
    if (followUps.created.length > 0) return;
    let status = ticket.status;
    try {
      status = (await this.deps.vps.getTicket(ticket.id)).ticket.status;
    } catch {
      // keep the last known status
    }
    if (patch.status === 'cancelled' || status === 'done' || status === 'cancelled') {
      try {
        this.deps.releaseWorkspace({ job, ticket, project });
      } catch (error) {
        this.deps.log('warn', 'worktree removal failed', { jobId: job.id, error: (error as Error).message });
      }
    }
  }

  private async cleanup(job: JobRow): Promise<CleanupRecord | null> {
    try {
      return await cleanupJob(
        {
          state: this.deps.state,
          tracker: this.deps.tracker,
          tmpRoot: this.deps.tmpRoot,
          graceMs: this.deps.cleanupGraceMs,
        },
        job,
      );
    } catch (error) {
      this.deps.log('error', 'cleanup failed', { jobId: job.id, error: (error as Error).message });
      return null;
    }
  }
}
