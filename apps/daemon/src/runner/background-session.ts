/**
 * Keeps an agent session open while the agent still has background tasks, for any runner that can send a
 * message into its session, stop a task and close the session (`SessionPort`). The runner reports what it
 * sees (the live task set, a turn starting, a turn ending) and this decides: wait for the runtime to deliver
 * the task notification, remind the agent once when a wait hits its ceiling, or stop the tasks and close.
 *
 * The runtime owes the agent a turn for every piece of background work that ended and for the reminder. The
 * session counts those turns: a turn that ends pays for one of them at most, and one that ran nothing pays for
 * none. With nothing alive the session closes at once only when nothing is owed; otherwise it stays open a
 * short time for the next turn.
 */

/** A live background task of the session (a shell command, a subagent, …). */
export interface BackgroundTask {
  id: string;
  type: string;
  description: string;
  /** Not part of the session's work (the runtime's own tasks, live-update watchers): never waited for. */
  ambient: boolean;
}

/** One entry of the runtime's `background_tasks_changed` payload. */
export interface BackgroundTaskPayload {
  task_id: string;
  task_type: string;
  description: string;
  ambient?: boolean;
}

/** What the session logic needs from a runner's session. */
export interface SessionPort {
  /** Sends one more user message into the open session (it starts a turn). */
  send(text: string): void;
  /** Stops one background task. */
  stopTask(taskId: string): Promise<void>;
  /** Closes the session input: no further turn starts. */
  close(): void;
}

/** Why a session closed. */
export type CloseReason =
  /** No background work is left, and no turn is due for work that ended. */
  | 'idle'
  /** The turn ended with an error result. */
  | 'turn_error'
  /** A ticket tool asked to end the run. */
  | 'end_requested'
  /** The run's own work is finished (the ticket left in-progress). */
  | 'work_done'
  /**
   * The turn answering the reminder ended with background work still alive (or the reminder started no turn,
   * or the turn still owed to work that ended did not come).
   */
  | 'reminded'
  /** The run was aborted or torn down. */
  | 'shutdown';

export const DEFAULT_BACKGROUND_WAIT_MS = 30 * 60_000;
/**
 * How long the session stays open for a turn the runtime still owes. The runtime starts that turn within tens
 * of milliseconds of the previous result, also for a task that ended while the agent was writing the last
 * answer of its turn (the live set is then already empty when the turn's result arrives), and after the
 * reminder's turn for a task that ended while the reminder was waiting for that turn.
 */
export const DEFAULT_SETTLE_MS = 10_000;
/** How long closing waits for the runtime to confirm the stops. */
export const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export interface BackgroundSessionOptions {
  port: SessionPort;
  /** Ceiling of one wait; when it passes, the agent is reminded (once per run). */
  waitMs?: number;
  settleMs?: number;
  stopTimeoutMs?: number;
  /** True once a ticket tool asked to end the run: a turn that ends then never waits. */
  endRequested?: () => boolean;
  /** True once the run's own work is finished: a turn that ends then never waits. Absent: always wait. */
  workDone?: () => boolean | Promise<boolean>;
}

/** A turn as the runner saw it end. */
export interface EndedTurn {
  isError: boolean;
  /** The turn ran nothing (its result counts no turn): it handled nothing the runtime owes. */
  empty?: boolean;
}

function waitText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 1 ? `${minutes} phút` : `${Math.max(1, Math.round(ms / 1_000))} giây`;
}

/** The reminder sent into the session when a wait hits its ceiling. */
export function reminderText(tasks: BackgroundTask[], waitMs: number): string {
  return [
    `Nhắc từ daemon: phiên này đã chờ ${waitText(waitMs)} mà các tác vụ nền dưới đây vẫn chưa kết thúc:`,
    ...tasks.map((task) => `- ${task.description.replace(/\s+/g, ' ').slice(0, 200)} (id ${task.id})`),
    'Trong lượt này, hãy hoàn tất phần việc còn lại của ticket theo đúng quy trình, hoặc tự dừng các tác vụ nền không còn cần.',
    'Daemon chỉ nhắc một lần: sau lượt trả lời này, mọi tác vụ nền còn chạy sẽ bị dừng và phiên được đóng.',
  ].join('\n');
}

/**
 * What the session is waiting for between two turns: `work` for live background work (up to the ceiling),
 * `settle` for a turn the runtime still owes (a short time).
 */
type Wait = 'work' | 'settle';

export class BackgroundSession {
  private tasks: BackgroundTask[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wait: Wait | null = null;
  /** A turn is in flight; the session starts with the turn of the run's prompt. */
  private running = true;
  /**
   * Turns the runtime may still owe because live work reached zero: one for each piece of work that ended,
   * one for the reminder. An upper bound (one turn can carry several notifications, a stopped task gets none):
   * what is left over is written off when a settle time passes without a turn.
   */
  private owed = 0;
  /** A turn was owed when the turn in flight started: only such a turn can be one of the owed ones. */
  private payable = false;
  /**
   * The runtime may still owe a turn to background work that ended while other work was still alive: during
   * the turn in flight, or while the reminder was waiting for its own turn. Unlike `owed`, this is only
   * consulted once live work is not yet empty, so one flag (not a count) is enough: after the reminder, at
   * most one settle grace is given before the session gives up and closes `reminded`.
   */
  private workEnded = false;
  /** The reminder was sent and no turn has started since. */
  private reminderPending = false;
  private closing: Promise<void> | null = null;
  private signalClosing: () => void = () => {};
  private readonly whenClosing = new Promise<void>((resolve) => {
    this.signalClosing = resolve;
  });
  private left: BackgroundTask[] = [];
  private remindedOnce = false;
  private reason: CloseReason | null = null;
  private readonly waitMs: number;
  private readonly settleMs: number;
  private readonly stopTimeoutMs: number;

  constructor(private readonly options: BackgroundSessionOptions) {
    this.waitMs = options.waitMs ?? DEFAULT_BACKGROUND_WAIT_MS;
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  }

  /** True once the session was closed (or is closing). */
  get closed(): boolean {
    return this.closing !== null;
  }

  get closeReason(): CloseReason | null {
    return this.reason;
  }

  /** True once the agent was reminded after a wait hit its ceiling. */
  get reminded(): boolean {
    return this.remindedOnce;
  }

  /** The background work alive when the session closed (then stopped); empty after a clean end. */
  get tasksLeft(): BackgroundTask[] {
    return [...this.left];
  }

  /** Every live task, ambient ones included. */
  liveTasks(): BackgroundTask[] {
    return [...this.tasks];
  }

  /** The live tasks that are the session's own work. */
  liveWork(): BackgroundTask[] {
    return this.tasks.filter((task) => !task.ambient);
  }

  /** The runtime's full live set: replaces the stored one (it starts empty with the process). */
  tasksChanged(payload: readonly BackgroundTaskPayload[]): void {
    const before = this.liveWork();
    this.tasks = payload.map((task) => ({
      id: task.task_id,
      type: task.task_type,
      description: task.description,
      ambient: task.ambient === true,
    }));
    const work = this.liveWork();
    const endedCount = before.filter((task) => !work.some((live) => live.id === task.id)).length;
    this.owed += endedCount;
    // Work that ends during a turn in flight, or while the reminder waits for its own turn, is paid by the
    // turn that ends that wait. Not while a plain `work` wait for other still-live tasks is going on: those
    // are expected to end with their own notification turn later.
    if (endedCount > 0 && (this.wait === null || this.reminderPending)) this.workEnded = true;
    if (this.wait === 'work' && work.length === 0) {
      // A task normally ends with a notification turn. One that leaves without it (it was stopped) must not
      // hold the session open until the ceiling.
      this.wait = 'settle';
      this.arm(this.settleMs);
    }
  }

  /** A turn of the main agent started (or goes on): the wait, if any, is over. */
  turnStarted(): void {
    if (this.running) return;
    this.running = true;
    this.payable = this.owed > 0;
    this.wait = null;
    // The turn that ends a wait is the one owed to the work that ended meanwhile. When the reminder was
    // waiting for a turn too, this turn is only one of the two the runtime owes: the other stays due.
    if (!this.reminderPending) this.workEnded = false;
    this.reminderPending = false;
    this.disarm();
  }

  /**
   * A turn ended with a result: closes the session, or leaves it open to wait for the background work or for
   * a turn the runtime still owes. `empty` marks a turn that ran nothing (the runtime reports one when two
   * tasks end at the same moment, right before the turn that carries their notifications).
   */
  async turnEnded(turn: EndedTurn): Promise<'closed' | 'waiting'> {
    this.turnStarted();
    if (this.closed) return 'closed';
    this.running = false;
    // What came to be owed during the turn is not paid by it, and a turn that ran nothing pays for nothing.
    if (this.payable && !turn.empty) this.owed -= 1;
    this.payable = false;
    const workEnded = this.workEnded;
    this.workEnded = false;
    // Reading the run's state may take a while (an API call): an abort meanwhile does not wait for it.
    const decision = await Promise.race([this.afterTurn(turn, workEnded), this.whenClosing.then(() => null)]);
    if (this.closed || decision === null) {
      await this.closing;
      return 'closed';
    }
    if (decision === 'work' || decision === 'settle') {
      this.wait = decision;
      this.arm(decision === 'work' ? this.waitMs : this.settleMs);
      return 'waiting';
    }
    await this.close(decision);
    return 'closed';
  }

  /** Stops the live tasks and closes the session, whatever its state (abort, teardown). */
  shutdown(): Promise<void> {
    return this.close('shutdown');
  }

  /** Drops the pending timer (the run is over). */
  dispose(): void {
    this.wait = null;
    this.disarm();
  }

  private async afterTurn(turn: EndedTurn, workEnded: boolean): Promise<CloseReason | Wait> {
    if (turn.isError) return 'turn_error';
    if (this.options.endRequested?.()) return 'end_requested';
    if (this.liveWork().length === 0) return this.owed > 0 ? 'settle' : 'idle';
    // After the reminder, live work is never waited for again; a turn still owed to work that ended is given
    // one more short settle window before the session gives up on the live work and closes.
    if (this.remindedOnce) return workEnded ? 'settle' : 'reminded';
    try {
      if (this.options.workDone && (await this.options.workDone())) return 'work_done';
    } catch {
      // Unknown: wait, the wait has its ceiling.
    }
    return 'work';
  }

  private arm(ms: number): void {
    this.disarm();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.waitOver();
    }, ms);
  }

  private disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private waitOver(): void {
    if (this.wait === null || this.closed) return;
    const work = this.liveWork();
    if (work.length === 0) {
      void this.close('idle');
      return;
    }
    if (this.wait === 'settle') {
      if (this.remindedOnce) {
        // The owed turn did not come, and the agent was already told the live work would be stopped.
        void this.close('reminded');
        return;
      }
      // Work showed up again without a turn: it gets a full wait. No turn came, so none is owed any more.
      this.owed = 0;
      this.wait = 'work';
      this.arm(this.waitMs);
      return;
    }
    if (this.remindedOnce) {
      // The reminder started no turn within another full wait.
      void this.close('reminded');
      return;
    }
    // The reminder starts a turn; the turn that answers it never waits again.
    this.remindedOnce = true;
    this.owed += 1;
    this.reminderPending = true;
    this.options.port.send(reminderText(work, this.waitMs));
    this.arm(this.waitMs);
  }

  private close(reason: CloseReason): Promise<void> {
    if (this.closing) return this.closing;
    this.wait = null;
    this.disarm();
    this.reason = reason;
    this.left = this.liveWork();
    this.closing = this.stopAll().then(() => {
      try {
        this.options.port.close();
      } catch {
        // Closing an input that is already gone is not an error.
      }
    });
    this.signalClosing();
    return this.closing;
  }

  /** Stops every live task; a stop that fails or never answers does not hold the close back. */
  private async stopAll(): Promise<void> {
    const live = this.liveTasks();
    if (live.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.stopTimeoutMs);
    });
    const stops = Promise.allSettled(
      live.map(async (task) => {
        await this.options.port.stopTask(task.id);
      }),
    );
    await Promise.race([stops, timeout]);
    clearTimeout(timer);
  }
}
