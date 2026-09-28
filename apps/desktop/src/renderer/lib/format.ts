const TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** `14:05 29/09` in the owner's time zone. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

/** `1 giờ 5 phút`, `3 phút 20 giây`. */
export function formatElapsed(fromIso: string | null, now: number = Date.now()): string {
  if (!fromIso) return '—';
  const seconds = Math.max(0, Math.round((now - Date.parse(fromIso)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} giờ ${minutes} phút`;
  if (minutes > 0) return `${minutes} phút ${seconds % 60} giây`;
  return `${seconds} giây`;
}

export function formatUsd(value: number): string {
  return `${value.toFixed(value < 1 ? 3 : 2)} USD`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
