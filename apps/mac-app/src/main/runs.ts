import type { ActiveRun } from '../shared/ipc-contract.js';
import { PaperclipAuthError } from './paperclip/client.js';
import type { PaperclipClient } from './paperclip/types.js';

export interface RunsDeps {
  activeRuns(): Promise<ActiveRun[]>;
  /** Client Paperclip đã đăng nhập; ném "Chưa đăng nhập Paperclip" khi chưa có origin. */
  client(): Pick<PaperclipClient, 'cancelRun' | 'runWebUrl'>;
  openExternal(url: string): Promise<void>;
}

export interface RunsResult {
  ok: boolean;
  message: string;
}

const LOGIN_AGAIN = 'Cần đăng nhập lại Paperclip (mục Cài đặt).';

function needsLogin(error: unknown): boolean {
  return (
    error instanceof PaperclipAuthError ||
    (error instanceof Error && error.message.startsWith('Chưa đăng nhập'))
  );
}

/** Hủy run đi qua REST của Paperclip (để heartbeat và issue cập nhật đúng); app không bao giờ kill process. */
export function createRuns(deps: RunsDeps) {
  return {
    list: () => deps.activeRuns(),

    async cancel(runId: string): Promise<RunsResult> {
      try {
        await deps.client().cancelRun(runId);
        return { ok: true, message: 'Đã gửi lệnh hủy, Paperclip sẽ dừng run.' };
      } catch (error) {
        if (needsLogin(error)) return { ok: false, message: LOGIN_AGAIN };
        return {
          ok: false,
          message: `Không hủy được run: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    async openWeb(runId: string): Promise<RunsResult> {
      try {
        await deps.openExternal(await deps.client().runWebUrl(runId));
        return { ok: true, message: 'Đã mở run trên web.' };
      } catch (error) {
        if (needsLogin(error)) return { ok: false, message: LOGIN_AGAIN };
        return {
          ok: false,
          message: `Không mở được run: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
