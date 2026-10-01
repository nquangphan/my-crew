import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentRole, JobWaitDetail, JobWaitReason, RoleStage } from '@crew/shared';
import Database from 'better-sqlite3';
import type { RunTrace } from './runner/run-trace.js';

export type JobKind = 'agent' | 'docs_update' | 'docs_init';
export type JobStatus =
  | 'queued'
  | 'running'
  | 'backoff'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'skipped';

/** A ticket has at most one job in these states (partial unique index). */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['queued', 'running', 'backoff'];

/**
 * A queued job whose last run a daemon stop or crash cut short. It always starts a fresh session with a
 * summary of that run; `restart_resume` only appears on rows an older daemon wrote.
 */
export type ResumeMode = 'restart_resume' | 'restart_fresh';

/**
 * Why a run left its session abandoned; a later run never resumes that session (the runtime would deliver a
 * killed background task's `stopped` notification ahead of the prompt and cancel its first tool call).
 *
 * - `run_started`: written right before the agent starts and cleared when the run reports back cleanly, so a
 *   daemon that dies mid-run leaves the mark behind even if it never wrote anything at the end.
 * - `background_tasks`: the session closed with background tasks still alive (even after `stopTask`).
 * - `aborted`: the job was cancelled (or its project released) mid-run.
 * - `daemon_stopped`: a graceful daemon stop aborted the run and re-queued the job.
 * - `no_result`: the agent process died or the runner threw without a `result` message.
 * - `daemon_restart`: the job was still `running` when the daemon started again (it died mid-run).
 */
export type AbandonReason =
  | 'run_started'
  | 'background_tasks'
  | 'aborted'
  | 'daemon_stopped'
  | 'no_result'
  | 'daemon_restart';

/**
 * Last errors of a run that ended without finishing its step, on sessions broken before the abandoned mark
 * existed: an unblock after them starts fresh instead of resuming.
 */
const UNFINISHED_ERRORS: ReadonlySet<string> = new Set(['no_handoff', 'not_finished']);

/** What a ticket's next run resumes (see `StateDb.resumeChoice`). */
export interface ResumeChoice {
  /** The session to resume, or null for a fresh session. */
  sessionId: string | null;
  /**
   * The earlier run that was cut short, when this run starts fresh because of it: the new session's prompt
   * summarizes it. Null when nothing was interrupted (a clean resume, or a fresh session by design).
   */
  interrupted: JobRow | null;
}

export interface JobRow {
  id: string;
  ticketId: string;
  projectId: string | null;
  role: AgentRole;
  kind: JobKind;
  status: JobStatus;
  /** Event type (or `wakeup`, `handoff`) that created the job. */
  trigger: string;
  /** Delivery sequence numbers of the events this job answers. */
  eventIds: string[];
  resumeMode: ResumeMode | null;
  /** The last dependency check found unmet `depends_on`; re-checked on events, reconnect and a timer. */
  waitingDeps: boolean;
  cancelRequested: boolean;
  sessionId: string | null;
  worktree: string | null;
  model: string | null;
  effort: string | null;
  attempts: number;
  retryAt: string | null;
  costUsd: number;
  resultSubtype: string | null;
  /** Per-model usage of the run's final result (tokens and cost). */
  modelUsage: Record<string, { costUSD: number; inputTokens: number; outputTokens: number }>;
  skillsListed: string[];
  skillsInvoked: string[];
  /** JSON recorded by the `handoff_docs` tool. */
  handoff: unknown;
  askedOwner: boolean;
  /** Last committed ticket-tool write sequence; the next write uses `toolSeq + 1` as its idempotency key. */
  toolSeq: number;
  pgid: number | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  /** The role step this run performed (set when the run is planned). */
  stage: RoleStage | null;
  /** Failed attempts before this job (no handoff, rejected docs commit, runner error); capped by the failure policy. */
  failedAttempts: number;
  /** Skills and MCP servers the agent picked in its capability preflight (`select_capabilities`). */
  capabilities: CapabilityChoice | null;
  /** Recorded by the docs job's `return_to_dev`: why the commit failed and the hook output. */
  returnToDev: { summaryMd: string; output: string } | null;
  /** Why the scheduler last left this queued or backoff job waiting; cleared when the job starts. */
  waitReason: JobWaitReason | null;
  waitDetail: JobWaitDetail | null;
  /** How the last run ended: result, turns, duration, cost, its last message and tool calls (scrubbed). */
  runTrace: RunTrace | null;
  /** The server settings revision the run started with (prompts, path rules, model map). */
  settingsRevision: string | null;
  /** Set when the run left `sessionId` abandoned (never resumed again); null for a clean session. */
  sessionAbandoned: AbandonReason | null;
}

/** What a run selected in its capability preflight, each with a one-line reason. */
export interface CapabilityChoice {
  skills: { name: string; reason: string }[];
  mcps: { server: string; reason: string }[];
  /** Why nothing fits, when both lists are empty. */
  noneReason: string | null;
}

export interface NewJob {
  ticketId: string;
  projectId: string | null;
  role: AgentRole;
  kind?: JobKind;
  trigger: string;
  eventIds?: string[];
  resumeMode?: ResumeMode | null;
  sessionId?: string | null;
  worktree?: string | null;
  attempts?: number;
  failedAttempts?: number;
}

export interface ToolLogEntry {
  jobId: string;
  seq: number;
  tool: string;
  target: string | null;
  decision: 'allow' | 'deny';
  reason: string | null;
  at: string;
}

/** An owner comment tagged `@pm` that woke a pm_task's PM (from a `ticket.pm_mentioned` event). */
export interface PmMention {
  eventId: string;
  pmTaskId: string;
  sourceTicketId: string;
  sourceTicketKey: string;
  commentId: string;
  createdAt: string;
}

export interface CleanupRecord {
  id: number;
  jobId: string;
  pids: number[];
  ports: number[];
  bytesFreed: number;
  containers: string[];
  at: string;
}

const SCHEMA = `
create table if not exists meta (key text primary key, value text not null);
create table if not exists jobs (
  id text primary key,
  ticket_id text not null,
  project_id text,
  role text not null check (role in ('assistant', 'pm', 'dev', 'qc')),
  kind text not null check (kind in ('agent', 'docs_update', 'docs_init')),
  status text not null
    check (status in ('queued', 'running', 'backoff', 'done', 'failed', 'blocked', 'cancelled', 'skipped')),
  trigger text not null,
  event_ids text not null default '[]',
  resume_mode text check (resume_mode in ('restart_resume', 'restart_fresh')),
  waiting_deps integer not null default 0,
  cancel_requested integer not null default 0,
  session_id text,
  worktree text,
  model text,
  effort text,
  attempts integer not null default 0,
  retry_at text,
  cost_usd real not null default 0,
  result_subtype text,
  model_usage text not null default '{}',
  skills_listed text not null default '[]',
  skills_invoked text not null default '[]',
  handoff text,
  asked_owner integer not null default 0,
  tool_seq integer not null default 0,
  pgid integer,
  error text,
  created_at text not null,
  started_at text,
  ended_at text,
  stage text,
  failed_attempts integer not null default 0,
  capabilities text,
  return_to_dev text,
  wait_reason text,
  wait_detail text,
  run_trace text,
  settings_revision text,
  session_abandoned text
);
create unique index if not exists jobs_one_active_per_ticket
  on jobs (ticket_id) where status in ('queued', 'running', 'backoff');
create index if not exists jobs_status on jobs (status);
create table if not exists pending_wakeups (
  id integer primary key autoincrement,
  ticket_id text not null,
  event_ids text not null,
  created_at text not null
);
create index if not exists pending_wakeups_ticket on pending_wakeups (ticket_id);
create table if not exists pm_mentions (
  event_id text primary key,
  pm_task_id text not null,
  source_ticket_id text not null,
  source_ticket_key text not null,
  comment_id text not null,
  created_at text not null
);
create table if not exists tool_log (
  job_id text not null,
  seq integer not null,
  tool text not null,
  target text,
  decision text not null check (decision in ('allow', 'deny')),
  reason text,
  at text not null,
  primary key (job_id, seq)
);
create table if not exists job_cleanup (
  id integer primary key autoincrement,
  job_id text not null,
  pids text not null,
  ports text not null,
  bytes_freed integer not null,
  containers text not null default '[]',
  at text not null
);
`;

/** Job columns added after the first release, with their definitions (see `StateDb.migrate`). */
const LATER_COLUMNS: readonly (readonly [string, string])[] = [
  ['stage', 'text'],
  ['failed_attempts', 'integer not null default 0'],
  ['capabilities', 'text'],
  ['return_to_dev', 'text'],
  ['wait_reason', 'text'],
  ['wait_detail', 'text'],
  ['run_trace', 'text'],
  ['settings_revision', 'text'],
  ['session_abandoned', 'text'],
];

type Row = Record<string, unknown>;

const json = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

function toJob(row: Row): JobRow {
  return {
    id: row.id as string,
    ticketId: row.ticket_id as string,
    projectId: (row.project_id as string | null) ?? null,
    role: row.role as AgentRole,
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    trigger: row.trigger as string,
    eventIds: json<string[]>(row.event_ids, []),
    resumeMode: (row.resume_mode as ResumeMode | null) ?? null,
    waitingDeps: row.waiting_deps === 1,
    cancelRequested: row.cancel_requested === 1,
    sessionId: (row.session_id as string | null) ?? null,
    worktree: (row.worktree as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    effort: (row.effort as string | null) ?? null,
    attempts: row.attempts as number,
    retryAt: (row.retry_at as string | null) ?? null,
    costUsd: row.cost_usd as number,
    resultSubtype: (row.result_subtype as string | null) ?? null,
    modelUsage: json<JobRow['modelUsage']>(row.model_usage, {}),
    skillsListed: json<string[]>(row.skills_listed, []),
    skillsInvoked: json<string[]>(row.skills_invoked, []),
    handoff: json<unknown>(row.handoff, null),
    askedOwner: row.asked_owner === 1,
    toolSeq: row.tool_seq as number,
    pgid: (row.pgid as number | null) ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string | null) ?? null,
    endedAt: (row.ended_at as string | null) ?? null,
    stage: (row.stage as RoleStage | null) ?? null,
    failedAttempts: (row.failed_attempts as number | null) ?? 0,
    capabilities: json<CapabilityChoice | null>(row.capabilities, null),
    returnToDev: json<JobRow['returnToDev']>(row.return_to_dev, null),
    waitReason: (row.wait_reason as JobWaitReason | null) ?? null,
    waitDetail: json<JobWaitDetail | null>(row.wait_detail, null),
    runTrace: json<RunTrace | null>(row.run_trace, null),
    settingsRevision: (row.settings_revision as string | null) ?? null,
    sessionAbandoned: (row.session_abandoned as AbandonReason | null) ?? null,
  };
}

/** Columns a job update may set, mapped to their SQL names and encoders. */
const JOB_COLUMNS = {
  status: ['status', (v: unknown) => v],
  kind: ['kind', (v: unknown) => v],
  trigger: ['trigger', (v: unknown) => v],
  eventIds: ['event_ids', (v: unknown) => JSON.stringify(v)],
  resumeMode: ['resume_mode', (v: unknown) => v],
  waitingDeps: ['waiting_deps', (v: unknown) => (v ? 1 : 0)],
  cancelRequested: ['cancel_requested', (v: unknown) => (v ? 1 : 0)],
  sessionId: ['session_id', (v: unknown) => v],
  worktree: ['worktree', (v: unknown) => v],
  model: ['model', (v: unknown) => v],
  effort: ['effort', (v: unknown) => v],
  attempts: ['attempts', (v: unknown) => v],
  retryAt: ['retry_at', (v: unknown) => v],
  costUsd: ['cost_usd', (v: unknown) => v],
  resultSubtype: ['result_subtype', (v: unknown) => v],
  modelUsage: ['model_usage', (v: unknown) => JSON.stringify(v)],
  skillsListed: ['skills_listed', (v: unknown) => JSON.stringify(v)],
  skillsInvoked: ['skills_invoked', (v: unknown) => JSON.stringify(v)],
  handoff: ['handoff', (v: unknown) => (v === null ? null : JSON.stringify(v))],
  askedOwner: ['asked_owner', (v: unknown) => (v ? 1 : 0)],
  toolSeq: ['tool_seq', (v: unknown) => v],
  pgid: ['pgid', (v: unknown) => v],
  error: ['error', (v: unknown) => v],
  startedAt: ['started_at', (v: unknown) => v],
  endedAt: ['ended_at', (v: unknown) => v],
  stage: ['stage', (v: unknown) => v],
  failedAttempts: ['failed_attempts', (v: unknown) => v],
  capabilities: ['capabilities', (v: unknown) => (v === null ? null : JSON.stringify(v))],
  returnToDev: ['return_to_dev', (v: unknown) => (v === null ? null : JSON.stringify(v))],
  waitReason: ['wait_reason', (v: unknown) => v],
  waitDetail: ['wait_detail', (v: unknown) => (v === null ? null : JSON.stringify(v))],
  runTrace: ['run_trace', (v: unknown) => (v === null ? null : JSON.stringify(v))],
  settingsRevision: ['settings_revision', (v: unknown) => v],
  sessionAbandoned: ['session_abandoned', (v: unknown) => v],
} as const satisfies Record<string, readonly [string, (v: unknown) => unknown]>;

export type JobPatch = Partial<Pick<JobRow, keyof typeof JOB_COLUMNS>>;

/**
 * The daemon's local SQLite state (`~/.crew/state.db`): the stream cursor, jobs, folded wake-ups, owner
 * @pm tags, the tool log and cleanup records. Every method is synchronous, so a caller can group several of them in one
 * `transaction()` and either all or none of them persist.
 */
export class StateDb {
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.pragma('journal_mode = WAL');
    // FULL: a committed cursor + job write survives a power cut, not only a process crash.
    this.db.pragma('synchronous = FULL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Adds the columns a state DB written by an older daemon lacks (SQLite has no `add column if not exists`). */
  private migrate(): void {
    const have = new Set(
      (this.db.prepare('pragma table_info(jobs)').all() as Row[]).map((column) => column.name as string),
    );
    for (const [name, ddl] of LATER_COLUMNS) {
      if (!have.has(name)) this.db.exec(`alter table jobs add column ${name} ${ddl}`);
    }
  }

  close(): void {
    this.db.close();
  }

  /** Runs `fn` in one SQLite transaction; a throw rolls every write back. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // -------------------------------------------------------------------------
  // Cursor and meta
  // -------------------------------------------------------------------------

  getMeta(key: string): string | null {
    const row = this.db.prepare('select value from meta where key = ?').get(key) as Row | undefined;
    return (row?.value as string | undefined) ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
      )
      .run(key, value);
  }

  getCursor(): string | null {
    return this.getMeta('cursor');
  }

  setCursor(cursor: string): void {
    this.setMeta('cursor', cursor);
  }

  // -------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------

  insertJob(input: NewJob, now = new Date()): JobRow {
    const id = randomUUID();
    this.db
      .prepare(
        `insert into jobs (id, ticket_id, project_id, role, kind, status, trigger, event_ids, resume_mode,
           session_id, worktree, attempts, failed_attempts, created_at)
         values (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.ticketId,
        input.projectId,
        input.role,
        input.kind ?? 'agent',
        input.trigger,
        JSON.stringify(input.eventIds ?? []),
        input.resumeMode ?? null,
        input.sessionId ?? null,
        input.worktree ?? null,
        input.attempts ?? 0,
        input.failedAttempts ?? 0,
        now.toISOString(),
      );
    return this.requireJob(id);
  }

  getJob(id: string): JobRow | null {
    const row = this.db.prepare('select * from jobs where id = ?').get(id) as Row | undefined;
    return row ? toJob(row) : null;
  }

  /** The newest job whose id starts with `prefix` (the short name of its temp dir), or null. */
  getJobByIdPrefix(prefix: string): JobRow | null {
    if (prefix.length === 0) return null;
    const row = this.db
      .prepare('select * from jobs where substr(id, 1, ?) = ? order by created_at desc limit 1')
      .get(prefix.length, prefix) as Row | undefined;
    return row ? toJob(row) : null;
  }

  requireJob(id: string): JobRow {
    const job = this.getJob(id);
    if (!job) throw new Error(`job ${id} not found`);
    return job;
  }

  /** The ticket's queued, running or backoff job, if any (there is at most one). */
  activeJob(ticketId: string): JobRow | null {
    const row = this.db
      .prepare(`select * from jobs where ticket_id = ? and status in ('queued', 'running', 'backoff')`)
      .get(ticketId) as Row | undefined;
    return row ? toJob(row) : null;
  }

  listJobs(statuses?: readonly JobStatus[]): JobRow[] {
    const rows = statuses
      ? (this.db
          .prepare(
            `select * from jobs where status in (${statuses.map(() => '?').join(', ')}) order by created_at, rowid`,
          )
          .all(...statuses) as Row[])
      : (this.db.prepare('select * from jobs order by created_at, rowid').all() as Row[]);
    return rows.map(toJob);
  }

  /** The newest `limit` jobs, newest first. */
  recentJobs(limit: number): JobRow[] {
    const rows = this.db
      .prepare('select * from jobs order by created_at desc, rowid desc limit ?')
      .all(limit) as Row[];
    return rows.map(toJob);
  }

  jobsForTicket(ticketId: string): JobRow[] {
    const rows = this.db
      .prepare('select * from jobs where ticket_id = ? order by created_at, rowid')
      .all(ticketId) as Row[];
    return rows.map(toJob);
  }

  /**
   * Failed jobs that ended at or after `since` and are still their ticket's latest job (no job was created
   * for the ticket after them), oldest first.
   */
  latestFailures(since: Date): JobRow[] {
    const rows = this.db
      .prepare(
        `select * from jobs j where j.status = 'failed' and j.ended_at >= ?
           and not exists (
             select 1 from jobs k where k.ticket_id = j.ticket_id
               and (k.created_at > j.created_at or (k.created_at = j.created_at and k.rowid > j.rowid)))
         order by j.ended_at, j.rowid`,
      )
      .all(since.toISOString()) as Row[];
    return rows.map(toJob);
  }

  /** Session of the ticket's latest job of this kind, used to resume it. */
  latestSession(ticketId: string, kind: JobKind): string | null {
    const row = this.db
      .prepare(
        `select session_id from jobs where ticket_id = ? and kind = ? and session_id is not null
         order by created_at desc, rowid desc limit 1`,
      )
      .get(ticketId, kind) as Row | undefined;
    return (row?.session_id as string | undefined) ?? null;
  }

  /** The newest job whose run left this session abandoned, or null when every run of it ended cleanly. */
  abandonedBy(sessionId: string): JobRow | null {
    const row = this.db
      .prepare(
        `select * from jobs where session_id = ? and session_abandoned is not null
         order by created_at desc, rowid desc limit 1`,
      )
      .get(sessionId) as Row | undefined;
    return row ? toJob(row) : null;
  }

  /**
   * The one place that decides whether a ticket's next run resumes a session. Every path that picks one — a
   * new job for an event, a folded or daemon-internal wake-up, a retry, a re-queue after a daemon stop or
   * crash, and the planner right before the run — asks here, so they all agree. The run starts fresh, with
   * the interrupted run to summarize, when:
   *
   * - the job itself was cut short by a daemon stop or crash (`resumeMode` set);
   * - a run left `candidate` abandoned (`sessionAbandoned`);
   * - it answers an unblock (`ticket.unblocked`: the owner's, or the PM's `retry_subtask`) and the ticket's
   *   latest finished job failed with `no_handoff` or `not_finished` — how a session broken before the mark
   *   existed looks.
   *
   * Otherwise `candidate` is resumed as it is (null: a fresh session by design, nothing to summarize).
   */
  resumeChoice(
    ticketId: string,
    candidate: string | null,
    next: { id?: string; trigger: string; resumeMode?: ResumeMode | null },
  ): ResumeChoice {
    if (next.resumeMode && next.id) return { sessionId: null, interrupted: this.getJob(next.id) };
    if (candidate) {
      const by = this.abandonedBy(candidate);
      if (by) return { sessionId: null, interrupted: by };
    }
    if (next.trigger === 'ticket.unblocked') {
      const last = this.jobsForTicket(ticketId)
        .filter(
          (job) =>
            job.id !== next.id && job.status !== 'skipped' && !ACTIVE_JOB_STATUSES.includes(job.status),
        )
        .at(-1);
      if (
        last &&
        (last.status === 'failed' || last.status === 'blocked') &&
        UNFINISHED_ERRORS.has(last.error ?? '')
      ) {
        return { sessionId: null, interrupted: last };
      }
    }
    return { sessionId: candidate, interrupted: null };
  }

  /** The session a new job of this kind resumes: the ticket's latest, unless `resumeChoice` says fresh. */
  resumableSession(ticketId: string, kind: JobKind, trigger: string): string | null {
    return this.resumeChoice(ticketId, this.latestSession(ticketId, kind), { trigger }).sessionId;
  }

  updateJob(id: string, patch: JobPatch): JobRow {
    const entries = Object.entries(patch) as [keyof typeof JOB_COLUMNS, unknown][];
    if (entries.length > 0) {
      const sets = entries.map(([key]) => `${JOB_COLUMNS[key][0]} = ?`).join(', ');
      const values = entries.map(([key, value]) => JOB_COLUMNS[key][1](value));
      this.db.prepare(`update jobs set ${sets} where id = ?`).run(...values, id);
    }
    return this.requireJob(id);
  }

  // -------------------------------------------------------------------------
  // Wake-ups folded while a job runs
  // -------------------------------------------------------------------------

  appendWakeup(ticketId: string, eventIds: string[], now = new Date()): void {
    this.db
      .prepare('insert into pending_wakeups (ticket_id, event_ids, created_at) values (?, ?, ?)')
      .run(ticketId, JSON.stringify(eventIds), now.toISOString());
  }

  /** Removes and returns the ticket's pending wake-up event ids, oldest first. */
  takeWakeups(ticketId: string): string[] {
    const rows = this.db
      .prepare('select event_ids from pending_wakeups where ticket_id = ? order by id')
      .all(ticketId) as Row[];
    this.db.prepare('delete from pending_wakeups where ticket_id = ?').run(ticketId);
    return rows.flatMap((row) => json<string[]>(row.event_ids, []));
  }

  pendingWakeupCount(ticketId: string): number {
    const row = this.db
      .prepare('select count(*) as n from pending_wakeups where ticket_id = ?')
      .get(ticketId) as Row;
    return row.n as number;
  }

  dropWakeups(ticketId: string): void {
    this.db.prepare('delete from pending_wakeups where ticket_id = ?').run(ticketId);
  }

  // -------------------------------------------------------------------------
  // Owner @pm tags
  // -------------------------------------------------------------------------

  /** Keeps what a `ticket.pm_mentioned` event names, so the PM run it wakes can read the call. */
  recordPmMention(mention: Omit<PmMention, 'createdAt'>, now = new Date()): void {
    this.db
      .prepare(
        `insert into pm_mentions (event_id, pm_task_id, source_ticket_id, source_ticket_key, comment_id, created_at)
         values (?, ?, ?, ?, ?, ?) on conflict (event_id) do nothing`,
      )
      .run(
        mention.eventId,
        mention.pmTaskId,
        mention.sourceTicketId,
        mention.sourceTicketKey,
        mention.commentId,
        now.toISOString(),
      );
  }

  /** The owner @pm tags among these event ids (a job's `eventIds`), oldest first. */
  pmMentions(eventIds: readonly string[]): PmMention[] {
    if (eventIds.length === 0) return [];
    const rows = this.db
      .prepare(
        `select * from pm_mentions where event_id in (${eventIds.map(() => '?').join(', ')})
         order by created_at, rowid`,
      )
      .all(...eventIds) as Row[];
    return rows.map((row) => ({
      eventId: row.event_id as string,
      pmTaskId: row.pm_task_id as string,
      sourceTicketId: row.source_ticket_id as string,
      sourceTicketKey: row.source_ticket_key as string,
      commentId: row.comment_id as string,
      createdAt: row.created_at as string,
    }));
  }

  // -------------------------------------------------------------------------
  // Tool log
  // -------------------------------------------------------------------------

  logTool(entry: Omit<ToolLogEntry, 'seq' | 'at'>, now = new Date()): ToolLogEntry {
    return this.transaction(() => {
      const row = this.db
        .prepare('select coalesce(max(seq), 0) as seq from tool_log where job_id = ?')
        .get(entry.jobId) as Row;
      const seq = (row.seq as number) + 1;
      const at = now.toISOString();
      this.db
        .prepare(
          'insert into tool_log (job_id, seq, tool, target, decision, reason, at) values (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(entry.jobId, seq, entry.tool, entry.target, entry.decision, entry.reason, at);
      return { ...entry, seq, at };
    });
  }

  toolLog(jobId: string): ToolLogEntry[] {
    const rows = this.db.prepare('select * from tool_log where job_id = ? order by seq').all(jobId) as Row[];
    return rows.map((row) => ({
      jobId: row.job_id as string,
      seq: row.seq as number,
      tool: row.tool as string,
      target: (row.target as string | null) ?? null,
      decision: row.decision as 'allow' | 'deny',
      reason: (row.reason as string | null) ?? null,
      at: row.at as string,
    }));
  }

  // -------------------------------------------------------------------------
  // Cleanup records
  // -------------------------------------------------------------------------

  recordCleanup(record: Omit<CleanupRecord, 'id' | 'at'>, now = new Date()): CleanupRecord {
    const at = now.toISOString();
    const result = this.db
      .prepare(
        'insert into job_cleanup (job_id, pids, ports, bytes_freed, containers, at) values (?, ?, ?, ?, ?, ?)',
      )
      .run(
        record.jobId,
        JSON.stringify(record.pids),
        JSON.stringify(record.ports),
        record.bytesFreed,
        JSON.stringify(record.containers),
        at,
      );
    return { ...record, id: Number(result.lastInsertRowid), at };
  }

  cleanups(options: { jobId?: string; limit?: number } = {}): CleanupRecord[] {
    const limit = options.limit ?? 50;
    const rows = (
      options.jobId
        ? this.db
            .prepare('select * from job_cleanup where job_id = ? order by id desc limit ?')
            .all(options.jobId, limit)
        : this.db.prepare('select * from job_cleanup order by id desc limit ?').all(limit)
    ) as Row[];
    return rows.map((row) => ({
      id: row.id as number,
      jobId: row.job_id as string,
      pids: json<number[]>(row.pids, []),
      ports: json<number[]>(row.ports, []),
      bytesFreed: row.bytes_freed as number,
      containers: json<string[]>(row.containers, []),
      at: row.at as string,
    }));
  }
}
