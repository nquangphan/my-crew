import { describe, expect, it } from 'vitest';
import { DRAIN_MAX_MS, DRAIN_POLL_MS, type DrainDeps, drainForUpdate } from '../src/main/update/drain.js';

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
