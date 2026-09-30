import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  APP_HEALTH_FIXES,
  type AppFacts,
  type AppInfo,
  type AppLogEntry,
  type DaemonRuntime,
  type DaemonStatusView,
  DESKTOP_EVENT_CHANNEL,
  DESKTOP_INVOKE_CHANNEL,
  type DesktopEventName,
  type DesktopEventPayload,
  type HealthReport,
  type Navigate,
  parseRuntimeManifest,
} from '@crew/shared';
import { app, type BrowserWindow, dialog, ipcMain, Notification, shell, utilityProcess } from 'electron';
import electronUpdater from 'electron-updater';
import { AppLog, lineSplitter } from './app-log.js';
import { DaemonSupervisor, type HostProcess } from './daemon-supervisor.js';
import { DesktopStateStore } from './desktop-state.js';
import {
  defaultProbes,
  detectFullDiskAccess,
  FULL_DISK_ACCESS_PANE,
  type Probe,
} from './full-disk-access.js';
import { dispatchDesktopRequest, ipcLogEntry, isTrustedSender, type MainHandlers } from './ipc-handlers.js';
import { electronLoginItem, fileLoginItem } from './login-item.js';
import { type BlockedJob, Notifier } from './notifications.js';
import { decideQuit, QUIT_BUTTONS, quitMessage } from './quit-guard.js';
import { type LaunchTarget, RuntimeManager } from './runtime-manager.js';
import { RuntimeStore } from './runtime-store.js';
import { trustedKeys } from './runtime-verify.js';
import { loginShellPath } from './shell-env.js';
import { macTerminalLauncher, recordingTerminalLauncher } from './terminal-launcher.js';
import { CrewTray } from './tray.js';
import { isDeveloperIdSigned, RELEASES_URL, Updater } from './updater.js';
import { createMainWindow } from './window.js';

const HEALTH_INTERVAL_MS = 5 * 60 * 1000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Fixes that need the app itself; every other fix runs in the daemon host. */
const APP_FIXES = new Set(APP_HEALTH_FIXES);

const here = dirname(fileURLToPath(import.meta.url));
const testMode = process.env.CREW_DESKTOP_TEST_MODE === '1';

function crewHome(): string {
  const override = process.env.CREW_HOME;
  if (override && isAbsolute(override)) return override;
  return join(homedir(), '.crew');
}

/** The crew-docs bundle shipped with the app (staged next to the code), or the workspace build in development. */
function crewDocsSource(): string {
  const candidates = [
    join(app.getAppPath(), 'resources', 'crew-docs.cjs'),
    join(app.getAppPath(), '..', '..', 'packages', 'docs-kit', 'dist', 'crew-docs.cjs'),
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[0] ?? '';
}

if (process.env.CREW_DESKTOP_USER_DATA) app.setPath('userData', process.env.CREW_DESKTOP_USER_DATA);
if (!testMode) process.env.PATH = loginShellPath(process.env);

const home = crewHome();
mkdirSync(home, { recursive: true, mode: 0o700 });
const logsDir = join(home, 'logs');
/** `~/.crew/logs/app.log`: this process is its only writer (the daemon host sends its lines over its port). */
const appLog = new AppLog(join(logsDir, 'app.log'));
const log = (level: AppLogEntry['level'], event: string, fields: Record<string, unknown> = {}) =>
  appLog.write({ level, source: 'main', event, fields });
process.on('uncaughtException', (error) => {
  log('error', 'uncaught-exception', { error: error.stack ?? error.message });
});
process.on('unhandledRejection', (reason) => {
  log('error', 'unhandled-rejection', {
    error: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  });
});
const desktopState = new DesktopStateStore(home);
const loginItem = testMode ? fileLoginItem(join(home, '.test-login-item')) : electronLoginItem(app);
const openClaudeLogin = testMode
  ? recordingTerminalLauncher(join(home, '.test-terminal-launches'))
  : macTerminalLauncher();

/**
 * The runtime bundle (daemon host + renderer) the app ships with, next to the main bundle: `out/runtime/`. Its
 * manifest gives the version; it is part of the signed app, so it is never re-verified here.
 */
const builtinDir = join(here, '..', 'runtime');
function builtinVersion(): string {
  try {
    const parsed = parseRuntimeManifest(readFileSync(join(builtinDir, 'manifest.json'), 'utf8'));
    if ('manifest' in parsed) return parsed.manifest.version;
    log('error', 'runtime-builtin-manifest-invalid', { error: parsed.error });
  } catch (error) {
    log('error', 'runtime-builtin-manifest-missing', { error: (error as Error).message });
  }
  return app.getVersion();
}

const shellFacts = { appVersion: app.getVersion(), electronVersion: process.versions.electron ?? '0.0.0' };
/**
 * Signed hot updates of the runtime bundle (packaged apps, and the E2E test mode). A development build runs
 * what it was built with.
 */
const runtimeUpdates = (app.isPackaged || testMode) && process.env.CREW_RUNTIME_UPDATES !== '0';
const runtime = new RuntimeManager({
  store: new RuntimeStore(home, trustedKeys(process.env), shellFacts),
  builtin: { version: builtinVersion(), dir: builtinDir },
  shell: shellFacts,
  enabled: runtimeUpdates,
  nodeModules: join(app.getAppPath(), 'node_modules'),
  check: () => supervisor.request('host.runtimeCheck', {}, 60_000),
  download: async (version) =>
    (await supervisor.request('host.runtimeDownload', { version }, 15 * 60_000)).path,
  runningJobs: () => latestStatus?.jobs.running ?? 0,
  switchTo: (target) => switchRuntime(target),
  onState: (state) => {
    send('runtime.status', state);
    pushFacts();
  },
  log: (level, event, fields = {}) => log(level, event, fields),
  // The E2E suite watches a new runtime for seconds, not minutes.
  ...(testMode && process.env.CREW_RUNTIME_PROBATION_MS
    ? { probationMs: Number(process.env.CREW_RUNTIME_PROBATION_MS) }
    : {}),
});
runtime.select();

/** The renderer of the runtime running now (the dev server in development). */
function rendererUrl(): string {
  return !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : pathToFileURL(runtime.current().rendererIndex).toString();
}

let window: BrowserWindow | null = null;
let tray: CrewTray | null = null;
let latestStatus: DaemonStatusView | null = null;
let latestHealth: HealthReport | null = null;
let quitting = false;

function send<E extends DesktopEventName>(name: E, payload: DesktopEventPayload<E>): void {
  if (window && !window.isDestroyed()) window.webContents.send(DESKTOP_EVENT_CHANNEL, name, payload);
}

const supervisor = new DaemonSupervisor({
  fork: (): HostProcess => {
    const child = utilityProcess.fork(runtime.current().hostEntry, [], {
      serviceName: '2P Crew daemon',
      // Piped into app.log: launched from Finder or at login the app's own stdio goes nowhere.
      stdio: 'pipe',
      env: {
        ...process.env,
        CREW_HOME: home,
        CREW_APP_EXECUTABLE: app.getPath('exe'),
        CREW_DOCS_SOURCE: crewDocsSource(),
        CREW_APP_VERSION: app.getVersion(),
        CREW_RUNTIME_VERSION: runtime.current().version,
      },
    });
    for (const [stream, level, event] of [
      [child.stdout, 'info', 'host-stdout'],
      [child.stderr, 'warn', 'host-stderr'],
    ] as const) {
      stream?.setEncoding('utf8');
      stream?.on(
        'data',
        lineSplitter((line) => appLog.write({ level, source: 'host', event, fields: { line } })),
      );
    }
    return {
      get pid() {
        return child.pid;
      },
      postMessage: (message) => child.postMessage(message),
      onMessage: (listener) => child.on('message', listener),
      onExit: (listener) => child.on('exit', listener),
      kill: () => void child.kill(),
      forceKill: () => {
        if (child.pid === undefined) return;
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      },
    };
  },
});

let lastUpdateState: string | null = null;
const updater = new Updater({
  enabled: app.isPackaged && !testMode && process.platform === 'darwin',
  updater: () => electronUpdater.autoUpdater,
  signed: () => isDeveloperIdSigned(join(app.getPath('exe'), '..', '..', '..')),
  onStatus: (status) => {
    if (status.state === 'error') log('warn', 'updater-error', { message: status.message });
    else if (status.state === 'unpublished' && lastUpdateState !== 'unpublished') {
      log('info', 'updater-unpublished', { version: app.getVersion() });
    }
    lastUpdateState = status.state;
    send('update.status', status);
    pushFacts();
  },
  openExternal: (url) => shell.openExternal(url),
  waitForIdle: async () => {
    await supervisor.request('daemon.pause', {});
    await supervisor.stop('drain');
    quitting = true;
  },
});

const notifier = new Notifier((title, body) => {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
});

function facts(): AppFacts {
  return {
    version: app.getVersion(),
    loginItem: loginItem.enabled(),
    update: updater.current(),
    runtime: runtime.state(),
  };
}

/**
 * Moves the app onto another runtime bundle: the host stops gracefully (running jobs are re-queued and resume
 * on the new host), a new host starts from the new bundle, and an open window reloads the new renderer on the
 * page it showed.
 */
async function switchRuntime(target: LaunchTarget): Promise<void> {
  log('info', 'runtime-switching', { version: target.version, source: target.source });
  await supervisor.relaunch();
  if (window && !window.isDestroyed()) {
    const hash = new URL(window.webContents.getURL() || 'file:///#/status').hash || '#/status';
    await window.loadURL(`${rendererUrl()}${hash}`);
  }
}

/** The probes read a protected path; test mode reads a marker file in the test's crew home instead. */
const fullDiskProbes: Probe[] = testMode
  ? [
      () => {
        const marker = join(home, '.test-full-disk-access');
        if (!existsSync(marker) || readFileSync(marker, 'utf8').trim() !== 'granted') {
          throw Object.assign(new Error('not granted'), { code: 'EPERM' });
        }
      },
    ]
  : defaultProbes();

function pushFacts(): void {
  supervisor.setFacts(facts());
  refreshTray();
}

function refreshTray(): void {
  tray?.update({
    health: latestHealth?.summary.status ?? null,
    runningJobs: latestStatus?.jobs.running ?? 0,
    paused: desktopState.read().paused,
    daemon: supervisor.runtime().state,
    setupComplete: desktopState.read().setupCompletedAt !== null,
  });
}

function openWindow(navigate?: Navigate): void {
  if (window && !window.isDestroyed()) {
    if (navigate) send('app.navigate', navigate);
    window.show();
    window.focus();
    return;
  }
  const setupComplete = desktopState.read().setupCompletedAt !== null;
  app.dock?.show();
  window = createMainWindow({
    preload: join(here, '..', 'preload', 'index.cjs'),
    rendererUrl,
    route: navigate?.route ?? (setupComplete ? 'status' : 'setup'),
  });
  window.on('closed', () => {
    window = null;
    // The app keeps running in the menu bar; the daemon and its jobs are untouched.
    if (!quitting) app.dock?.hide();
  });
  if (setupComplete) void runHealth(false);
}

async function runHealth(quick: boolean): Promise<HealthReport | null> {
  try {
    return await supervisor.request('health.run', { quick }, 10 * 60 * 1000);
  } catch (error) {
    log('warn', 'health-run-failed', { quick, error: (error as Error).message });
    return null;
  }
}

async function appInfo(): Promise<AppInfo> {
  const state = await supervisor
    .request('host.appState', {})
    .catch(() => ({ apiUrl: null, machineName: null, paired: false }));
  return {
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    setupComplete: desktopState.read().setupCompletedAt !== null,
    loginItem: loginItem.enabled(),
    apiUrl: state.apiUrl,
    machineName: state.machineName,
    paired: state.paired,
    daemon: supervisor.runtime(),
    status: latestStatus,
    update: updater.current(),
    runtime: runtime.state(),
  };
}

async function setPaused(paused: boolean): Promise<DaemonStatusView | null> {
  desktopState.update({ paused });
  supervisor.setPaused(paused);
  const status = await supervisor.request(paused ? 'daemon.pause' : 'daemon.resume', {});
  latestStatus = status;
  refreshTray();
  return status;
}

/** A health fix only this process can apply (from the tray, or asked for from the web through the host). */
async function applyAppFix(fixId: string): Promise<void> {
  if (fixId === 'open-claude-login') await openClaudeLogin();
  if (fixId === 'enable-login-item') {
    loginItem.set(true);
    pushFacts();
  }
  if (fixId === 'install-update') await updater.install();
  if (fixId === 'restart-daemon') {
    supervisor.restart();
    await waitForHost();
  }
}

async function waitForHost(): Promise<void> {
  for (let i = 0; i < 100 && supervisor.runtime().state !== 'running'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const mainHandlers: MainHandlers = {
  'app.info': appInfo,
  'app.openExternal': async ({ url }) => {
    const state = await supervisor.request('host.appState', {}).catch(() => ({ apiUrl: null }));
    const allowed =
      (state.apiUrl && new URL(url).origin === new URL(state.apiUrl).origin) || url.startsWith(RELEASES_URL);
    if (!allowed) throw new Error('Chỉ mở được trang của server đã ghép hoặc trang phát hành của 2P Crew.');
    await shell.openExternal(url);
    return null;
  },
  'app.checkUpdate': () => updater.check(),
  'app.checkRuntime': () => runtime.check(),
  'app.fullDiskAccess': async () => {
    const access = detectFullDiskAccess(fullDiskProbes);
    log('info', 'full-disk-access', { state: access.state });
    return access;
  },
  'app.openFullDiskAccess': async () => {
    if (testMode)
      writeFileSync(join(home, '.test-opened-settings'), `${FULL_DISK_ACCESS_PANE}\n`, { flag: 'a' });
    else await shell.openExternal(FULL_DISK_ACCESS_PANE);
    return null;
  },
  'app.installUpdate': () => updater.install(),
  'app.openLogFolder': async () => {
    mkdirSync(logsDir, { recursive: true, mode: 0o700 });
    const failed = await shell.openPath(logsDir);
    if (failed) throw new Error(`Không mở được thư mục log ${logsDir}: ${failed}`);
    return null;
  },
  'app.reportError': async ({ kind, message, stack }) => {
    appLog.write({
      level: 'error',
      source: 'renderer',
      event: kind === 'error' ? 'uncaught-error' : 'unhandled-rejection',
      fields: { message, ...(stack ? { stack } : {}) },
    });
    return null;
  },
  'app.setLoginItem': async ({ enabled }) => {
    const result = loginItem.set(enabled);
    pushFacts();
    return result;
  },
  'setup.openClaudeLogin': async () => {
    await openClaudeLogin();
    return null;
  },
  'setup.finish': async () => {
    loginItem.set(true);
    desktopState.update({ setupCompletedAt: new Date().toISOString() });
    pushFacts();
    await supervisor.startDaemon();
    void runHealth(false);
    return appInfo();
  },
  'folder.pick': async () => {
    const options = { properties: ['openDirectory' as const], message: 'Chọn thư mục repo của project' };
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return { path: picked.canceled ? null : (picked.filePaths[0] ?? null) };
  },
  'daemon.pause': () => setPaused(true),
  'daemon.resume': () => setPaused(false),
  'daemon.restart': async () => {
    supervisor.restart();
    await waitForHost();
    return supervisor.runtime();
  },
  'health.fix': async ({ group, fixId }) => {
    if (!APP_FIXES.has(fixId)) return supervisor.request('health.fix', { group, fixId }, 10 * 60 * 1000);
    await applyAppFix(fixId);
    return supervisor.request('health.run', { quick: true }, 10 * 60 * 1000);
  },
};

let lastRuntime: string | null = null;
supervisor.on('runtime', (runtime: DaemonRuntime) => {
  const summary = `${runtime.state}:${runtime.daemonStarted}`;
  if (summary !== lastRuntime) {
    lastRuntime = summary;
    const bad = runtime.state === 'crashed' || runtime.state === 'restarting';
    log(bad ? 'warn' : 'info', 'daemon-host', {
      state: runtime.state,
      daemonStarted: runtime.daemonStarted,
      restarts: runtime.restarts,
      lastExit: runtime.lastExit,
      pid: runtime.pid,
    });
  }
  send('daemon.runtime', runtime);
  refreshTray();
});
supervisor.on('host-log', (entry: AppLogEntry) => appLog.write({ ...entry, source: 'host' }));
supervisor.on('ready-timeout', (fields: { pid: number | null; ms: number }) => {
  log('error', 'daemon-host-ready-timeout', { ...fields, runtime: runtime.current().version });
  runtime.onReadyTimeout();
});
supervisor.on('host-crash', (fields: { code: number; uptimeMs: number }) => {
  log('warn', 'daemon-host-crash', { ...fields, runtime: runtime.current().version });
  runtime.onHostCrash();
});
/** The first runtime check waits for the host (it asks the server through the host's machine token). */
let runtimeChecked = false;
supervisor.on('runtime', (state: DaemonRuntime) => {
  if (runtimeChecked || state.state !== 'running') return;
  runtimeChecked = true;
  void runtime.check();
});
supervisor.on('host-event', (name: string, payload: unknown) => {
  if (name === 'daemon.status') {
    latestStatus = payload as DaemonStatusView | null;
    // A pause or resume from the web (a remote action) is kept like one from the tray: it survives a restart
    // of the host. Only once the daemon booted (and re-applied the kept state), so a fresh start never undoes it.
    if (
      latestStatus?.running &&
      supervisor.runtime().daemonStarted &&
      latestStatus.paused !== supervisor.isPaused()
    ) {
      supervisor.setPaused(latestStatus.paused);
      desktopState.update({ paused: latestStatus.paused });
    }
    send('daemon.status', latestStatus);
    refreshTray();
  } else if (name === 'app.fix') {
    const { fixId } = payload as { fixId: string };
    if (APP_FIXES.has(fixId)) {
      log('info', 'remote-app-fix', { fixId });
      void applyAppFix(fixId).catch((error: Error) =>
        log('warn', 'remote-app-fix-failed', { fixId, error: error.message }),
      );
    }
  } else if (name === 'health.report') {
    latestHealth = payload as HealthReport;
    notifier.onHealth(latestHealth);
    send('health.report', latestHealth);
    refreshTray();
  } else if (name === 'job.blocked') {
    notifier.onJobBlocked(payload as BlockedJob);
  } else if (name === 'runtime.changed') {
    void runtime.check();
  }
});

async function quit(): Promise<void> {
  if (quitting) return;
  const running = latestStatus?.jobs.running ?? 0;
  const decision = await decideQuit(running, async (count) => {
    const { message, detail } = quitMessage(count);
    const answer = await dialog.showMessageBox({
      type: 'warning',
      message,
      detail,
      buttons: [...QUIT_BUTTONS],
      defaultId: 0,
      cancelId: 2,
    });
    return (['wait', 'stop', 'cancel'] as const)[answer.response] ?? 'cancel';
  });
  if (decision === 'cancel') return;
  quitting = true;
  await supervisor.stop(decision).catch(() => undefined);
  runtime.dispose();
  tray?.destroy();
  app.exit(0);
}

if (!app.requestSingleInstanceLock()) {
  // Another 2P Crew runs on this user account: it owns the daemon (one daemon per crew home).
  app.exit(0);
} else {
  app.on('second-instance', () => openWindow());
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    void quit();
  });
  app.on('window-all-closed', () => {
    // Stay in the menu bar.
  });
  app.on('activate', () => openWindow());

  app.whenReady().then(() => {
    ipcMain.handle(DESKTOP_INVOKE_CHANNEL, async (event, method: unknown, input: unknown) => {
      const started = Date.now();
      const result = isTrustedSender(event.senderFrame?.url, rendererUrl())
        ? await dispatchDesktopRequest(method, input, mainHandlers, (name, value) =>
            supervisor.request(name, value as never, 10 * 60 * 1000),
          )
        : ({ ok: false, error: 'Nguồn gọi không hợp lệ.' } as const);
      // The renderer's own crash reports are their own app-log lines.
      if (method !== 'app.reportError' || !result.ok) {
        appLog.write(ipcLogEntry(method, result, Date.now() - started));
      }
      return result;
    });
    log('info', 'app-start', {
      version: app.getVersion(),
      packaged: app.isPackaged,
      executable: app.getPath('exe'),
      // Run from a mounted dmg or macOS App Translocation: this path goes away (hooks are repaired at start).
      temporaryLocation: /\/AppTranslocation\/|^\/Volumes\//.test(app.getPath('exe')),
      setupComplete: desktopState.read().setupCompletedAt !== null,
    });

    tray = new CrewTray({
      openDashboard: () => openWindow({ route: 'status' }),
      togglePause: () => void setPaused(!desktopState.read().paused).catch(() => undefined),
      runHealth: () => {
        openWindow({ route: 'status' });
        void runHealth(false);
      },
      quit: () => void quit(),
    });

    const state = desktopState.read();
    supervisor.setPaused(state.paused);
    supervisor.setFacts(facts());
    if (state.setupCompletedAt) void supervisor.startDaemon();
    else supervisor.start();
    refreshTray();

    // Started by the login item: the menu bar only, no window.
    if (!(state.setupCompletedAt && loginItem.openedAtLogin())) {
      openWindow();
    } else {
      app.dock?.hide();
      // No window to trigger the first run: give the stream a moment, then report health in the heartbeat.
      setTimeout(() => void runHealth(false), 15_000);
    }

    setInterval(() => void runHealth(true), HEALTH_INTERVAL_MS);
    void updater.check();
    setInterval(() => void updater.check(), UPDATE_INTERVAL_MS);
    runtime.schedule();
  });
}
