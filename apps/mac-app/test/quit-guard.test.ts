import { describe, expect, it } from 'vitest';
import {
  decideQuit,
  installQuitGuard,
  QUIT_BUTTONS,
  QUIT_DEFAULT_ID,
  type QuitChoice,
  type QuitGuardDeps,
  quitMessage,
} from '../src/main/quit-guard.js';

describe('decideQuit', () => {
  it('không có run thì thoát ngay, không hỏi', async () => {
    let asked = false;
    expect(
      await decideQuit(0, async () => {
        asked = true;
        return 'cancel';
      }),
    ).toEqual({ kind: 'quit-now' });
    expect(asked).toBe(false);
  });

  it('có run thì hỏi và theo lựa chọn', async () => {
    expect(await decideQuit(2, async () => 'wait')).toEqual({ kind: 'wait-then-quit' });
    expect(await decideQuit(2, async () => 'now')).toEqual({ kind: 'quit-now' });
    expect(await decideQuit(2, async () => 'cancel')).toEqual({ kind: 'stay' });
    expect(QUIT_BUTTONS).toEqual(['Chờ run xong rồi thoát', 'Thoát ngay, run vẫn chạy', 'Hủy']);
  });

  it('nút mặc định là "Thoát ngay, run vẫn chạy" (phiên sống qua thoát app)', () => {
    expect(QUIT_BUTTONS[QUIT_DEFAULT_ID]).toBe('Thoát ngay, run vẫn chạy');
  });

  it('câu chữ tiếng Việt có số run', () => {
    expect(quitMessage(3).message).toBe('Có 3 run đang chạy trên máy này.');
    expect(quitMessage(3).detail).toContain('run đang chạy vẫn chạy tới xong');
    expect(quitMessage(null).message).toBe('Không đọc được danh sách run trên máy này.');
  });
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function guard(runsSeq: number[], answers: QuitChoice[], sleep: () => Promise<void> = async () => undefined) {
  let handler: ((event: { preventDefault(): void }) => void) | null = null;
  const calls: string[] = [];
  let runIndex = 0;
  const deps: QuitGuardDeps = {
    onBeforeQuit: (h) => {
      handler = h;
    },
    quit: () => {
      calls.push('quit');
      // app.quit() phát lại before-quit; guard phải cho qua.
      fire();
    },
    ask: async (n) => {
      calls.push(`ask:${n}`);
      return answers.shift() ?? 'cancel';
    },
    activeRuns: async () => runsSeq[Math.min(runIndex++, runsSeq.length - 1)] ?? 0,
    stopForQuit: async () => {
      calls.push('stopForQuit');
    },
    pause: async () => {
      calls.push('pause');
    },
    resume: async () => {
      calls.push('resume');
    },
    showWaiting: (n) => {
      calls.push(`waiting:${n}`);
    },
    sleep,
    log: () => undefined,
  };
  const prevented: boolean[] = [];
  const fire = () => {
    let p = false;
    handler?.({
      preventDefault: () => {
        p = true;
      },
    });
    prevented.push(p);
  };
  installQuitGuard(deps);
  return { calls, prevented, fire };
}

describe('installQuitGuard', () => {
  it('0 run: dừng listener rồi thoát, không hỏi', async () => {
    const g = guard([0], []);
    g.fire();
    await flush();
    expect(g.calls).toEqual(['stopForQuit', 'quit']);
    expect(g.prevented).toEqual([true, false]);
  });

  it('có run, chọn "Thoát ngay": dừng listener rồi thoát', async () => {
    const g = guard([2], ['now']);
    g.fire();
    await flush();
    expect(g.calls).toEqual(['ask:2', 'stopForQuit', 'quit']);
  });

  it('có run, chọn "Hủy": ở lại, lần thoát sau hỏi lại', async () => {
    const g = guard([2], ['cancel', 'now']);
    g.fire();
    await flush();
    expect(g.calls).toEqual(['ask:2']);
    g.fire();
    await flush();
    expect(g.calls).toEqual(['ask:2', 'ask:2', 'stopForQuit', 'quit']);
  });

  it('có run, chọn "Chờ": pause listener, chờ về 0 rồi thoát', async () => {
    const g = guard([2, 1, 0], ['wait']);
    g.fire();
    await flush();
    expect(g.calls).toEqual(['ask:2', 'pause', 'waiting:2', 'waiting:1', 'stopForQuit', 'quit']);
  });

  it('đang quyết định thì lần bấm Thoát thứ hai bị nuốt', async () => {
    const g = guard([2], ['now']);
    g.fire();
    g.fire();
    await flush();
    expect(g.calls.filter((c) => c.startsWith('ask'))).toHaveLength(1);
    expect(g.prevented.slice(0, 2)).toEqual([true, true]);
  });

  it('đang chờ run mà bấm Thoát lần nữa: hỏi lại; "Hủy" thì bỏ chờ và mở lại listener', async () => {
    const g = guard([2], ['wait', 'cancel'], () => new Promise<void>(() => undefined));
    g.fire();
    await flush();
    expect(g.calls).toEqual(['ask:2', 'pause', 'waiting:2']);
    g.fire();
    await flush();
    expect(g.calls.slice(3, 5)).toEqual(['ask:2', 'resume']);
    expect(g.calls).not.toContain('quit');
  });

  it('đọc run lỗi thì vẫn hỏi (coi như không rõ), không thoát im lặng', async () => {
    let handler: ((event: { preventDefault(): void }) => void) | null = null;
    const calls: string[] = [];
    installQuitGuard({
      onBeforeQuit: (h) => {
        handler = h;
      },
      quit: () => calls.push('quit'),
      ask: async (n) => {
        calls.push(`ask:${n}`);
        return 'cancel';
      },
      activeRuns: async () => {
        throw new Error('ps lỗi');
      },
      stopForQuit: async () => undefined,
      pause: async () => undefined,
      resume: async () => undefined,
      showWaiting: () => undefined,
      sleep: async () => undefined,
      log: () => undefined,
    });
    (handler as unknown as (e: { preventDefault(): void }) => void)({ preventDefault: () => undefined });
    await flush();
    expect(calls).toEqual(['ask:null']);
  });
});
