import type { CheckResult } from '@crew/mac';
import { describe, expect, it } from 'vitest';
import { type AppState, defaultAppState } from '../src/main/app-state.js';
import {
  CREW_MAC_IDLE_POLL_MS,
  installCrewMacWhenIdle,
  PROBATION_MS,
  type ProbationDeps,
  runProbation,
} from '../src/main/update/probation.js';

type SupervisorStatus = ReturnType<ProbationDeps['supervisor']['status']>;

function check(id: string, status: CheckResult['status']): CheckResult {
  return { id, title: id, status, detail: '' };
}

function harness(opts: {
  state?: Partial<AppState>;
  update?: Partial<AppState['update']>;
  listenerUpAt?: number | null;
  supervisorState?: SupervisorStatus['state'];
  doctor?: CheckResult[];
  sendStatus?: () => Promise<void>;
  rolledBack?: string | null;
  hasPrevious?: boolean;
}) {
  let clock = 0;
  const base = defaultAppState('0.1.1');
  let state: AppState = {
    ...base,
    updateState: 'installing',
    ...opts.state,
    update: { ...base.update, from: '0.1.0', to: '0.1.1', baseline: ['tcc-pending'], ...opts.update },
  };
  const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  const calls: string[] = [];
  let rolledBack = opts.rolledBack ?? null;
  const markers = { ok: [] as string[], failed: [] as string[] };
  const listenerUpAt = opts.listenerUpAt === undefined ? 0 : opts.listenerUpAt;
  const deps: ProbationDeps = {
    appVersion: '0.1.1',
    store: {
      get: () => structuredClone(state),
      update: async (fn) => {
        state = fn(structuredClone(state));
        return structuredClone(state);
      },
    },
    supervisor: {
      status: () => ({
        state:
          opts.supervisorState ?? (listenerUpAt !== null && clock >= listenerUpAt ? 'running' : 'backoff'),
        pid: null,
        restarts: 0,
        lastError: null,
      }),
      stopForQuit: async () => {
        calls.push('stopForQuit');
      },
    },
    doctor: async () => opts.doctor ?? [check('tcc-pending', 'fail'), check('node', 'ok')],
    sendStatus: opts.sendStatus ?? (async () => undefined),
    markers: {
      readRolledBack: () => rolledBack,
      clearRolledBack: () => {
        rolledBack = null;
        calls.push('clearRolledBack');
      },
      writeOk: (v) => markers.ok.push(v),
      writeFailed: (v) => markers.failed.push(v),
    },
    hasPrevious: () => opts.hasPrevious ?? true,
    spawnRollbackNow: (to) => calls.push(`rollback-now:${to}`),
    exit: (code) => calls.push(`exit:${code}`),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => new Date(Date.UTC(2026, 9, 9, 8, 0, 0) + clock),
    log: (_level, event, fields) => events.push({ event, fields }),
  };
  return { deps, state: () => state, events, calls, markers, clock: () => clock };
}

describe('runProbation', () => {
  it('bản mới khỏe: ghi .ok, về idle, log update-installed', async () => {
    const h = harness({ listenerUpAt: 30_000 });
    expect(await runProbation(h.deps)).toBe('passed');
    expect(h.markers.ok).toEqual(['0.1.1']);
    expect(h.state().updateState).toBe('idle');
    expect(h.events.map((e) => e.event)).toEqual(['update-installed']);
    expect(h.events[0]?.fields).toMatchObject({ from: '0.1.0', to: '0.1.1' });
    expect(h.calls).toEqual([]);
  });

  it('listener không lên trong 5 phút: quay lui, thêm badVersions, dừng sshd rồi thoát', async () => {
    const h = harness({ listenerUpAt: null });
    expect(await runProbation(h.deps)).toBe('failed');
    expect(h.clock()).toBeGreaterThanOrEqual(PROBATION_MS);
    const failed = h.events.find((e) => e.event === 'update-probation-failed');
    expect(failed?.fields?.reason).toBe('sshd không lên');
    expect(h.state().update.badVersions).toEqual(['0.1.1']);
    expect(h.state().updateState).toBe('rolled-back');
    expect(h.calls).toEqual(['rollback-now:0.1.1', 'stopForQuit', 'exit:0']);
    expect(h.markers.ok).toEqual([]);
  });

  it('doctor có fail mới (không trong baseline): quay lui, lý do nêu id', async () => {
    const h = harness({ doctor: [check('tcc-pending', 'fail'), check('sshd-agent', 'fail')] });
    expect(await runProbation(h.deps)).toBe('failed');
    const failed = h.events.find((e) => e.event === 'update-probation-failed');
    expect(failed?.fields?.reason).toContain('sshd-agent');
    expect(String(failed?.fields?.reason)).not.toContain('tcc-pending');
    expect(h.calls).toContain('exit:0');
  });

  it('không gửi được bản tin máy (thử lại vẫn hỏng): quay lui', async () => {
    let tries = 0;
    const h = harness({
      sendStatus: async () => {
        tries += 1;
        throw new Error('Gửi trạng thái thất bại');
      },
    });
    expect(await runProbation(h.deps)).toBe('failed');
    expect(tries).toBeGreaterThan(1);
    const failed = h.events.find((e) => e.event === 'update-probation-failed');
    expect(failed?.fields?.reason).toBe('không gửi được bản tin máy');
    expect(h.clock()).toBeLessThanOrEqual(PROBATION_MS);
  });

  it('bản tin vốn đã không gửi được trước khi cài (baseline send-status) thì không tính là hỏng', async () => {
    const h = harness({
      update: { baseline: ['send-status'] },
      doctor: [],
      sendStatus: async () => {
        throw new Error('chưa cấu hình');
      },
    });
    expect(await runProbation(h.deps)).toBe('passed');
  });

  it('gửi bản tin hỏng lần đầu, lần sau được thì đạt', async () => {
    let tries = 0;
    const h = harness({
      sendStatus: async () => {
        tries += 1;
        if (tries === 1) throw new Error('mạng chập chờn');
      },
    });
    expect(await runProbation(h.deps)).toBe('passed');
  });

  it('chế độ CLI (supervisor disabled): không đòi listener của app', async () => {
    const h = harness({ supervisorState: 'disabled' });
    expect(await runProbation(h.deps)).toBe('passed');
  });

  it('khởi động thấy marker rolled-back: log update-rolled-back, thêm badVersions, xóa marker', async () => {
    const h = harness({
      state: { updateState: 'rolled-back' },
      rolledBack: '0.1.2',
      update: { badVersions: ['0.0.5'] },
    });
    h.deps.appVersion = '0.1.1';
    expect(await runProbation(h.deps)).toBe('rolled-back-detected');
    expect(h.events.map((e) => e.event)).toEqual(['update-rolled-back']);
    expect(h.state().update.badVersions).toEqual(['0.0.5', '0.1.2']);
    expect(h.state().updateState).toBe('rolled-back');
    expect(h.calls).toEqual(['clearRolledBack']);
  });

  it('updateState không phải installing thì không làm gì', async () => {
    const h = harness({ state: { updateState: 'idle' } });
    expect(await runProbation(h.deps)).toBe('skipped');
    expect(h.events).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('installing nhưng bản đang chạy không phải bản đích (Squirrel không thay được): gỡ watchdog, về idle', async () => {
    const h = harness({ update: { to: '0.1.2' } });
    expect(await runProbation(h.deps)).toBe('install-missing');
    expect(h.markers.failed).toEqual(['0.1.2']);
    expect(h.state().updateState).toBe('idle');
    expect(h.events.map((e) => e.event)).toEqual(['update-install-missing']);
    expect(h.calls).toEqual([]);
  });

  it('hỏng mà không có bản trước: không thoát (thoát là chết app), ghi .failed để watchdog thôi', async () => {
    const h = harness({ listenerUpAt: null, hasPrevious: false });
    expect(await runProbation(h.deps)).toBe('failed');
    expect(h.calls).toEqual([]);
    expect(h.markers.failed).toEqual(['0.1.1']);
    expect(h.state().update.badVersions).toEqual(['0.1.1']);
    expect(h.state().updateState).toBe('idle');
  });
});

describe('installCrewMacWhenIdle', () => {
  it('chờ máy rảnh (kiểm mỗi 10 phút) rồi cài crew-mac mang theo đúng một lần', async () => {
    let clock = 0;
    const installs: number[] = [];
    const events: string[] = [];
    await installCrewMacWhenIdle({
      activeRuns: async () => (clock < 25 * 60_000 ? 1 : 0),
      install: async () => {
        installs.push(clock);
        return { installed: true, version: '0.3.0', backup: null };
      },
      sleep: async (ms) => {
        clock += ms;
      },
      log: (_l, event) => events.push(event),
    });
    expect(installs).toEqual([3 * CREW_MAC_IDLE_POLL_MS]);
    expect(events).toEqual(['crew-mac-installed']);
  });

  it('crew-mac từ chối vì vừa có run mới thì chờ tiếp rồi thử lại', async () => {
    let clock = 0;
    let tries = 0;
    await installCrewMacWhenIdle({
      activeRuns: async () => 0,
      install: async () => {
        tries += 1;
        return tries === 1
          ? { installed: false, version: '0.3.0', backup: null, reason: 'Từ chối cài vì còn run đang chạy' }
          : { installed: false, version: '0.3.0', backup: null };
      },
      sleep: async (ms) => {
        clock += ms;
      },
      log: () => undefined,
    });
    expect(tries).toBe(2);
    expect(clock).toBe(CREW_MAC_IDLE_POLL_MS);
  });
});
