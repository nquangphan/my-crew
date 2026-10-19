/** Listener chạy liền mạch từng này thì đếm lần sinh lại về 0. */
export const STABLE_RESET_MS = 5 * 60_000;

/** Chờ trước lần sinh lại thứ `restarts + 1`: 1s, 2s, 4s, … tối đa 60s. */
export function nextDelayMs(restarts: number): number {
  return Math.min(1000 * 2 ** Math.max(0, restarts), 60_000);
}
