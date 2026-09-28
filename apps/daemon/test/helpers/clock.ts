import type { ProbeClock } from '../../src/git/probe-worktree.js';

/** A clock whose time and timers only move when the test calls `advance`. */
export function manualClock(start = 1_700_000_000_000): ProbeClock & { advance(ms: number): void } {
  let now = start;
  const timers = new Set<{ at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const timer = { at: now + ms, fn };
      timers.add(timer);
      return timer;
    },
    clearTimeout(handle) {
      timers.delete(handle as { at: number; fn: () => void });
    },
    advance(ms) {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at > now || !timers.has(timer)) continue;
        timers.delete(timer);
        timer.fn();
      }
    },
  };
}
