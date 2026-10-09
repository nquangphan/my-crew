export type QuitChoice = 'wait' | 'now' | 'cancel';
export type QuitDecision = { kind: 'quit-now' } | { kind: 'wait-then-quit' } | { kind: 'stay' };

/** Thứ tự nút của hộp thoại; chỉ số trùng `QuitChoice` theo `CHOICE_BY_INDEX`. */
export const QUIT_BUTTONS = ['Chờ run xong rồi thoát', 'Thoát ngay, run vẫn chạy', 'Hủy'] as const;
const CHOICE_BY_INDEX: readonly QuitChoice[] = ['wait', 'now', 'cancel'];
/**
 * Mặc định "Thoát ngay, run vẫn chạy": phiên SSH của run sống qua thoát/crash app và quyền macOS vẫn gắn với app
 * khi listener mồ côi (đo trên máy thật 09/10/2026). Đổi về 0 nếu hộp thoại quyền dưới listener mồ côi không mang
 * tên app.
 */
export const QUIT_DEFAULT_ID = 1;
export const QUIT_CANCEL_ID = 2;
/** Khi chờ run xong, kiểm lại số run mỗi 10 giây. */
export const WAIT_POLL_MS = 10_000;

export function choiceFromButton(index: number): QuitChoice {
  return CHOICE_BY_INDEX[index] ?? 'cancel';
}

/** `activeRuns` null = không đọc được bảng process: vẫn hỏi, không thoát im lặng. */
export async function decideQuit(
  activeRuns: number | null,
  ask: (n: number | null) => Promise<QuitChoice>,
): Promise<QuitDecision> {
  if (activeRuns !== null && activeRuns <= 0) return { kind: 'quit-now' };
  const choice = await ask(activeRuns);
  if (choice === 'wait') return { kind: 'wait-then-quit' };
  if (choice === 'now') return { kind: 'quit-now' };
  return { kind: 'stay' };
}

export function quitMessage(activeRuns: number | null): { message: string; detail: string } {
  return {
    message:
      activeRuns === null
        ? 'Không đọc được danh sách run trên máy này.'
        : `Có ${activeRuns} run đang chạy trên máy này.`,
    detail:
      'Chờ run xong: máy không nhận run mới và thoát khi các run hiện tại kết thúc. Thoát ngay: run đang chạy vẫn chạy tới xong; run mới chờ tới khi mở lại app.',
  };
}

export interface QuitGuardDeps {
  /** Đăng ký `app.on('before-quit')`. */
  onBeforeQuit(handler: (event: { preventDefault(): void }) => void): void;
  /** `app.quit()`; guard cho lần `before-quit` tiếp theo đi qua. */
  quit(): void;
  ask(activeRuns: number | null): Promise<QuitChoice>;
  activeRuns(): Promise<number>;
  stopForQuit(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Tray "Đang chờ N run". */
  showWaiting(activeRuns: number | null): void;
  sleep(ms: number): Promise<void>;
  log(level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>): void;
}

/**
 * Chặn `before-quit` để hỏi owner khi còn run. Thoát ngay: dừng listener (phiên đang mở vẫn sống) rồi thoát.
 * Chờ: dừng nhận run mới, kiểm số run mỗi 10 giây, về 0 thì thoát. Bấm Thoát lần nữa khi đang chờ thì hỏi lại.
 */
export function installQuitGuard(deps: QuitGuardDeps): void {
  let phase: 'idle' | 'deciding' | 'waiting' | 'exiting' = 'idle';
  let waitToken = 0;

  const fail = (event: string) => (error: unknown) =>
    deps.log('warn', event, { error: error instanceof Error ? error.message : String(error) });

  const countRuns = async (): Promise<number | null> => {
    try {
      return await deps.activeRuns();
    } catch (error) {
      fail('quit-active-runs-failed')(error);
      return null;
    }
  };

  const exitNow = async () => {
    phase = 'exiting';
    waitToken += 1;
    await deps.stopForQuit().catch(fail('quit-stop-sshd-failed'));
    deps.log('info', 'app-quit', {});
    deps.quit();
  };

  const waitThenQuit = async (initial: number | null) => {
    phase = 'waiting';
    waitToken += 1;
    const token = waitToken;
    await deps.pause().catch(fail('quit-pause-sshd-failed'));
    let runs = initial;
    while (token === waitToken) {
      if (runs === 0 && phase === 'waiting') {
        await exitNow();
        return;
      }
      deps.showWaiting(runs);
      await deps.sleep(WAIT_POLL_MS);
      if (token !== waitToken) return;
      runs = await countRuns();
    }
  };

  const onRequest = async () => {
    const wasWaiting = phase === 'waiting';
    phase = 'deciding';
    const runs = await countRuns();
    const decision = await decideQuit(runs, deps.ask);
    if (decision.kind === 'quit-now') {
      await exitNow();
    } else if (decision.kind === 'wait-then-quit') {
      if (wasWaiting) phase = 'waiting';
      else await waitThenQuit(runs);
    } else {
      if (wasWaiting) {
        waitToken += 1;
        await deps.resume().catch(fail('quit-resume-sshd-failed'));
      }
      phase = 'idle';
    }
  };

  deps.onBeforeQuit((event) => {
    if (phase === 'exiting') return;
    event.preventDefault();
    if (phase === 'deciding') return;
    void onRequest().catch((error) => {
      fail('quit-guard-failed')(error);
      phase = 'idle';
    });
  });
}
