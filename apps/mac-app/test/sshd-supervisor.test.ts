import type { ProcInfo } from '@crew/mac';
import { describe, expect, it } from 'vitest';
import { type AppState, defaultAppState } from '../src/main/app-state.js';
import { STABLE_RESET_MS } from '../src/main/sshd/backoff.js';
import {
  createSshdSupervisor,
  type SshdChild,
  type SshdExit,
  type SupervisorDeps,
} from '../src/main/sshd/supervisor.js';
import type { ListenerProc } from '../src/main/sshd/takeover.js';

const CFG = '/Users/u/.crew-mac/sshd/sshd_config';
const listener = (pid: number): ListenerProc => ({
  pid,
  comm: 'sshd: /usr/sbin/',
  command: `sshd: /usr/sbin/sshd -D -f ${CFG} -E /Users/u/.crew-mac/sshd/sshd.log [listener] 0 of 10-100 startups`,
});

class FakeChild implements SshdChild {
  private readonly listeners: Array<(exit: SshdExit) => void> = [];
  alive = true;
  constructor(readonly pid: number) {}
  onExit(cb: (exit: SshdExit) => void): void {
    this.listeners.push(cb);
  }
  exit(exit: SshdExit): void {
    if (!this.alive) return;
    this.alive = false;
    for (const cb of this.listeners) cb(exit);
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function proc(partial: Partial<ProcInfo> & { pid: number }): ProcInfo {
  return {
    ppid: 1,
    pgid: partial.pid,
    tty: '??',
    startedAt: 1000,
    comm: 'x',
    command: 'x',
    runId: null,
    envReadable: true,
    ...partial,
  };
}

function harness(
  opts: { owner?: 'app' | 'launchd'; pidFile?: number | null; oldAlive?: 'dies' | 'stuck' } = {},
) {
  let owner: 'app' | 'launchd' = opts.owner ?? 'app';
  let manifestCb: (() => void) | null = null;
  let nowMs = 1_000_000;
  let nextPid = 600;
  let oldAlive = opts.oldAlive !== undefined;
  const children: FakeChild[] = [];
  const signals: Array<[number, string]> = [];
  const sleeps: number[] = [];
  let state: AppState = defaultAppState('0.1.0');
  let table: ProcInfo[] = [];

  const deps: SupervisorDeps = {
    sshdConfig: CFG,
    readPidFile: () => opts.pidFile ?? null,
    procInfo: async (pid) => (pid === 500 && oldAlive ? listener(500) : null),
    spawnSshd: () => {
      const child = new FakeChild(nextPid++);
      children.push(child);
      return child;
    },
    signal: (pid, sig) => {
      signals.push([pid, sig]);
      if (pid === 500 && (opts.oldAlive === 'dies' || sig === 'SIGKILL')) oldAlive = false;
      const child = children.find((c) => c.pid === pid && c.alive);
      if (child) queueMicrotask(() => child.exit({ code: null, signal: sig }));
    },
    readOwner: () => owner,
    watchManifest: (cb) => {
      manifestCb = cb;
      return () => {
        manifestCb = null;
      };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => nowMs,
    listProcesses: async () => table,
    readCwds: async (pids) => new Map(pids.map((pid) => [pid, `/Users/u/crew-agents/a-${pid}`])),
    store: {
      update: async (fn) => {
        state = fn(state);
        return state;
      },
    },
  };
  const supervisor = createSshdSupervisor(deps);
  return {
    supervisor,
    children,
    signals,
    sleeps,
    state: () => state,
    setOwner: (next: 'app' | 'launchd') => {
      owner = next;
      manifestCb?.();
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
    setTable: (rows: ProcInfo[]) => {
      table = rows;
    },
  };
}

describe('createSshdSupervisor', () => {
  it('manifest chưa giao sshd cho app thì disabled, không sinh listener', async () => {
    const h = harness({ owner: 'launchd' });
    await h.supervisor.start();
    expect(h.supervisor.status().state).toBe('disabled');
    expect(h.children).toHaveLength(0);
    expect(h.state().sshdOwner).toBe('launchd');
    expect(h.state().sshdPid).toBeNull();
  });

  it('không có listener cũ thì sinh mới và ghi pid vào app.json', async () => {
    const h = harness();
    await h.supervisor.start();
    expect(h.children).toHaveLength(1);
    expect(h.supervisor.status()).toMatchObject({ state: 'running', pid: 600, restarts: 0 });
    expect(h.state()).toMatchObject({ sshdOwner: 'app', sshdPid: 600 });
    expect(h.signals).toEqual([]);
  });

  it('listener cũ khớp argv: TERM đúng một lần, chờ nó thoát rồi mới sinh mới', async () => {
    const h = harness({ pidFile: 500, oldAlive: 'dies' });
    await h.supervisor.start();
    expect(h.signals).toEqual([[500, 'SIGTERM']]);
    expect(h.children).toHaveLength(1);
    expect(h.state().sshdPid).toBe(600);
  });

  it('listener cũ không chịu thoát sau 5 giây thì SIGKILL đúng pid đó', async () => {
    const h = harness({ pidFile: 500, oldAlive: 'stuck' });
    await h.supervisor.start();
    expect(h.signals).toEqual([
      [500, 'SIGTERM'],
      [500, 'SIGKILL'],
    ]);
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5000);
    expect(h.children).toHaveLength(1);
  });

  it('pidfile trỏ process không phải listener thì không gửi tín hiệu nào', async () => {
    const h = harness({ pidFile: 501 });
    await h.supervisor.start();
    expect(h.signals).toEqual([]);
    expect(h.children).toHaveLength(1);
  });

  it('con thoát bất thường: sinh lại sau 1s, 2s, 4s; ổn định 5 phút thì đếm về 0', async () => {
    const h = harness();
    await h.supervisor.start();
    for (let i = 0; i < 3; i++) {
      h.children.at(-1)?.exit({ code: 255, signal: null });
      await flush();
    }
    expect(h.sleeps).toEqual([1000, 2000, 4000]);
    expect(h.children).toHaveLength(4);
    expect(h.supervisor.status()).toMatchObject({ state: 'running', pid: 603, restarts: 3 });
    expect(h.supervisor.status().lastError).toContain('255');
    h.advance(STABLE_RESET_MS);
    expect(h.supervisor.status().restarts).toBe(0);
    h.children.at(-1)?.exit({ code: 255, signal: null });
    await flush();
    expect(h.sleeps.at(-1)).toBe(1000);
  });

  it('pause: TERM listener của mình, không sinh lại; resume sinh lại', async () => {
    const h = harness();
    await h.supervisor.start();
    await h.supervisor.pause();
    await flush();
    expect(h.signals).toEqual([[600, 'SIGTERM']]);
    expect(h.supervisor.status()).toMatchObject({ state: 'paused', pid: null });
    expect(h.children).toHaveLength(1);
    expect(h.state().sshdPid).toBeNull();
    await h.supervisor.resume();
    expect(h.children).toHaveLength(2);
    expect(h.supervisor.status()).toMatchObject({ state: 'running', pid: 601 });
  });

  it('stopForQuit chỉ gửi tín hiệu tới pid listener, không đụng sshd-session hay claude', async () => {
    const h = harness();
    h.setTable([
      proc({ pid: 777, comm: 'sshd-session: u@notty', command: 'sshd-session: u@notty', ppid: 600 }),
      proc({ pid: 778, comm: 'claude', command: 'claude --print x', runId: 'r1', ppid: 777 }),
    ]);
    await h.supervisor.start();
    await h.supervisor.stopForQuit();
    await flush();
    expect(h.signals).toEqual([[600, 'SIGTERM']]);
    expect(h.supervisor.status().state).toBe('stopped');
    expect(h.children).toHaveLength(1);
  });

  it('manifest đổi sang launchd: TERM listener, disabled, không sinh lại; đổi lại app thì sinh', async () => {
    const h = harness();
    const changes: string[] = [];
    h.supervisor.onChange(() => changes.push(h.supervisor.status().state));
    await h.supervisor.start();
    h.setOwner('launchd');
    await flush();
    expect(h.signals).toEqual([[600, 'SIGTERM']]);
    expect(h.supervisor.status().state).toBe('disabled');
    expect(h.children).toHaveLength(1);
    expect(h.state()).toMatchObject({ sshdOwner: 'launchd', sshdPid: null });
    h.setOwner('app');
    await flush();
    expect(h.children).toHaveLength(2);
    expect(h.supervisor.status().state).toBe('running');
    expect(changes).toContain('disabled');
  });

  it('manifest hỏng thì disabled kèm lỗi, không sinh listener', async () => {
    let spawned = 0;
    const sup = createSshdSupervisor({
      ...baseDeps(),
      spawnSshd: () => new FakeChild(900 + spawned++),
      readOwner: () => {
        throw new Error('manifest.json hỏng');
      },
    });
    await sup.start();
    expect(sup.status()).toMatchObject({ state: 'disabled', lastError: 'manifest.json hỏng' });
    expect(spawned).toBe(0);
  });

  it('activeRuns: chỉ đếm claude --print có runId', async () => {
    const h = harness();
    h.setTable([
      proc({
        pid: 10,
        comm: 'claude',
        command: 'claude --print --output-format stream-json',
        runId: 'run-1',
      }),
      proc({ pid: 11, comm: 'node', command: 'node mcp.js', ppid: 10 }),
      proc({ pid: 12, comm: 'claude', command: 'claude', runId: null }),
      proc({ pid: 13, comm: 'claude', command: 'claude --print x', runId: null, envReadable: false }),
    ]);
    expect(await h.supervisor.activeRuns()).toEqual([
      { pid: 10, runId: 'run-1', worktree: '/Users/u/crew-agents/a-10', startedAt: 1000, children: 1 },
    ]);
  });
});

function baseDeps(): SupervisorDeps {
  return {
    sshdConfig: CFG,
    readPidFile: () => null,
    procInfo: async () => null,
    spawnSshd: () => new FakeChild(900),
    signal: () => undefined,
    readOwner: () => 'app',
    watchManifest: () => () => undefined,
    sleep: async () => undefined,
    now: () => 0,
    listProcesses: async () => [],
    readCwds: async () => new Map(),
    store: { update: async (fn) => fn(defaultAppState('0.1.0')) },
  };
}

describe('describeExit', () => {
  it('lỗi spawn dùng mô tả cổng bị chiếm và vẫn backoff', async () => {
    const children: FakeChild[] = [];
    const sleeps: number[] = [];
    const sup = createSshdSupervisor({
      ...baseDeps(),
      spawnSshd: () => {
        const child = new FakeChild(900 + children.length);
        children.push(child);
        return child;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      describeExit: async () => 'Cổng 2222 đang bị chiếm: sshd 123',
    });
    await sup.start();
    children[0]?.exit({ code: 255, signal: null });
    await flush();
    expect(sup.status().lastError).toBe('Cổng 2222 đang bị chiếm: sshd 123');
    expect(sleeps).toEqual([1000]);
    expect(children).toHaveLength(2);
  });

  it('pause trong lúc đang backoff thì không sinh lại', async () => {
    const children: FakeChild[] = [];
    let release: () => void = () => undefined;
    const sup = createSshdSupervisor({
      ...baseDeps(),
      spawnSshd: () => {
        const child = new FakeChild(900 + children.length);
        children.push(child);
        return child;
      },
      sleep: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    await sup.start();
    children[0]?.exit({ code: 1, signal: null });
    await flush();
    expect(sup.status().state).toBe('backoff');
    await sup.pause();
    release();
    await flush();
    expect(children).toHaveLength(1);
    expect(sup.status().state).toBe('paused');
  });
});
