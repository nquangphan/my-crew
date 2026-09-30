import { EventEmitter } from 'node:events';
import {
  type AppFacts,
  type DaemonRuntime,
  FromHost,
  type HostEventName,
  type HostInput,
  type HostMethod,
  type HostOutput,
  type ToHost,
} from '@crew/shared';

/** The forked daemon host as the supervisor sees it (an Electron `UtilityProcess` in production). */
export interface HostProcess {
  readonly pid: number | undefined;
  postMessage(message: ToHost): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
  /** Graceful stop (SIGTERM): the host stops its daemon, then exits. */
  kill(): void;
  /** SIGKILL, for a host whose event loop is blocked and so cannot run its SIGTERM handler. */
  forceKill(): void;
}

export type ForkHost = () => HostProcess;

export interface SupervisorOptions {
  fork: ForkHost;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** A host that ran this long before crashing restarts with the initial backoff again. */
  stableMs?: number;
  requestTimeoutMs?: number;
  /** A host that has not reported ready this long after its fork is killed and restarted. */
  readyTimeoutMs?: number;
  /** A host that never reported ready and ignores SIGTERM this long is killed with SIGKILL. */
  killGraceMs?: number;
  now?: () => number;
}

/** The first daemon start may wait for the owner to answer macOS's folder-permission prompt. */
const DAEMON_START_TIMEOUT_MS = 30 * 60 * 1000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class HostUnavailableError extends Error {
  constructor(message = 'Daemon đang khởi động lại, thử lại sau vài giây.') {
    super(message);
    this.name = 'HostUnavailableError';
  }
}

/**
 * Runs the daemon host in a utility process and keeps it alive: a crash is restarted with exponential
 * backoff (1 s, 2 s, 4 s … 30 s), the daemon is started again when the machine is set up, and a pause is
 * re-applied. A graceful stop either waits for running jobs (`drain`) or re-queues them (`requeue`).
 *
 * A host that does not report ready within `readyTimeoutMs` is killed and restarted the same way.
 *
 * Events: `runtime` (DaemonRuntime), `host-event` (name, payload), `host-log` (AppLogEntry for app.log),
 * `ready-timeout` ({ pid, ms }), `host-crash` ({ code, uptimeMs }: an exit nobody asked for).
 */
export class DaemonSupervisor extends EventEmitter {
  private child: HostProcess | null = null;
  private ready = false;
  private readyWaiters: { resolve: () => void; reject: (error: Error) => void }[] = [];
  private wantHost = false;
  private wantDaemon = false;
  private paused = false;
  private daemonStarted = false;
  private facts: AppFacts | null = null;
  private state: DaemonRuntime['state'] = 'stopped';
  private restarts = 0;
  private lastExit: string | null = null;
  private startedAt = 0;
  private backoffMs: number;
  private restartTimer: NodeJS.Timeout | null = null;
  private readyTimer: NodeJS.Timeout | null = null;
  private forceKillTimer: NodeJS.Timeout | null = null;
  private readyTimedOut = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly options: Required<Omit<SupervisorOptions, 'fork'>> & { fork: ForkHost };

  constructor(options: SupervisorOptions) {
    super();
    this.options = {
      initialBackoffMs: 1_000,
      maxBackoffMs: 30_000,
      stableMs: 60_000,
      requestTimeoutMs: 120_000,
      readyTimeoutMs: 30_000,
      killGraceMs: 5_000,
      now: Date.now,
      ...options,
    };
    this.backoffMs = this.options.initialBackoffMs;
  }

  runtime(): DaemonRuntime {
    return {
      state: this.state,
      pid: this.child?.pid ?? null,
      restarts: this.restarts,
      lastExit: this.lastExit,
      daemonStarted: this.daemonStarted,
    };
  }

  private setState(state: DaemonRuntime['state']): void {
    this.state = state;
    this.emit('runtime', this.runtime());
  }

  /** Forks the host (idempotent). */
  start(): void {
    this.wantHost = true;
    if (!this.child && !this.restartTimer) this.spawn();
  }

  private spawn(): void {
    this.restartTimer = null;
    this.ready = false;
    this.readyTimedOut = false;
    this.startedAt = this.options.now();
    const child = this.options.fork();
    this.child = child;
    child.onMessage((raw) => this.onMessage(child, raw));
    child.onExit((code) => this.onExit(child, code));
    this.readyTimer = setTimeout(() => this.onReadyTimeout(child), this.options.readyTimeoutMs);
    this.setState(this.restarts > 0 ? 'restarting' : 'starting');
  }

  /** A host that never reports ready would leave every request waiting: kill it, the exit restarts it. */
  private onReadyTimeout(child: HostProcess): void {
    this.readyTimer = null;
    if (child !== this.child || this.ready) return;
    this.readyTimedOut = true;
    this.emit('ready-timeout', { pid: child.pid ?? null, ms: this.options.readyTimeoutMs });
    this.killHost(child);
  }

  /** SIGTERM; a host that never reported ready runs no daemon, so SIGKILL it if SIGTERM does not end it. */
  private killHost(child: HostProcess): void {
    child.kill();
    if (this.ready || this.forceKillTimer) return;
    this.forceKillTimer = setTimeout(() => {
      this.forceKillTimer = null;
      if (child === this.child) child.forceKill();
    }, this.options.killGraceMs);
  }

  private clearHostTimers(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.forceKillTimer) clearTimeout(this.forceKillTimer);
    this.readyTimer = null;
    this.forceKillTimer = null;
  }

  private onMessage(child: HostProcess, raw: unknown): void {
    if (child !== this.child) return;
    const parsed = FromHost.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.kind === 'ready') {
      void this.onReady();
    } else if (message.kind === 'log') {
      this.emit('host-log', message.entry);
    } else if (message.kind === 'response') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result ?? null);
      else pending.reject(new Error(message.error?.message ?? 'Daemon báo lỗi không rõ.'));
    } else {
      this.emit('host-event', message.name as HostEventName, message.payload);
    }
  }

  private async onReady(): Promise<void> {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.ready = true;
    for (const waiter of this.readyWaiters.splice(0)) waiter.resolve();
    if (this.facts) this.child?.postMessage({ kind: 'facts', facts: this.facts });
    this.setState('running');
    if (this.wantDaemon) await this.bootDaemon();
  }

  private async bootDaemon(): Promise<void> {
    try {
      await this.request('host.startDaemon', {}, DAEMON_START_TIMEOUT_MS);
      if (this.paused) await this.request('daemon.pause', {});
      this.daemonStarted = true;
    } catch (error) {
      this.daemonStarted = false;
      // A host that died meanwhile already recorded its exit; keep that as the reason.
      if (!(error instanceof HostUnavailableError)) this.lastExit = (error as Error).message;
    }
    this.emit('runtime', this.runtime());
  }

  private onExit(child: HostProcess, code: number): void {
    if (child !== this.child) return;
    this.clearHostTimers();
    this.child = null;
    this.ready = false;
    this.daemonStarted = false;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new HostUnavailableError());
      this.pending.delete(id);
    }
    this.lastExit = this.readyTimedOut
      ? `không báo sẵn sàng sau ${Math.round(this.options.readyTimeoutMs / 1000)} giây nên bị dừng (mã ${code})`
      : `thoát với mã ${code}`;
    if (!this.wantHost) {
      for (const waiter of this.readyWaiters.splice(0))
        waiter.reject(new HostUnavailableError('Daemon đã dừng.'));
      this.setState('stopped');
      this.emit('stopped');
      return;
    }
    this.emit('host-crash', { code, uptimeMs: this.options.now() - this.startedAt });
    if (this.options.now() - this.startedAt >= this.options.stableMs)
      this.backoffMs = this.options.initialBackoffMs;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.options.maxBackoffMs);
    this.restarts += 1;
    this.setState('crashed');
    this.restartTimer = setTimeout(() => this.spawn(), delay);
  }

  private whenReady(timeoutMs: number): Promise<void> {
    if (this.ready && this.child) return Promise.resolve();
    if (!this.wantHost) return Promise.reject(new HostUnavailableError('Daemon không chạy.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new HostUnavailableError()), timeoutMs);
      this.readyWaiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  /** A typed request to the host; waits (bounded) while the host is restarting. */
  async request<M extends HostMethod>(
    method: M,
    params: HostInput<M>,
    timeoutMs?: number,
  ): Promise<HostOutput<M>> {
    const limit = timeoutMs ?? this.options.requestTimeoutMs;
    await this.whenReady(Math.min(limit, 15_000));
    const child = this.child;
    if (!child) throw new HostUnavailableError();
    const id = this.nextId++;
    return new Promise<HostOutput<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Daemon không trả lời ${method} sau ${Math.round(limit / 1000)} giây.`));
      }, limit);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      child.postMessage({ kind: 'request', id, method, params });
    });
  }

  setFacts(facts: AppFacts): void {
    this.facts = facts;
    if (this.ready) this.child?.postMessage({ kind: 'facts', facts });
  }

  /** Starts the daemon runtime now, and after every host restart. */
  async startDaemon(): Promise<void> {
    this.wantDaemon = true;
    this.start();
    if (this.ready) await this.bootDaemon();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Kills the host; the supervisor starts it again at once (the "restart daemon" fix). */
  restart(): void {
    this.backoffMs = this.options.initialBackoffMs;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.spawn();
      return;
    }
    if (this.child) this.killHost(this.child);
    else if (this.wantHost) this.spawn();
  }

  /**
   * Replaces the host with a new one, forked by whatever `fork` launches now (a switched runtime bundle): a
   * graceful stop in which running jobs are re-queued (they resume on the new host), then a fresh start. The
   * daemon starts again when it ran before.
   */
  async relaunch(): Promise<void> {
    await this.stop('requeue');
    this.backoffMs = this.options.initialBackoffMs;
    this.start();
  }

  /**
   * Graceful stop. `drain`: no new jobs, running ones finish; `requeue`: stop now, running jobs resume on the
   * next start. Resolves when the host process has exited.
   */
  async stop(mode: 'requeue' | 'drain', drainTimeoutMs = 6 * 60 * 60 * 1000): Promise<void> {
    this.wantHost = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.setState('stopped');
    }
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>((resolve) => this.once('stopped', () => resolve()));
    if (this.ready) {
      await this.request('host.stopDaemon', { mode }, mode === 'drain' ? drainTimeoutMs : 60_000).catch(
        () => undefined,
      );
    }
    this.killHost(child);
    await exited;
  }
}
