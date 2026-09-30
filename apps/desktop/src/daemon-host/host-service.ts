import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDaemon, HEALTH_CHECKS, type JobRow, runHealthChecks, scrubSecrets } from '@crew/daemon';
import {
  APP_HEALTH_FIXES,
  type AppFacts,
  type DaemonStatusView,
  type DesktopMethod,
  type DesktopParsed,
  type HealthReport,
  type HostMethod,
  hostInputSchema,
  type LogLine,
  RUNTIME_LIMITS,
} from '@crew/shared';
import { z } from 'zod';
import { Activity } from './activity.js';
import { type BmadInstallOutcome, installBmad, npxRunner } from './bmad-install.js';
import { HealthOps } from './health-ops.js';
import { HostContext, type HostDeps, HostError } from './host-context.js';
import {
  checkServer,
  describeError,
  installShippedCrewDocs,
  pairMachine,
  repairBrokenHooks,
  setFolder,
  statusView,
} from './setup-ops.js';

const STATUS_POLL_MS = 1_000;
/** How long an app-level fix asked for from the web gets in the main process before the re-check. */
const APP_FIX_SETTLE_MS = 2_000;

/** A log line sent to the web: scrubbed of anything credential-shaped, its fields capped so a tail stays small. */
const MAX_LOG_FIELDS_CHARS = 2_000;

function boundedLogLine(line: LogLine): LogLine {
  const fields = scrubSecrets(JSON.stringify(line.fields ?? {})).text;
  let kept: LogLine['fields'];
  try {
    kept =
      fields.length > MAX_LOG_FIELDS_CHARS
        ? { truncated: fields.slice(0, MAX_LOG_FIELDS_CHARS) }
        : JSON.parse(fields);
  } catch {
    kept = { truncated: fields.slice(0, MAX_LOG_FIELDS_CHARS) };
  }
  return { ...line, message: scrubSecrets(line.message).text.slice(0, 1_000), fields: kept };
}

/**
 * Everything the daemon host (the Electron utility process) answers: the setup wizard's operations, the status
 * view and the folder picker, the health checks (run on a schedule, their summary goes to the web in the
 * heartbeat), the remote actions the owner triggers from the web, and the daemon runtime itself
 * (`createDaemon()`), which runs here so a UI crash or a closed window never stops a running job.
 */
export class HostService {
  readonly host: HostContext;
  readonly health: HealthOps;
  readonly activity: Activity;
  private statusTimer: NodeJS.Timeout | null = null;
  private lastStatus = '';

  private startup: Promise<void> | null = null;

  /** Cheap on purpose: the host reports ready right after this, before any disk or repo work. */
  constructor(deps: HostDeps) {
    this.host = new HostContext(deps);
    this.health = new HealthOps(this.host);
    this.activity = new Activity(this.host);
  }

  /**
   * Startup maintenance, run once after the host reported ready: refresh the shipped crew-docs bundle, then
   * repair broken hooks once the repo folders can be read (a pending macOS permission prompt only delays this).
   */
  start(): Promise<void> {
    this.startup ??= (async () => {
      try {
        installShippedCrewDocs(this.host);
      } catch (error) {
        this.activity.logger('warn', 'crew-docs install failed', { error: (error as Error).message });
        this.host.log('error', 'crew-docs-install-failed', { error: (error as Error).message });
      }
      await this.host.repoAccess();
      repairBrokenHooks(this.host);
    })();
    return this.startup;
  }

  setFacts(facts: AppFacts): void {
    const before = JSON.stringify(this.health.facts?.runtime ?? null);
    this.health.facts = facts;
    // A new runtime version or update state reaches the web at once, not with the next 30 s heartbeat.
    if (this.host.daemon && JSON.stringify(facts.runtime ?? null) !== before) {
      void this.host.daemon.heartbeat().catch(() => undefined);
    }
  }

  /** Which runtime the paired server wants this machine to run (null: not paired yet). */
  private async runtimeCheck() {
    const config = this.host.config();
    if (!config?.machineId || !this.host.tokenStore.get()) return null;
    return this.host.vps(config.apiUrl).runtime();
  }

  /**
   * Downloads a runtime tarball into `<home>/runtime/.incoming/` for the main process, which verifies the
   * signature and every hash before it unpacks or runs anything.
   */
  private async runtimeDownload(version: string): Promise<{ path: string; size: number }> {
    const data = await this.host.vps().runtimeBundle(version, RUNTIME_LIMITS.bundleBytes);
    const dir = join(this.host.deps.home, 'runtime', '.incoming');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${version}.tar.gz`);
    writeFileSync(path, data, { mode: 0o600 });
    this.host.log('info', 'runtime-downloaded', { version, size: data.length });
    return { path, size: data.length };
  }

  status(): DaemonStatusView | null {
    return this.host.daemon?.status() ?? null;
  }

  private emitStatus(force: boolean): void {
    const status = this.status();
    const json = JSON.stringify(status);
    if (!force && json === this.lastStatus) return;
    this.lastStatus = json;
    this.host.deps.emit('daemon.status', status);
  }

  /** A blocked job becomes a macOS notification (the main process shows it). */
  private async onJob(job: JobRow): Promise<void> {
    if (job.status !== 'blocked') return;
    let ticketKey: string | null = null;
    try {
      ticketKey = (await this.host.vps().getTicket(job.ticketId)).ticket.key;
    } catch {
      ticketKey = null;
    }
    this.host.deps.emit('job.blocked', {
      jobId: job.id,
      ticketId: job.ticketId,
      ticketKey,
      error: job.error,
    });
  }

  /**
   * A health fix asked for from the web. Fixes only the main process can apply (Terminal, login item, app
   * update) go to it; restarting the host itself is refused (this host would not live to report the result).
   */
  private async remoteFix(group: Parameters<HealthOps['fix']>[0], fixId: string): Promise<HealthReport> {
    if (!APP_HEALTH_FIXES.includes(fixId)) return this.health.fix(group, fixId);
    if (fixId === 'restart-daemon') {
      throw new HostError('Khởi động lại daemon chỉ làm được trên máy (menu 2P Crew trên thanh menu).');
    }
    this.host.deps.emit('app.fix', { fixId });
    await new Promise((resolve) => setTimeout(resolve, APP_FIX_SETTLE_MS));
    return this.health.run('fix');
  }

  async startDaemon(): Promise<DaemonStatusView | null> {
    // The daemon's startup runs synchronous git in the repos.
    await this.host.repoAccess();
    if (this.host.daemon) return this.status();
    const config = this.host.requireConfig();
    const { deps } = this.host;
    const daemon = createDaemon({
      config,
      home: deps.home,
      tokenStore: this.host.tokenStore,
      crewDocsSource: deps.crewDocsSource,
      crewDocsRuntime: deps.runtime,
      appVersion: deps.appVersion,
      logger: this.activity.logger,
      onApiError: this.host.logApiError,
      health: () => this.health.summary(),
      runtime: () => this.health.facts?.runtime,
      onRuntimeChanged: () => this.host.deps.emit('runtime.changed', {}),
      // Remote actions from the web that only this app can perform (the daemon adds pause, resume, the
      // inventory re-probe, the job list and the releases itself).
      commandHandlers: {
        'health.run': ({ quick }) => this.health.run(quick ? 'quick' : 'full'),
        'health.fix': ({ group, fixId }) => this.remoteFix(group, fixId),
        'bmad.install': ({ projectKey }) => this.installBmad(projectKey),
        'logs.tail': async ({ limit, ticket }) => this.activity.tail(limit, ticket).map(boundedLogLine),
      },
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.seams ? { query: deps.seams.query, probe: deps.seams.probe } : {}),
    });
    daemon.events.on('status', () => this.emitStatus(true));
    daemon.events.on('job', (job: JobRow) => void this.onJob(job));
    this.host.daemon = daemon;
    try {
      await daemon.start();
    } catch (error) {
      this.host.daemon = null;
      await daemon.halt().catch(() => undefined);
      this.host.log('error', 'daemon-start-failed', { error: describeError(error) });
      throw new HostError(`Không khởi động được daemon: ${describeError(error)}`);
    }
    this.host.log('info', 'daemon-started', { apiUrl: config.apiUrl, projects: this.host.projects().length });
    this.statusTimer = setInterval(() => this.emitStatus(false), STATUS_POLL_MS);
    this.emitStatus(true);
    return this.status();
  }

  /** `drain` stops taking new jobs and waits for the running ones; `requeue` stops now and resumes them later. */
  async stopDaemon(mode: 'requeue' | 'drain'): Promise<void> {
    const daemon = this.host.daemon;
    if (!daemon) return;
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    if (mode === 'drain') {
      daemon.pause();
      await daemon.idle();
    }
    // The final status event fires after the state DB closed; the host reports "stopped" itself below.
    daemon.events.removeAllListeners('status');
    this.host.daemon = null;
    await daemon.stop();
    this.emitStatus(true);
  }

  private readonly background = new Set<Promise<unknown>>();
  /** Projects whose BMAD install is running: a second request waits for the first instead of racing it. */
  private readonly bmadInstalls = new Set<string>();

  /**
   * "Cài BMAD" from the web: installs the project's BMAD profile (as the server holds it) into this machine's
   * folder of the project, then re-probes its inventory.
   */
  private async installBmad(key: string): Promise<BmadInstallOutcome> {
    const ctx = this.host;
    const project = ctx.projects().find((item) => item.key === key);
    if (!project) throw new HostError(`Máy này chưa có thư mục cho ${key}.`);
    if (this.bmadInstalls.has(key)) throw new HostError(`Đang cài BMAD cho ${key}; chờ lần cài này xong.`);
    this.bmadInstalls.add(key);
    try {
      const view = (await ctx.vps().listProjects()).items.find((item) => item.key === key);
      const outcome = await installBmad(ctx, key, view?.bmadProfile ?? null, project.repoPath, {
        runner: ctx.deps.bmadRunner ?? ctx.deps.seams?.bmadRunner ?? npxRunner,
        reprobe: async () => {
          if (!ctx.daemon) return null;
          const inventory = await ctx.daemon.refreshInventory(key);
          if (!inventory) throw new Error('inventory probe failed');
          return inventory.skills.length;
        },
      });
      this.afterProjectChange();
      return outcome;
    } finally {
      this.bmadInstalls.delete(key);
    }
  }

  /** Re-checks health in the background after a project change (the answer does not wait for it). */
  private afterProjectChange(): void {
    const run = this.health.run('quick').catch(() => undefined);
    this.background.add(run);
    void run.finally(() => this.background.delete(run));
  }

  /** Resolves once the background health runs started so far have finished. */
  async settled(): Promise<void> {
    await Promise.allSettled([...this.background]);
  }

  /**
   * Answers one request. A failure is written to the app log with what the UI shows plus the error code
   * (the main process logs the outcome of every IPC call; this line adds the host's detail).
   */
  async handle(method: string, params: unknown): Promise<unknown> {
    const started = Date.now();
    try {
      const schema = hostInputSchema(method);
      if (!schema) throw new HostError(`Không có thao tác ${method}.`);
      const parsed = schema.safeParse(params ?? {});
      if (!parsed.success) throw new HostError(`Dữ liệu không hợp lệ: ${z.prettifyError(parsed.error)}`);
      return await this.dispatch(method as HostMethod, parsed.data);
    } catch (error) {
      this.host.log('warn', 'host-op-failed', {
        method: method.slice(0, 100),
        ms: Date.now() - started,
        error: describeError(error),
        errorCode: (error as { code?: unknown }).code ?? null,
        status: (error as { status?: unknown }).status ?? null,
      });
      throw error;
    }
  }

  private async dispatch(method: HostMethod, input: unknown): Promise<unknown> {
    const ctx = this.host;
    const as = <M extends DesktopMethod>() => input as DesktopParsed<M>;
    switch (method) {
      case 'host.startDaemon':
        return this.startDaemon();
      case 'host.stopDaemon':
        await this.stopDaemon((input as { mode: 'requeue' | 'drain' }).mode);
        return null;
      case 'host.status':
        return this.status();
      case 'host.appState': {
        const config = ctx.config();
        return {
          apiUrl: config?.apiUrl ?? null,
          machineName: config?.machineName ?? null,
          paired: Boolean(config?.machineId && ctx.tokenStore.get()),
        };
      }
      case 'host.runtimeCheck':
        return this.runtimeCheck();
      case 'host.runtimeDownload':
        return this.runtimeDownload((input as { version: string }).version);
      case 'setup.checkServer':
        return checkServer(ctx, as<'setup.checkServer'>().apiUrl);
      case 'setup.pair': {
        const paired = await pairMachine(ctx, as<'setup.pair'>());
        if (ctx.daemon) {
          // A new server or machine id: restart the runtime on the new pairing.
          await this.stopDaemon('requeue');
          await this.startDaemon();
        }
        return paired;
      }
      case 'setup.checkClaude':
        return runHealthChecks(this.health.context('full'), {
          checks: HEALTH_CHECKS.filter((check) => check.group === 'claude'),
        });
      case 'status.view':
        return statusView(ctx);
      case 'projects.setFolder': {
        const { key, path } = as<'projects.setFolder'>();
        const validation = await setFolder(ctx, key, path);
        this.afterProjectChange();
        return validation;
      }
      case 'health.get':
        return this.health.latest();
      case 'health.run':
        return this.health.run(as<'health.run'>().quick ? 'quick' : 'full');
      case 'health.fix': {
        const { group, fixId } = as<'health.fix'>();
        return this.health.fix(group, fixId);
      }
      case 'daemon.pause':
        ctx.daemon?.pause();
        return this.status();
      case 'daemon.resume':
        ctx.daemon?.resume();
        return this.status();
      default:
        throw new HostError(`Thao tác ${method} do app xử lý, không phải daemon.`);
    }
  }

  async shutdown(): Promise<void> {
    await this.settled();
    await this.stopDaemon('requeue');
  }
}
