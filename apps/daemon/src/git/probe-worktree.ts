import { existsSync } from 'node:fs';
import { removeWorktree, worktreePath } from './worktree-manager.js';

/** The detached worktree each project's capability inventory is probed in. */
export const PROBE_WORKTREE_KEY = '_probe';
/** A probe worktree is kept this long after its last probe for reuse, then removed. */
export const PROBE_WORKTREE_TTL_MS = 60 * 60 * 1000;

/** Time source and timers; tests pass a controllable clock. */
export interface ProbeClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: ProbeClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface ProbeWorktreeKeeperOptions {
  /** Persists the last probe time per project, so a restarted daemon knows the worktree's age. */
  meta: { get(key: string): string | null; set(key: string, value: string): void };
  /** The project's main checkout, or null when this machine has no folder for it. */
  repoOf: (projectKey: string) => string | null;
  /** A probe is running in the project's worktree right now. */
  busy: (projectKey: string) => boolean;
  ttlMs?: number;
  clock?: ProbeClock;
  onError?: (projectKey: string, error: Error) => void;
}

const metaKey = (projectKey: string) => `probeWorktreeUsedAt:${projectKey}`;

/**
 * Keeps each project's `_probe` worktree for an hour after its last probe, so probes close together reuse
 * it, then removes it. A timer removes it on time; `expire` (daemon start and the periodic sweep) removes
 * any that outlived the hour, e.g. across a restart. A worktree with no recorded probe time predates this
 * rule and counts as expired.
 */
export class ProbeWorktreeKeeper {
  private readonly ttlMs: number;
  private readonly clock: ProbeClock;
  private readonly timers = new Map<string, unknown>();

  constructor(private readonly options: ProbeWorktreeKeeperOptions) {
    this.ttlMs = options.ttlMs ?? PROBE_WORKTREE_TTL_MS;
    this.clock = options.clock ?? systemClock;
  }

  /**
   * A probe just used the project's worktree: keep it for the full period from now. `arm: false` only
   * records the time (the daemon is stopping; the next start expires it).
   */
  used(projectKey: string, { arm = true }: { arm?: boolean } = {}): void {
    this.options.meta.set(metaKey(projectKey), String(this.clock.now()));
    if (arm) this.arm(projectKey, this.ttlMs);
  }

  /** Removes the expired probe worktrees of these projects; returns how many were removed. */
  expire(projectKeys: readonly string[]): number {
    let removed = 0;
    for (const projectKey of projectKeys) if (this.expireOne(projectKey)) removed += 1;
    return removed;
  }

  stop(): void {
    for (const handle of this.timers.values()) this.clock.clearTimeout(handle);
    this.timers.clear();
  }

  private arm(projectKey: string, ms: number): void {
    const existing = this.timers.get(projectKey);
    if (existing !== undefined) this.clock.clearTimeout(existing);
    this.timers.set(
      projectKey,
      this.clock.setTimeout(() => {
        this.timers.delete(projectKey);
        this.expireOne(projectKey);
      }, ms),
    );
  }

  private expireOne(projectKey: string): boolean {
    const repo = this.options.repoOf(projectKey);
    if (!repo || !existsSync(worktreePath(repo, PROBE_WORKTREE_KEY))) return false;
    // The probe that is running re-arms the timer when it ends.
    if (this.options.busy(projectKey)) return false;
    const usedAt = Number(this.options.meta.get(metaKey(projectKey)));
    const age = Number.isFinite(usedAt) && usedAt > 0 ? this.clock.now() - usedAt : Number.POSITIVE_INFINITY;
    if (age < this.ttlMs) {
      if (!this.timers.has(projectKey)) this.arm(projectKey, this.ttlMs - age);
      return false;
    }
    try {
      return removeWorktree(repo, PROBE_WORKTREE_KEY);
    } catch (error) {
      this.options.onError?.(projectKey, error as Error);
      return false;
    }
  }
}
