import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { setup } from '../src/commands/setup.js';
import { formatStopLine, StopRunInputError, stopRun } from '../src/commands/stop-run.js';
import { createRunner } from '../src/system.js';
import { fakeMac, PAPERCLIP_PUB } from './helpers/fake-mac.js';
import { FakeRunner } from './helpers/fake-runner.js';

const RUN = '11111111-2222-4333-8444-555555555555';
const RUN_B = '99999999-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-06T07:05:00.000Z');
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const ONLY_LAUNCHD = '    1     0     1 ??       10-00:00:00 /sbin/launchd';
// Mọi worktree thử nằm trong thư mục tạm; HOME giả nằm ngoài nó.
const TMP = realpathSync(tmpdir());
const GUARD = { allowedRoot: TMP, home: '/Users/khong-phai-home' };

function worktree(runs: Record<string, { started: number; pgid?: number }>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'crew-stop-root-')));
  for (const [id, meta] of Object.entries(runs)) {
    const dir = join(root, '.paperclip-runtime', 'runs', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'started'), `${meta.started}\n`);
    if (meta.pgid !== undefined) writeFileSync(join(dir, 'pgid'), `${meta.pgid}\n`);
  }
  return root;
}

function harness(root: string, trees: string[], argv: string, env: string) {
  let call = 0;
  const runner = new FakeRunner()
    .on('/bin/ps', (args) => {
      if (args.includes('-E')) return { stdout: env };
      if (args.includes('pid=,command=')) return { stdout: argv };
      const tree = trees[Math.min(call, trees.length - 1)] as string;
      call++;
      return { stdout: tree };
    })
    .on('/usr/sbin/lsof', (args) => ({
      stdout: String(args.at(-1))
        .split(',')
        .map((pid) => `p${pid}\nfcwd\nn${root}\n`)
        .join(''),
    }));
  const signals: string[] = [];
  const deps = {
    runner,
    signal: (pid: number, sig: 'SIGTERM' | 'SIGKILL') => {
      signals.push(`${sig} ${pid}`);
    },
    sleep: async () => {},
    now: () => NOW,
    selfPid: 999,
  };
  return { deps, runner, signals };
}

// 600: zsh của phiên SSH (group wrapper ghi); 601: claude của run A; 610/611: Bash tool trong session riêng;
// 700: tool A đã thoát ra ngoài; 800: tool của run B sinh sau khi run B bắt đầu; 900: Terminal của owner.
const TREE = [
  ONLY_LAUNCHD,
  '  501     1   501 ??             05:00 sshd-session: owner@notty',
  '  600   501   600 ??             04:00 zsh',
  '  601   600   600 ??             03:59 claude',
  '  610   601   610 ??             03:00 zsh',
  '  611   610   610 ??             02:59 make',
  '  700     1   610 ??             02:30 sleep',
  '  800     1   800 ??             00:30 sleep',
  '  900   899   900 ttys003       01:00 -zsh',
].join('\n');
const ARGV = [
  '601 claude --print',
  '610 /bin/zsh -c make',
  '611 make',
  '700 sleep 300',
  '800 sleep 300',
  '900 -zsh',
].join('\n');
const ENV = ARGV.replace('601 claude --print', `601 claude --print PAPERCLIP_RUN_ID=${RUN} HOME=/h`);

describe('stopRun', () => {
  it('dừng claude, Bash tool trong session riêng, zsh của phiên và tool mồ côi; không đụng run B hay Terminal', async () => {
    const root = worktree({
      [RUN]: { started: NOW_SEC - 240, pgid: 600 },
      [RUN_B]: { started: NOW_SEC - 60 },
    });
    const h = harness(root, [TREE, ONLY_LAUNCHD], ARGV, ENV);
    const result = await stopRun(h.deps, { runId: RUN, root, termWaitMs: 1_000, ...GUARD });
    expect(result).toMatchObject({ matched: 5, killed: 0, remaining: 0, members: [600, 601, 610, 611, 700] });
    for (const untouched of ['800', '900']) expect(h.signals.some((s) => s.includes(untouched))).toBe(false);
    expect(existsSync(join(root, '.paperclip-runtime', 'runs', RUN))).toBe(false);
    expect(existsSync(join(root, '.paperclip-runtime', 'runs', RUN_B))).toBe(true);
    expect(formatStopLine(result)).toBe('crew-stop matched=5 killed=0 remaining=0');
  });

  it('còn process sau KILL thì giữ thư mục run', async () => {
    const root = worktree({ [RUN]: { started: NOW_SEC - 240, pgid: 600 } });
    const stuck = [ONLY_LAUNCHD, '  601   600   600 ??             03:59 claude'].join('\n');
    const h = harness(root, [TREE, stuck, stuck], ARGV, ENV);
    const result = await stopRun(h.deps, { runId: RUN, root, termWaitMs: 1_000, ...GUARD });
    // Không có run B nên tool 800 (sinh sau run A, cwd trong worktree) cũng thuộc run A.
    expect(result).toMatchObject({ matched: 6, killed: 1, remaining: 1 });
    expect(existsSync(join(root, '.paperclip-runtime', 'runs', RUN))).toBe(true);
  });

  it('worktree hay file run không có: chỉ còn con cháu của claude, không lỗi', async () => {
    const missing = join(TMP, `chua-co-worktree-${process.pid}`);
    const h = harness(missing, [TREE, ONLY_LAUNCHD], ARGV, ENV);
    const result = await stopRun(h.deps, { runId: RUN, root: missing, termWaitMs: 1_000, ...GUARD });
    expect(result).toMatchObject({ matched: 3, members: [601, 610, 611] });
    expect(h.runner.commands().some((c) => c.includes('lsof'))).toBe(false);
  });

  it.each([
    ['/', 'gốc ổ đĩa'],
    [join(TMP, 'home-gia'), 'HOME'],
    [TMP, 'tổ tiên của HOME'],
    ['/Users/owner/khac', 'ngoài thư mục worktree'],
  ])('root %s bị từ chối (%s)', async (root) => {
    const h = harness(root, [TREE], ARGV, ENV);
    await expect(
      stopRun(h.deps, { runId: RUN, root, termWaitMs: 0, allowedRoot: TMP, home: join(TMP, 'home-gia') }),
    ).rejects.toThrow(StopRunInputError);
    expect(h.signals).toEqual([]);
  });

  it('runId không phải UUID thì từ chối', async () => {
    const root = worktree({});
    const h = harness(root, [TREE], ARGV, ENV);
    await expect(stopRun(h.deps, { runId: '../../x', root, termWaitMs: 0, ...GUARD })).rejects.toThrow(
      StopRunInputError,
    );
  });

  it('.paperclip-runtime là symlink thì không xóa gì', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'crew-stop-root-')));
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'crew-stop-elsewhere-')));
    mkdirSync(join(elsewhere, 'runs', RUN), { recursive: true });
    writeFileSync(join(elsewhere, 'runs', RUN, 'started'), `${NOW_SEC - 240}\n`);
    symlinkSync(elsewhere, join(root, '.paperclip-runtime'));
    const h = harness(root, [TREE, ONLY_LAUNCHD], ARGV, ENV);
    const result = await stopRun(h.deps, { runId: RUN, root, termWaitMs: 0, ...GUARD });
    expect(result.remaining).toBe(0);
    expect(existsSync(join(elsewhere, 'runs', RUN))).toBe(true);
  });

  it('máy nhiều process: một lần gọi lsof cho đúng ứng viên và xong dưới 8 giây', async () => {
    const root = worktree({ [RUN]: { started: NOW_SEC - 240, pgid: 600 } });
    const noise: string[] = [];
    // 6000 process khác: một nửa có tty, một nửa sinh trước run; vài chục ứng viên thật.
    for (let i = 0; i < 6_000; i++) {
      const pid = 20_000 + i;
      noise.push(
        i % 2 === 0
          ? `${pid}     1 ${pid} ttys00${i % 9}       00:10 node`
          : `${pid}     1 ${pid} ??          2-00:00:00 Helper`,
      );
    }
    for (let i = 0; i < 40; i++) noise.push(`${30_000 + i}     1 ${30_000 + i} ??             00:20 node`);
    const tree = [TREE, ...noise].join('\n');
    const h = harness(root, [tree, ONLY_LAUNCHD], ARGV, ENV);
    const started = Date.now();
    await stopRun(h.deps, { runId: RUN, root, termWaitMs: 0, ...GUARD });
    expect(Date.now() - started).toBeLessThan(8_000);
    const lsof = h.runner.calls.filter((c) => c.command === '/usr/sbin/lsof');
    expect(lsof).toHaveLength(1);
    expect(String(lsof[0]?.args.at(-1)).split(',')).toHaveLength(3 + 40);
  });

  it.skipIf(process.platform !== 'darwin')(
    'trên macOS thật: dừng claude và tool đã tách session lẫn tool mồ côi trong worktree',
    async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'crew-stop-real-')));
      const bin = realpathSync(mkdtempSync(join(tmpdir(), 'crew-stop-bin-')));
      symlinkSync(process.execPath, join(bin, 'claude'));
      const runId = `aaaaaaaa-bbbb-4ccc-8ddd-${String(process.pid).padStart(12, '0')}`;
      const runDir = join(root, '.paperclip-runtime', 'runs', runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'started'), `${Math.floor(Date.now() / 1000) - 1}\n`);
      const marker = 3_000 + (process.pid % 997);
      // claude giả: một tool trong session riêng (con của claude) và một tool mồ côi (cha thoát ngay).
      const script = [
        "const { spawn } = require('node:child_process');",
        `spawn('perl', ['-e', 'use POSIX; POSIX::setsid(); exec @ARGV', 'sleep', '${marker}'], { detached: true, stdio: 'ignore' });`,
        `spawn('/bin/sh', ['-c', 'perl -e "use POSIX; POSIX::setsid(); exec @ARGV" sleep ${marker + 1} & exit 0'], { detached: true, stdio: 'ignore' });`,
        'setInterval(() => {}, 1000);',
      ].join('\n');
      const child = spawn(join(bin, 'claude'), ['-e', script, '--', '--print'], {
        cwd: root,
        env: { ...process.env, PAPERCLIP_RUN_ID: runId },
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      const alive = (pattern: string) =>
        spawnSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' })
          .stdout.split('\n')
          .some((line) => line.trim() === pattern);
      try {
        await sleep(1_000);
        expect(alive(`sleep ${marker}`)).toBe(true);
        expect(alive(`sleep ${marker + 1}`)).toBe(true);
        const result = await stopRun(
          {
            runner: createRunner(),
            signal: (pid, sig) => process.kill(pid, sig),
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            now: () => new Date(),
            selfPid: process.pid,
          },
          { runId, root, termWaitMs: 1_000, ...GUARD },
        );
        expect(result.remaining).toBe(0);
        expect(result.matched).toBeGreaterThanOrEqual(3);
        await sleep(300);
        expect(alive(`sleep ${marker}`)).toBe(false);
        expect(alive(`sleep ${marker + 1}`)).toBe(false);
        expect(existsSync(runDir)).toBe(false);
      } finally {
        try {
          process.kill(child.pid as number, 'SIGKILL');
        } catch {}
      }
    },
    20_000,
  );
});

describe('crew-mac stop-run', () => {
  function io(env: NodeJS.ProcessEnv = {}, mac = fakeMac()) {
    mac.runner.on('/bin/ps', () => ({ stdout: `${ONLY_LAUNCHD}\n` }));
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env, context: mac.ctx },
    };
  }

  it('in đúng một dòng kết quả và thoát 0', async () => {
    const mac = fakeMac();
    await setup(mac.ctx, { paperclipKey: PAPERCLIP_PUB });
    const t = io({}, mac);
    const root = join(mac.home, 'crew-agents', 'repo-a');
    expect(await main(['stop-run', '--run-id', RUN, '--root', root], t.io)).toBe(0);
    expect(t.out).toEqual(['crew-stop matched=0 killed=0 remaining=0']);
  });

  it('root ngoài thư mục worktree đã cài thì thoát 2', async () => {
    const mac = fakeMac();
    await setup(mac.ctx, { paperclipKey: PAPERCLIP_PUB });
    for (const root of [mac.home, '/', join(mac.home, 'Documents')]) {
      const t = io({}, mac);
      expect(await main(['stop-run', '--run-id', RUN, '--root', root], t.io)).toBe(2);
      expect(t.out).toEqual([]);
    }
  });

  it('chưa chạy crew-mac setup thì thoát 2', async () => {
    const t = io();
    expect(await main(['stop-run', '--run-id', RUN, '--root', '/Users/owner/crew-agents/repo-a'], t.io)).toBe(
      2,
    );
    expect(t.err.join('\n')).toContain('setup');
  });

  it.each([
    [['stop-run', '--run-id', 'khong-phai-uuid', '--root', '/a']],
    [['stop-run', '--run-id', RUN, '--root', 'tuong/doi']],
    [['stop-run', '--root', '/a']],
    [['stop-run', '--run-id', RUN]],
    [['stop-run', '--run-id', RUN, '--root', '/a', '--term-wait-seconds', '-1']],
    [['stop-run', '--run-id', RUN, '--root', '/a', '--term-wait-seconds', '99']],
  ])('đầu vào sai %j thì thoát 2, không in dòng kết quả', async (argv) => {
    const t = io();
    expect(await main(argv, t.io)).toBe(2);
    expect(t.out).toEqual([]);
  });
});
