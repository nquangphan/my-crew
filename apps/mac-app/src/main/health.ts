import type { CheckResult, CheckStatus, DoctorOptions } from '@crew/mac';

/** Kiểm định kỳ không probe; probe (chạy claude thật, chậm) chỉ khi owner bấm. */
export const HEALTH_INTERVAL_MS = 15 * 60_000;

export interface HealthSnapshot {
  at: string;
  results: CheckResult[];
}

export interface HealthDeps {
  doctor(opts: DoctorOptions): Promise<CheckResult[]>;
  notify(title: string, body: string): void;
  /** Gọi sau mỗi lần kiểm xong (cập nhật chấm tray). */
  onResult?(worst: CheckStatus, results: CheckResult[]): void;
  now?: () => Date;
  log(level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>): void;
}

export interface Health {
  start(): void;
  stop(): void;
  /** Kiểm một lần; các lần gọi chồng nhau xếp hàng, không chạy song song. */
  run(probe: boolean): Promise<CheckResult[]>;
  last(): HealthSnapshot | null;
}

export function worstStatus(results: CheckResult[]): CheckStatus {
  if (results.some((r) => r.status === 'fail')) return 'fail';
  if (results.some((r) => r.status === 'warn')) return 'warn';
  return 'ok';
}

export function createHealth(deps: HealthDeps): Health {
  const now = deps.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let snapshot: HealthSnapshot | null = null;
  // Chưa có kết quả nào coi như chưa lỗi: máy đỏ ngay lúc mở app vẫn báo một lần.
  let wasFailing = false;

  const execute = async (probe: boolean): Promise<CheckResult[]> => {
    const results = await deps.doctor({ probe, tccWindow: '24h', probeTimeoutSec: 90 });
    snapshot = { at: now().toISOString(), results };
    const worst = worstStatus(results);
    const failing = worst === 'fail';
    if (failing && !wasFailing) {
      deps.notify('2P Crew: máy có lỗi', results.find((r) => r.status === 'fail')?.title ?? '');
    } else if (!failing && wasFailing) {
      deps.notify('2P Crew: máy đã ổn', '');
    }
    wasFailing = failing;
    deps.onResult?.(worst, results);
    return results;
  };

  const run = (probe: boolean): Promise<CheckResult[]> => {
    const next = queue.then(() => execute(probe));
    queue = next.catch(() => undefined);
    return next;
  };

  const scheduled = () => {
    run(false).catch((error) =>
      deps.log('warn', 'health-failed', { error: error instanceof Error ? error.message : String(error) }),
    );
  };

  return {
    start() {
      if (timer) return;
      scheduled();
      timer = setInterval(scheduled, HEALTH_INTERVAL_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    run,
    last: () => snapshot,
  };
}
