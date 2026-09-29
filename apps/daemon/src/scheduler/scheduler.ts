import type { AgentRole, JobWaitDetail, JobWaitReason } from '@crew/shared';
import type { JobPatch, JobRow, StateDb } from '../state-db.js';

/** PM and assistant jobs coordinate everyone else, so one slot beyond the dev/QC limit is kept for them. */
export function isCoordinatorRole(role: AgentRole): boolean {
  return role === 'pm' || role === 'assistant';
}

/** Jobs that may start now: queued ones not waiting on dependencies, and backoffs whose time has come. */
export function runnableJobs(state: StateDb, now = new Date()): JobRow[] {
  return state
    .listJobs(['queued', 'backoff'])
    .filter((job) =>
      job.status === 'queued'
        ? !job.waitingDeps && (job.retryAt === null || Date.parse(job.retryAt) <= now.getTime())
        : job.retryAt !== null && Date.parse(job.retryAt) <= now.getTime(),
    );
}

export interface SlotPlan {
  /** Jobs to start, in order. */
  start: JobRow[];
}

/**
 * Picks which runnable jobs start given `slots` free machine slots and the jobs already running. Dev and
 * QC jobs use at most `slots`; PM and assistant jobs may also use one reserved slot on top, so a full
 * machine can still accept, plan and close work. With no slots (memory or load pressure) nothing starts.
 */
export function planSlots(
  slots: number,
  running: readonly JobRow[],
  candidates: readonly JobRow[],
): SlotPlan {
  if (slots <= 0) return { start: [] };
  let total = running.length;
  const start: JobRow[] = [];
  for (const job of candidates) {
    const limit = isCoordinatorRole(job.role) ? slots + 1 : slots;
    if (total < limit) {
      start.push(job);
      total += 1;
    }
  }
  return { start };
}

export type StartDecision =
  | { action: 'start' }
  /**
   * At least one `depends_on` ticket is not done: wait for `dependency.resolved` or the next re-check.
   * `dependsOn` lists the keys of the unfinished ones.
   */
  | { action: 'wait_deps'; dependsOn?: string[] }
  /** Never start this job (ticket closed, over budget, project not run here). */
  | { action: 'skip'; reason: string }
  /**
   * Try again on a later tick. `wait` is the reason reported to the owner (`check_failed` when absent,
   * with `reason` as its message).
   */
  | { action: 'defer'; reason: string; wait?: JobWaitReason; detail?: JobWaitDetail };

export interface SchedulerDeps {
  state: StateDb;
  /** Free machine slots right now (resource monitor). */
  slots: () => number;
  paused: () => boolean;
  /** Dependency, ticket-state and budget checks against the API. */
  decide: (job: JobRow) => Promise<StartDecision>;
  /** Launches the job; resolves once it is marked running (the run itself continues in the background). */
  launch: (job: JobRow) => Promise<void>;
  onError?: (error: Error, job?: JobRow) => void;
  /** A queued or backoff job started waiting for a different reason (called once per change, not per tick). */
  onWaitChange?: (job: JobRow, reason: JobWaitReason, detail: JobWaitDetail | null) => void;
  now?: () => Date;
  tickMs?: number;
  recheckMs?: number;
}

/**
 * Starts jobs within the machine's slots. It ticks every few seconds (backoff timers, freed resources),
 * re-checks jobs waiting on dependencies every 60 s, and runs at once when told something changed.
 */
export class Scheduler {
  private tickTimer: NodeJS.Timeout | null = null;
  private recheckTimer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => void this.tick(), this.deps.tickMs ?? 5_000);
    this.recheckTimer = setInterval(() => void this.recheckWaiting(), this.deps.recheckMs ?? 60_000);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.recheckTimer) clearInterval(this.recheckTimer);
    this.tickTimer = null;
    this.recheckTimer = null;
    await this.running;
  }

  /** Clears every `waitingDeps` flag (reconnect, 60 s timer) and ticks. */
  recheckWaiting(): Promise<void> {
    const { state } = this.deps;
    state.transaction(() => {
      for (const job of state.listJobs(['queued'])) {
        if (job.waitingDeps) state.updateJob(job.id, { waitingDeps: false });
      }
    });
    return this.tick();
  }

  /** One scheduling pass. Concurrent calls coalesce into one extra pass. */
  tick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.pass();
      } while (this.again);
    })()
      .catch((error: Error) => this.deps.onError?.(error))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async pass(): Promise<void> {
    const { state } = this.deps;
    if (this.deps.paused()) return;
    const now = this.deps.now?.() ?? new Date();
    const slots = this.deps.slots();
    const pending = runnableJobs(state, now);
    if (pending.length === 0) return;
    // Decide one job at a time: each start changes what the next job may use.
    for (const candidate of pending) {
      const running = state.listJobs(['running']);
      if (planSlots(slots, running, [candidate]).start.length === 0) {
        this.setWait(candidate, 'no_slots', null);
        continue;
      }
      const current = state.getJob(candidate.id);
      if (!current || (current.status !== 'queued' && current.status !== 'backoff')) continue;
      let decision: StartDecision;
      try {
        decision = await this.deps.decide(current);
      } catch (error) {
        this.deps.onError?.(error as Error, current);
        this.setWait(current, 'check_failed', { message: (error as Error).message.slice(0, 500) });
        continue;
      }
      if (decision.action === 'wait_deps') {
        this.setWait(
          current,
          'waiting_deps',
          decision.dependsOn ? { dependsOn: decision.dependsOn.slice(0, 50) } : null,
          { waitingDeps: true },
        );
      } else if (decision.action === 'defer') {
        this.setWait(
          current,
          decision.wait ?? 'check_failed',
          decision.detail ?? (decision.wait ? null : { message: decision.reason.slice(0, 500) }),
        );
      } else if (decision.action === 'skip') {
        state.updateJob(current.id, {
          status: 'skipped',
          error: decision.reason,
          endedAt: new Date().toISOString(),
        });
      } else if (decision.action === 'start') {
        try {
          await this.deps.launch(current);
        } catch (error) {
          this.deps.onError?.(error as Error, current);
        }
      }
    }
  }

  /**
   * Records why a job waits (only when it changed, so a busy machine does not rewrite every job each
   * tick) and reports a change of reason once.
   */
  private setWait(
    job: JobRow,
    reason: JobWaitReason,
    detail: JobWaitDetail | null,
    extra: JobPatch = {},
  ): void {
    const changed = job.waitReason !== reason;
    const same = !changed && JSON.stringify(job.waitDetail) === JSON.stringify(detail);
    if (!same || Object.keys(extra).length > 0) {
      this.deps.state.updateJob(job.id, { ...extra, waitReason: reason, waitDetail: detail });
    }
    if (changed) this.deps.onWaitChange?.(job, reason, detail);
  }
}
