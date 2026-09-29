import { z } from 'zod';
import { Effort, ModelAlias } from './agent-schemas.js';
import { BmadProfile } from './bmad-schemas.js';
import { HealthCheckResult, HealthFixId, HealthGroup, HealthReport } from './health-schemas.js';
import {
  DaemonCreateProjectRequest,
  DaemonProject,
  OwnerState,
  PairingCode,
  PendingProjectChange,
  ProjectChangeOutcome,
  ProjectTestSetup,
  SkillInventory,
} from './machine-schemas.js';
import { McpServerName, ProjectKey, ProjectPlatform, UiTestMcp } from './project-schemas.js';

/**
 * Typed IPC of the 2P Crew desktop app. The sandboxed renderer calls `invoke(method, input)` through the
 * preload bridge; the main process validates every input with these schemas, answers app-level calls
 * itself and forwards the rest to the daemon host (an Electron utility process) over its MessagePort.
 * The machine token never crosses this boundary: the UI only sees validity and expiry.
 */

export const DESKTOP_INVOKE_CHANNEL = 'crew:invoke';
export const DESKTOP_EVENT_CHANNEL = 'crew:event';

const Empty = z.object({}).strict();
const AbsolutePath = z
  .string()
  .min(1)
  .max(4_096)
  .refine((path) => path.startsWith('/'), 'must be an absolute path');
const HttpUrl = z
  .string()
  .trim()
  .max(2_000)
  .refine((url) => /^https?:\/\/[^\s/]+/.test(url), 'must be an http(s) URL');

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export const DesktopRoute = z.enum(['setup', 'health', 'jobs', 'logs', 'settings', 'settings-projects']);
export type DesktopRoute = z.infer<typeof DesktopRoute>;

export const Navigate = z.object({
  route: DesktopRoute,
  /** Wizard step or settings section to open, e.g. `pairing` or `resources`. */
  section: z.string().max(50).optional(),
  projectKey: ProjectKey.optional(),
});
export type Navigate = z.infer<typeof Navigate>;

export const UpdateStatus = z.object({
  /** `unpublished`: the release feed has no published release yet (not an error). */
  state: z.enum(['disabled', 'idle', 'checking', 'none', 'unpublished', 'available', 'downloaded', 'error']),
  version: z.string().nullable(),
  /** Signed and notarized builds install in place; unsigned builds only link to the download. */
  canAutoInstall: z.boolean(),
  downloadUrl: z.string().nullable(),
  message: z.string().nullable(),
});
export type UpdateStatus = z.infer<typeof UpdateStatus>;

export const DaemonRuntime = z.object({
  state: z.enum(['stopped', 'starting', 'running', 'restarting', 'crashed']),
  pid: z.number().int().nullable(),
  /** Restarts after a crash since the app started. */
  restarts: z.number().int().min(0),
  lastExit: z.string().nullable(),
  /** The daemon runtime inside the host is started (the machine is set up). */
  daemonStarted: z.boolean(),
});
export type DaemonRuntime = z.infer<typeof DaemonRuntime>;

export const DaemonStatusView = z.object({
  running: z.boolean(),
  paused: z.boolean(),
  connected: z.boolean(),
  cursor: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  jobs: z.object({ running: z.number().int(), queued: z.number().int(), backoff: z.number().int() }),
  orphansCleaned: z.number().int(),
  projects: z.array(z.object({ key: z.string(), ownerState: z.string().nullable(), runnable: z.boolean() })),
  hostsAssistant: z.boolean(),
});
export type DaemonStatusView = z.infer<typeof DaemonStatusView>;

export const AppInfo = z.object({
  version: z.string(),
  platform: z.string(),
  packaged: z.boolean(),
  setupComplete: z.boolean(),
  loginItem: z.boolean(),
  apiUrl: z.string().nullable(),
  machineName: z.string().nullable(),
  paired: z.boolean(),
  daemon: DaemonRuntime,
  status: DaemonStatusView.nullable(),
  update: UpdateStatus,
});
export type AppInfo = z.infer<typeof AppInfo>;

export const JobView = z.object({
  id: z.string(),
  ticketId: z.string(),
  ticketKey: z.string().nullable(),
  ticketTitle: z.string().nullable(),
  status: z.string(),
  role: z.string(),
  kind: z.string(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  retryAt: z.string().nullable(),
  costUsd: z.number(),
  error: z.string().nullable(),
  /** The ticket on the web app. */
  webUrl: z.string().nullable(),
});
export type JobView = z.infer<typeof JobView>;

export const LogLine = z.object({
  at: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
  jobId: z.string().nullable(),
  ticketId: z.string().nullable(),
  ticketKey: z.string().nullable(),
  fields: z.record(z.string(), z.unknown()),
});
export type LogLine = z.infer<typeof LogLine>;

export const ServerCheck = z.object({ ok: z.boolean(), apiUrl: z.string(), message: z.string() });
export type ServerCheck = z.infer<typeof ServerCheck>;

export const PairResult = z.object({ machineId: z.string(), machineName: z.string(), expiresAt: z.string() });
export type PairResult = z.infer<typeof PairResult>;

export const ProjectView = DaemonProject.extend({
  /** The local folder, stored only in `~/.crew/config.yaml`. */
  localPath: z.string().nullable(),
});
export type ProjectView = z.infer<typeof ProjectView>;

export const ProjectsView = z.object({
  items: z.array(ProjectView),
  assistant: z.object({ state: OwnerState, hostName: z.string().nullable(), pendingClaim: z.boolean() }),
});
export type ProjectsView = z.infer<typeof ProjectsView>;

export const FolderInfo = z.object({
  path: z.string(),
  isRepo: z.boolean(),
  origin: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  suggestedKey: z.string(),
  suggestedName: z.string(),
});
export type FolderInfo = z.infer<typeof FolderInfo>;

export const FolderValidation = z.object({
  path: z.string(),
  /** No check is red. */
  ok: z.boolean(),
  checks: z.array(HealthCheckResult),
});
export type FolderValidation = z.infer<typeof FolderValidation>;

export const ClaimOutcome = z.object({
  /** Project key, or `assistant`. */
  target: z.string(),
  status: z.enum(['granted', 'already_owned', 'pending', 'released', 'withdrawn', 'unchanged', 'error']),
  message: z.string(),
});
export type ClaimOutcome = z.infer<typeof ClaimOutcome>;

export const HookView = z.object({
  key: z.string(),
  path: z.string(),
  /** The hooks run (whichever runtime installed them). */
  installed: z.boolean(),
  /** The hooks run this machine's crew-docs version. */
  current: z.boolean(),
  /** Why the hooks do not run, or what they run. */
  detail: z.string().optional(),
  docsInitialized: z.boolean(),
  docsStatus: z.string().nullable(),
});
export type HookView = z.infer<typeof HookView>;

export const ResourceSettings = z.object({
  maxConcurrentJobs: z.number().int().min(1).max(64),
  minFreeMemGb: z.number().min(0).max(1_024),
  maxLoadPerCpu: z.number().positive().max(64),
});
export type ResourceSettings = z.infer<typeof ResourceSettings>;

const ModelChoice = z.object({ model: ModelAlias, effort: Effort });

export const ModelSettings = z.object({
  allow: z
    .array(ModelAlias)
    .min(1)
    .refine((list) => list.includes('sonnet'), 'sonnet phải luôn được cho phép (docs chạy trên sonnet)'),
  complexityMap: z.object({
    trivial: ModelChoice,
    small: ModelChoice,
    medium: ModelChoice,
    large: ModelChoice,
  }),
});
export type ModelSettings = z.infer<typeof ModelSettings>;

export const ResourcesView = z.object({
  resources: ResourceSettings,
  models: ModelSettings,
  /** Defaults suggested from this machine's CPU and RAM. */
  suggested: ResourceSettings,
  machine: z.object({ cpus: z.number().int(), totalMemGb: z.number() }),
});
export type ResourcesView = z.infer<typeof ResourcesView>;

/** What the project's `_bmad/_config/manifest.yaml` on this machine says is installed. */
export const BmadLocalInstall = z.object({ version: z.string(), modules: z.array(z.string()) });
export type BmadLocalInstall = z.infer<typeof BmadLocalInstall>;

/**
 * What "Cài BMAD" would do: `no_profile` (no machine reported one), `skip` (this version with every profile
 * module is already here), `install` (no BMAD here), `update` (an older or incomplete install), `newer`
 * (this machine already has a newer BMAD; the app never downgrades it).
 */
export const BmadInstallPlan = z.enum(['no_profile', 'skip', 'install', 'update', 'newer']);
export type BmadInstallPlan = z.infer<typeof BmadInstallPlan>;

export const ProjectBmadView = z.object({
  profile: BmadProfile.nullable(),
  local: BmadLocalInstall.nullable(),
  plan: BmadInstallPlan,
});
export type ProjectBmadView = z.infer<typeof ProjectBmadView>;

export const ProjectDetail = z.object({
  key: z.string(),
  localPath: z.string().nullable(),
  platform: ProjectPlatform.nullable(),
  uiTestMcp: UiTestMcp.nullable(),
  /** The UI-test servers QC must use for this project type. */
  requiredMcps: z.array(z.string()),
  inventory: SkillInventory.nullable(),
  disabledMcpServers: z.array(z.string()),
  sharedPaths: z.object({ detected: z.array(z.string()), extra: z.array(z.string()) }),
  /** The project's settings page on the web. */
  webSettingsUrl: z.string().nullable(),
  /** This machine's type and MCP change waiting for the owner's confirmation on the web. */
  pendingChange: PendingProjectChange.nullable(),
  /** This machine's latest change request for the project: how the owner decided, or that it was withdrawn. */
  lastChange: ProjectChangeOutcome.nullable(),
  /** The project's BMAD profile on the server and the install in this machine's folder. */
  bmad: ProjectBmadView,
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

export const BmadInstallResult = z.object({
  status: z.enum(['skipped', 'installed', 'updated']),
  /** What happened, in Vietnamese, including files the install left uncommitted. */
  message: z.string(),
  detail: ProjectDetail,
});
export type BmadInstallResult = z.infer<typeof BmadInstallResult>;

/** One line of the BMAD installer's output while "Cài BMAD" runs. */
export const BmadProgress = z.object({ key: z.string(), line: z.string() });
export type BmadProgress = z.infer<typeof BmadProgress>;

// ---------------------------------------------------------------------------
// Requests (renderer → main → host)
// ---------------------------------------------------------------------------

const RepoRelativePath = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (path) => !path.startsWith('/') && !path.split(/[\\/]/).includes('..'),
    'must stay inside the repo',
  );

const request = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output });

export const DesktopRequests = {
  'app.info': request(Empty, AppInfo),
  /** Opens a ticket or release page in the browser; only the paired server and GitHub releases. */
  'app.openExternal': request(z.object({ url: HttpUrl }).strict(), z.null()),
  'app.checkUpdate': request(Empty, UpdateStatus),
  'app.installUpdate': request(Empty, UpdateStatus),
  'app.setLoginItem': request(z.object({ enabled: z.boolean() }).strict(), z.boolean()),
  /** Opens `~/.crew/logs` (app.log and daemon.log) in Finder. */
  'app.openLogFolder': request(Empty, z.null()),
  /** An uncaught error or unhandled rejection in the renderer, written to app.log. */
  'app.reportError': request(
    z
      .object({
        kind: z.enum(['error', 'unhandledrejection']),
        message: z.string().max(2_000),
        stack: z.string().max(10_000).optional(),
      })
      .strict(),
    z.null(),
  ),

  'setup.checkServer': request(z.object({ apiUrl: HttpUrl }).strict(), ServerCheck),
  'setup.pair': request(
    z.object({ apiUrl: HttpUrl, code: PairingCode, machineName: z.string().trim().min(1).max(100) }).strict(),
    PairResult,
  ),
  'setup.checkClaude': request(Empty, z.array(HealthCheckResult)),
  /** Opens Terminal running `claude`, so the owner can `/login`. */
  'setup.openClaudeLogin': request(Empty, z.null()),
  /** Turns on start at login, starts the daemon and marks the setup complete. */
  'setup.finish': request(Empty, AppInfo),

  'folder.pick': request(Empty, z.object({ path: z.string().nullable() })),
  'folder.inspect': request(z.object({ path: AbsolutePath }).strict(), FolderInfo),
  'folder.validate': request(
    z
      .object({ path: AbsolutePath, repoUrl: z.string().max(500), defaultBranch: z.string().min(1).max(200) })
      .strict(),
    FolderValidation,
  ),

  'projects.list': request(Empty, ProjectsView),
  'projects.apply': request(
    z
      .object({
        selections: z.array(z.object({ key: ProjectKey, path: AbsolutePath }).strict()).max(100),
        assistant: z.boolean(),
      })
      .strict(),
    z.array(ClaimOutcome),
  ),
  'projects.create': request(
    DaemonCreateProjectRequest.extend({ path: AbsolutePath }).strict(),
    ClaimOutcome,
  ),
  'projects.setFolder': request(z.object({ key: ProjectKey, path: AbsolutePath }).strict(), FolderValidation),
  'projects.release': request(z.object({ key: ProjectKey }).strict(), ClaimOutcome),
  'projects.setAssistant': request(z.object({ enabled: z.boolean() }).strict(), ClaimOutcome),
  'projects.detail': request(z.object({ key: ProjectKey }).strict(), ProjectDetail),
  'projects.setMcpEnabled': request(
    z.object({ key: ProjectKey, server: McpServerName, enabled: z.boolean() }).strict(),
    ProjectDetail,
  ),
  'projects.setSharedPaths': request(
    z.object({ key: ProjectKey, paths: z.array(RepoRelativePath).max(50) }).strict(),
    ProjectDetail,
  ),
  'projects.refreshInventory': request(z.object({ key: ProjectKey }).strict(), ProjectDetail),
  /** Asks the owner to change the project type and UI-test MCP mapping; nothing changes until approved. */
  'projects.requestTestSetup': request(ProjectTestSetup.extend({ key: ProjectKey }).strict(), ProjectDetail),
  /** Installs the project's BMAD profile into its local folder (manual only; never commits). */
  'projects.installBmad': request(z.object({ key: ProjectKey }).strict(), BmadInstallResult),

  'hooks.list': request(Empty, z.array(HookView)),
  'hooks.install': request(z.object({ key: ProjectKey }).strict(), HookView),

  'config.resources': request(Empty, ResourcesView),
  'config.saveResources': request(
    z.object({ resources: ResourceSettings, models: ModelSettings }).strict(),
    ResourcesView,
  ),

  'health.get': request(Empty, HealthReport.nullable()),
  /** `quick` skips the paid login probe and the checkout skill probe (the 5-minute schedule). */
  'health.run': request(z.object({ quick: z.boolean().optional() }).strict(), HealthReport),
  'health.fix': request(z.object({ group: HealthGroup, fixId: HealthFixId }).strict(), HealthReport),

  'daemon.pause': request(Empty, DaemonStatusView.nullable()),
  'daemon.resume': request(Empty, DaemonStatusView.nullable()),
  'daemon.restart': request(Empty, DaemonRuntime),

  'jobs.list': request(Empty, z.array(JobView)),
  'logs.tail': request(
    z
      .object({ ticket: z.string().trim().max(100).optional(), limit: z.number().int().min(1).max(2_000) })
      .strict(),
    z.array(LogLine),
  ),
} as const;

export type DesktopMethod = keyof typeof DesktopRequests;
export type DesktopInput<M extends DesktopMethod> = z.input<(typeof DesktopRequests)[M]['input']>;
export type DesktopOutput<M extends DesktopMethod> = z.output<(typeof DesktopRequests)[M]['output']>;
/** An input after validation (defaults applied), as the handlers receive it. */
export type DesktopParsed<M extends DesktopMethod> = z.output<(typeof DesktopRequests)[M]['input']>;

export function isDesktopMethod(value: unknown): value is DesktopMethod {
  return typeof value === 'string' && Object.hasOwn(DesktopRequests, value);
}

// ---------------------------------------------------------------------------
// Events (main → renderer)
// ---------------------------------------------------------------------------

export const DesktopEvents = {
  'daemon.status': DaemonStatusView.nullable(),
  'daemon.runtime': DaemonRuntime,
  'health.report': HealthReport,
  'jobs.changed': z.array(JobView),
  'log.line': LogLine,
  'update.status': UpdateStatus,
  'app.navigate': Navigate,
  'bmad.progress': BmadProgress,
} as const;

export type DesktopEventName = keyof typeof DesktopEvents;
export type DesktopEventPayload<E extends DesktopEventName> = z.output<(typeof DesktopEvents)[E]>;

// ---------------------------------------------------------------------------
// Daemon host protocol (main ↔ utility process, over its MessagePort)
// ---------------------------------------------------------------------------

/** Facts only the main process knows, sent to the host for the App health group. */
export const AppFacts = z.object({
  version: z.string(),
  loginItem: z.boolean(),
  update: UpdateStatus,
});
export type AppFacts = z.infer<typeof AppFacts>;

/** Methods only the main process calls on the host. */
export const HostOnlyRequests = {
  'host.startDaemon': request(Empty, DaemonStatusView.nullable()),
  /** `requeue`: stop now, running jobs resume next start. `drain`: stop taking jobs, wait, then stop. */
  'host.stopDaemon': request(z.object({ mode: z.enum(['requeue', 'drain']) }).strict(), z.null()),
  'host.status': request(Empty, DaemonStatusView.nullable()),
  'host.appState': request(
    Empty,
    z.object({ apiUrl: z.string().nullable(), machineName: z.string().nullable(), paired: z.boolean() }),
  ),
} as const;

export type HostOnlyMethod = keyof typeof HostOnlyRequests;
export type HostMethod = DesktopMethod | HostOnlyMethod;
export type HostInput<M extends HostMethod> = M extends DesktopMethod
  ? DesktopInput<M>
  : M extends HostOnlyMethod
    ? z.input<(typeof HostOnlyRequests)[M]['input']>
    : never;
export type HostOutput<M extends HostMethod> = M extends DesktopMethod
  ? DesktopOutput<M>
  : M extends HostOnlyMethod
    ? z.output<(typeof HostOnlyRequests)[M]['output']>
    : never;

export function hostInputSchema(method: string): z.ZodType | null {
  if (Object.hasOwn(DesktopRequests, method)) return DesktopRequests[method as DesktopMethod].input;
  if (Object.hasOwn(HostOnlyRequests, method)) return HostOnlyRequests[method as HostOnlyMethod].input;
  return null;
}

export const HostEventName = z.enum([
  'daemon.status',
  'health.report',
  'jobs.changed',
  'log.line',
  'job.blocked',
  'bmad.progress',
]);
export type HostEventName = z.infer<typeof HostEventName>;

export const ToHost = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request'), id: z.number().int(), method: z.string(), params: z.unknown() }),
  z.object({ kind: z.literal('facts'), facts: AppFacts }),
]);
export type ToHost = z.infer<typeof ToHost>;

/**
 * One line of `~/.crew/logs/app.log`: what the app did (IPC operations, failed API calls, health changes,
 * updater errors, crashes). The main process is the only writer; the daemon host sends its entries over the
 * port. Fields never carry tokens, cookies, pairing codes or other secrets.
 */
export const AppLogEntry = z.object({
  level: z.enum(['info', 'warn', 'error']),
  source: z.enum(['main', 'host', 'renderer']),
  event: z.string().min(1).max(100),
  fields: z.record(z.string(), z.unknown()).default({}),
});
export type AppLogEntry = z.input<typeof AppLogEntry>;

export const FromHost = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('log'), entry: AppLogEntry }),
  z.object({ kind: z.literal('ready') }),
  z.object({
    kind: z.literal('response'),
    id: z.number().int(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.object({ message: z.string(), code: z.string().optional() }).optional(),
  }),
  z.object({ kind: z.literal('event'), name: HostEventName, payload: z.unknown() }),
]);
export type FromHost = z.infer<typeof FromHost>;
