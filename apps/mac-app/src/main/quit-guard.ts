export type QuitChoice = 'wait' | 'now' | 'cancel';
export type QuitDecision = { kind: 'quit-now' } | { kind: 'wait-then-quit' } | { kind: 'stay' };

/** Câu cảnh báo chung: app giữ cổng sshd agent, nên thoát app là máy ngừng nhận run mới. */
export const STOPS_NEW_WORK = 'Thoát app thì máy ngừng nhận việc mới cho tới khi mở lại.';
/** Khi chờ run xong, kiểm lại số run mỗi 10 giây. */
export const WAIT_POLL_MS = 10_000;

export interface QuitPrompt {
  message: string;
  detail: string;
  buttons: readonly string[];
  /** Nút của phím Enter. */
  defaultId: number;
  /** Nút của phím Esc / đóng hộp thoại. */
  cancelId: number;
  /** Lựa chọn theo chỉ số nút. */
  choices: readonly QuitChoice[];
}

/**
 * Hộp thoại khi thoát. Còn run (hoặc không đọc được): 3 nút, mặc định "Thoát ngay, run vẫn chạy" vì phiên SSH của run
 * sống qua thoát/crash app và quyền macOS vẫn gắn với app khi listener mồ côi (đo trên máy thật 09/10/2026; đổi về
 * "Chờ run xong" nếu hộp thoại quyền dưới listener mồ côi không mang tên app). 0 run: chỉ "Thoát" / "Ở lại", Enter và
 * Esc đều ở lại để một cú Cmd+Q lỡ tay không đóng cổng.
 */
export function quitPrompt(activeRuns: number | null): QuitPrompt {
  if (activeRuns === 0) {
    return {
      message: STOPS_NEW_WORK,
      detail: 'Không có run nào đang chạy. Run mới chờ trên Paperclip tới khi mở lại 2P Crew.',
      buttons: ['Thoát', 'Ở lại'],
      defaultId: 1,
      cancelId: 1,
      choices: ['now', 'cancel'],
    };
  }
  return {
    message:
      activeRuns === null
        ? 'Không đọc được danh sách run trên máy này.'
        : `Có ${activeRuns} run đang chạy trên máy này.`,
    detail: `${STOPS_NEW_WORK} Chờ run xong: máy không nhận run mới và thoát khi các run hiện tại kết thúc. Thoát ngay: run đang chạy vẫn chạy tới xong; run mới chờ tới khi mở lại app.`,
    buttons: ['Chờ run xong rồi thoát', 'Thoát ngay, run vẫn chạy', 'Hủy'],
    defaultId: 1,
    cancelId: 2,
    choices: ['wait', 'now', 'cancel'],
  };
}

export function choiceFromButton(prompt: QuitPrompt, index: number): QuitChoice {
  return prompt.choices[index] ?? 'cancel';
}

/**
 * App không giữ cổng (chủ `launchd` hay manifest hỏng): thoát app không đổi gì cho run, nên không hỏi. App giữ cổng:
 * luôn hỏi, kể cả 0 run. `activeRuns` null = không đọc được bảng process: vẫn hỏi, không thoát im lặng.
 */
export async function decideQuit(
  input: { activeRuns: number | null; ownsListener: boolean },
  ask: (n: number | null) => Promise<QuitChoice>,
): Promise<QuitDecision> {
  if (!input.ownsListener) return { kind: 'quit-now' };
  const choice = await ask(input.activeRuns);
  if (choice === 'wait') return { kind: 'wait-then-quit' };
  if (choice === 'now') return { kind: 'quit-now' };
  return { kind: 'stay' };
}

export interface QuitGuardDeps {
  /** Đăng ký `app.on('before-quit')`. */
  onBeforeQuit(handler: (event: { preventDefault(): void }) => void): void;
  /** `app.quit()`; guard cho lần `before-quit` tiếp theo đi qua. */
  quit(): void;
  ask(activeRuns: number | null): Promise<QuitChoice>;
  /** App đang là chủ cổng sshd agent (supervisor không `disabled`). */
  ownsListener(): boolean;
  activeRuns(): Promise<number>;
  stopForQuit(): Promise<void>;
  pause(): Promise<void>;
  /** Mở lại listener; supervisor tự bỏ qua khi listener đang chạy. */
  resume(): Promise<void>;
  /** Tray "Đang chờ N run". */
  showWaiting(activeRuns: number | null): void;
  /** Bỏ nhãn "Đang chờ N run" khi owner hủy việc chờ. */
  hideWaiting?(): void;
  sleep(ms: number): Promise<void>;
  log(level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>): void;
}

export interface QuitGuard {
  /**
   * Updater gọi ngay trước `quitAndInstall` (owner đã đồng ý ở bước drain): mọi `before-quit` sau đó đi qua, không hỏi
   * lại; vòng "Chờ run xong" (nếu có) dừng. Guard không tự dừng listener: updater vẫn tự gọi `stopForQuit()`.
   * Trả hàm hủy: gọi khi app không thoát được (Squirrel lỗi) để guard về bình thường và supervisor `resume()`, không
   * để cổng trống. Hàm hủy của giấy phép cũ (đã có giấy phép mới) không làm gì.
   */
  allowQuitForUpdate(): () => Promise<void>;
  /**
   * Bọc một thao tác đổi chủ sshd (wizard chuyển sang app hay tự lui về launchd): bấm Thoát giữa chừng thì guard chờ
   * thao tác xong (kể cả lỗi) rồi mới hỏi, để `will-quit` không giết utilityProcess khi manifest/plist đang ghi dở.
   */
  holdQuit<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * Chặn `before-quit`. App giữ cổng thì luôn hỏi (0 run: "Thoát" / "Ở lại"; còn run: chờ / thoát ngay / hủy). Thoát:
 * dừng listener (phiên đang mở vẫn sống) rồi thoát. Chờ: dừng nhận run mới, kiểm số run mỗi 10 giây, về 0 thì thoát.
 * Bấm Thoát lần nữa khi đang chờ thì hỏi lại. Ở lại/Hủy: `resume()` (thoát bị hủy sau `stopForQuit` thì cổng mở lại).
 */
export function installQuitGuard(deps: QuitGuardDeps): QuitGuard {
  let phase: 'idle' | 'deciding' | 'waiting' | 'exiting' = 'idle';
  let waitToken = 0;
  /** Tăng mỗi lần updater cho phép thoát: quyết định đang dở của hộp thoại cũ bị bỏ. */
  let permit = 0;
  let holds = 0;
  let holdsDrained: Array<() => void> = [];

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
    const myPermit = permit;
    while (holds > 0) await new Promise<void>((resolve) => holdsDrained.push(resolve));
    const runs = await countRuns();
    const decision = await decideQuit({ activeRuns: runs, ownsListener: deps.ownsListener() }, deps.ask);
    if (permit !== myPermit) return;
    if (decision.kind === 'quit-now') {
      await exitNow();
    } else if (decision.kind === 'wait-then-quit') {
      if (wasWaiting) phase = 'waiting';
      else await waitThenQuit(runs);
    } else {
      waitToken += 1;
      await deps.resume().catch(fail('quit-resume-sshd-failed'));
      if (wasWaiting) deps.hideWaiting?.();
      phase = 'idle';
    }
  };

  deps.onBeforeQuit((event) => {
    if (phase === 'exiting') return;
    event.preventDefault();
    if (phase === 'deciding') return;
    void onRequest().catch((error) => {
      fail('quit-guard-failed')(error);
      if (phase !== 'exiting') phase = 'idle';
    });
  });

  return {
    allowQuitForUpdate: () => {
      permit += 1;
      const mine = permit;
      phase = 'exiting';
      waitToken += 1;
      deps.log('info', 'quit-allowed-for-update', {});
      return async () => {
        if (permit !== mine || phase !== 'exiting') return;
        phase = 'idle';
        deps.log('info', 'quit-update-cancelled', {});
        await deps.resume().catch(fail('quit-resume-sshd-failed'));
      };
    },
    holdQuit: async (task) => {
      holds += 1;
      try {
        return await task();
      } finally {
        holds -= 1;
        if (holds === 0) {
          const waiters = holdsDrained;
          holdsDrained = [];
          for (const resolve of waiters) resolve();
        }
      }
    },
  };
}
