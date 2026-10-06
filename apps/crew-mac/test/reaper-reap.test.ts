import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { reapOnce, vnTime } from '../src/reaper/reap.js';
import { createRunner } from '../src/system.js';
import { FakeRunner } from './helpers/fake-runner.js';

const TREE = [
  '    1     0     1 /sbin/launchd',
  '80000     1 80000 zsh',
  '80001 80000 80000 claude',
  '80002 80001 80000 git',
].join('\n');
const ENV = ['80001 claude --print PAPERCLIP_RUN_ID=run-dead', '80002 git status'].join('\n');
const TREE_AFTER_TERM = ['    1     0     1 /sbin/launchd', '80001     1 80000 claude'].join('\n');

// Group 80000 có thêm một phiên claude tương tác không mang run id: không được gửi signal cho cả group.
const TREE_SHARED = `${TREE}\n80009 80000 80000 claude`;
const ENV_SHARED = `${ENV}\n80009 claude --resume abc HOME=/Users/owner`;
const TREE_SHARED_AFTER = [
  '    1     0     1 /sbin/launchd',
  '80001     1 80000 claude',
  '80009     1 80000 claude',
].join('\n');

function setupDeps(trees: string[], env = ENV) {
  const dir = mkdtempSync(join(tmpdir(), 'crew-mac-reaper-'));
  let treeCall = 0;
  const runner = new FakeRunner().on('/bin/ps', (args) => {
    if (args.includes('-E')) return { stdout: env };
    const tree = trees[Math.min(treeCall, trees.length - 1)] as string;
    treeCall++;
    return { stdout: tree };
  });
  const signals: string[] = [];
  const sleeps: number[] = [];
  const deps = {
    runner,
    signal: (pid: number, sig: 'SIGTERM' | 'SIGKILL') => {
      signals.push(`${sig} ${pid}`);
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    now: () => new Date('2026-10-06T07:05:00.000Z'),
    selfPid: 999,
  };
  const options = {
    graceMs: 60_000,
    termWaitMs: 10_000,
    dryRun: false,
    statePath: join(dir, 'state.json'),
    logPath: join(dir, 'reaper.log'),
  };
  return { deps, options, signals, sleeps, dir };
}

describe('reapOnce', () => {
  it('lần đầu chỉ ghi nhận, không gửi signal', async () => {
    const t = setupDeps([TREE]);
    expect(await reapOnce(t.deps, t.options)).toEqual([]);
    expect(t.signals).toEqual([]);
    expect(JSON.parse(readFileSync(t.options.statePath, 'utf8'))).toEqual({
      orphanSince: { '80001:run-dead': '2026-10-06T07:05:00.000Z' },
    });
  });

  it('quá hạn: TERM cả process group, chờ, KILL group nếu còn sống, ghi log giờ Việt Nam', async () => {
    const t = setupDeps([TREE, TREE_AFTER_TERM]);
    writeFileSync(
      t.options.statePath,
      JSON.stringify({ orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } }),
    );
    const targets = await reapOnce(t.deps, t.options);
    expect(targets.map((x) => x.pid)).toEqual([80001]);
    expect(t.signals).toEqual(['SIGTERM -80000', 'SIGKILL -80000']);
    expect(t.sleeps).toEqual([10_000]);
    const log = readFileSync(t.options.logPath, 'utf8');
    expect(log).toContain('2026-10-06 14:05:00 TERM run=run-dead pid=80001 pgid=80000 pids=80001,80002');
    expect(log).toContain('KILL run=run-dead pids=80001');
    expect(JSON.parse(readFileSync(t.options.statePath, 'utf8'))).toEqual({ orphanSince: {} });
  });

  it('group lẫn phiên claude tương tác thì chỉ gửi signal từng pid của run, không đụng phiên đó', async () => {
    const t = setupDeps([TREE_SHARED, TREE_SHARED_AFTER], ENV_SHARED);
    writeFileSync(
      t.options.statePath,
      JSON.stringify({ orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } }),
    );
    await reapOnce(t.deps, t.options);
    expect(t.signals).toEqual(['SIGTERM 80001', 'SIGTERM 80002', 'SIGKILL 80001']);
    expect(t.signals.some((s) => s.includes('80009') || s.includes('-80000'))).toBe(false);
  });

  it('dry-run không gửi signal', async () => {
    const t = setupDeps([TREE]);
    writeFileSync(
      t.options.statePath,
      JSON.stringify({ orphanSince: { '80001:run-dead': '2026-10-06T07:00:00.000Z' } }),
    );
    await reapOnce(t.deps, { ...t.options, dryRun: true });
    expect(t.signals).toEqual([]);
    expect(readFileSync(t.options.logPath, 'utf8')).toContain('SẼ DỌN run=run-dead');
  });

  it('state hỏng thì coi như rỗng', async () => {
    const t = setupDeps([TREE]);
    writeFileSync(t.options.statePath, '{hỏng');
    expect(await reapOnce(t.deps, t.options)).toEqual([]);
  });

  it.skipIf(process.platform !== 'darwin')(
    'trên macOS thật: ps -E đọc được run id và chọn đúng process claude --print mồ côi (dry-run)',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'crew-mac-reaper-real-'));
      // Đặt tên "claude" cho node để argv[0] giống agent thật; không có sshd trong chuỗi cha nên tính là mồ côi.
      symlinkSync(process.execPath, join(dir, 'claude'));
      const runId = `run-real-${process.pid}`;
      const child = spawn(join(dir, 'claude'), ['-e', 'setInterval(() => {}, 1000)', '--', '--print'], {
        env: { ...process.env, PAPERCLIP_RUN_ID: runId },
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      try {
        await sleep(500);
        const signals: string[] = [];
        const targets = await reapOnce(
          {
            runner: createRunner(),
            signal: (pid, sig) => {
              signals.push(`${sig} ${pid}`);
            },
            sleep: async () => {},
            now: () => new Date(),
            selfPid: process.pid,
          },
          {
            graceMs: 0,
            termWaitMs: 0,
            dryRun: true,
            statePath: join(dir, 'state.json'),
            logPath: join(dir, 'reaper.log'),
          },
        );
        const mine = targets.find((x) => x.runId === runId);
        expect(mine?.pid).toBe(child.pid);
        expect(signals).toEqual([]);
      } finally {
        process.kill(child.pid as number, 'SIGKILL');
      }
    },
  );

  it('vnTime theo Asia/Ho_Chi_Minh', () => {
    expect(vnTime(new Date('2026-10-06T17:30:00.000Z'))).toBe('2026-10-07 00:30:00');
  });
});
