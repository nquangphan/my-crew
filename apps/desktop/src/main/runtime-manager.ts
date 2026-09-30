import { join } from 'node:path';
import {
  compareVersions,
  type DaemonRuntimeResponse,
  type MachineRuntimeState,
  type RuntimeReleaseFiles,
  type RuntimeUpdateState,
  shellRangeProblem,
} from '@crew/shared';
import type { RuntimeStateFile, RuntimeStore } from './runtime-store.js';
import { RuntimeRefused, type ShellFacts } from './runtime-verify.js';

/** A runtime the shell can start: the one it ships with, or a verified installed one. */
export interface LaunchTarget {
  version: string;
  source: 'builtin' | 'installed';
  /** The runtime folder (`host/`, `renderer/`). */
  dir: string;
  hostEntry: string;
  rendererIndex: string;
}

/** The runtime the app ships with (inside the signed app; its manifest gives the version). */
export interface BuiltinRuntime {
  version: string;
  dir: string;
}

export interface RuntimeManagerDeps {
  store: RuntimeStore;
  builtin: BuiltinRuntime;
  shell: ShellFacts;
  /** Off in development builds: the app runs what it was built with. */
  enabled: boolean;
  /** The shell's node_modules, linked into every installed runtime. */
  nodeModules: string;
  /** Asks the paired server (through the host) which runtime to run; null when not paired. */
  check: () => Promise<DaemonRuntimeResponse | null>;
  /** Downloads a tarball (through the host) into the store's incoming folder; returns its path. */
  download: (version: string) => Promise<string>;
  /** Jobs running right now (a switch waits for them, up to `waitForJobsMs`). */
  runningJobs: () => number;
  /** Stops the host gracefully (jobs resume later) and starts it again on `target`, reloading the window. */
  switchTo: (target: LaunchTarget) => Promise<void>;
  onState: (state: MachineRuntimeState) => void;
  log: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  waitForJobsMs?: number;
  pollJobsMs?: number;
  /** A new runtime is watched this long after a switch. */
  probationMs?: number;
  /** Ready timeouts of a new runtime's host before it is rolled back. */
  maxReadyTimeouts?: number;
  /** Crashes of a new runtime's host within the probation before it is rolled back. */
  maxCrashes?: number;
  /** Previous installed versions kept besides the active one. */
  keepPrevious?: number;
}

/** What a check decided (pure; see `decideRuntime`). */
export type RuntimeDecision =
  | { kind: 'stay'; notice: string | null }
  | { kind: 'builtin' }
  | { kind: 'install'; release: RuntimeReleaseFiles }
  | { kind: 'blocked'; state: 'shell_update_required' | 'rolled_back'; target: string; message: string };

/**
 * Which runtime this machine should run, given the server's answer: the pinned release (even an older one: a
 * rollback), else the newest release this shell can run but never older than the one the app ships with. A
 * version that already failed here is not tried again; one this shell cannot run asks for a dmg install.
 */
export function decideRuntime(
  response: DaemonRuntimeResponse,
  context: { current: string; builtin: string; bad: Readonly<Record<string, string>>; shell: ShellFacts },
): RuntimeDecision {
  const { desired, latest, pinnedVersion } = response;
  const newerNeedsShell =
    latest &&
    compareVersions(latest.version, desired?.version ?? context.current) > 0 &&
    shellRangeProblem(latest.shellRange, context.shell);
  const notice = newerNeedsShell
    ? `Bản runtime ${latest.version} cần bản app mới hơn (${latest.shellRange.app}): tải và cài file dmg mới.`
    : null;
  if (!desired) return { kind: 'stay', notice };
  let target = desired.version;
  if (!pinnedVersion && compareVersions(target, context.builtin) <= 0) target = context.builtin;
  if (target === context.current) return { kind: 'stay', notice };
  const failed = context.bad[target];
  if (failed) {
    return {
      kind: 'blocked',
      state: 'rolled_back',
      target,
      message: `Bản runtime ${target} từng không khởi động được trên máy này nên không cài lại (${failed}).`,
    };
  }
  if (target === context.builtin) return { kind: 'builtin' };
  const problem = shellRangeProblem(desired.shellRange, context.shell);
  if (problem) {
    return {
      kind: 'blocked',
      state: 'shell_update_required',
      target,
      message: `Bản runtime ${target} cần bản app mới hơn: ${problem}. Tải và cài file dmg mới.`,
    };
  }
  return { kind: 'install', release: desired };
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Runs the runtime update flow of the shell. At launch it picks the runtime to start (the active installed one
 * if it still verifies, else an earlier one, else the one the app ships with). A check (at start, on a
 * `runtime.published`/`runtime.pinned` event, hourly, or on request) asks the server which runtime to run,
 * downloads it through the host, verifies and installs it, waits for running jobs (bounded), then restarts the
 * host and the window on it. A new runtime is on probation: if its host misses the ready timeout twice or
 * crashes repeatedly within five minutes, the previous runtime comes back and the version is marked failed.
 */
export class RuntimeManager {
  private target: LaunchTarget;
  private status: MachineRuntimeState;
  private running: Promise<MachineRuntimeState> | null = null;
  private again = false;
  private checkAfterProbation = false;
  private probationTimer: NodeJS.Timeout | null = null;
  private readonly options: Required<
    Pick<
      RuntimeManagerDeps,
      'waitForJobsMs' | 'pollJobsMs' | 'probationMs' | 'maxReadyTimeouts' | 'maxCrashes' | 'keepPrevious'
    >
  > & { now: () => number; sleep: (ms: number) => Promise<void> };

  constructor(private readonly deps: RuntimeManagerDeps) {
    this.options = {
      waitForJobsMs: deps.waitForJobsMs ?? 30 * 60 * 1000,
      pollJobsMs: deps.pollJobsMs ?? 15_000,
      probationMs: deps.probationMs ?? 5 * 60 * 1000,
      maxReadyTimeouts: deps.maxReadyTimeouts ?? 2,
      maxCrashes: deps.maxCrashes ?? 3,
      keepPrevious: deps.keepPrevious ?? 2,
      now: deps.now ?? Date.now,
      sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    };
    this.target = this.builtinTarget();
    this.status = {
      shellVersion: deps.shell.appVersion,
      version: deps.builtin.version,
      source: 'builtin',
      state: deps.enabled ? 'idle' : 'disabled',
      target: null,
      message: null,
      checkedAt: null,
    };
  }

  private builtinTarget(): LaunchTarget {
    const { dir, version } = this.deps.builtin;
    return {
      version,
      source: 'builtin',
      dir,
      hostEntry: join(dir, 'host', 'index.js'),
      rendererIndex: join(dir, 'renderer', 'index.html'),
    };
  }

  private installedTarget(version: string): LaunchTarget {
    const installed = this.deps.store.load(version);
    this.deps.store.linkNodeModules(installed.dir, this.deps.nodeModules);
    return {
      version,
      source: 'installed',
      dir: installed.dir,
      hostEntry: join(installed.dir, 'host', 'index.js'),
      rendererIndex: join(installed.dir, 'renderer', 'index.html'),
    };
  }

  current(): LaunchTarget {
    return this.target;
  }

  state(): MachineRuntimeState {
    return this.status;
  }

  private set(state: RuntimeUpdateState, patch: Partial<MachineRuntimeState> = {}): void {
    this.status = {
      ...this.status,
      version: this.target.version,
      source: this.target.source,
      state,
      target: null,
      message: null,
      ...patch,
    };
    this.deps.onState(this.status);
  }

  /**
   * The runtime to start now. An installed version runs only after a full verification; one that fails it is
   * marked failed and an earlier one (or the one the app ships with) runs instead. After a dmg update the next
   * check moves an unpinned machine up to the shipped runtime when it is newer.
   */
  select(): LaunchTarget {
    if (!this.deps.enabled) return this.target;
    let state: RuntimeStateFile;
    try {
      this.deps.store.ensureRoot();
      state = this.deps.store.read();
    } catch (error) {
      this.deps.log('error', 'runtime-store-unusable', { error: (error as Error).message });
      return this.target;
    }
    const candidates = [state.probation?.version ?? state.active, ...state.history].filter(
      (version): version is string => typeof version === 'string',
    );
    let chosen: LaunchTarget | null = null;
    for (const version of [...new Set(candidates)]) {
      if (state.bad[version]) continue;
      try {
        chosen = this.installedTarget(version);
        break;
      } catch (error) {
        const reason = (error as Error).message;
        this.deps.log('error', 'runtime-verify-failed', { version, error: reason });
        state = this.deps.store.update((current) => ({
          ...current,
          bad: { ...current.bad, [version]: reason },
        }));
      }
    }
    this.target = chosen ?? this.builtinTarget();
    const active = this.target.source === 'installed' ? this.target.version : null;
    if (active !== state.active) {
      this.deps.store.update((current) => ({
        ...current,
        active,
        probation: current.probation?.version === active ? current.probation : null,
      }));
    }
    this.status = { ...this.status, version: this.target.version, source: this.target.source };
    this.deps.log('info', 'runtime-selected', { version: this.target.version, source: this.target.source });
    if (this.deps.store.read().probation) this.armProbationTimer();
    return this.target;
  }

  /** Checks now; concurrent calls share the running check (and one more runs after it). */
  check(): Promise<MachineRuntimeState> {
    if (!this.deps.enabled) return Promise.resolve(this.status);
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.runCheck();
        } while (this.again);
        return this.status;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async runCheck(): Promise<void> {
    // A runtime on probation is not replaced; the check runs again when the probation ends.
    if (this.deps.store.read().probation) {
      this.checkAfterProbation = true;
      return;
    }
    this.set('checking');
    const checkedAt = new Date(this.options.now()).toISOString();
    let response: DaemonRuntimeResponse | null;
    try {
      response = await this.deps.check();
    } catch (error) {
      this.set('error', {
        checkedAt,
        message: `Không hỏi được server bản runtime nào cần chạy: ${(error as Error).message}`,
      });
      return;
    }
    if (!response) {
      this.set('idle', { checkedAt });
      return;
    }
    const state = this.deps.store.read();
    const decision = decideRuntime(response, {
      current: this.target.version,
      builtin: this.deps.builtin.version,
      bad: state.bad,
      shell: this.deps.shell,
    });
    if (decision.kind === 'stay') {
      this.set(decision.notice ? 'shell_update_required' : 'idle', {
        checkedAt,
        message: decision.notice,
        target: decision.notice ? (response.latest?.version ?? null) : null,
      });
      return;
    }
    if (decision.kind === 'blocked') {
      this.set(decision.state, { checkedAt, target: decision.target, message: decision.message });
      return;
    }
    let next: LaunchTarget;
    if (decision.kind === 'builtin') {
      next = this.builtinTarget();
    } else {
      const installed = await this.install(decision.release, checkedAt);
      if (!installed) return;
      next = installed;
    }
    await this.waitForJobs(next.version, checkedAt);
    await this.switchTo(next, checkedAt);
  }

  private async install(release: RuntimeReleaseFiles, checkedAt: string): Promise<LaunchTarget | null> {
    const { version } = release;
    try {
      return this.installedTarget(version);
    } catch {
      // not installed yet (or broken on disk): download it again
    }
    let tarball: Buffer;
    try {
      this.set('downloading', { checkedAt, target: version });
      const path = await this.deps.download(version);
      tarball = this.deps.store.takeIncoming(path);
    } catch (error) {
      this.set('error', {
        checkedAt,
        target: version,
        message: `Không tải được bản runtime ${version}: ${(error as Error).message}`,
      });
      return null;
    }
    try {
      this.set('installing', { checkedAt, target: version });
      this.deps.store.install(release.manifest, release.signature, tarball);
      this.deps.log('info', 'runtime-installed', { version });
      return this.installedTarget(version);
    } catch (error) {
      const message = (error as Error).message;
      this.deps.log(error instanceof RuntimeRefused ? 'error' : 'warn', 'runtime-refused', {
        version,
        error: message,
      });
      this.set(error instanceof RuntimeRefused ? 'refused' : 'error', {
        checkedAt,
        target: version,
        message,
      });
      return null;
    }
  }

  private async waitForJobs(version: string, checkedAt: string): Promise<void> {
    const started = this.options.now();
    for (;;) {
      const running = this.deps.runningJobs();
      if (running === 0) return;
      const waited = this.options.now() - started;
      if (waited >= this.options.waitForJobsMs) {
        this.deps.log('info', 'runtime-switch-requeues-jobs', { version, running });
        return;
      }
      const minutes = Math.ceil((this.options.waitForJobsMs - waited) / 60_000);
      this.set('waiting', {
        checkedAt,
        target: version,
        message: `Đã cài bản ${version}; chờ ${running} job đang chạy xong (tối đa ${minutes} phút nữa, sau đó job tạm dừng và chạy tiếp trên bản mới).`,
      });
      await this.options.sleep(this.options.pollJobsMs);
    }
  }

  private async switchTo(next: LaunchTarget, checkedAt: string): Promise<void> {
    const from = this.target;
    this.set('switching', { checkedAt, target: next.version });
    this.deps.store.update((state) => ({
      ...state,
      active: next.source === 'installed' ? next.version : null,
      history: [
        ...new Set([...(from.source === 'installed' ? [from.version] : []), ...state.history]),
      ].filter((version) => version !== next.version),
      probation:
        next.source === 'installed'
          ? {
              version: next.version,
              previous: from.source === 'installed' ? from.version : null,
              startedAt: new Date(this.options.now()).toISOString(),
              readyTimeouts: 0,
              crashes: [],
            }
          : null,
    }));
    this.target = next;
    this.deps.log('info', 'runtime-switch', { from: from.version, to: next.version });
    if (next.source === 'installed') this.armProbationTimer();
    try {
      await this.deps.switchTo(next);
      this.set('idle', { checkedAt });
    } catch (error) {
      this.deps.log('error', 'runtime-switch-failed', { to: next.version, error: (error as Error).message });
      await this.rollback(`không khởi động lại được: ${(error as Error).message}`);
    }
  }

  private armProbationTimer(): void {
    if (this.probationTimer) clearTimeout(this.probationTimer);
    const probation = this.deps.store.read().probation;
    if (!probation) return;
    const left = Math.max(0, Date.parse(probation.startedAt) + this.options.probationMs - this.options.now());
    this.probationTimer = setTimeout(() => this.endProbation(), left);
    this.probationTimer.unref?.();
  }

  /** The new runtime stayed up through its probation: it is kept, and older bundles beyond two are removed. */
  endProbation(): void {
    this.probationTimer = null;
    const state = this.deps.store.update((current) => ({
      ...current,
      probation: null,
      history: current.history.slice(0, this.options.keepPrevious),
    }));
    const keep = [state.active, ...state.history].filter(
      (version): version is string => typeof version === 'string',
    );
    const removed = this.deps.store.prune(keep);
    this.deps.log('info', 'runtime-kept', { version: state.active ?? this.deps.builtin.version, removed });
    if (this.checkAfterProbation) {
      this.checkAfterProbation = false;
      void this.check();
    }
  }

  /** The host of the runtime on probation did not report ready in time. */
  onReadyTimeout(): void {
    const probation = this.deps.store.read().probation;
    if (!probation || probation.version !== this.target.version) return;
    const next = this.deps.store.update((state) => ({
      ...state,
      probation: state.probation
        ? { ...state.probation, readyTimeouts: state.probation.readyTimeouts + 1 }
        : null,
    }));
    if ((next.probation?.readyTimeouts ?? 0) >= this.options.maxReadyTimeouts) {
      void this.rollback(`host không báo sẵn sàng sau ${next.probation?.readyTimeouts} lần chờ`);
    }
  }

  /** The host of the runtime on probation exited unexpectedly. */
  onHostCrash(): void {
    const probation = this.deps.store.read().probation;
    if (!probation || probation.version !== this.target.version) return;
    const now = this.options.now();
    const since = now - this.options.probationMs;
    const next = this.deps.store.update((state) => ({
      ...state,
      probation: state.probation
        ? { ...state.probation, crashes: [...state.probation.crashes.filter((at) => at >= since), now] }
        : null,
    }));
    const crashes = next.probation?.crashes.length ?? 0;
    if (crashes >= this.options.maxCrashes)
      void this.rollback(`host dừng đột ngột ${crashes} lần trong 5 phút`);
  }

  private rolling = false;

  /** Switches back to the runtime that ran before the one on probation, and marks that one failed. */
  async rollback(reason: string): Promise<void> {
    const probation = this.deps.store.read().probation;
    if (!probation || this.rolling) return;
    this.rolling = true;
    try {
      if (this.probationTimer) clearTimeout(this.probationTimer);
      this.probationTimer = null;
      let previous: LaunchTarget = this.builtinTarget();
      if (probation.previous) {
        try {
          previous = this.installedTarget(probation.previous);
        } catch (error) {
          this.deps.log('warn', 'runtime-rollback-previous-unusable', {
            version: probation.previous,
            error: (error as Error).message,
          });
        }
      }
      this.deps.store.update((state) => ({
        ...state,
        active: previous.source === 'installed' ? previous.version : null,
        history: state.history.filter((version) => version !== previous.version),
        bad: { ...state.bad, [probation.version]: reason },
        probation: null,
      }));
      this.deps.log('error', 'runtime-rolled-back', {
        from: probation.version,
        to: previous.version,
        reason,
      });
      this.target = previous;
      const message = `Bản runtime ${probation.version} không khởi động được (${reason}); đã quay lại bản ${previous.version}.`;
      this.set('rolled_back', { target: probation.version, message });
      try {
        await this.deps.switchTo(previous);
      } catch (error) {
        this.deps.log('error', 'runtime-rollback-switch-failed', { error: (error as Error).message });
      }
      this.set('rolled_back', { target: probation.version, message });
    } finally {
      this.rolling = false;
    }
  }

  /** Hourly checks; returns a stop function. */
  schedule(intervalMs = HOUR_MS): () => void {
    const timer = setInterval(() => void this.check(), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  dispose(): void {
    if (this.probationTimer) clearTimeout(this.probationTimer);
    this.probationTimer = null;
  }
}
