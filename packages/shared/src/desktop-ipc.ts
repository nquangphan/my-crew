import { z } from 'zod';
import { HealthCheckResult, HealthFixId, HealthGroup, HealthReport } from './health-schemas.js';
import { OwnerState, PairingCode } from './machine-schemas.js';
import { ProjectKey } from './project-schemas.js';
import { MachineSettingsState } from './settings-schemas.js';

/**
 * Typed IPC of the 2P Crew desktop app. The app is a gateway: pairing, a status view, links to the web (where
 * every setting and remote action lives) and the actions only the machine can do (folder picker, macOS folder
 * permission, Claude login, log folder, quit). The sandboxed renderer calls `invoke(method, input)` through the
 * preload bridge; the main process validates every input with these schemas, answers app-level calls itself
 * and forwards the rest to the daemon host (an Electron utility process) over its MessagePort. The machine
 * token never crosses this boundary: the UI only sees validity and expiry.
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

export const DesktopRoute = z.enum(['setup', 'status']);
export type DesktopRoute = z.infer<typeof DesktopRoute>;

export const Navigate = z.object({
  route: DesktopRoute,
  /** Wizard step to open, e.g. `pairing`. */
  section: z.string().max(50).optional(),
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
  /** The server settings new jobs start with (revision, and whether from the server, cache or bundled). */
  settings: MachineSettingsState.optional(),
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

/**
 * One project this machine holds, as the status view shows it: its folder here (a server setting, so the owner
 * can also set it on the web) and why the machine cannot use it, if it cannot.
 */
export const ProjectStatus = z.object({
  key: z.string(),
  name: z.string(),
  ownerState: OwnerState,
  /** The folder the daemon uses (null: none set, or the machine cannot use the one set). */
  localPath: z.string().nullable(),
  /** The folder set on the server that this machine cannot use, and why. */
  folderProblem: z.string().nullable(),
  /** The project's settings page on the web. */
  webUrl: z.string().nullable(),
});
export type ProjectStatus = z.infer<typeof ProjectStatus>;

/** What the gateway's status view shows besides the daemon status and the health summary. */
export const StatusView = z.object({
  machineId: z.string().nullable(),
  projects: z.array(ProjectStatus),
  assistant: OwnerState,
  /** The settings revision new jobs start with (from the server, a cached copy or the bundled defaults). */
  settings: MachineSettingsState.nullable(),
  /** Folders whose macOS permission prompt is open right now (answer "Allow" on this machine). */
  folderAccessWaiting: z.array(z.string()),
  /** Pages of this machine on the web. */
  links: z.object({
    machines: z.string().nullable(),
    machineSettings: z.string().nullable(),
    systemSettings: z.string().nullable(),
  }),
});
export type StatusView = z.infer<typeof StatusView>;

export const FolderValidation = z.object({
  path: z.string(),
  /** No check is red. */
  ok: z.boolean(),
  checks: z.array(HealthCheckResult),
});
export type FolderValidation = z.infer<typeof FolderValidation>;

// ---------------------------------------------------------------------------
// Requests (renderer → main → host)
// ---------------------------------------------------------------------------

const request = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output });

export const DesktopRequests = {
  'app.info': request(Empty, AppInfo),
  /** Opens a page of the paired server (or the release page) in the browser. */
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

  /** The gateway's status view: projects and their folders here, settings, pending permission prompts. */
  'status.view': request(Empty, StatusView),
  'folder.pick': request(Empty, z.object({ path: z.string().nullable() })),
  /**
   * The folder picker's convenience: checks the folder here (repo, origin, branch, push access), then saves it
   * as this machine's folder of the project on the server (the same setting the web edits).
   */
  'projects.setFolder': request(z.object({ key: ProjectKey, path: AbsolutePath }).strict(), FolderValidation),

  'health.get': request(Empty, HealthReport.nullable()),
  /** `quick` skips the paid login probe and the checkout skill probe (the 5-minute schedule). */
  'health.run': request(z.object({ quick: z.boolean().optional() }).strict(), HealthReport),
  'health.fix': request(z.object({ group: HealthGroup, fixId: HealthFixId }).strict(), HealthReport),

  'daemon.pause': request(Empty, DaemonStatusView.nullable()),
  'daemon.resume': request(Empty, DaemonStatusView.nullable()),
  'daemon.restart': request(Empty, DaemonRuntime),
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
  'update.status': UpdateStatus,
  'app.navigate': Navigate,
} as const;

export type DesktopEventName = keyof typeof DesktopEvents;
export type DesktopEventPayload<E extends DesktopEventName> = z.output<(typeof DesktopEvents)[E]>;

// ---------------------------------------------------------------------------
// Daemon host protocol (main ↔ utility process, over its MessagePort)
// ---------------------------------------------------------------------------

/**
 * Health fixes only the main process can apply (Terminal, login item, app update, restarting the host). A fix
 * asked for from the web reaches the host, which passes these to the main process (`app.fix` event).
 */
export const APP_HEALTH_FIXES: readonly string[] = [
  'open-claude-login',
  'enable-login-item',
  'install-update',
  'restart-daemon',
];

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

export const HostEventName = z.enum(['daemon.status', 'health.report', 'job.blocked', 'app.fix']);
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
