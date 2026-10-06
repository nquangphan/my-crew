import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { reapOnce, vnTime } from '../src/reaper/reap.js';
import { createRunner } from '../src/system.js';
import { FakeRunner } from './helpers/fake-runner.js';

const RUN = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-06T07:05:00.000Z');
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

// Cột: pid ppid pgid tty etime comm. 80000/80001/80002 là phiên đã mất SSH của run; 80100 là tool đã thoát ra
// ngoài (cha là launchd); 80200 là Terminal của owner mở trong cùng worktree.
const TREE = [
  '    1     0     1 ??       10-00:00:00 /sbin/launchd',
  '80000     1 80000 ??             04:00 zsh',
  '80001 80000 80000 ??             03:59 claude',
  '80002 80001 80000 ??             03:00 git',
  '80100     1 80100 ??             02:00 sleep',
  '80200 80199 80200 ttys003       01:00 -zsh',
].join('\n');
const ARGV = ['80001 claude --print', '80002 git status', '80100 sleep 300', '80200 -zsh'].join('\n');
const ENV = [
  `80001 claude --print PAPERCLIP_RUN_ID=${RUN}`,
  '80002 git status',
  '80100 sleep 300',
  '80200 -zsh',
].join('\n');
const ONLY_LAUNCHD = '    1     0     1 ??       10-00:00:00 /sbin/launchd';
const CLAUDE_STUCK = [ONLY_LAUNCHD, '80001 80000 80000 ??             03:59 claude'].join('\n');

function worktree(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'crew-mac-reaper-root-')));
  const runDir = join(root, '.paperclip-runtime', 'runs', RUN);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'started'), `${NOW_SEC - 240}\n`);
  writeFileSync(join(runDir, 'pgid'), '80000\n');
  return root;
}

function setupDeps(trees: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'crew-mac-reaper-'));
  const root = worktree();
  let treeCall = 0;
  const runner = new FakeRunner()
    .on('/bin/ps', (args) => {
      if (args.includes('-E')) return { stdout: ENV };
      if (args.includes('pid=,command=')) return { stdout: ARGV };
      const tree = trees[Math.min(treeCall, trees.length - 1)] as string;
      treeCall++;
      return { stdout: tree };
    })
    .on('/usr/sbin/lsof', (args) => ({
      stdout: String(args.at(-1))
        .split(',')
        .map((pid) => `p${pid}\nfcwd\nn${root}\n`)
        .join(''),
    }));
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
    now: () => NOW,
    selfPid: 999,
  };
  const options = {
    graceMs: 60_000,
    termWaitMs: 10_000,
    dryRun: false,
    statePath: join(dir, 'state.json'),
    logPath: join(dir, 'reaper.log'),
    worktreeRoot: realpathSync(tmpdir()) as string | null,
    home: '/Users/khong-phai-home',
  };
  return { deps, options, signals, sleeps, dir, root, runner };
}

const due = (t: ReturnType<typeof setupDeps>) =>
  writeFileSync(
    t.options.statePath,
    JSON.stringify({ orphanSince: { [`80001:${RUN}`]: '2026-10-06T07:00:00.000Z' } }),
  );

describe('reapOnce', () => {
  it('lần đầu chỉ ghi nhận, không gửi signal, không hỏi cwd', async () => {
    const t = setupDeps([TREE]);
    expect(await reapOnce(t.deps, t.options)).toEqual([]);
    expect(t.signals).toEqual([]);
    expect(t.runner.commands().some((c) => c.includes('lsof'))).toBe(false);
    expect(JSON.parse(readFileSync(t.options.statePath, 'utf8'))).toEqual({
      orphanSince: { [`80001:${RUN}`]: '2026-10-06T07:05:00.000Z' },
    });
  });

  it('quá hạn: dọn claude, con cháu, zsh của phiên và tool mồ côi trong worktree; không đụng Terminal của owner', async () => {
    const t = setupDeps([TREE, ONLY_LAUNCHD]);
    due(t);
    const targets = await reapOnce(t.deps, t.options);
    expect(targets).toEqual([
      {
        pid: 80001,
        runId: RUN,
        orphanSince: '2026-10-06T07:00:00.000Z',
        root: t.root,
        members: [80000, 80001, 80002, 80100],
        result: { matched: 4, killed: 0, remaining: 0 },
      },
    ]);
    expect(t.signals).toEqual(['SIGTERM -80000', 'SIGTERM -80100']);
    expect(t.signals.some((s) => s.includes('80200'))).toBe(false);
    expect(t.sleeps).toEqual([10_000]);
    const log = readFileSync(t.options.logPath, 'utf8');
    expect(log).toContain(
      `2026-10-06 14:05:00 TERM run=${RUN} pid=80001 root=${t.root} pids=80000,80001,80002,80100`,
    );
    expect(log).toContain('matched=4 killed=0 remaining=0');
    expect(JSON.parse(readFileSync(t.options.statePath, 'utf8'))).toEqual({ orphanSince: {} });
  });

  it('process còn sống sau TERM thì KILL theo group đã nhận TERM', async () => {
    const t = setupDeps([TREE, CLAUDE_STUCK, ONLY_LAUNCHD]);
    due(t);
    const [target] = await reapOnce(t.deps, t.options);
    expect(t.signals).toEqual(['SIGTERM -80000', 'SIGTERM -80100', 'SIGKILL -80000']);
    expect(target?.result).toEqual({ matched: 4, killed: 1, remaining: 0 });
  });

  it('worktree của claude nằm ngoài thư mục worktree đã cài thì chỉ dọn con cháu của claude', async () => {
    const t = setupDeps([TREE, ONLY_LAUNCHD]);
    due(t);
    const [target] = await reapOnce(t.deps, { ...t.options, worktreeRoot: '/Users/owner/crew-agents' });
    expect(target?.members).toEqual([80001, 80002]);
    expect(t.signals.some((s) => s.includes('80100') || s.includes('80000'))).toBe(false);
  });

  it('chưa có manifest (không biết thư mục worktree) thì chỉ dọn con cháu của claude', async () => {
    const t = setupDeps([TREE, ONLY_LAUNCHD]);
    due(t);
    const [target] = await reapOnce(t.deps, { ...t.options, worktreeRoot: null });
    expect(target?.members).toEqual([80001, 80002]);
  });

  it('dry-run không gửi signal', async () => {
    const t = setupDeps([TREE]);
    due(t);
    await reapOnce(t.deps, { ...t.options, dryRun: true });
    expect(t.signals).toEqual([]);
    expect(readFileSync(t.options.logPath, 'utf8')).toContain(`SẼ DỌN run=${RUN}`);
  });

  it('state hỏng thì coi như rỗng', async () => {
    const t = setupDeps([TREE]);
    writeFileSync(t.options.statePath, '{hỏng');
    expect(await reapOnce(t.deps, t.options)).toEqual([]);
  });

  it.skipIf(process.platform !== 'darwin')(
    'trên macOS thật: ps -E, lsof và file started cho ra đúng claude mồ côi cùng worktree (dry-run)',
    async () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crew-mac-reaper-real-')));
      // Đặt tên "claude" cho node để argv[0] giống agent thật; không có sshd trong chuỗi cha nên tính là mồ côi.
      symlinkSync(process.execPath, join(dir, 'claude'));
      const runId = `run-real-${process.pid}`;
      mkdirSync(join(dir, '.paperclip-runtime', 'runs', runId), { recursive: true });
      writeFileSync(
        join(dir, '.paperclip-runtime', 'runs', runId, 'started'),
        `${Math.floor(Date.now() / 1000) - 2}\n`,
      );
      const child = spawn(join(dir, 'claude'), ['-e', 'setInterval(() => {}, 1000)', '--', '--print'], {
        cwd: dir,
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
            worktreeRoot: realpathSync(tmpdir()),
            home: '/Users/khong-phai-home',
          },
        );
        const mine = targets.find((x) => x.runId === runId);
        expect(mine?.pid).toBe(child.pid);
        expect(mine?.root).toBe(dir);
        expect(mine?.members).toContain(child.pid);
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
