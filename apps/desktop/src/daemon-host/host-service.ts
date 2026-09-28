import { createDaemon, HEALTH_CHECKS, type JobRow, runHealthChecks } from '@crew/daemon';
import {
  type AppFacts,
  type DaemonStatusView,
  type DesktopMethod,
  type DesktopParsed,
  type HostMethod,
  hostInputSchema,
} from '@crew/shared';
import { z } from 'zod';
import { Activity } from './activity.js';
import { HealthOps } from './health-ops.js';
import { HostContext, type HostDeps, HostError } from './host-context.js';
import {
  applyProjects,
  checkServer,
  createProject,
  describeError,
  folderInfo,
  installProjectHooks,
  installShippedCrewDocs,
  listHooks,
  listProjects,
  pairMachine,
  projectDetail,
  releaseProject,
  requestTestSetup,
  resourcesView,
  saveResources,
  setAssistant,
  setFolder,
  updateProject,
  validateFolder,
} from './setup-ops.js';

const STATUS_POLL_MS = 1_000;

/**
 * Everything the daemon host (the Electron utility process) answers: the setup wizard's operations, the
 * health checks and fixes, Settings → Projects, the jobs and logs views, and the daemon runtime itself
 * (`createDaemon()`), which runs here so a UI crash or a closed window never stops a running job.
 */
export class HostService {
  readonly host: HostContext;
  readonly health: HealthOps;
  readonly activity: Activity;
  private statusTimer: NodeJS.Timeout | null = null;
  private jobsTimer: NodeJS.Timeout | null = null;
  private lastStatus = '';

  constructor(deps: HostDeps) {
    this.host = new HostContext(deps);
    this.health = new HealthOps(this.host);
    this.activity = new Activity(this.host);
    try {
      installShippedCrewDocs(this.host);
    } catch (error) {
      this.activity.logger('warn', 'crew-docs install failed', { error: (error as Error).message });
    }
  }

  setFacts(facts: AppFacts): void {
    this.health.facts = facts;
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

  private scheduleJobs(): void {
    if (this.jobsTimer) return;
    this.jobsTimer = setTimeout(() => {
      this.jobsTimer = null;
      void this.activity.jobs().then(
        (jobs) => this.host.deps.emit('jobs.changed', jobs),
        () => undefined,
      );
    }, 300);
  }

  private async onJob(job: JobRow): Promise<void> {
    this.scheduleJobs();
    if (job.status !== 'blocked') return;
    const [view] = (await this.activity.jobs().catch(() => [])).filter((item) => item.id === job.id);
    this.host.deps.emit('job.blocked', {
      jobId: job.id,
      ticketId: job.ticketId,
      ticketKey: view?.ticketKey ?? null,
      error: job.error,
    });
  }

  async startDaemon(): Promise<DaemonStatusView | null> {
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
      health: () => this.health.summary(),
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
      throw new HostError(`Không khởi động được daemon: ${describeError(error)}`);
    }
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

  private afterProjectChange(): void {
    void this.health.run('quick').catch(() => undefined);
  }

  async handle(method: string, params: unknown): Promise<unknown> {
    const schema = hostInputSchema(method);
    if (!schema) throw new HostError(`Không có thao tác ${method}.`);
    const parsed = schema.safeParse(params ?? {});
    if (!parsed.success) throw new HostError(`Dữ liệu không hợp lệ: ${z.prettifyError(parsed.error)}`);
    return this.dispatch(method as HostMethod, parsed.data);
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
      case 'folder.inspect':
        return folderInfo(as<'folder.inspect'>().path);
      case 'folder.validate': {
        const { path, repoUrl, defaultBranch } = as<'folder.validate'>();
        return validateFolder(path, repoUrl.trim() === '' ? null : repoUrl, defaultBranch);
      }
      case 'projects.list':
        return listProjects(ctx);
      case 'projects.apply': {
        const outcomes = await applyProjects(ctx, as<'projects.apply'>());
        this.afterProjectChange();
        return outcomes;
      }
      case 'projects.create': {
        const outcome = await createProject(ctx, as<'projects.create'>());
        this.afterProjectChange();
        return outcome;
      }
      case 'projects.setFolder': {
        const { key, path } = as<'projects.setFolder'>();
        const validation = await setFolder(ctx, key, path);
        this.afterProjectChange();
        return validation;
      }
      case 'projects.release': {
        const outcome = await releaseProject(ctx, as<'projects.release'>().key);
        this.afterProjectChange();
        return outcome;
      }
      case 'projects.setAssistant': {
        const outcome = await setAssistant(ctx, as<'projects.setAssistant'>().enabled);
        await ctx.daemon?.refreshProjects().catch(() => undefined);
        return outcome;
      }
      case 'projects.detail':
        return projectDetail(ctx, as<'projects.detail'>().key);
      case 'projects.setMcpEnabled': {
        const { key, server, enabled } = as<'projects.setMcpEnabled'>();
        updateProject(ctx, key, (project) => ({
          ...project,
          disabledMcpServers: enabled
            ? project.disabledMcpServers.filter((name) => name !== server)
            : [...new Set([...project.disabledMcpServers, server])],
        }));
        this.afterProjectChange();
        return projectDetail(ctx, key);
      }
      case 'projects.setSharedPaths': {
        const { key, paths } = as<'projects.setSharedPaths'>();
        updateProject(ctx, key, (project) => ({ ...project, sharedPaths: [...new Set(paths)] }));
        this.afterProjectChange();
        return projectDetail(ctx, key);
      }
      case 'projects.requestTestSetup':
        return requestTestSetup(this.host, as<'projects.requestTestSetup'>());
      case 'projects.refreshInventory': {
        const { key } = as<'projects.refreshInventory'>();
        if (!ctx.daemon) throw new HostError('Daemon chưa chạy: kho skill được dò khi daemon chạy.');
        await ctx.daemon.refreshInventory(key);
        this.afterProjectChange();
        return projectDetail(ctx, key);
      }
      case 'hooks.list':
        return listHooks(ctx);
      case 'hooks.install': {
        const view = await installProjectHooks(ctx, as<'hooks.install'>().key);
        this.afterProjectChange();
        return view;
      }
      case 'config.resources':
        return resourcesView(ctx);
      case 'config.saveResources':
        return saveResources(ctx, as<'config.saveResources'>());
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
      case 'jobs.list':
        return this.activity.jobs();
      case 'logs.tail': {
        const { limit, ticket } = as<'logs.tail'>();
        return this.activity.tail(limit, ticket);
      }
      default:
        throw new HostError(`Thao tác ${method} do app xử lý, không phải daemon.`);
    }
  }

  async shutdown(): Promise<void> {
    if (this.jobsTimer) clearTimeout(this.jobsTimer);
    await this.stopDaemon('requeue');
  }
}
