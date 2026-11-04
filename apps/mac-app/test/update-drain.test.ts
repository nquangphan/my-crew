import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bugFindingRunningReviews } from '../src/main/bug-finding/state.js';
import {
  BUG_FINDING_QUIT_MS,
  BUG_FINDING_WAIT_REASON,
  type BugFindingDrain,
  DRAIN_MAX_MS,
  DRAIN_POLL_MS,
  type DrainDeps,
  drainForUpdate,
  reopenBugFindingAfterUpdate,
  reviewsFromHeartbeat,
} from '../src/main/update/drain.js';

/** Đồng hồ giả: `sleep` chỉ cộng giờ. `runsAt(t)` trả số run tại thời điểm t (ms). */
function fakeDeps(runsAt: (t: number) => number, answer: 'now' | 'later' = 'later') {
  let clock = 0;
  const calls: string[] = [];
  const polls: number[] = [];
  const asked: Array<number | null> = [];
  const deps: DrainDeps = {
    pause: async () => {
      calls.push('pause');
    },
    resume: async () => {
      calls.push('resume');
    },
    activeRuns: async () => {
      polls.push(clock);
      return runsAt(clock);
    },
    ask: async (n) => {
      asked.push(n);
      calls.push('ask');
      return answer;
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, polls, asked, clock: () => clock };
}

describe('drainForUpdate', () => {
  it('0 run: pause một lần rồi cài ngay', async () => {
    const f = fakeDeps(() => 0);
    expect(await drainForUpdate(f.deps)).toBe('install');
    expect(f.calls).toEqual(['pause']);
    expect(f.clock()).toBe(0);
  });

  it('2 run về 0 sau 20 phút: kiểm mỗi 10 giây, không hỏi, không resume', async () => {
    const f = fakeDeps((t) => (t < 20 * 60_000 ? 2 : 0));
    expect(await drainForUpdate(f.deps)).toBe('install');
    expect(f.calls).toEqual(['pause']);
    expect(f.clock()).toBe(20 * 60_000);
    const gaps = f.polls.slice(1).map((t, i) => t - (f.polls[i] ?? 0));
    expect(new Set(gaps)).toEqual(new Set([DRAIN_POLL_MS]));
  });

  it('quá 30 phút vẫn còn run: mở lại listener rồi hỏi; "Để sau" trả later', async () => {
    const f = fakeDeps(() => 1, 'later');
    expect(await drainForUpdate(f.deps)).toBe('later');
    expect(f.clock()).toBe(DRAIN_MAX_MS);
    expect(f.asked).toEqual([1]);
    expect(f.calls).toEqual(['pause', 'resume', 'ask']);
  });

  it('quá 30 phút, owner chọn "Cài ngay" thì cài dù run vẫn chạy', async () => {
    const f = fakeDeps(() => 3, 'now');
    expect(await drainForUpdate(f.deps)).toBe('install');
    expect(f.asked).toEqual([3]);
  });

  it('không đọc được bảng process thì coi như còn run, không cài im lặng', async () => {
    const f = fakeDeps(() => 0, 'later');
    f.deps.activeRuns = async () => {
      throw new Error('ps lỗi');
    };
    expect(await drainForUpdate(f.deps)).toBe('later');
    expect(f.asked).toEqual([null]);
  });
});

/** Bug Finding giả: `reviewsAt(t)` là `running` trong heartbeat tại thời điểm t; `quitAfterMs` app thoát sau bao lâu. */
function fakeBugFinding(
  f: ReturnType<typeof fakeDeps>,
  opts: { reviewsAt: (t: number) => number; running?: boolean; quitAfterMs?: number | null },
) {
  let running = opts.running ?? true;
  let quitAt: number | null = null;
  const events: string[] = [];
  const reopen: boolean[] = [];
  const bugFinding: BugFindingDrain = {
    runningReviews: async () => opts.reviewsAt(f.clock()),
    isRunning: async () => {
      if (running && quitAt !== null && f.clock() >= quitAt) running = false;
      return running;
    },
    quit: async () => {
      events.push(`quit@${f.clock()}`);
      const after = opts.quitAfterMs === undefined ? 2_000 : opts.quitAfterMs;
      if (after !== null) quitAt = f.clock() + after;
    },
    setReopen: async (on) => {
      reopen.push(on);
    },
    hold: async () => {
      f.calls.push('hold');
    },
    release: () => {
      f.calls.push('release');
    },
  };
  f.deps.bugFinding = bugFinding;
  return { events, reopen, isRunning: () => running };
}

describe('drainForUpdate với Bug Finding', () => {
  it('Bug Finding đang review (running 1): không cài, báo "chờ Bug Finding review xong", không thoát app', async () => {
    const f = fakeDeps(() => 0, 'now');
    const reasons: Array<string | null> = [];
    f.deps.onWait = (reason) => reasons.push(reason);
    const bf = fakeBugFinding(f, { reviewsAt: () => 1 });
    expect(await drainForUpdate(f.deps)).toBe('later');
    expect(reasons).toContain(BUG_FINDING_WAIT_REASON);
    expect(BUG_FINDING_WAIT_REASON).toBe('Chờ Bug Finding review xong');
    expect(bf.events).toEqual([]);
    // Quá 30 phút: mở lại listener và cổng nhưng không hỏi "Cài ngay" — cài lúc này sẽ thay binary đang review.
    expect(f.calls).toEqual(['pause', 'hold', 'resume', 'release']);
    expect(f.asked).toEqual([]);
    expect(bf.isRunning()).toBe(true);
  });

  it('review xong (running 1 → 0) sau 5 phút: thoát Bug Finding rồi mới cài, đặt cờ mở lại', async () => {
    const f = fakeDeps(() => 0);
    const reasons: Array<string | null> = [];
    f.deps.onWait = (reason) => reasons.push(reason);
    const bf = fakeBugFinding(f, { reviewsAt: (t) => (t < 5 * 60_000 ? 1 : 0) });
    expect(await drainForUpdate(f.deps)).toBe('install');
    expect(bf.events).toEqual([`quit@${5 * 60_000}`]);
    expect(bf.isRunning()).toBe(false);
    expect(bf.reopen).toEqual([true]);
    expect(reasons.at(0)).toBe(BUG_FINDING_WAIT_REASON);
    expect(reasons.at(-1)).toBeNull();
  });

  it('running 0 ngay từ đầu: gửi quit một lần, chờ app thoát (không quá 30 giây) rồi cài', async () => {
    const f = fakeDeps(() => 0);
    const bf = fakeBugFinding(f, { reviewsAt: () => 0, quitAfterMs: 4_000 });
    expect(await drainForUpdate(f.deps)).toBe('install');
    expect(bf.events).toEqual(['quit@0']);
    expect(f.clock()).toBeGreaterThanOrEqual(4_000);
    expect(f.clock()).toBeLessThanOrEqual(BUG_FINDING_QUIT_MS);
  });

  it('Bug Finding không chạy: không gửi quit, không đặt cờ mở lại', async () => {
    const f = fakeDeps(() => 0);
    const bf = fakeBugFinding(f, { reviewsAt: () => 0, running: false });
    expect(await drainForUpdate(f.deps)).toBe('install');
    expect(bf.events).toEqual([]);
    expect(bf.reopen).toEqual([]);
  });

  it('Bug Finding không thoát trong 30 giây: không cài lúc đó, bỏ cờ mở lại, thử lại tới hạn 30 phút', async () => {
    const f = fakeDeps(() => 0, 'now');
    const bf = fakeBugFinding(f, { reviewsAt: () => 0, quitAfterMs: null });
    expect(await drainForUpdate(f.deps)).toBe('later');
    expect(bf.isRunning()).toBe(true);
    expect(bf.reopen.at(-1)).toBe(false);
    const first = bf.events[0] ?? '';
    const second = bf.events[1] ?? '';
    expect(Number(second.slice(5)) - Number(first.slice(5))).toBeGreaterThanOrEqual(BUG_FINDING_QUIT_MS);
    expect(f.asked).toEqual([]);
  });

  it('còn run Crew sau 30 phút, owner chọn "Cài ngay": vẫn thoát Bug Finding (đang rảnh) trước khi cài', async () => {
    const f = fakeDeps(() => 2, 'now');
    const bf = fakeBugFinding(f, { reviewsAt: () => 0 });
    expect(await drainForUpdate(f.deps)).toBe('install');
    expect(f.asked).toEqual([2]);
    expect(bf.events).toEqual([`quit@${DRAIN_MAX_MS}`]);
    expect(bf.isRunning()).toBe(false);
  });

  it('đóng cổng mở Bug Finding ngay sau khi dừng listener; cài thì giữ cổng đóng, không mở lại', async () => {
    const f = fakeDeps(() => 0);
    fakeBugFinding(f, { reviewsAt: () => 0 });
    expect(await drainForUpdate(f.deps)).toBe('install');
    expect(f.calls).toEqual(['pause', 'hold']);
  });

  it('"Để sau" sau 30 phút: mở lại cả listener lẫn cổng mở Bug Finding', async () => {
    const f = fakeDeps(() => 1, 'later');
    fakeBugFinding(f, { reviewsAt: () => 0 });
    expect(await drainForUpdate(f.deps)).toBe('later');
    expect(f.calls).toEqual(['pause', 'hold', 'resume', 'ask', 'release']);
  });

  it('ghi cờ mở lại lỗi trong lúc thoát Bug Finding: không ném, chờ tiếp rồi mở lại listener và cổng', async () => {
    const f = fakeDeps(() => 0, 'now');
    const bf = fakeBugFinding(f, { reviewsAt: () => 0 });
    f.deps.bugFinding = {
      ...(f.deps.bugFinding as BugFindingDrain),
      setReopen: async () => {
        throw new Error('ENOSPC');
      },
    };
    expect(await drainForUpdate(f.deps)).toBe('later');
    expect(bf.events).toEqual([]);
    expect(f.calls).toContain('resume');
    expect(f.calls.at(-1)).toBe('release');
  });

  it('ps lỗi khi kiểm Bug Finding còn chạy: không cài, mở lại listener', async () => {
    const f = fakeDeps(() => 0, 'now');
    fakeBugFinding(f, { reviewsAt: () => 0 });
    f.deps.bugFinding = {
      ...(f.deps.bugFinding as BugFindingDrain),
      isRunning: async () => {
        throw new Error('ps lỗi (mã 2)');
      },
    };
    expect(await drainForUpdate(f.deps)).toBe('later');
    expect(f.calls).toEqual(['pause', 'hold', 'resume', 'release']);
  });

  it('lỗi bất ngờ trong drain (hỏi owner ném): vẫn mở lại listener và cổng rồi ném', async () => {
    const f = fakeDeps(() => 1);
    fakeBugFinding(f, { reviewsAt: () => 0 });
    f.deps.ask = async () => {
      throw new Error('dialog lỗi');
    };
    await expect(drainForUpdate(f.deps)).rejects.toThrow('dialog lỗi');
    expect(f.calls.filter((c) => c === 'resume')).toHaveLength(1);
    expect(f.calls).toContain('release');
  });

  it('Bug Finding thoát trễ hơn 30 giây sau quit: lượt sau cài và giữ cờ mở lại', async () => {
    const f = fakeDeps(() => 0);
    const bf = fakeBugFinding(f, { reviewsAt: () => 0, quitAfterMs: 35_000 });
    expect(await drainForUpdate(f.deps)).toBe('install');
    expect(bf.isRunning()).toBe(false);
    expect(bf.reopen).not.toContain(false);
    expect(bf.reopen.at(-1)).toBe(true);
  });

  it('không đọc được số lượt review của Bug Finding: coi như đang review, không cài', async () => {
    const f = fakeDeps(() => 0, 'now');
    const bf = fakeBugFinding(f, { reviewsAt: () => 0 });
    f.deps.bugFinding = {
      ...(f.deps.bugFinding as BugFindingDrain),
      runningReviews: async () => {
        throw new Error('đọc lỗi');
      },
    };
    expect(await drainForUpdate(f.deps)).toBe('later');
    expect(bf.events).toEqual([]);
  });
});

describe('reopenBugFindingAfterUpdate', () => {
  it('cờ reopenBugFinding bật: mở lại Bug Finding chạy nền rồi xóa cờ', async () => {
    let flag = true;
    const launched: Array<{ background: boolean }> = [];
    const result = await reopenBugFindingAfterUpdate({
      pending: () => flag,
      clear: async () => {
        flag = false;
      },
      launch: async (opts) => {
        launched.push(opts);
        return { ok: true };
      },
    });
    expect(result).toBe('reopened');
    expect(launched).toEqual([{ background: true }]);
    expect(flag).toBe(false);
  });

  it('không có cờ: không mở gì', async () => {
    let launched = 0;
    const result = await reopenBugFindingAfterUpdate({
      pending: () => false,
      clear: async () => undefined,
      launch: async () => {
        launched++;
        return { ok: true };
      },
    });
    expect(result).toBe('none');
    expect(launched).toBe(0);
  });

  it('mở lỗi vẫn xóa cờ, lần khởi động sau không thử lại mãi', async () => {
    let flag = true;
    const result = await reopenBugFindingAfterUpdate({
      pending: () => flag,
      clear: async () => {
        flag = false;
      },
      launch: async () => {
        throw new Error('open mã 1');
      },
    });
    expect(result).toBe('failed');
    expect(flag).toBe(false);
  });
});

describe('bugFindingRunningReviews', () => {
  const now = Date.parse('2026-11-04T06:00:00Z');
  const withHeartbeat = (body: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), 'bf-hb-'));
    const file = join(dir, 'heartbeat.json');
    if (body !== undefined) writeFileSync(file, JSON.stringify(body));
    return { file, done: () => rmSync(dir, { recursive: true, force: true }) };
  };

  it('heartbeat mới có running 1 → 1; running 0 → 0', () => {
    const a = withHeartbeat({ at: '2026-11-04T05:59:50Z', pid: 9, running: 1, waiting: 0 });
    const b = withHeartbeat({ at: '2026-11-04T05:59:50Z', pid: 9, running: 0, waiting: 2 });
    try {
      expect(bugFindingRunningReviews(a.file, now)).toBe(1);
      expect(bugFindingRunningReviews(b.file, now)).toBe(0);
    } finally {
      a.done();
      b.done();
    }
  });

  it('không có heartbeat hoặc heartbeat cũ quá 60 giây → null (không có tín hiệu mới)', () => {
    const missing = withHeartbeat(undefined);
    const stale = withHeartbeat({ at: '2026-11-04T05:50:00Z', pid: 9, running: 3 });
    try {
      expect(bugFindingRunningReviews(missing.file, now)).toBeNull();
      expect(bugFindingRunningReviews(stale.file, now)).toBeNull();
    } finally {
      missing.done();
      stale.done();
    }
  });

  it('heartbeat hỏng, ghi dở hay thiếu running thì ném (chưa rõ), không coi là rảnh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bf-hb-'));
    const file = join(dir, 'heartbeat.json');
    try {
      writeFileSync(file, '{"at":"2026-11-04T05:59:50Z","runn');
      expect(() => bugFindingRunningReviews(file, now)).toThrow();
      writeFileSync(file, JSON.stringify({ at: '2026-11-04T05:59:50Z', pid: 9 }));
      expect(() => bugFindingRunningReviews(file, now)).toThrow('running');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('reviewsFromHeartbeat', () => {
  it('heartbeat mới thì dùng running', async () => {
    expect(
      await reviewsFromHeartbeat(
        () => 2,
        async () => true,
      ),
    ).toBe(2);
  });
  it('không có heartbeat mới, app không chạy → 0', async () => {
    expect(
      await reviewsFromHeartbeat(
        () => null,
        async () => false,
      ),
    ).toBe(0);
  });
  it('không có heartbeat mới mà app vẫn chạy → ném (drain chờ, không thoát app)', async () => {
    await expect(
      reviewsFromHeartbeat(
        () => null,
        async () => true,
      ),
    ).rejects.toThrow();
  });
  it('heartbeat hỏng → ném', async () => {
    await expect(
      reviewsFromHeartbeat(
        () => {
          throw new Error('JSON hỏng');
        },
        async () => false,
      ),
    ).rejects.toThrow('JSON hỏng');
  });
});
