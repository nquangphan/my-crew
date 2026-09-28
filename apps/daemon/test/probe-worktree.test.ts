import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROBE_WORKTREE_KEY, PROBE_WORKTREE_TTL_MS, ProbeWorktreeKeeper } from '../src/git/probe-worktree.js';
import { ensureWorktree, worktreePath } from '../src/git/worktree-manager.js';
import { manualClock } from './helpers/clock.js';
import { makeRepo } from './helpers/git.js';

const HOUR = PROBE_WORKTREE_TTL_MS;
const MINUTE = 60 * 1000;

function setup(options: { busy?: () => boolean } = {}) {
  const repo = makeRepo();
  const meta = new Map<string, string>();
  const clock = manualClock();
  const keeper = new ProbeWorktreeKeeper({
    meta: { get: (key) => meta.get(key) ?? null, set: (key, value) => meta.set(key, value) },
    repoOf: (key) => (key === 'WEB' ? repo : null),
    busy: options.busy ?? (() => false),
    clock,
  });
  const probe = () => ensureWorktree({ repo, key: PROBE_WORKTREE_KEY, base: 'main', detach: true });
  const exists = () => existsSync(worktreePath(repo, PROBE_WORKTREE_KEY));
  return { repo, meta, clock, keeper, probe, exists };
}

describe('probe worktree retention', () => {
  it('keeps the worktree for an hour after the last probe, then removes it on a timer', () => {
    const t = setup();
    t.probe();
    t.keeper.used('WEB');
    t.clock.advance(59 * MINUTE);
    expect(t.exists()).toBe(true);
    // A second probe within the hour reuses the worktree and restarts the hour.
    expect(t.probe().created).toBe(false);
    t.keeper.used('WEB');
    t.clock.advance(59 * MINUTE);
    expect(t.exists()).toBe(true);
    t.clock.advance(MINUTE);
    expect(t.exists()).toBe(false);
  });

  it('expires worktrees older than an hour (daemon start, sweep) and keeps younger ones', () => {
    const t = setup();
    t.probe();
    t.keeper.used('WEB', { arm: false });
    t.clock.advance(30 * MINUTE);
    expect(t.keeper.expire(['WEB', 'OTHER'])).toBe(0);
    expect(t.exists()).toBe(true);
    // The younger worktree got a timer for the rest of its hour.
    t.clock.advance(30 * MINUTE);
    expect(t.exists()).toBe(false);

    t.probe();
    t.keeper.used('WEB', { arm: false });
    t.clock.advance(HOUR + MINUTE);
    const restarted = new ProbeWorktreeKeeper({
      meta: { get: (key) => t.meta.get(key) ?? null, set: (key, value) => t.meta.set(key, value) },
      repoOf: () => t.repo,
      busy: () => false,
      clock: t.clock,
    });
    expect(restarted.expire(['WEB'])).toBe(1);
    expect(t.exists()).toBe(false);
    expect(restarted.expire(['WEB'])).toBe(0);
  });

  it('removes a worktree with no recorded probe time, and never one a probe is using', () => {
    let busy = true;
    const t = setup({ busy: () => busy });
    t.probe();
    expect(t.keeper.expire(['WEB'])).toBe(0);
    expect(t.exists()).toBe(true);
    busy = false;
    expect(t.keeper.expire(['WEB'])).toBe(1);
    expect(t.exists()).toBe(false);
  });

  it('stop() cancels the pending removals', () => {
    const t = setup();
    t.probe();
    t.keeper.used('WEB');
    t.keeper.stop();
    t.clock.advance(2 * HOUR);
    expect(t.exists()).toBe(true);
  });
});
