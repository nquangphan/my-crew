import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import {
  type DaemonProject,
  type FailedJob,
  type HealthSummary,
  type HeartbeatRequest,
  type JobWaitDetail,
  type JobWaitReason,
  type MachineSettingsState,
  type RunningJob,
  type SkillInventory,
  TERMINAL_STATUSES,
  type Ticket,
  type WaitingJob,
} from '@crew/shared';
import { type ApiFailure, VpsClient, VpsError } from './api/vps-client.js';
import { crewHome, type DaemonConfig, homePaths, type ProjectConfig } from './config.js';
import { CREW_DOCS_BUNDLE, installCrewDocs, packagedCrewDocs } from './git/docs-kit-bridge.js';
import { PROBE_WORKTREE_KEY, type ProbeClock, ProbeWorktreeKeeper } from './git/probe-worktree.js';
import {
  detectSharedPaths,
  ensureWorktree,
  git,
  removeWorktree,
  worktreeKeys,
  worktreePath,
} from './git/worktree-manager.js';
import { jobView, type MachineCommandHandlers, runMachineCommand } from './remote/machine-commands.js';
import { failedJobText } from './roles/failure-policy.js';
import { rolePlanner } from './roles/role-planner.js';
import {
  type AgentRunner,
  agentEnv,
  createSdkRunner,
  type InitInfo,
  sdkRuntimeVersion,
} from './runner/agent-runner.js';
import { cleanupJob, ensureTmpRoot, sweepOrphans } from './runner/job-cleanup.js';
import { JobRunner, type RolePlanner } from './runner/job-runner.js';
import { ResourceOps, type WorktreeEntry } from './runner/resource-report.js';
import { ResourceTracker } from './runner/resource-tracker.js';
import { type ResourceSnapshot, takeSnapshot, totalSlots } from './scheduler/resource-monitor.js';
import { Scheduler, type StartDecision } from './scheduler/scheduler.js';
import { defaultTokenStore, type TokenStore } from './secrets.js';
import {
  type ActiveSettings,
  effectiveConfig,
  localSettingsUpload,
  projectFolderProblem,
  SettingsStore,
  settingsImportedKey,
} from './settings/settings-store.js';
import { readBmadProfile } from './skills/bmad-profile.js';
import { probeInventory } from './skills/skill-inventory.js';
import { ACTIVE_JOB_STATUSES, type CleanupRecord, type JobRow, StateDb } from './state-db.js';
import { type DispatchEffect, wakeTicket } from './stream/dispatcher.js';
import { HeartbeatLoop, StreamClient } from './stream/stream-client.js';

export type LogLevel = 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string, fields?: Record<string, unknown>) => void;

const stderrLogger: Logger = (level, message, fields) => {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), level, message, ...fields })}\n`);
};

export interface DaemonTimings {
  heartbeatMs?: number;
  tickMs?: number;
  recheckMs?: number;
  sweepMs?: number;
  cleanupGraceMs?: number;
  /** How long a probe worktree is kept after its last probe (1 hour). */
  probeWorktreeTtlMs?: number;
  /** Clock of the probe worktree timers (tests). */
  probeClock?: ProbeClock;
  /** Safety-net refetch of the server settings (1 hour); events trigger a refetch at once. */
  settingsMs?: number;
  stream?: { minBackoffMs?: number; maxBackoffMs?: number; idleTimeoutMs?: number };
}

export interface CreateDaemonOptions {
  /** The local config (`~/.crew/config.yaml`); the server settings apply on top of it. */
  config: DaemonConfig;
  /** Crew home (`~/.crew` by default). */
  home?: string;
  tokenStore?: TokenStore;
  /** Agent runner: the SDK runner in production, the scripted runner in tests. */
  runner?: AgentRunner;
  /** Role behaviour; the role workflow (`rolePlanner`) by default. */
  planner?: RolePlanner;
  /** SDK `query` used by the inventory probe (and the SDK runner when `runner` is not given). */
  query?: typeof sdkQuery;
  /** Replaces the SDK inventory probe (tests). */
  probe?: (input: {
    cwd: string;
    env: Record<string, string | undefined>;
    enabledMcpjsonServers: string[];
  }) => Promise<SkillInventory>;
  /** Probe inventories at start and after runs whose skills changed (default true). */
  inventory?: boolean;
  fetch?: typeof fetch;
  tracker?: ResourceTracker;
  logger?: Logger;
  appVersion?: string;
  /** Health summary for the heartbeat (the desktop app provides it). */
  health?: () => HealthSummary | undefined;
  /** Free slots override (tests); defaults to the resource monitor. */
  slots?: () => number;
  /** crew-docs bundle copied to `~/.crew/bin` at start; null skips the install. */
  crewDocsSource?: string | null;
  /**
   * Absolute runtime the crew-docs wrapper and hooks call (default: this process's binary). The desktop app
   * passes its own executable, run with ELECTRON_RUN_AS_NODE=1, so hooks need no Node install.
   */
  crewDocsRuntime?: string;
  /** Every API call of the daemon that fails for good (the desktop app writes it to its app log). */
  onApiError?: (failure: ApiFailure) => void;
  /**
   * Handlers of remote actions the owner triggers from the web, added to (or replacing) the built-in ones
   * (pause, resume, inventory re-probe, job list). The desktop app adds the health checks and fixes, the
   * BMAD install and the log tail.
   */
  commandHandlers?: MachineCommandHandlers;
  timings?: DaemonTimings;
}

export interface DaemonStatus {
  running: boolean;
  paused: boolean;
  connected: boolean;
  cursor: string | null;
  lastEventAt: string | null;
  jobs: { running: number; queued: number; backoff: number };
  orphansCleaned: number;
  projects: { key: string; ownerState: string | null; runnable: boolean }[];
  hostsAssistant: boolean;
  /** The server settings new jobs start with. */
  settings: MachineSettingsState;
}

export interface Daemon {
  readonly state: StateDb;
  readonly jobs: JobRunner;
  readonly scheduler: Scheduler;
  readonly stream: StreamClient;
  readonly events: EventEmitter;
  start(): Promise<void>;
  /** Graceful stop: running jobs are aborted and re-queued to resume on the next start. */
  stop(): Promise<void>;
  /** Crash stand-in for tests: stops at once and writes nothing more. */
  halt(): Promise<void>;
  pause(): void;
  resume(): void;
  status(): DaemonStatus;
  /** Applies a new local config live (projects, folders) without a restart; server settings stay on top. */
  updateConfig(config: DaemonConfig): void;
  /** The config jobs start with: the local config with the server settings applied. */
  effectiveConfig(): DaemonConfig;
  /** The server settings new jobs start with (prompts, path rules, models, resources, MCP switches). */
  settings(): ActiveSettings;
  /** Refetches the server settings now (an unreachable server keeps the current ones). */
  refreshSettings(): Promise<void>;
  /** Switches MCP servers of a project this machine owns, as a new revision of the server setting. */
  setProjectMcp(projectKey: string, disabledMcpServers: readonly string[], note?: string): Promise<void>;
  /** Sets (or with null, removes) one project's folder on this machine in its server setting. */
  setProjectFolder(
    projectKey: string,
    folder: { repoPath: string; sharedPaths?: readonly string[] } | null,
  ): Promise<void>;
  /** Why this machine cannot use each server folder it has (missing, not a repo), by project key. */
  folderProblems(): ReadonlyMap<string, string>;
  /** Replaces the project list live (Settings → Projects in the desktop app). */
  updateProjects(projects: DaemonConfig['projects']): void;
  refreshProjects(): Promise<void>;
  refreshInventory(projectKey: string | null): Promise<SkillInventory | null>;
  /** Periodic sweep: orphan processes, temp dirs and worktrees of closed tickets. */
  sweep(): Promise<number>;
  heartbeat(): Promise<void>;
  /** Resolves when no job is running. */
  idle(): Promise<void>;
}

const MACHINE_INVENTORY = '';
/** A failed job is reported to the server (as the ticket's agent activity) for a day. */
const FAILED_JOB_REPORT_MS = 24 * 60 * 60 * 1000;
/** The docs standard is installed next to the crew-docs bundle, for the docs-init prompt. */
const STANDARD_FILE = 'STANDARD.md';

/** `STANDARD.md` of the `@crew/docs-kit` package this daemon was built with, when it can be found. */
function packagedStandard(): string | null {
  try {
    const manifest = createRequire(import.meta.url).resolve('@crew/docs-kit/package.json');
    const file = join(dirname(manifest), STANDARD_FILE);
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

function readMcpJsonServers(repo: string): string[] {
  const file = `${repo}/.mcp.json`;
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: Record<string, unknown> };
    return Object.keys(parsed.mcpServers ?? {});
  } catch {
    return [];
  }
}

/** Refuses to start a second daemon on the same home (it would break one-job-per-ticket). */
function takePidLock(pidFile: string): void {
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code === 'EPERM';
      }
      if (alive) throw new Error(`crewd is already running (pid ${pid})`);
    }
  }
  writeFileSync(pidFile, `${process.pid}\n`, { mode: 0o600 });
}

/**
 * The daemon runtime as a library: the CLI `start` command and the desktop app both run it. It keeps the
 * event stream, turns events into jobs, schedules them against the machine, runs each as an agent and
 * cleans up after it.
 */
export function createDaemon(options: CreateDaemonOptions): Daemon {
  /** The local config; `config` below is what jobs use (server settings applied). */
  let localConfig = options.config;
  let config = options.config;
  const home = options.home ?? crewHome();
  const paths = homePaths(home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const log = options.logger ?? stderrLogger;
  const tokenStore = options.tokenStore ?? defaultTokenStore(paths.tokenFile);
  const state = new StateDb(paths.stateDb);
  const vps = new VpsClient({
    apiUrl: config.apiUrl,
    token: () => tokenStore.get(),
    fetch: options.fetch,
    ...(options.onApiError ? { onError: options.onApiError } : {}),
  });
  const tracker = options.tracker ?? new ResourceTracker();
  const events = new EventEmitter();
  const timings = options.timings ?? {};
  const settingsStore = new SettingsStore({ vps, cacheFile: paths.settingsCache, log });
  /** The one-time upload of this machine's local settings succeeded (per paired machine). */
  const importedKey = () => settingsImportedKey(localConfig.machineId);
  const localImported = () => state.getMeta(importedKey()) === '1';
  /** Server folders this machine checked: usable, or why not (missing, unreadable, not a repo root). */
  const folderStatus = new Map<string, { repoPath: string; error: string | null }>();
  const folderOk = (entry: { key: string; repoPath: string }) => {
    const status = folderStatus.get(entry.key);
    return status?.repoPath === entry.repoPath && status.error === null;
  };
  /** The settings the heartbeat reports: the store's, plus every server folder this machine cannot use. */
  const settingsState = (): MachineSettingsState => {
    const base = settingsStore.state();
    const folders = [...folderStatus.entries()]
      .filter(([, status]) => status.error !== null)
      .map(([key, status]) => `project_folder:${key}: ${status.error}`.slice(0, 200));
    return { ...base, rejected: [...base.rejected, ...folders].slice(0, 100) };
  };
  config = effectiveConfig(localConfig, settingsStore.current(), localImported(), folderOk);

  let started = false;
  let paused = false;
  let stopping = false;
  let halted = false;
  let orphansCleaned = 0;
  let claudeVersion: string | null = sdkRuntimeVersion();
  let crewDocs: { bundle: string; runtime: string } | null = null;
  let standardPath: string | null = null;
  let projectsView = new Map<string, DaemonProject>();
  let hostsAssistant = false;
  const inventories = new Map<string, SkillInventory>();
  const probing = new Map<string, Promise<SkillInventory | null>>();
  /** API calls started without awaiting them; stop and halt wait for them before closing the state db. */
  const background = new Set<Promise<unknown>>();
  const inBackground = (work: Promise<unknown>): void => {
    const settled = work.catch(() => undefined);
    background.add(settled);
    void settled.then(() => background.delete(settled));
  };
  const backgroundIdle = async () => {
    while (background.size > 0) await Promise.allSettled([...background]);
  };
  let sweepTimer: NodeJS.Timeout | null = null;
  let settingsTimer: NodeJS.Timeout | null = null;
  /** The scheduler runs (set once `start()` started it). */
  let scheduling = false;

  for (const row of state.db.prepare(`select key, value from meta where key like 'inventory:%'`).all() as {
    key: string;
    value: string;
  }[]) {
    try {
      inventories.set(row.key.slice('inventory:'.length), JSON.parse(row.value) as SkillInventory);
    } catch {
      // re-probed on start
    }
  }

  const localProject = (key: string): ProjectConfig | null =>
    config.projects.find((p) => p.key === key) ?? null;

  const probeWorktrees = new ProbeWorktreeKeeper({
    meta: { get: (key) => state.getMeta(key), set: (key, value) => state.setMeta(key, value) },
    repoOf: (projectKey) => localProject(projectKey)?.repoPath ?? null,
    busy: (projectKey) => probing.has(projectKey),
    ...(timings.probeWorktreeTtlMs === undefined ? {} : { ttlMs: timings.probeWorktreeTtlMs }),
    ...(timings.probeClock ? { clock: timings.probeClock } : {}),
    onError: (projectKey, error) =>
      log('warn', 'probe worktree removal failed', { projectKey, error: error.message }),
  });
  const expireProbeWorktrees = () => probeWorktrees.expire(config.projects.map((project) => project.key));

  /** The local project for a server project id, when this machine owns it and has a folder for it. */
  const projectFor = (projectId: string | null): ProjectConfig | null => {
    if (!projectId) return null;
    const view = projectsView.get(projectId);
    if (view?.ownerState !== 'mine') return null;
    return localProject(view.key);
  };

  const inventoryFor = (projectKey: string | null): SkillInventory =>
    inventories.get(projectKey ?? MACHINE_INVENTORY) ?? { skills: [], mcpServers: [] };

  const slots = () => options.slots?.() ?? totalSlots(config.resources, takeSnapshot(home));

  async function refreshProjects(): Promise<void> {
    const view = await vps.listProjects();
    projectsView = new Map(view.items.map((item) => [item.id, item]));
    hostsAssistant = view.assistant.state === 'mine';
  }

  /**
   * Reports the project's BMAD profile (read from the main checkout) when this machine owns the project and the
   * profile changed since its last report. The server keeps the newest install, so an outdated `_bmad` on a
   * machine that took the project over never hides the setup another machine reported.
   */
  async function reportBmadProfile(project: ProjectConfig): Promise<void> {
    const view = [...projectsView.values()].find((item) => item.key === project.key);
    if (view?.ownerState !== 'mine') return;
    try {
      const profile = readBmadProfile(project.repoPath);
      if (!profile) return;
      const json = JSON.stringify(profile);
      const metaKey = `bmad-profile:${project.key}`;
      if (state.getMeta(metaKey) === json) return;
      const answer = await vps.putBmadProfile(
        project.key,
        profile,
        `bmad-profile:${project.key}:${Date.now()}`,
      );
      state.setMeta(metaKey, json);
      log('info', answer.stored ? 'bmad profile reported' : 'bmad profile older than the stored one', {
        projectKey: project.key,
        version: profile.version,
        stored: answer.stored,
      });
    } catch (error) {
      log('warn', 'bmad profile report failed', { projectKey: project.key, error: (error as Error).message });
    }
  }

  async function refreshInventory(projectKey: string | null): Promise<SkillInventory | null> {
    const key = projectKey ?? MACHINE_INVENTORY;
    const inFlight = probing.get(key);
    if (inFlight) return inFlight;
    const run = (async () => {
      const project = projectKey ? localProject(projectKey) : null;
      if (projectKey && !project) return null;
      if (project) await reportBmadProfile(project);
      let cwd = paths.assistantDir;
      let enabled: string[] = [];
      if (project) {
        const sharedPaths = detectSharedPaths(project.repoPath, project.sharedPaths);
        // A probe worktree prepared exactly like a job worktree, so the inventory is what agents see.
        const probe = ensureWorktree({
          repo: project.repoPath,
          key: PROBE_WORKTREE_KEY,
          base: project.defaultBranch,
          sharedPaths,
          detach: true,
        });
        if (!probe.created) git(probe.path, ['checkout', '--quiet', '--detach', project.defaultBranch]);
        cwd = probe.path;
        enabled = readMcpJsonServers(project.repoPath).filter(
          (name) => !project.disabledMcpServers.includes(name),
        );
      } else {
        mkdirSync(cwd, { recursive: true });
      }
      const env = agentEnv(process.env, {});
      const inventory = options.probe
        ? await options.probe({ cwd, env, enabledMcpjsonServers: enabled })
        : (
            await probeInventory({
              cwd,
              env,
              enabledMcpjsonServers: enabled,
              ...(options.query ? { query: options.query } : {}),
            })
          ).inventory;
      inventories.set(key, inventory);
      state.setMeta(`inventory:${key}`, JSON.stringify(inventory));
      // The server refuses tickets that require a server the owner switched off for the project.
      const disabledHere = new Set(project?.disabledMcpServers ?? []);
      const reported = {
        skills: inventory.skills,
        mcpServers: inventory.mcpServers.map((server) =>
          disabledHere.has(server.name) ? { ...server, disabled: true } : server,
        ),
      };
      await vps.putSkills(
        { projectKey: projectKey, ...reported },
        `inventory:${key || 'machine'}:${Date.now()}`,
      );
      return inventory;
    })()
      .catch((error: Error) => {
        log('warn', 'inventory probe failed', { projectKey, error: error.message });
        return null;
      })
      .finally(() => {
        probing.delete(key);
        // Kept for reuse by the next probe for an hour, then removed.
        if (projectKey && localProject(projectKey)) {
          probeWorktrees.used(projectKey, { arm: !stopping && !halted });
        }
      });
    probing.set(key, run);
    return run;
  }

  const onInit = (job: JobRow, init: InitInfo, project: ProjectConfig | null) => {
    claudeVersion =
      init.claudeCodeVersion && init.claudeCodeVersion !== 'scripted'
        ? init.claudeCodeVersion
        : claudeVersion;
    if (options.inventory === false) return;
    const known = new Set(inventoryFor(project?.key ?? null).skills.map((skill) => skill.name));
    if (init.skills.some((skill) => !known.has(skill))) {
      log('info', 'skills changed since the last probe; refreshing the inventory', { jobId: job.id });
      void refreshInventory(project?.key ?? null);
    }
  };

  async function worktreeEntries(): Promise<WorktreeEntry[]> {
    const entries: WorktreeEntry[] = [];
    for (const project of config.projects) {
      if (!existsSync(project.repoPath)) continue;
      for (const key of worktreeKeys(project.repoPath)) {
        if (key === PROBE_WORKTREE_KEY) continue;
        let ticketStatus: string | null = null;
        try {
          ticketStatus = (await vps.getTicket(key)).ticket.status;
        } catch {
          ticketStatus = null;
        }
        entries.push({
          projectKey: project.key,
          repo: project.repoPath,
          key,
          path: worktreePath(project.repoPath, key),
          ticketStatus,
        });
      }
    }
    return entries;
  }

  const jobs: JobRunner = new JobRunner({
    state,
    vps,
    runner: options.runner ?? createSdkRunner(options.query ? { query: options.query } : {}),
    planner: options.planner ?? rolePlanner,
    tracker,
    config: () => config,
    settings: () => settingsStore.current(),
    tmpRoot: paths.tmp,
    binDir: paths.bin,
    crewDocs: () => crewDocs,
    standardPath: () => standardPath,
    projectFor,
    inventoryFor,
    workspace: ({ job, ticket, project, base }) => {
      if (job.role === 'assistant' && !ticket.projectId) {
        mkdirSync(paths.assistantDir, { recursive: true });
        return { cwd: paths.assistantDir, sharedPaths: [], worktreeKey: null };
      }
      if (!project) throw new Error(`project of ${ticket.key} is not configured on this machine`);
      const sharedPaths = detectSharedPaths(project.repoPath, project.sharedPaths);
      const worktree = ensureWorktree({
        repo: project.repoPath,
        key: ticket.key,
        base: base ?? project.defaultBranch,
        sharedPaths,
      });
      return { cwd: worktree.path, sharedPaths, worktreeKey: ticket.key };
    },
    releaseWorkspace: ({ ticket, project }) => {
      if (project) removeWorktree(project.repoPath, ticket.key);
    },
    contextBlock: async (_job, cwd) => {
      const project = config.projects.find((p) => cwd.startsWith(p.repoPath)) ?? null;
      const inventory = inventoryFor(project?.key ?? null);
      const disabled = new Set(project?.disabledMcpServers ?? []);
      return {
        stage: _job.stage,
        machine: { ...takeSnapshot(home), freeSlots: slots() },
        runningJobs: state.listJobs(['running']).map((job) => ({
          ticketId: job.ticketId,
          role: job.role,
          kind: job.kind,
          startedAt: job.startedAt,
        })),
        capabilities: {
          skills: inventory.skills,
          mcpServers: inventory.mcpServers.filter((server) => !disabled.has(server.name)),
        },
      };
    },
    resourceOps: () =>
      new ResourceOps({
        state,
        tracker,
        tmpRoot: paths.tmp,
        snapshot: () => takeSnapshot(home),
        freeSlots: slots,
        runningJobIds: () => jobs.runningJobIds(),
        worktrees: worktreeEntries,
        removeWorktree: (entry) => removeWorktree(entry.repo, entry.key),
        graceMs: timings.cleanupGraceMs,
      }),
    onInit,
    onCleaned: (job, ticket, record) => inBackground(wakePmForLeftovers(job, ticket, record)),
    onJobChanged: (job) => events.emit('job', job),
    log,
    stopping: () => stopping,
    halted: () => halted,
    cleanupGraceMs: timings.cleanupGraceMs,
  });

  /** Ticket keys by id, for log lines (jobs only carry the ticket id). */
  const ticketKeys = new Map<string, string>();

  async function decide(job: JobRow): Promise<StartDecision> {
    if (job.projectId) {
      const view = projectsView.get(job.projectId);
      if (!view)
        return {
          action: 'defer',
          reason: 'project not in this machine view yet',
          wait: 'project_not_here',
        };
      if (view.ownerState !== 'mine')
        return {
          action: 'defer',
          reason: `project ${view.key} is not owned here`,
          wait: 'project_not_here',
          detail: { projectKey: view.key },
        };
      if (!localProject(view.key))
        return {
          action: 'defer',
          reason: `project ${view.key} has no local folder`,
          wait: 'no_local_folder',
          detail: { projectKey: view.key },
        };
    } else if (job.role === 'assistant' && !hostsAssistant) {
      return {
        action: 'defer',
        reason: 'this machine does not host the assistant',
        wait: 'not_assistant_host',
      };
    }
    const detail = await vps.getTicket(job.ticketId);
    const { ticket } = detail;
    ticketKeys.set(ticket.id, ticket.key);
    if (ticket.status === 'done' || ticket.status === 'cancelled') {
      return { action: 'skip', reason: `ticket is ${ticket.status}` };
    }
    const unfinished: string[] = [];
    for (const dependency of ticket.dependsOn) {
      const dep = await vps.getTicket(dependency);
      if (dep.ticket.status !== 'done') unfinished.push(dep.ticket.key);
    }
    if (unfinished.length > 0) return { action: 'wait_deps', dependsOn: unfinished };
    const budget = await vps.getBudget(ticket.id);
    // The server holds the pm_task for the owner; the job stays queued and starts once they approve.
    if (budget.overBudget)
      return { action: 'defer', reason: 'over budget: waiting for the owner', wait: 'over_budget' };
    return { action: 'start' };
  }

  /** Logs a job's new wait reason once, with its ticket key (fetched when the scheduler has not seen it). */
  function logWaitChange(job: JobRow, reason: JobWaitReason, detail: JobWaitDetail | null): void {
    reportSoon();
    const write = (ticket: string) =>
      log('info', 'job waiting', {
        ticket,
        jobId: job.id,
        role: job.role,
        reason,
        ...(job.waitReason ? { previous: job.waitReason } : {}),
        ...(detail ? { detail } : {}),
      });
    const known = ticketKeys.get(job.ticketId);
    if (known) {
      write(known);
      return;
    }
    vps.getTicket(job.ticketId).then(
      ({ ticket }) => {
        ticketKeys.set(ticket.id, ticket.key);
        write(ticket.key);
      },
      () => write(job.ticketId),
    );
  }

  /**
   * A finished child left processes, ports or containers that its cleanup had to stop: wake the PM of its
   * pm_task, which checks `resource_report` and comments which ticket left them.
   */
  async function wakePmForLeftovers(job: JobRow, ticket: Ticket, record: CleanupRecord): Promise<void> {
    if (record.pids.length + record.ports.length + record.containers.length === 0) return;
    if (!ticket.parentId || !['dev', 'bug', 'qc', 'docs_init'].includes(ticket.type)) return;
    try {
      const parent = (await vps.getTicket(ticket.parentId)).ticket;
      if (parent.type !== 'pm_task' || TERMINAL_STATUSES.includes(parent.status)) return;
      if (!projectFor(parent.projectId)) return;
      const effect = state.transaction(() =>
        wakeTicket(state, {
          ticketId: parent.id,
          projectId: parent.projectId,
          role: 'pm',
          trigger: 'child.resources',
          eventId: `cleanup:${record.id}:${job.id}`,
        }),
      );
      events.emit('job', effect.job);
      void scheduler.tick();
    } catch (error) {
      log('warn', 'PM resource wake-up failed', { jobId: job.id, error: (error as Error).message });
    }
  }

  /**
   * `ticket.cancelled` names the root of the cancelled tree only; the server has already cancelled its
   * descendants. Every active job of this daemon whose ticket is now cancelled stops, and its worktree goes.
   */
  async function cancelDescendants(rootId: string): Promise<void> {
    for (const job of state.listJobs(['queued', 'running', 'backoff'])) {
      if (job.ticketId === rootId) continue;
      let ticket: Ticket;
      try {
        ticket = (await vps.getTicket(job.ticketId)).ticket;
      } catch {
        continue;
      }
      if (ticket.status !== 'cancelled') continue;
      state.dropWakeups(ticket.id);
      const current = state.getJob(job.id);
      if (current?.status === 'running') {
        state.updateJob(job.id, { cancelRequested: true });
        jobs.abort(job.id);
        continue;
      }
      if (current && (current.status === 'queued' || current.status === 'backoff')) {
        events.emit(
          'job',
          state.updateJob(job.id, {
            status: 'cancelled',
            endedAt: new Date().toISOString(),
            error: 'ticket cancelled with its parent',
          }),
        );
      }
      const project = projectFor(ticket.projectId);
      if (project) {
        try {
          removeWorktree(project.repoPath, ticket.key);
        } catch (error) {
          log('warn', 'worktree removal failed', { ticket: ticket.key, error: (error as Error).message });
        }
      }
    }
  }

  const scheduler = new Scheduler({
    state,
    slots,
    paused: () => paused || stopping || halted,
    decide,
    launch: (job) => jobs.launch(job),
    onError: (error, job) => log('warn', 'scheduler', { jobId: job?.id, error: error.message }),
    onWaitChange: logWaitChange,
    tickMs: timings.tickMs,
    recheckMs: timings.recheckMs,
  });

  function onEffect(effect: DispatchEffect): void {
    switch (effect.kind) {
      case 'enqueued':
      case 'absorbed':
      case 'recheck':
        events.emit('job', effect.job);
        void scheduler.tick();
        break;
      case 'folded':
        break;
      case 'cancel':
        inBackground(
          cancelDescendants(effect.ticketId).catch((error: Error) =>
            log('warn', 'cancel cascade failed', { ticketId: effect.ticketId, error: error.message }),
          ),
        );
        if (effect.job?.status === 'running' && jobs.abort(effect.job.id)) break;
        inBackground(
          (async () => {
            try {
              const { ticket } = await vps.getTicket(effect.ticketId);
              const project = projectFor(ticket.projectId);
              if (project) removeWorktree(project.repoPath, ticket.key);
            } catch (error) {
              log('warn', 'cancel cleanup failed', {
                ticketId: effect.ticketId,
                error: (error as Error).message,
              });
            }
          })(),
        );
        break;
      case 'refresh_projects':
        inBackground(
          refreshProjects()
            .then(() => releaseLostProjects())
            .then(() => scheduler.tick())
            .catch((error: Error) => log('warn', 'project refresh failed', { error: error.message })),
        );
        // A project moved here or away: its MCP switches come with it.
        inBackground(refreshSettings());
        break;
      case 'refresh_settings':
        inBackground(refreshSettings());
        break;
      case 'run_command':
        inBackground(runMachineCommand({ vps, handlers: commandHandlers, log }, effect.commandId));
        break;
      case 'ignored':
        break;
    }
  }

  const stream = new StreamClient({
    vps,
    state,
    fetch: options.fetch,
    onEffect,
    onConnected: () => {
      log('info', 'stream connected', { cursor: state.getCursor() });
      // A settings change may have been missed while the stream was down.
      inBackground(refreshSettings());
      inBackground(
        refreshProjects()
          .catch((error: Error) => log('warn', 'project refresh failed', { error: error.message }))
          .finally(() => void scheduler.recheckWaiting()),
      );
    },
    onError: (error) => log('warn', 'stream', { error: error.message }),
    ...(timings.stream ?? {}),
  });

  /** After a claim moved away: stop running jobs of projects this machine no longer owns, drop queued ones. */
  function releaseLostProjects(): void {
    for (const job of state.listJobs(['queued', 'running', 'backoff'])) {
      if (!job.projectId) continue;
      const view = projectsView.get(job.projectId);
      if (view?.ownerState === 'mine') continue;
      if (job.status === 'running') {
        state.updateJob(job.id, { cancelRequested: true });
        jobs.abort(job.id);
      } else {
        state.updateJob(job.id, {
          status: 'skipped',
          error: 'the project moved to another machine',
          endedAt: new Date().toISOString(),
        });
      }
      log('info', 'job released: project no longer owned here', { jobId: job.id });
    }
  }

  /**
   * Why a held job waits, as the owner should read it now: paused and a pending retry time win over the
   * scheduler's last decision, and a slot shortage carries the current load, memory and slot numbers.
   */
  function waitOf(
    job: JobRow,
    snapshot: ResourceSnapshot,
    running: number,
    now: number,
  ): { waitReason?: JobWaitReason; waitDetail?: JobWaitDetail } {
    if (paused) return { waitReason: 'paused' };
    if (job.retryAt && Date.parse(job.retryAt) > now) {
      return { waitReason: 'retry_at', waitDetail: { retryAt: job.retryAt } };
    }
    if (job.waitReason === 'no_slots') {
      const { resources } = config;
      return {
        waitReason: 'no_slots',
        waitDetail: {
          loadAvg1: snapshot.loadAvg1,
          cpus: snapshot.cpus,
          maxLoad: Math.round(snapshot.cpus * resources.maxLoadPerCpu * 100) / 100,
          freeMemGb: snapshot.freeMemGb,
          minFreeMemGb: resources.minFreeMemGb,
          slots: options.slots?.() ?? totalSlots(resources, snapshot),
          runningJobs: running,
        },
      };
    }
    return {
      ...(job.waitReason ? { waitReason: job.waitReason } : {}),
      ...(job.waitDetail ? { waitDetail: job.waitDetail } : {}),
    };
  }

  async function heartbeat(): Promise<void> {
    const snapshot = takeSnapshot(home);
    const now = Date.now();
    const isTicketId = (job: JobRow) => /^[0-9a-f-]{36}$/i.test(job.ticketId);
    const running = state.listJobs(['running']);
    const runningJobs: RunningJob[] = running.filter(isTicketId).map((job) => ({
      ticketId: job.ticketId,
      role: job.role,
      kind: job.kind,
      ...(job.startedAt ? { startedAt: job.startedAt } : {}),
      ...(job.stage ? { stage: job.stage } : {}),
      ...(job.model ? { model: job.model.slice(0, 100) } : {}),
      ...(job.effort ? { effort: job.effort.slice(0, 20) } : {}),
      ...(job.settingsRevision ? { settingsRevision: job.settingsRevision.slice(0, 100) } : {}),
    }));
    // Held but not running: the server's stuck-ticket alarm must not report these tickets, and the owner
    // sees why each one waits.
    const waitingJobs: WaitingJob[] = state
      .listJobs(['queued', 'backoff'])
      .filter(isTicketId)
      .map((job) => ({
        ticketId: job.ticketId,
        status: job.status === 'backoff' ? 'backoff' : 'queued',
        ...(job.retryAt ? { retryAt: job.retryAt } : {}),
        role: job.role,
        kind: job.kind,
        ...(job.stage ? { stage: job.stage } : {}),
        since: job.createdAt,
        ...waitOf(job, snapshot, running.length, now),
      }));
    const failedJobs: FailedJob[] = state
      .latestFailures(new Date(now - FAILED_JOB_REPORT_MS))
      .filter(isTicketId)
      .map((job) => ({
        ticketId: job.ticketId,
        role: job.role,
        ...(job.stage ? { stage: job.stage } : {}),
        failedAt: job.endedAt ?? job.createdAt,
        error: failedJobText(job),
      }))
      .slice(-200);
    const health = options.health?.();
    const body: HeartbeatRequest = {
      resources: {
        cpus: snapshot.cpus,
        loadAvg1: snapshot.loadAvg1,
        freeMemGb: snapshot.freeMemGb,
        totalMemGb: snapshot.totalMemGb,
        ...(snapshot.diskFreeGb === null ? {} : { diskFreeGb: snapshot.diskFreeGb }),
        orphansCleaned,
      },
      runningJobs,
      waitingJobs,
      failedJobs,
      cliVersion: claudeVersion ?? 'unknown',
      ...(options.appVersion ? { appVersion: options.appVersion } : {}),
      paused,
      ...(health ? { health } : {}),
      settings: settingsState(),
    };
    const response = await vps.heartbeat(body);
    state.setMeta('tokenExpiresAt', response.tokenExpiresAt);
  }

  const heartbeatLoop = new HeartbeatLoop({
    intervalMs: timings.heartbeatMs,
    beat: heartbeat,
    onError: (error) => log('warn', 'heartbeat failed', { error: error.message }),
  });

  /** Sends a heartbeat now (coalesced), so the owner sees a job change without waiting for the 30 s beat. */
  function reportSoon(): void {
    if (started && !stopping && !halted) void heartbeatLoop.tick();
  }

  // A job was taken, started, parked or ended: report it at once. Other job updates wait for the timer.
  const lastStatus = new Map<string, string>();
  events.on('job', (job: JobRow) => {
    if (lastStatus.get(job.id) === job.status) return;
    if (ACTIVE_JOB_STATUSES.includes(job.status)) lastStatus.set(job.id, job.status);
    else lastStatus.delete(job.id);
    reportSoon();
  });

  async function sweepWorktrees(): Promise<number> {
    let removed = 0;
    const inUse = new Set(state.listJobs(['queued', 'running', 'backoff']).map((job) => job.worktree));
    for (const entry of await worktreeEntries()) {
      if (entry.ticketStatus !== 'done' && entry.ticketStatus !== 'cancelled') continue;
      if (inUse.has(entry.path)) continue;
      try {
        if (removeWorktree(entry.repo, entry.key)) removed += 1;
      } catch (error) {
        log('warn', 'worktree sweep failed', { key: entry.key, error: (error as Error).message });
      }
    }
    return removed;
  }

  async function sweep(): Promise<number> {
    const result = await sweepOrphans(
      { state, tracker, tmpRoot: paths.tmp, graceMs: timings.cleanupGraceMs },
      jobs.runningJobIds(),
    );
    const worktrees = await sweepWorktrees().catch(() => 0);
    // A probe worktree past its hour (a missed timer, or a restart) is not an orphan: not counted.
    expireProbeWorktrees();
    orphansCleaned = result.cleaned + worktrees;
    if (orphansCleaned > 0) log('info', 'sweep cleaned orphans', { count: orphansCleaned });
    return orphansCleaned;
  }

  /** Jobs left `running` by a previous process: stop what they left, then resume or reconcile them. */
  async function reconcileRestart(): Promise<void> {
    for (const job of state.listJobs(['running'])) {
      await cleanupJob({ state, tracker, tmpRoot: paths.tmp, graceMs: timings.cleanupGraceMs }, job).catch(
        () => undefined,
      );
      state.updateJob(job.id, {
        status: 'queued',
        resumeMode: job.sessionId ? 'restart_resume' : 'restart_fresh',
        pgid: null,
      });
    }
  }

  function installBundle(): void {
    const source = options.crewDocsSource === undefined ? packagedCrewDocs() : options.crewDocsSource;
    if (source === null) return;
    const runtime = options.crewDocsRuntime ?? process.execPath;
    try {
      const installed = installCrewDocs(paths.bin, source, runtime);
      crewDocs = { bundle: installed.bundle, runtime };
      const standard = packagedStandard();
      if (standard) {
        copyFileSync(standard, join(paths.bin, STANDARD_FILE));
        standardPath = join(paths.bin, STANDARD_FILE);
      }
    } catch (error) {
      const existing = `${paths.bin}/${CREW_DOCS_BUNDLE}`;
      if (existsSync(existing)) crewDocs = { bundle: existing, runtime };
      log('warn', 'crew-docs install failed', { error: (error as Error).message });
    }
  }

  /** Ticket keys and titles by id, for the job list the web asks for. */
  const ticketInfo = new Map<string, { key: string; title: string }>();
  async function ticketOf(ticketId: string): Promise<{ key: string; title: string } | null> {
    const known = ticketInfo.get(ticketId);
    if (known) return known;
    try {
      const { ticket } = await vps.getTicket(ticketId);
      const info = { key: ticket.key, title: ticket.title };
      ticketInfo.set(ticketId, info);
      return info;
    } catch {
      return null;
    }
  }

  /** The remote actions this daemon performs itself; the app that hosts it may add more. */
  const commandHandlers = (): MachineCommandHandlers => ({
    pause: async () => {
      daemon.pause();
      return { paused: true };
    },
    resume: async () => {
      daemon.resume();
      return { paused: false };
    },
    'inventory.refresh': async ({ projectKey }) => {
      if (projectKey && !localProject(projectKey)) {
        throw new Error(`Máy này chưa có thư mục cho dự án ${projectKey}.`);
      }
      const inventory = await refreshInventory(projectKey);
      if (!inventory) throw new Error('Dò skill và MCP thất bại (xem log của máy).');
      return { skills: inventory.skills.length, mcpServers: inventory.mcpServers.length };
    },
    'project.release': async ({ projectKey }) => {
      const answer = await vps.release({ projectKey }, `release:${projectKey}:${randomUUID()}`);
      await refreshProjects();
      releaseLostProjects();
      await refreshSettings();
      return { status: answer.status };
    },
    'assistant.release': async () => {
      const answer = await vps.release({ hostsAssistant: true }, `release:assistant:${randomUUID()}`);
      await refreshProjects();
      return { status: answer.status };
    },
    'jobs.list': async () => {
      const views = [];
      for (const job of state.recentJobs(50)) views.push(jobView(job, await ticketOf(job.ticketId)));
      return views;
    },
    ...options.commandHandlers,
  });

  /** Recomputes the config jobs use; projects whose MCP switches changed are re-probed. */
  function applyConfig(): void {
    const before = new Map(config.projects.map((project) => [project.key, JSON.stringify(project)]));
    config = effectiveConfig(localConfig, settingsStore.current(), localImported(), folderOk);
    if (options.inventory !== false) {
      for (const project of config.projects) {
        if (before.get(project.key) !== JSON.stringify(project)) void refreshInventory(project.key);
      }
    }
    // Before the start sequence finished (reconcile, sweep) the scheduler must not launch anything.
    if (scheduling) void scheduler.tick();
    events.emit('status', daemon.status());
  }

  /**
   * The one-time upload of the local `config.yaml` values (resources, models, budgets, MCP switches) as this
   * machine's server settings, kept by the server only where it has none. Retried at the next refresh until
   * it succeeds; until then the local values stay the fallback.
   */
  async function importLocalSettings(): Promise<void> {
    if (localImported()) return;
    const body = localSettingsUpload(localConfig);
    const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
    try {
      const answer = await vps.importSettings(
        body,
        `settings-import:${localConfig.machineId ?? 'unpaired'}:${digest}`,
      );
      state.setMeta(importedKey(), '1');
      log('info', 'local settings uploaded to the server', { created: answer.created, kept: answer.kept });
      await settingsStore.refresh();
      await checkFolders();
      applyConfig();
    } catch (error) {
      log('warn', 'local settings upload failed; the local values stay in use until it succeeds', {
        error: (error as Error).message,
      });
    }
  }

  /** Checks the server's folders this machine has not proven usable yet (a failed one is checked again). */
  async function checkFolders(): Promise<boolean> {
    const folders = settingsStore.current().folders?.projects ?? [];
    let changed = false;
    for (const entry of folders) {
      const known = folderStatus.get(entry.key);
      if (known?.repoPath === entry.repoPath && known.error === null) continue;
      const error = await projectFolderProblem(entry.repoPath);
      if (known?.repoPath !== entry.repoPath || known.error !== error) changed = true;
      folderStatus.set(entry.key, { repoPath: entry.repoPath, error });
      if (error)
        log('warn', 'project folder unusable', { projectKey: entry.key, path: entry.repoPath, error });
    }
    for (const key of [...folderStatus.keys()]) {
      if (!folders.some((entry) => entry.key === key)) {
        folderStatus.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  async function refreshSettings(): Promise<void> {
    if (halted) return;
    const changed = await settingsStore.refresh();
    const folders = await checkFolders();
    if (changed || folders) {
      applyConfig();
      reportSoon();
    }
    await importLocalSettings();
  }

  const daemon: Daemon = {
    state,
    jobs,
    scheduler,
    stream,
    events,
    async start() {
      if (started) return;
      if (!tokenStore.get())
        throw new VpsError(401, 'UNAUTHORIZED', 'this machine is not paired; run crewd pair');
      takePidLock(paths.pidFile);
      started = true;
      stopping = false;
      halted = false;
      ensureTmpRoot(paths.tmp);
      // Temp dirs of older versions lived at `<home>/tmp`; the pid lock makes them this daemon's to drop.
      rmSync(join(home, 'tmp'), { recursive: true, force: true });
      installBundle();
      await reconcileRestart();
      await refreshProjects().catch((error: Error) =>
        log('warn', 'project refresh failed', { error: error.message }),
      );
      // Before any job starts: the prompts, rules and limits it runs with.
      await refreshSettings();
      await sweep().catch((error: Error) => log('warn', 'startup sweep failed', { error: error.message }));
      if (options.inventory !== false) {
        void refreshInventory(null);
        for (const project of config.projects) void refreshInventory(project.key);
      }
      stream.start();
      heartbeatLoop.start();
      scheduler.start();
      scheduling = true;
      sweepTimer = setInterval(() => void sweep().catch(() => undefined), timings.sweepMs ?? 10 * 60 * 1000);
      settingsTimer = setInterval(
        () => inBackground(refreshSettings()),
        timings.settingsMs ?? 60 * 60 * 1000,
      );
      events.emit('status', daemon.status());
      log('info', 'crewd started', { home, apiUrl: config.apiUrl });
    },
    async stop() {
      if (!started) return;
      stopping = true;
      scheduling = false;
      if (sweepTimer) clearInterval(sweepTimer);
      if (settingsTimer) clearInterval(settingsTimer);
      probeWorktrees.stop();
      await stream.stop();
      await scheduler.stop();
      jobs.abortAll();
      await jobs.idle();
      await heartbeatLoop.stop();
      await backgroundIdle();
      await Promise.allSettled([...probing.values()]);
      const final = { ...daemon.status(), running: false };
      state.close();
      rmSync(paths.pidFile, { force: true });
      // The temp root sits in /tmp, outside the home: drop it when no job left anything behind.
      try {
        rmdirSync(paths.tmp);
      } catch {
        // not empty, or already gone
      }
      started = false;
      events.emit('status', final);
    },
    async halt() {
      halted = true;
      scheduling = false;
      if (sweepTimer) clearInterval(sweepTimer);
      if (settingsTimer) clearInterval(settingsTimer);
      probeWorktrees.stop();
      await stream.stop();
      await scheduler.stop();
      await heartbeatLoop.stop();
      jobs.abortAll();
      await jobs.idle();
      await backgroundIdle();
      await Promise.allSettled([...probing.values()]);
      state.close();
      started = false;
    },
    pause() {
      paused = true;
      log('info', 'daemon paused: held jobs wait until resumed', {
        held: state.listJobs(['queued', 'backoff']).length,
      });
      void heartbeatLoop.tick();
      events.emit('status', daemon.status());
    },
    resume() {
      paused = false;
      void heartbeatLoop.tick();
      void scheduler.tick();
      events.emit('status', daemon.status());
    },
    status() {
      const count = (status: 'running' | 'queued' | 'backoff') => state.listJobs([status]).length;
      return {
        running: started,
        paused,
        connected: stream.connected,
        cursor: state.getCursor(),
        lastEventAt: stream.lastEventAt?.toISOString() ?? null,
        jobs: { running: count('running'), queued: count('queued'), backoff: count('backoff') },
        orphansCleaned,
        projects: config.projects.map((project) => {
          const view = [...projectsView.values()].find((item) => item.key === project.key);
          return {
            key: project.key,
            ownerState: view?.ownerState ?? null,
            runnable: view?.ownerState === 'mine',
          };
        }),
        hostsAssistant,
        settings: settingsState(),
      };
    },
    updateConfig(next) {
      localConfig = next;
      applyConfig();
    },
    updateProjects(projects) {
      daemon.updateConfig({ ...localConfig, projects });
    },
    effectiveConfig: () => config,
    settings: () => settingsStore.current(),
    refreshSettings,
    async setProjectFolder(projectKey, folder) {
      if (folder) {
        await vps.putProjectFolder(
          projectKey,
          {
            repoPath: folder.repoPath,
            ...(folder.sharedPaths ? { sharedPaths: [...folder.sharedPaths] } : {}),
          },
          `project-folder:${projectKey}:${randomUUID()}`,
        );
      } else {
        await vps.deleteProjectFolder(projectKey, `project-folder:${projectKey}:${randomUUID()}`);
      }
      await refreshSettings();
    },
    folderProblems: () =>
      new Map(
        [...folderStatus.entries()]
          .filter(([, status]) => status.error !== null)
          .map(([key, status]) => [key, status.error as string]),
      ),
    async setProjectMcp(projectKey, disabledMcpServers, note = '') {
      await vps.putProjectMcp(
        projectKey,
        { disabledMcpServers: [...new Set(disabledMcpServers)], note },
        `project-mcp:${projectKey}:${randomUUID()}`,
      );
      await refreshSettings();
    },
    refreshProjects,
    refreshInventory,
    sweep,
    heartbeat,
    idle: () => jobs.idle(),
  };
  return daemon;
}
