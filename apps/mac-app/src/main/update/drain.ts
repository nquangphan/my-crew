/** Kiểm số run mỗi 10 giây trong lúc chờ máy rảnh. */
export const DRAIN_POLL_MS = 10_000;
/** Chờ tối đa 30 phút rồi hỏi owner. */
export const DRAIN_MAX_MS = 30 * 60_000;

export type DrainAnswer = 'now' | 'later';

export interface DrainDeps {
  /** `supervisor.pause()`: TERM listener của app, phiên SSH đang chạy vẫn sống; run mới chờ `queued` trên Paperclip. */
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Số run `claude -p` đang chạy. Ném khi không đọc được bảng process. */
  activeRuns(): Promise<number>;
  /** Hỏi owner "Cài ngay, run vẫn chạy" / "Để sau"; `null` = không đọc được số run. */
  ask(activeRuns: number | null): Promise<DrainAnswer>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/**
 * Chờ máy rảnh trước khi cài: dừng listener (không nhận run mới), đếm run mỗi 10 giây, hết run thì `'install'`.
 * Không bao giờ gửi tín hiệu cho phiên SSH hay `claude`. Quá 30 phút: mở lại listener trước khi hỏi (hộp thoại có
 * thể chờ owner rất lâu, máy không được đứng im trong lúc đó), owner chọn "Cài ngay" thì `'install'`, "Để sau" thì
 * `'later'`.
 */
export async function drainForUpdate(deps: DrainDeps): Promise<'install' | 'later'> {
  await deps.pause();
  const deadline = deps.now() + DRAIN_MAX_MS;
  let runs: number | null = null;
  for (;;) {
    try {
      runs = await deps.activeRuns();
    } catch {
      runs = null;
    }
    if (runs === 0) return 'install';
    if (deps.now() >= deadline) break;
    await deps.sleep(DRAIN_POLL_MS);
  }
  await deps.resume();
  return (await deps.ask(runs)) === 'now' ? 'install' : 'later';
}
