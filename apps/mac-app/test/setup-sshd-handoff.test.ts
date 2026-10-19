import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AppStateStore } from '../src/main/app-state.js';
import type { FullDiskAccessState } from '../src/main/setup/disk-access.js';
import { handoffSshd, listenerPids, type SshdHandoffDeps } from '../src/main/setup/sshd-handoff.js';
import type { SupervisorState } from '../src/main/sshd/supervisor.js';

type Status = { state: SupervisorState; pid: number | null; restarts: number; lastError: string | null };

function harness(opts: {
  owner?: 'app' | 'launchd';
  runs?: number;
  status?: () => Status;
  listener?: () => number[];
  setup?: (opt: Record<string, unknown>) => Promise<unknown>;
  diskAccess?: FullDiskAccessState;
}) {
  let clock = 0;
  const setupCalls: Array<Record<string, unknown>> = [];
  const dir = mkdtempSync(join(tmpdir(), 'handoff-'));
  const store = new AppStateStore(join(dir, 'app.json'), '0.1.0');
  const order: string[] = [];
  const supervisor = {
    start: vi.fn(async () => undefined),
    pause: vi.fn(async () => {
      order.push('pause');
    }),
    status: opts.status ?? (() => ({ state: 'running', pid: 777, restarts: 0, lastError: null })),
    activeRuns: async () =>
      Array.from({ length: opts.runs ?? 0 }, (_, i) => ({ pid: i, runId: `r${i}` })) as never,
  };
  const deps: SshdHandoffDeps = {
    ops: {
      call: (async (op: string, arg: Record<string, unknown>) => {
        expect(op).toBe('setup');
        setupCalls.push(arg);
        order.push(`setup:${String(arg.sshdOwner)}`);
        return opts.setup ? opts.setup(arg) : { sshdHandoff: arg.sshdOwner };
      }) as never,
    },
    supervisor,
    store,
    diskAccess: () => opts.diskAccess ?? 'granted',
    readOwner: () => opts.owner ?? 'launchd',
    port: () => 2222,
    listenerPids: async () => (opts.listener ? opts.listener() : [777]),
    readLogTail: (lines) => `đuôi ${lines} dòng sshd.log`,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, setupCalls, supervisor, store, order };
}

describe('handoffSshd', () => {
  it.each(['denied', 'unknown'] as const)(
    'Full Disk Access %s thì từ chối, không gọi setup và không start supervisor',
    async (diskAccess) => {
      const { deps, setupCalls, supervisor } = harness({ diskAccess });
      const result = await handoffSshd(deps);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Quyền ổ đĩa');
      expect(setupCalls).toHaveLength(0);
      expect(supervisor.start).not.toHaveBeenCalled();
    },
  );

  it('tự lui thì dừng supervisor trước khi setup launchd', async () => {
    const { deps, order } = harness({
      status: () => ({ state: 'backoff', pid: null, restarts: 1, lastError: 'x' }),
    });
    await handoffSshd(deps);
    expect(order).toEqual(['setup:app', 'pause', 'setup:launchd']);
  });

  it('pause lỗi thì vẫn tự lui về launchd', async () => {
    const { deps, setupCalls, supervisor } = harness({
      status: () => ({ state: 'backoff', pid: null, restarts: 1, lastError: 'x' }),
    });
    supervisor.pause.mockRejectedValueOnce(new Error('kẹt'));
    await handoffSshd(deps);
    expect(setupCalls.at(-1)).toEqual({ sshdOwner: 'launchd', force: true });
  });

  it('còn run đang chạy thì từ chối, không gọi setup', async () => {
    const { deps, setupCalls } = harness({ runs: 1 });
    expect(await handoffSshd(deps)).toEqual({
      ok: false,
      message: 'Có 1 run đang chạy; chờ run xong rồi chuyển.',
    });
    expect(setupCalls).toHaveLength(0);
  });

  it('bình thường: setup app, start supervisor, chờ listener đúng pid thì ok', async () => {
    let polls = 0;
    const { deps, setupCalls, supervisor } = harness({
      status: () =>
        ++polls < 3
          ? { state: 'starting', pid: null, restarts: 0, lastError: null }
          : { state: 'running', pid: 777, restarts: 0, lastError: null },
    });
    const result = await handoffSshd(deps);
    expect(result.ok).toBe(true);
    expect(setupCalls).toEqual([{ sshdOwner: 'app' }]);
    expect(supervisor.start).toHaveBeenCalledTimes(1);
  });

  it('listener không lên trong 15 giây thì tự lui về launchd, báo lastError và 20 dòng log', async () => {
    const { deps, setupCalls, store } = harness({
      status: () => ({
        state: 'backoff',
        pid: null,
        restarts: 3,
        lastError: 'Cổng 2222 đang bị chiếm: sshd 16059',
      }),
      listener: () => [],
    });
    const result = await handoffSshd(deps);
    expect(result.ok).toBe(false);
    expect(setupCalls).toEqual([{ sshdOwner: 'app' }, { sshdOwner: 'launchd', force: true }]);
    expect(result.message).toContain('Cổng 2222 đang bị chiếm: sshd 16059');
    expect(result.message).toContain('đuôi 20 dòng sshd.log');
    expect(result.message).toContain('LaunchAgent');
    expect(store.get().sshdOwner).toBe('launchd');
    expect(store.get().sshdPid).toBeNull();
  });

  it('supervisor báo running nhưng cổng có chủ khác (hoặc hai chủ) cũng bị coi là chưa lên', async () => {
    const { deps, setupCalls } = harness({ listener: () => [777, 16059] });
    const result = await handoffSshd(deps);
    expect(result.ok).toBe(false);
    expect(setupCalls.at(-1)).toEqual({ sshdOwner: 'launchd', force: true });
  });

  it('setup sang app ném lỗi thì cũng tự lui, báo cả hai lỗi nếu lui hỏng', async () => {
    const { deps, setupCalls } = harness({
      setup: async (opt) => {
        throw new Error(opt.sshdOwner === 'app' ? 'bootout hỏng' : 'launchctl hỏng');
      },
    });
    const result = await handoffSshd(deps);
    expect(result.ok).toBe(false);
    expect(setupCalls).toHaveLength(2);
    expect(result.message).toContain('bootout hỏng');
    expect(result.message).toContain('launchctl hỏng');
    expect(result.message).toContain('crew-mac setup --sshd-owner launchd');
  });

  it('đã ở chế độ app và listener đang chạy thì ok, không gọi setup', async () => {
    const { deps, setupCalls } = harness({ owner: 'app', runs: 2 });
    const result = await handoffSshd(deps);
    expect(result.ok).toBe(true);
    expect(setupCalls).toHaveLength(0);
  });
});

describe('listenerPids', () => {
  it('đọc pid từ lsof -t, bỏ dòng rác', async () => {
    const runner = {
      calls: [] as string[],
      async run(command: string, args: readonly string[]) {
        this.calls.push([command, ...args].join(' '));
        return { code: 0, stdout: '777\n\n16059\nabc\n', stderr: '', timedOut: false };
      },
    };
    expect(await listenerPids(runner, 2222)).toEqual([777, 16059]);
    expect(runner.calls).toEqual(['/usr/sbin/lsof -nP -iTCP:2222 -sTCP:LISTEN -t']);
  });
  it('lsof không thấy gì (mã 1) thì rỗng', async () => {
    const runner = { run: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false }) };
    expect(await listenerPids(runner, 2222)).toEqual([]);
  });
});
