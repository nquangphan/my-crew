import { describe, expect, it } from 'vitest';
import {
  choiceFromButton,
  decideQuit,
  installQuitGuard,
  type QuitChoice,
  type QuitGuard,
  type QuitGuardDeps,
  quitPrompt,
  STOPS_NEW_WORK,
} from '../src/main/quit-guard.js';

describe('decideQuit', () => {
  it('0 run mà app giữ cổng: vẫn hỏi (thoát là máy ngừng nhận việc mới)', async () => {
    const asked: Array<number | null> = [];
    const ask = async (n: number | null): Promise<QuitChoice> => {
      asked.push(n);
      return 'cancel';
    };
    expect(await decideQuit({ activeRuns: 0, ownsListener: true }, ask)).toEqual({ kind: 'stay' });
    expect(await decideQuit({ activeRuns: 0, ownsListener: true }, async () => 'now')).toEqual({
      kind: 'quit-now',
    });
    expect(asked).toEqual([0]);
  });

  it('app không giữ cổng (chủ launchd): thoát không hỏi, kể cả khi còn run', async () => {
    let asked = false;
    const ask = async (): Promise<QuitChoice> => {
      asked = true;
      return 'cancel';
    };
    expect(await decideQuit({ activeRuns: 3, ownsListener: false }, ask)).toEqual({ kind: 'quit-now' });
    expect(await decideQuit({ activeRuns: null, ownsListener: false }, ask)).toEqual({ kind: 'quit-now' });
    expect(asked).toBe(false);
  });

  it('có run thì hỏi và theo lựa chọn', async () => {
    const input = { activeRuns: 2, ownsListener: true };
    expect(await decideQuit(input, async () => 'wait')).toEqual({ kind: 'wait-then-quit' });
    expect(await decideQuit(input, async () => 'now')).toEqual({ kind: 'quit-now' });
    expect(await decideQuit(input, async () => 'cancel')).toEqual({ kind: 'stay' });
  });
});

describe('quitPrompt', () => {
  it('còn run: 3 nút, mặc định "Thoát ngay, run vẫn chạy" (phiên sống qua thoát app)', () => {
    const prompt = quitPrompt(3);
    expect(prompt.buttons).toEqual(['Chờ run xong rồi thoát', 'Thoát ngay, run vẫn chạy', 'Hủy']);
    expect(prompt.buttons[prompt.defaultId]).toBe('Thoát ngay, run vẫn chạy');
    expect(prompt.buttons[prompt.cancelId]).toBe('Hủy');
    expect(prompt.message).toBe('Có 3 run đang chạy trên máy này.');
    expect(prompt.detail).toContain('run đang chạy vẫn chạy tới xong');
    expect(prompt.detail).toContain(STOPS_NEW_WORK);
    expect([0, 1, 2, 9].map((i) => choiceFromButton(prompt, i))).toEqual(['wait', 'now', 'cancel', 'cancel']);
    expect(quitPrompt(null).message).toBe('Không đọc được danh sách run trên máy này.');
  });

  it('0 run: cảnh báo ngừng nhận việc, chỉ "Thoát" / "Ở lại", Enter và Esc đều ở lại', () => {
    const prompt = quitPrompt(0);
    expect(STOPS_NEW_WORK).toBe('Thoát app thì máy ngừng nhận việc mới cho tới khi mở lại.');
    expect(prompt.message).toBe(STOPS_NEW_WORK);
    expect(prompt.buttons).toEqual(['Thoát', 'Ở lại']);
    expect(prompt.buttons[prompt.defaultId]).toBe('Ở lại');
    expect(prompt.buttons[prompt.cancelId]).toBe('Ở lại');
    expect([0, 1, 5].map((i) => choiceFromButton(prompt, i))).toEqual(['now', 'cancel', 'cancel']);
  });
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function guard(
  runsSeq: number[],
  answers: QuitChoice[],
  sleep: () => Promise<void> = async () => undefined,
  opts: { ownsListener?: boolean; ask?: (n: number | null) => Promise<QuitChoice> } = {},
) {
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
      if (opts.ask) return opts.ask(n);
      return answers.shift() ?? 'cancel';
    },
    ownsListener: () => opts.ownsListener ?? true,
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
    hideWaiting: () => {
      calls.push('hideWaiting');
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
  const api: QuitGuard = installQuitGuard(deps);
  return { calls, prevented, fire, api };
}

describe('installQuitGuard', () => {
  it('0 run, chọn "Thoát": hỏi trước, rồi dừng listener và thoát', async () => {
    const g = guard([0], ['now']);
    g.fire();
    await flush();
    expect(g.calls).toEqual(['ask:0', 'stopForQuit', 'quit']);
    expect(g.prevented).toEqual([true, false]);
  });

  it('0 run, chọn "Ở lại": không dừng listener, không thoát', async () => {
    const g = guard([0], ['cancel']);
    g.fire();
    await flush();
    expect(g.calls).not.toContain('stopForQuit');
    expect(g.calls).not.toContain('quit');
    expect(g.calls[0]).toBe('ask:0');
  });

  it('chủ cổng là launchd: thoát không hỏi', async () => {
    const g = guard([2], [], undefined, { ownsListener: false });
    g.fire();
    await flush();
    expect(g.calls).toEqual(['stopForQuit', 'quit']);
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
    expect(g.calls).toEqual(['ask:2', 'resume']);
    g.fire();
    await flush();
    expect(g.calls).toEqual(['ask:2', 'resume', 'ask:2', 'stopForQuit', 'quit']);
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
    expect(g.calls.slice(3, 6)).toEqual(['ask:2', 'resume', 'hideWaiting']);
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
      ownsListener: () => true,
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

describe('thoát để cập nhật', () => {
  it('allowQuitForUpdate: before-quit kế tiếp đi qua, không hỏi lại, guard không tự dừng listener', async () => {
    const g = guard([2], []);
    g.api.allowQuitForUpdate();
    g.fire();
    await flush();
    expect(g.prevented).toEqual([false]);
    expect(g.calls).toEqual([]);
  });

  it('hủy giấy phép (cài hỏng, app không thoát): guard hỏi lại như thường và mở lại listener', async () => {
    const g = guard([2], ['cancel']);
    const revoke = g.api.allowQuitForUpdate();
    await revoke();
    expect(g.calls).toEqual(['resume']);
    g.fire();
    await flush();
    expect(g.prevented).toEqual([true]);
    expect(g.calls).toEqual(['resume', 'ask:2', 'resume']);
  });

  it('giấy phép cũ đã bị thay thì hủy không làm gì', async () => {
    const g = guard([2], []);
    const first = g.api.allowQuitForUpdate();
    g.api.allowQuitForUpdate();
    await first();
    g.fire();
    await flush();
    expect(g.prevented).toEqual([false]);
    expect(g.calls).toEqual([]);
  });

  it('hộp thoại thoát đang mở khi updater cho phép: câu trả lời sau đó không chặn lại việc thoát', async () => {
    let answer: (c: QuitChoice) => void = () => undefined;
    const g = guard([2], [], undefined, {
      ask: () =>
        new Promise<QuitChoice>((resolve) => {
          answer = resolve;
        }),
    });
    g.fire();
    await flush();
    g.api.allowQuitForUpdate();
    answer('cancel');
    await flush();
    expect(g.calls).toEqual(['ask:2']);
    g.fire();
    expect(g.prevented).toEqual([true, false]);
  });

  it('đang "Chờ run xong" mà updater cho phép: vòng chờ dừng, guard không thoát lần hai', async () => {
    let tick: () => void = () => undefined;
    const g = guard(
      [2, 2],
      ['wait'],
      () =>
        new Promise<void>((resolve) => {
          tick = resolve;
        }),
    );
    g.fire();
    await flush();
    expect(g.calls).toEqual(['ask:2', 'pause', 'waiting:2']);
    g.api.allowQuitForUpdate();
    tick();
    await flush();
    expect(g.calls).toEqual(['ask:2', 'pause', 'waiting:2']);
  });
});

describe('giữ thoát khi đang chuyển chủ sshd', () => {
  it('holdQuit: bấm Thoát giữa thao tác thì chờ thao tác xong rồi mới hỏi', async () => {
    let finish: () => void = () => undefined;
    const g = guard([0], ['now']);
    const task = g.api.holdQuit(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve('xong');
        }),
    );
    g.fire();
    await flush();
    expect(g.prevented).toEqual([true]);
    expect(g.calls).toEqual([]);
    finish();
    expect(await task).toBe('xong');
    await flush();
    expect(g.calls).toEqual(['ask:0', 'stopForQuit', 'quit']);
  });

  it('holdQuit: thao tác lỗi vẫn nhả guard và trả lỗi cho bên gọi', async () => {
    const g = guard([0], ['now']);
    await expect(g.api.holdQuit(async () => Promise.reject(new Error('hỏng')))).rejects.toThrow('hỏng');
    g.fire();
    await flush();
    expect(g.calls).toEqual(['ask:0', 'stopForQuit', 'quit']);
  });
});
