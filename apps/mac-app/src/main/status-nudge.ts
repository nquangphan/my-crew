import type { JobOutcome, MachineJobKind } from './jobs/types.js';

/** Chờ chừng này sau lần nhờ đầu tiên rồi mới gửi, để các lần nhờ liền nhau (nhiều việc máy) gộp thành một lần gửi. */
export const STATUS_NUDGE_DELAY_MS = 2_000;

export interface StatusNudgeDeps {
  /** Đúng đường gửi bản tin của `crew-mac status send` (`ops.call('sendStatus')`). Được phép ném. */
  send(): Promise<void>;
  log(level: 'info' | 'warn', event: string, fields?: Record<string, unknown>): void;
  delayMs?: number;
}

export interface StatusNudge {
  /** Nhờ gửi bản tin máy sớm. Không chờ, không bao giờ ném; lỗi gửi chỉ ghi log. */
  request(reason: string): void;
}

/**
 * Gửi bản tin máy ngay sau khi checkout agent vừa được tạo, để kiểm tra "Sẵn sàng" của web thấy checkout mới mà không
 * phải chờ lượt gửi định kỳ của launchd. Các lần nhờ trong lúc đang chờ thì gộp vào lần gửi đó; nhờ trong lúc đang gửi
 * thì gửi thêm đúng một lần sau khi lần đang gửi xong (bản đang gửi có thể đã quét checkout trước thay đổi mới).
 */
export function createStatusNudge(deps: StatusNudgeDeps): StatusNudge {
  const delayMs = deps.delayMs ?? STATUS_NUDGE_DELAY_MS;
  let reasons: string[] = [];
  let scheduled = false;
  let sending = false;

  const schedule = () => {
    scheduled = true;
    setTimeout(() => void flush(), delayMs);
  };

  const flush = async () => {
    scheduled = false;
    sending = true;
    const batch = reasons;
    reasons = [];
    try {
      await deps.send();
      deps.log('info', 'status-nudge-sent', { reasons: batch });
    } catch (error) {
      deps.log('warn', 'status-nudge-failed', {
        reasons: batch,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      sending = false;
      if (reasons.length > 0) schedule();
    }
  };

  return {
    request(reason) {
      reasons.push(reason);
      if (!scheduled && !sending) schedule();
    },
  };
}

/** Việc máy vừa tạo (hay xác nhận) checkout agent trên máy: cần báo bản tin máy ngay. */
export function jobCreatedCheckouts(kind: MachineJobKind, outcome: JobOutcome): boolean {
  return (
    outcome.status === 'done' &&
    (kind === 'prepare-checkouts' || kind === 'agent-workspace' || kind === 'ensure-project')
  );
}
