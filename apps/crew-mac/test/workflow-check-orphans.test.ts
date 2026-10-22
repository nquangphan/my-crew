import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { orphanCheck } from '../src/commands/workflow-check.js';
import { createRunner } from '../src/system.js';
import { installSuperpowersPin } from '../src/workflows/install.js';
import { fakeMac } from './helpers/fake-mac.js';
import { FakeRunner } from './helpers/fake-runner.js';

const RUN = '11111111-2222-4333-8444-555555555555';
const NOW_SEC = 1_791_000_600;
const START = NOW_SEC - 300;
const NOW = new Date(NOW_SEC * 1000);
const BOOT = START - 86_400;

interface Row {
  pid: number;
  ppid: number;
  pgid: number;
  tty?: string;
  startedAt?: number;
  command: string;
  runId?: string;
  cwd?: string;
}

/** Thư mục tạm test này tạo (worktree giả, HOME của fakeMac); xóa sau mỗi test. */
const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Worktree tạm có marker `started`/`pgid` của run như wrapper `crew-claude-run` ghi. */
function runRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'crew-orphans-')));
  created.push(root);
  const dir = join(root, '.paperclip-runtime', 'runs', RUN);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'started'), `${START}\n`);
  writeFileSync(join(dir, 'pgid'), '600\n');
  return root;
}

function etime(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** Runner giả trả bảng `ps`/`lsof`/`sysctl` theo các dòng mô phỏng; không spawn process thật. */
function runnerFor(rows: readonly Row[]): FakeRunner {
  const exe = (r: Row) => r.command.split(/\s+/)[0]?.split('/').pop() ?? 'x';
  return new FakeRunner()
    .on('/bin/ps', (args) => {
      if (args.includes('-E'))
        return {
          stdout: rows
            .map((r) => `${r.pid} ${r.command}${r.runId ? ` PAPERCLIP_RUN_ID=${r.runId}` : ''} HOME=/h`)
            .join('\n'),
        };
      if (args.includes('pid=,command='))
        return { stdout: rows.map((r) => `${r.pid} ${r.command}`).join('\n') };
      return {
        stdout: rows
          .map(
            (r) =>
              `${r.pid} ${r.ppid} ${r.pgid} ${r.tty ?? '??'} ${etime(NOW_SEC - (r.startedAt ?? START + 10))} ${exe(r)}`,
          )
          .join('\n'),
      };
    })
    .on('/usr/sbin/lsof', (args) => {
      const asked = new Set((args[args.length - 1] ?? '').split(',').map(Number));
      return {
        stdout: rows
          .filter((r) => asked.has(r.pid) && r.cwd !== undefined)
          .map((r) => `p${r.pid}\nn${r.cwd}`)
          .join('\n'),
      };
    })
    .on('/usr/sbin/sysctl', () => ({ stdout: `{ sec = ${BOOT}, usec = 0 } Thu Oct  1 00:00:00 2026\n` }));
}

/**
 * Run đang báo xong: wrapper (600) → claude --print (601) → zsh của Bash tool (610) → crew-mac workflow-check (self)
 * → ps đang quét (self+1). Wrapper và sshd của phiên SSH Paperclip ở trên.
 */
function chain(root: string, self: number): Row[] {
  return [
    { pid: 1, ppid: 0, pgid: 1, command: '/sbin/launchd', startedAt: BOOT },
    { pid: 500, ppid: 1, pgid: 500, command: '/usr/sbin/sshd -D', startedAt: BOOT + 10 },
    { pid: 501, ppid: 500, pgid: 501, command: 'sshd-session: owner@notty', startedAt: START - 1 },
    {
      pid: 600,
      ppid: 501,
      pgid: 600,
      command: '/bin/sh /h/.crew/bin/crew-claude-run',
      startedAt: START,
      cwd: root,
    },
    {
      pid: 601,
      ppid: 600,
      pgid: 600,
      command: '/h/.local/bin/claude --print --output-format stream-json',
      runId: RUN,
      cwd: root,
    },
    { pid: 610, ppid: 601, pgid: 610, command: '/bin/zsh -c crew-mac workflow-check', runId: RUN, cwd: root },
    {
      pid: self,
      ppid: 610,
      pgid: 610,
      command: '/opt/homebrew/bin/node /h/.crew/app/crew-mac/dist/cli.js workflow-check',
      runId: RUN,
      cwd: root,
    },
    { pid: self + 1, ppid: self, pgid: 610, command: '/bin/ps -axww -o pid=', runId: RUN, cwd: root },
  ];
}

const SELF = 620;
const deps = (rows: readonly Row[], self = SELF) => ({
  runner: runnerFor(rows),
  now: () => NOW,
  selfPid: self,
});
const pidsIn = (lines: readonly string[]) =>
  lines.flatMap((l) => [...(/pid=(\d+)/.exec(l)?.slice(1) ?? [])]).map(Number);

describe('orphanCheck', () => {
  it('(a) không còn process nào ngoài chuỗi tổ tiên thì ok', async () => {
    const root = runRoot();
    const r = await orphanCheck(deps(chain(root, SELF)), { root, runId: RUN });
    expect(r).toEqual({ ok: true, lines: [`crew-workflow ok không còn process nào của run ${RUN}`] });
  });

  it('(b) dev server con cháu của claude còn sống trong worktree thì chặn, in pid và lệnh rút gọn', async () => {
    const root = runRoot();
    const longCmd = `node ${root}/node_modules/.bin/vite --port 5173 --host 127.0.0.1 ${'x'.repeat(80)}`;
    const rows = [
      ...chain(root, SELF),
      { pid: 640, ppid: 601, pgid: 640, command: '/bin/zsh -c pnpm dev', runId: RUN, cwd: root },
      { pid: 641, ppid: 640, pgid: 640, command: longCmd, runId: RUN, cwd: `${root}/apps/web` },
    ];
    const r = await orphanCheck(deps(rows), { root, runId: RUN });
    expect(r.ok).toBe(false);
    expect(pidsIn(r.lines)).toEqual([640, 641]);
    expect(r.lines[1]).toBe(
      `crew-workflow blocked: process còn chạy pid=641 cmd=${longCmd.slice(0, 80)} — tắt process bạn đã bật rồi chạy lại`,
    );
  });

  it('(c) process đã reparent về launchd, cwd dưới worktree, sinh trong cửa sổ run thì chặn', async () => {
    const root = runRoot();
    const rows = [
      ...chain(root, SELF),
      { pid: 700, ppid: 1, pgid: 700, command: 'node server.js', startedAt: START + 20, cwd: `${root}/api` },
      // Sinh trước run, hoặc cwd ngoài worktree: không phải của run này.
      { pid: 710, ppid: 1, pgid: 710, command: 'node old.js', startedAt: START - 600, cwd: root },
      { pid: 720, ppid: 1, pgid: 720, command: 'node other.js', startedAt: START + 30, cwd: '/tmp/khac' },
    ];
    const r = await orphanCheck(deps(rows), { root, runId: RUN });
    expect(r.ok).toBe(false);
    expect(pidsIn(r.lines)).toEqual([700]);
    expect(r.lines[0]).toContain('cmd=node server.js');
  });

  it('(d) chuỗi tổ tiên (wrapper, claude, shell tool), chính lệnh và ps nó đang chạy không bị tính', async () => {
    const root = runRoot();
    const self = 9_000;
    const rows = [
      ...chain(root, self),
      { pid: 650, ppid: 1, pgid: 600, command: 'sleep 300', startedAt: START + 40, cwd: root },
    ];
    const r = await orphanCheck(deps(rows, self), { root, runId: RUN });
    expect(r.ok).toBe(false);
    // Chỉ còn process cùng group wrapper đã ghi; 600/601/610/self/self+1 cùng group hay cây claude đều được loại.
    expect(pidsIn(r.lines)).toEqual([650]);
  });

  it('(f) MCP server stdio là con trực tiếp của claude, cùng Chrome nó mở, không bị chặn', async () => {
    const root = runRoot();
    const rows = [
      ...chain(root, SELF),
      { pid: 660, ppid: 601, pgid: 600, command: 'npm exec @playwright/mcp@latest', runId: RUN, cwd: root },
      {
        pid: 661,
        ppid: 660,
        pgid: 600,
        command: 'node /h/.npm/_npx/abc/node_modules/.bin/mcp-server-playwright',
        runId: RUN,
        cwd: root,
      },
      {
        pid: 662,
        ppid: 661,
        pgid: 600,
        command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-pipe',
        runId: RUN,
        cwd: root,
      },
      {
        pid: 663,
        ppid: 662,
        pgid: 600,
        command: '/Applications/Google Chrome.app/Contents/Frameworks/x/Google Chrome Helper --type=renderer',
        runId: RUN,
        cwd: root,
      },
      { pid: 670, ppid: 601, pgid: 600, command: 'node /h/mcp/other-server.js', runId: RUN, cwd: root },
    ];
    const r = await orphanCheck(deps(rows), { root, runId: RUN });
    expect(r).toEqual({ ok: true, lines: [`crew-workflow ok không còn process nào của run ${RUN}`] });
  });

  it('(g) dev server dưới shell con khác của claude bị chặn, MCP cạnh nó thì không', async () => {
    const root = runRoot();
    const rows = [
      ...chain(root, SELF),
      { pid: 660, ppid: 601, pgid: 600, command: 'npm exec @playwright/mcp@latest', runId: RUN, cwd: root },
      { pid: 680, ppid: 601, pgid: 680, command: '-zsh -c -l pnpm dev', runId: RUN, cwd: root },
      { pid: 681, ppid: 680, pgid: 680, command: 'node vite', runId: RUN, cwd: root },
      // Lệnh nền ngay trong shell đang chạy check (không phải tổ tiên của check) cũng bị chặn.
      { pid: 690, ppid: 610, pgid: 610, command: 'node server.js', runId: RUN, cwd: root },
    ];
    const r = await orphanCheck(deps(rows), { root, runId: RUN });
    expect(r.ok).toBe(false);
    expect(pidsIn(r.lines)).toEqual([680, 681, 690]);
  });

  it('(h) dev server đã reparent về launchd vẫn bị chặn khi có MCP chạy cạnh', async () => {
    const root = runRoot();
    const rows = [
      ...chain(root, SELF),
      { pid: 660, ppid: 601, pgid: 600, command: 'npm exec @playwright/mcp@latest', runId: RUN, cwd: root },
      { pid: 700, ppid: 1, pgid: 700, command: 'node vite', startedAt: START + 60, cwd: root },
    ];
    const r = await orphanCheck(deps(rows), { root, runId: RUN });
    expect(r.ok).toBe(false);
    expect(pidsIn(r.lines)).toEqual([700]);
  });

  it('(i) tiến trình nền của hook Crew Jev (jev gate-bg) đã reparent về launchd không bị chặn', async () => {
    const root = runRoot();
    const gateBg = '/opt/homebrew/bin/node /h/.crew/app/crew-mac/dist/cli.js jev gate-bg';
    const rows = [
      ...chain(root, SELF),
      // Hình dạng cũ (cwd trong worktree, có run id): chỉ argv loại được nó.
      { pid: 800, ppid: 1, pgid: 800, command: gateBg, runId: RUN, startedAt: NOW_SEC - 1, cwd: root },
      // Hình dạng hiện tại: cwd ~/.crew/jev, env không có run id.
      { pid: 801, ppid: 1, pgid: 801, command: gateBg, startedAt: NOW_SEC - 1, cwd: '/h/.crew/jev' },
    ];
    const r = await orphanCheck(deps(rows), { root, runId: RUN });
    expect(r).toEqual({ ok: true, lines: [`crew-workflow ok không còn process nào của run ${RUN}`] });
  });

  it('(j) process giả dạng gate-bg nhưng argv khác vẫn bị chặn', async () => {
    const root = runRoot();
    const rows = [
      ...chain(root, SELF),
      {
        pid: 810,
        ppid: 1,
        pgid: 810,
        command: 'node server.js jev gate-bg',
        startedAt: START + 20,
        cwd: root,
      },
      {
        pid: 811,
        ppid: 1,
        pgid: 811,
        command: '/opt/homebrew/bin/node /h/cli.js jev gate-bg --port 3000',
        startedAt: START + 20,
        cwd: root,
      },
    ];
    const r = await orphanCheck(deps(rows), { root, runId: RUN });
    expect(r.ok).toBe(false);
    expect(pidsIn(r.lines)).toEqual([810, 811]);
  });

  it('(e) thiếu PAPERCLIP_RUN_ID thì cảnh báo, ok, không quét process', async () => {
    const root = runRoot();
    for (const runId of [undefined, '', '  ']) {
      const d = deps(chain(root, SELF));
      const r = await orphanCheck(d, { root, runId });
      expect(r).toEqual({
        ok: true,
        lines: ['crew-workflow warn: không có PAPERCLIP_RUN_ID, bỏ qua kiểm process'],
      });
      expect(d.runner.calls).toEqual([]);
    }
  });

  it('PAPERCLIP_RUN_ID sai định dạng hoặc ps lỗi thì chặn', async () => {
    const root = runRoot();
    const bad = await orphanCheck(deps(chain(root, SELF)), { root, runId: '../x' });
    expect(bad.ok).toBe(false);
    expect(bad.lines[0]).toContain('PAPERCLIP_RUN_ID không hợp lệ');
    const failing = new FakeRunner();
    const r = await orphanCheck({ runner: failing, now: () => NOW, selfPid: SELF }, { root, runId: RUN });
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toContain('không đọc được bảng process');
  });
});

describe('CLI workflow-check --require-no-orphans', () => {
  function setup() {
    const mac = fakeMac();
    created.push(mac.home);
    const pinDir = installSuperpowersPin({ ...mac.ctx, runner: createRunner() }).dir;
    return { mac, pinDir };
  }

  function io(context: Parameters<typeof main>[1]['context'], env: NodeJS.ProcessEnv) {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env, context },
    };
  }

  it('dạng --runtime: còn process thì 78, sạch thì 0, không có run id thì cảnh báo', async () => {
    const { mac, pinDir } = setup();
    const root = runRoot();
    const args = ['workflow-check', '--runtime', 'codex_local', '--root', root, '--require-no-orphans'];
    const env = { CREW_SUPERPOWERS_DIR: pinDir, PAPERCLIP_RUN_ID: RUN };
    const clean = chain(root, process.pid);
    const ctxFor = (rows: Row[]) => ({ ...mac.ctx, runner: runnerFor(rows), now: () => NOW });

    const ok = io(ctxFor(clean), env);
    expect(await main(args, ok.io)).toBe(0);
    expect(ok.out).toEqual([
      'crew-workflow ok runtime=codex_local superpowers=9.9.9',
      `crew-workflow ok không còn process nào của run ${RUN}`,
    ]);

    const dirty = io(
      ctxFor([
        ...clean,
        { pid: 700, ppid: 1, pgid: 700, command: 'sleep 300', startedAt: START + 5, cwd: root },
      ]),
      env,
    );
    expect(await main(args, dirty.io)).toBe(78);
    expect(dirty.err).toContain(
      'crew-workflow blocked: process còn chạy pid=700 cmd=sleep 300 — tắt process bạn đã bật rồi chạy lại',
    );

    const noRun = io(ctxFor(clean), { CREW_SUPERPOWERS_DIR: pinDir });
    expect(await main(args, noRun.io)).toBe(0);
    expect(noRun.out).toContain('crew-workflow warn: không có PAPERCLIP_RUN_ID, bỏ qua kiểm process');
  });

  it('dạng --plugin-dir nhận cờ; không có cờ thì không quét process', async () => {
    const { mac, pinDir } = setup();
    const root = runRoot();
    const runner = runnerFor(chain(root, process.pid));
    const ctx = { ...mac.ctx, runner, now: () => NOW };
    const env = { PAPERCLIP_RUN_ID: RUN };
    const without = io(ctx, env);
    await main(['workflow-check', '--root', root, '--plugin-dir', pinDir], without.io);
    expect(runner.calls).toEqual([]);
    const withFlag = io(ctx, env);
    expect(
      await main(
        ['workflow-check', '--root', root, '--plugin-dir', pinDir, '--require-no-orphans'],
        withFlag.io,
      ),
    ).toBe(0);
    expect(withFlag.out).toContain(`crew-workflow ok không còn process nào của run ${RUN}`);
  });
});
