import { z } from 'zod';

export const AgentRole = z.enum(['assistant', 'pm', 'dev', 'qc']);
export type AgentRole = z.infer<typeof AgentRole>;

export const Complexity = z.enum(['trivial', 'small', 'medium', 'large']);
export type Complexity = z.infer<typeof Complexity>;

/**
 * Every model alias a stored ticket may carry. `fable` is only a legacy value: no run uses it and no input
 * accepts it (owner decision). Inputs, the machine allowlist and the complexity map use SelectableModel.
 */
export const ModelAlias = z.enum(['haiku', 'sonnet', 'opus', 'fable']);
export type ModelAlias = z.infer<typeof ModelAlias>;

/** The models an agent run may use and any input may name. Fable is not used at all (owner decision). */
export const SelectableModel = z.enum(['haiku', 'sonnet', 'opus'], {
  error: 'model phải là haiku, sonnet hoặc opus: Fable không được dùng (quyết định của chủ dự án).',
});
export type SelectableModel = z.infer<typeof SelectableModel>;

export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof Effort>;

/**
 * The step of a role's work one agent run performs. The daemon picks it from the ticket, its children and
 * the job kind; each stage has its own prompt, model default and legal status path.
 */
export const RoleStage = z.enum([
  'assistant_triage',
  'assistant_close',
  'pm_analyze',
  'pm_monitor',
  'pm_accept',
  'dev',
  'docs_update',
  'qc',
  'docs_init',
]);
export type RoleStage = z.infer<typeof RoleStage>;

/** All documentation work (the docs-init ticket and every docs-update job) runs on this model (owner decision). */
export const DOCS_MODEL: SelectableModel = 'sonnet';

// ---------------------------------------------------------------------------
// Agent activity: what a machine is doing with a ticket's job
// ---------------------------------------------------------------------------

/**
 * Why a job the daemon holds is not running, as its scheduler last decided: no free slot (load, memory,
 * or every slot busy), unmet `depends_on`, the project is not owned here or has no local folder, the
 * machine does not host the assistant, the ticket tree is over budget, the daemon is paused, a backoff
 * timer, or the start checks failed (e.g. the API was unreachable).
 */
export const JobWaitReason = z.enum([
  'no_slots',
  'waiting_deps',
  'project_not_here',
  'no_local_folder',
  'not_assistant_host',
  'over_budget',
  'paused',
  'retry_at',
  'check_failed',
]);
export type JobWaitReason = z.infer<typeof JobWaitReason>;

/** Facts behind a wait reason; each reason fills only the fields it needs. */
export const JobWaitDetail = z.object({
  /** `no_slots`: 1-minute load, CPU count and the load above which no job starts (cpus × maxLoadPerCpu). */
  loadAvg1: z.number().min(0).max(100_000).optional(),
  cpus: z.number().int().min(1).max(1_024).optional(),
  maxLoad: z.number().min(0).max(100_000).optional(),
  /** `no_slots`: available memory and the floor below which no job starts. */
  freeMemGb: z.number().min(0).max(65_536).optional(),
  minFreeMemGb: z.number().min(0).max(65_536).optional(),
  /** `no_slots`: slots the machine allows right now and the jobs running in them. */
  slots: z.number().int().min(0).max(1_000).optional(),
  runningJobs: z.number().int().min(0).max(1_000).optional(),
  /** `waiting_deps`: keys of the `depends_on` tickets that are not done. */
  dependsOn: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  /** `project_not_here` / `no_local_folder`. */
  projectKey: z.string().trim().min(1).max(50).optional(),
  /** `retry_at`. */
  retryAt: z.iso.datetime().optional(),
  /** `check_failed`, or a failed job: what went wrong (scrubbed). */
  message: z.string().max(500).optional(),
});
export type JobWaitDetail = z.infer<typeof JobWaitDetail>;

/** Machine heartbeats older than this make the reported job state unknown (heartbeats: every 30 s). */
export const AGENT_ACTIVITY_STALE_MS = 2 * 60 * 1000;

/**
 * `running`, `queued`, `backoff`: a machine reported the ticket's job in a fresh heartbeat. `unknown`: the
 * machine that last reported it is offline or silent for AGENT_ACTIVITY_STALE_MS. `unreported`: the ticket
 * waits for an agent, but no machine reports a job for it (`machine*` is then the machine it is assigned
 * to, if any). `failed`: the machine's latest job for the ticket failed (a crash or a run error) and no
 * new job has started since; `waitDetail.message` holds the error.
 */
export const AgentActivityStatus = z.enum([
  'running',
  'queued',
  'backoff',
  'failed',
  'unknown',
  'unreported',
]);
export type AgentActivityStatus = z.infer<typeof AgentActivityStatus>;

/** Owner view of what an agent machine is doing with one ticket (ticket list and detail). */
export const AgentActivity = z.object({
  status: AgentActivityStatus,
  machineId: z.string().nullable(),
  machineName: z.string().nullable(),
  machineOnline: z.boolean(),
  role: AgentRole.nullable(),
  stage: RoleStage.nullable(),
  /** Running: when the run started. Queued or backoff: when the machine took the job. Failed: when it failed. */
  since: z.iso.datetime().nullable(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  waitReason: JobWaitReason.nullable(),
  waitDetail: JobWaitDetail.nullable(),
  /** The machine's latest heartbeat. */
  reportedAt: z.iso.datetime().nullable(),
});
export type AgentActivity = z.infer<typeof AgentActivity>;
