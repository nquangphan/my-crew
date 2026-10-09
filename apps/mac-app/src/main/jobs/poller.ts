import { sanitizeJobError } from './sanitize.js';
import { JOB_TIMEOUT_MS, type JobOutcome, type MachineJob, UUID_RE } from './types.js';

/** Một Paperclip/company app hỏi việc (lấy từ đích bản tin của crew-mac). */
export interface PollTarget {
  url: string;
  companyId: string;
}

/** App chưa có board key cho origin của đích: không hỏi đích đó. */
export class MissingKeyError extends Error {
  constructor() {
    super('Chưa đăng nhập Paperclip');
    this.name = 'MissingKeyError';
  }
}

export interface PollerDeps {
  loadTargets(): Promise<{ machineId: string | null; targets: PollTarget[] }>;
  /** `null` = không có việc (204). Ném `MissingKeyError` khi chưa có board key. */
  claim(target: PollTarget, machineId: string): Promise<MachineJob | null>;
  /** `claimedAt`: giá trị server trả lúc claim; plugin từ chối (409) kết quả của lần nhận đã bị thay. */
  submit(
    target: PollTarget,
    machineId: string,
    jobId: string,
    outcome: JobOutcome,
    claimedAt: string | null,
  ): Promise<void>;
  /** `signal` bật khi việc quá giờ: phần chạy ở Main phải dừng, không được bắt đầu bước mới. */
  run(job: MachineJob, target: PollTarget, signal: AbortSignal): Promise<JobOutcome>;
  /** Hủy việc đang chạy (giết tiến trình git con rồi tiến trình phụ đang làm việc). */
  cancelRunning(): void | Promise<void>;
  isVisible(): boolean;
  /** Ghi `jobsAgent.lastPollAt` vào `app.json` (bản tin máy đọc). */
  recordPoll(at: Date): Promise<void>;
  log(level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>): void;
  timeoutMs?: number;
}

export const VISIBLE_INTERVAL_MS = 5_000;
export const HIDDEN_INTERVAL_MS = 15_000;
export const MAX_BACKOFF_MS = 60_000;
/** `app.json` đổi là cửa sổ đọc lại trạng thái, nên `lastPollAt` chỉ ghi tối đa 30 giây một lần. */
export const RECORD_EVERY_MS = 30_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Vòng hỏi hàng đợi việc trên máy: mỗi chu kỳ (5 giây khi cửa sổ hiện, 15 giây khi ẩn) `claim` lần lượt từng đích, có
 * việc thì làm xong rồi báo kết quả mới hỏi tiếp, nên máy chỉ làm một việc một lúc. Đích lỗi thì lùi dần riêng đích đó
 * tới 60 giây. Việc quá 8 phút thì hủy và báo `app_error` (lease của plugin là 10 phút). Không bao giờ ném.
 */
export function createJobsPoller(deps: PollerDeps) {
  const backoff = new Map<string, { failures: number; nextAt: number }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let lastRecorded: number | null = null;

  const interval = () => (deps.isVisible() ? VISIBLE_INTERVAL_MS : HIDDEN_INTERVAL_MS);
  const keyOf = (t: PollTarget) => `${t.url} ${t.companyId}`;

  function schedule(ms: number) {
    if (!running) return;
    timer = setTimeout(() => {
      timer = null;
      void tick().finally(() => schedule(interval()));
    }, ms);
  }

  async function runWithTimeout(job: MachineJob, target: PollTarget): Promise<JobOutcome> {
    const timeoutMs = deps.timeoutMs ?? JOB_TIMEOUT_MS;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const expired = new Promise<JobOutcome>((resolve) => {
      timeout = setTimeout(() => {
        abort.abort();
        void Promise.resolve(deps.cancelRunning()).catch(() => undefined);
        resolve({
          status: 'failed',
          errorCode: 'app_error',
          errorText: `App đã hủy việc vì quá thời gian (${Math.round(timeoutMs / 60_000)} phút)`,
        });
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        deps.run(job, target, abort.signal).catch(
          (error): JobOutcome => ({
            status: 'failed',
            errorCode: 'app_error',
            errorText: sanitizeJobError(errorText(error)),
          }),
        ),
        expired,
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function handle(job: MachineJob, target: PollTarget, machineId: string): Promise<void> {
    if (typeof job?.id !== 'string' || !UUID_RE.test(job.id)) {
      deps.log('warn', 'machine-job-invalid', { companyId: target.companyId });
      return;
    }
    const mismatch =
      String(job.companyId).toLowerCase() !== target.companyId.toLowerCase() ||
      String(job.machineId).toLowerCase() !== machineId.toLowerCase();
    deps.log('info', 'machine-job-start', { jobId: job.id, kind: job.kind, companyId: target.companyId });
    const outcome: JobOutcome = mismatch
      ? { status: 'failed', errorCode: 'app_error', errorText: 'Việc không thuộc company hoặc máy này' }
      : await runWithTimeout(job, target);
    deps.log(outcome.status === 'done' ? 'info' : 'warn', 'machine-job-finish', {
      jobId: job.id,
      kind: job.kind,
      status: outcome.status,
      ...(outcome.status === 'failed' ? { errorCode: outcome.errorCode } : {}),
    });
    try {
      await deps.submit(target, machineId, job.id, outcome, job.claimedAt);
    } catch (error) {
      // 409 (đã nhận lại) cũng rơi vào đây: bỏ kết quả, không gửi lại. Việc vẫn `claimed`: hết lease plugin trả về hàng đợi và máy làm lại (mọi việc đều chạy lại được).
      deps.log('warn', 'machine-job-submit-failed', { jobId: job.id, message: errorText(error) });
    }
  }

  async function tick(): Promise<void> {
    let config: Awaited<ReturnType<PollerDeps['loadTargets']>>;
    try {
      config = await deps.loadTargets();
    } catch (error) {
      deps.log('warn', 'machine-jobs-targets-failed', { message: errorText(error) });
      return;
    }
    const { machineId } = config;
    if (!machineId) return;
    let polled = false;
    for (const target of config.targets) {
      if (!running) return;
      const key = keyOf(target);
      const state = backoff.get(key);
      if (state && Date.now() < state.nextAt) continue;
      let job: MachineJob | null;
      try {
        job = await deps.claim(target, machineId);
      } catch (error) {
        if (error instanceof MissingKeyError) continue;
        const failures = (state?.failures ?? 0) + 1;
        const delay = Math.min(MAX_BACKOFF_MS, interval() * 2 ** failures);
        backoff.set(key, { failures, nextAt: Date.now() + delay });
        deps.log('warn', 'machine-jobs-claim-failed', {
          companyId: target.companyId,
          message: errorText(error),
        });
        continue;
      }
      backoff.delete(key);
      polled = true;
      if (job) await handle(job, target, machineId);
    }
    if (polled && (lastRecorded === null || Date.now() - lastRecorded >= RECORD_EVERY_MS)) {
      const at = new Date();
      lastRecorded = at.getTime();
      await deps.recordPoll(at).catch((error: unknown) => {
        deps.log('warn', 'machine-jobs-record-failed', { message: errorText(error) });
      });
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      schedule(0);
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    tick,
  };
}
