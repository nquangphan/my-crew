import {
  agentEnv,
  applyHealthFix,
  ConfigError,
  execCommand,
  type HealthContext,
  probeInventory,
  runHealthChecks,
  summarize,
} from '@crew/daemon';
import {
  type AppFacts,
  type HealthCheckResult,
  HealthGroup,
  type HealthReport,
  type HealthSummary,
} from '@crew/shared';
import type { HostContext } from './host-context.js';

/**
 * `full`: on open and on demand, every probe. `quick`: the 5-minute schedule, without the paid login probe,
 * the push dry run and the checkout skill probe. `fix`: after a fix, everything but the login probe.
 */
export type HealthMode = 'full' | 'quick' | 'fix';

/** Rows only a probe produces; a run that skips the probe keeps the last known row. */
const PROBE_ROW = /^(claude\.login|repos\.([^.]+)\.push|skills\.([^.]+)\.match)$/;
const GROUP_ORDER = HealthGroup.options;

/** Runs the shared health checks (the same list as `crewd doctor`) with the app's facts and the live daemon. */
export class HealthOps {
  private known = new Map<string, HealthCheckResult>();
  private last: HealthReport | null = null;
  /** Runs overlap (a fix, the 5-minute schedule, a project change): an older run never replaces a newer one. */
  private runsStarted = 0;
  private newestApplied = 0;
  facts: AppFacts | null = null;

  constructor(private readonly host: HostContext) {}

  latest(): HealthReport | null {
    return this.last;
  }

  /** The heartbeat summary: the web Machines page shows the same status as the dashboard. */
  summary(): HealthSummary | undefined {
    return this.last?.summary;
  }

  context(mode: HealthMode): HealthContext {
    let config: HealthContext['config'] = null;
    try {
      config = this.host.config();
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
    }
    const { deps } = this.host;
    return {
      config,
      paths: this.host.paths,
      tokenStore: this.host.tokenStore,
      vps: config ? this.host.vps(config.apiUrl) : null,
      state: this.host.daemon?.state ?? null,
      env: deps.env,
      platform: process.platform,
      exec: execCommand,
      skipLoginProbe: mode !== 'full',
      quick: mode === 'quick',
      ...(deps.seams ? { query: deps.seams.query } : {}),
      daemon: this.host.daemon,
      ...(this.facts ? { app: this.facts } : {}),
      crewDocs: { source: deps.crewDocsSource, runtime: deps.runtime },
      ...(mode === 'quick'
        ? {}
        : {
            probeCheckout: async (repoPath: string) =>
              deps.seams
                ? deps.seams.probe({ cwd: repoPath })
                : (
                    await probeInventory({
                      cwd: repoPath,
                      env: agentEnv(deps.env, {}),
                      enabledMcpjsonServers: [],
                    })
                  ).inventory,
          }),
    };
  }

  async run(mode: HealthMode): Promise<HealthReport> {
    // The repo checks run synchronous git in the project folders.
    await this.host.repoAccess();
    const ticket = ++this.runsStarted;
    const ctx = this.context(mode);
    const results = await runHealthChecks(ctx);
    const keys = new Set(ctx.config?.projects.map((project) => project.key) ?? []);
    if (mode !== 'full') {
      const present = new Set(results.map((item) => item.id));
      for (const [id, item] of this.known) {
        const match = PROBE_ROW.exec(id);
        const project = match?.[2] ?? match?.[3];
        if (match && !present.has(id) && (!project || keys.has(project))) results.push(item);
      }
      results.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    }
    const summary = summarize(results);
    const report: HealthReport = { generatedAt: new Date().toISOString(), results, summary };
    if (ticket < this.newestApplied) return report;
    this.newestApplied = ticket;
    if (mode === 'full') this.known.clear();
    for (const item of results) this.known.set(item.id, item);
    this.logChanges(results, summary);
    const changed = this.last?.summary.status !== report.summary.status;
    this.last = report;
    this.host.deps.emit('health.report', report);
    if (changed) void this.host.daemon?.heartbeat().catch(() => undefined);
    return report;
  }

  /**
   * App-log lines for the checks whose status changed since the last run (on the first run, the ones that
   * are not green), and for the summary when it changed.
   */
  private logChanges(results: HealthCheckResult[], summary: HealthSummary): void {
    const before = new Map(this.last?.results.map((item) => [item.id, item.status]) ?? []);
    for (const item of results) {
      const from = before.get(item.id) ?? null;
      if (from === item.status || (from === null && item.status === 'green')) continue;
      this.host.log(item.status === 'red' ? 'warn' : 'info', 'health-change', {
        check: item.id,
        from,
        to: item.status,
        detail: item.detail,
      });
    }
    if (this.last?.summary.status !== summary.status) {
      this.host.log(summary.status === 'red' ? 'warn' : 'info', 'health-summary', {
        from: this.last?.summary.status ?? null,
        to: summary.status,
        failing: summary.failing.map((item) => item.id),
      });
    }
  }

  async fix(group: HealthGroup, fixId: string): Promise<HealthReport> {
    await applyHealthFix(this.context('fix'), group, fixId);
    return this.run('fix');
  }
}
