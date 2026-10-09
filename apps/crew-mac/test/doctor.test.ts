import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  doctor,
  isAgentTccSubject,
  parseLoad,
  parsePendingTccPrompts,
  printProbeScript,
  TCC_PREDICATE,
  tccHint,
} from '../src/commands/doctor.js';
import { setup } from '../src/commands/setup.js';
import { workflowCheck } from '../src/commands/workflow-check.js';
import { macPaths, SSHD_LABEL } from '../src/paths.js';
import { pinDir, superpowersPinDir } from '../src/workflows/pin.js';
import {
  APP_EXECUTABLE,
  FIXTURE_BMAD_PIN,
  FIXTURE_PIN,
  fakeMac,
  fakeProcs,
  installedPluginsFile,
  PAPERCLIP_PUB,
} from './helpers/fake-mac.js';

// Dòng log thật của tccd trên Mac mini ngày 06/10/2026 (rút gọn phần đuôi): hộp thoại quyền ổ ngoài đang chờ.
const TCC_LOG = [
  'Timestamp               Ty Process[PID:TID]',
  '2026-10-06 10:41:02.207 Df tccd[75697:5a8b53a] [com.apple.TCC:access] AUTHREQ_PROMPTING: msgID=75841.27656, service=kTCCServiceSystemPolicyRemovableVolumes, subject=Sub:{/Users/owner/.local/share/claude/versions/2.1.289}Resp:{TCCDProcess: identifier=com.anthropic.claude-code, pid=18951}',
  '2026-10-06 11:57:48.683 Df tccd[75697:5ad68f1] [com.apple.TCC:access] AUTHREQ_PROMPTING: msgID=75841.27701, service=kTCCServiceSystemPolicyDesktopFolder, subject=Sub:{/private/tmp/opendir}Resp:{TCCDProcess: identifier=opendir, pid=84654}',
  '2026-10-06 11:58:10.001 Df tccd[75697:5ad68f1] [com.apple.TCC:access] AUTHREQ_RESULT: msgID=75841.27701, authValue=0, authReason=2, authVersion=1, desired_auth=0, error=(null),',
].join('\n');

// Cùng sự kiện nhưng subject bị log che thành <private>: không khớp định dạng đầy đủ.
const TCC_PRIVATE_LINE =
  '2026-10-06 12:00:00.000 Df tccd[75697:5ad6000] [com.apple.TCC:access] AUTHREQ_PROMPTING: msgID=75841.27800, service=kTCCServiceSystemPolicyRemovableVolumes, subject=<private>';

const AUTH_OK = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' });

async function installed(
  sshHandler: (remote: string) => { code?: number; stdout?: string; timedOut?: boolean },
) {
  // node và cli phải tồn tại thật để check launcher đạt.
  const mac = fakeMac({ nodePath: process.execPath, cliPath: fileURLToPath(import.meta.url) });
  await setup(mac.ctx, { paperclipKey: PAPERCLIP_PUB });
  mac.runner
    .on('/usr/bin/nc', () => ({}))
    .on('ssh', (args) => sshHandler(args.at(-1) as string))
    .on('/usr/bin/log', () => ({ stdout: 'Timestamp               Ty Process[PID:TID]\n' }))
    .on('/usr/sbin/sysctl', (args) => ({
      stdout: args.includes('vm.loadavg') ? '{ 1.47 1.53 1.45 }\n' : '10\n',
    }))
    .on('/usr/bin/memory_pressure', () => ({ stdout: 'System-wide memory free percentage: 55%\n' }));
  return mac;
}

const okSsh = (remote: string) => {
  if (remote.includes('auth status')) return { stdout: AUTH_OK };
  if (remote.includes('crew-claude-run')) return { stdout: '2.1.289 (Claude Code)\n' };
  return { stdout: 'ok\n' };
};

describe('doctor crew-docs', () => {
  const OPTIONS = { probe: false, tccWindow: '24h', probeTimeoutSec: 90 };

  /** Một worktree có docs/flows.yaml; ssh trả config git cho các lệnh crew-docs, còn lại như máy khỏe. */
  async function withRepos(
    names: string[],
    crewDocsSsh: (remote: string) => { code?: number; stdout?: string; timedOut?: boolean },
  ) {
    const mac = await installed(okSsh);
    const root = macPaths(mac.home).defaultWorktreeRoot;
    for (const name of names) {
      mkdirSync(join(root, name, 'docs'), { recursive: true });
      writeFileSync(join(root, name, 'docs', 'flows.yaml'), 'version: 1\n');
    }
    const remotes: string[] = [];
    mac.runner.on('ssh', (args) => {
      const remote = args.at(-1) as string;
      if (/crew-docs|BUNDLE=|--version/.test(remote) && !remote.includes('crew-claude-run')) {
        remotes.push(remote);
        return crewDocsSsh(remote);
      }
      return okSsh(remote);
    });
    const run = async () => (await doctor(mac.ctx, OPTIONS)).find((c) => c.id === 'crew-docs');
    return { mac, root, remotes, run };
  }

  const cfg = (bundle: string, runtime: string, gitDir = '/Users/owner/crew-tools/repo/.git') =>
    `BUNDLE=${bundle}\nRUNTIME=${runtime}\nGITDIR=${gitDir}\n`;
  const GOOD = cfg('/Users/owner/crew-tools/crew-docs.cjs', '/Users/owner/crew-tools/node');
  const healthy = (remote: string) =>
    remote.includes('BUNDLE=') ? { stdout: GOOD } : { stdout: 'crew-docs 0.1.0\n' };

  it('thiếu crew-docs.bundle thì fail', async () => {
    const t = await withRepos(['integrator'], () => ({ stdout: 'BUNDLE=\nRUNTIME=\nGITDIR=/x/.git\n' }));
    const r = await t.run();
    expect(r?.status).toBe('fail');
    expect(r?.detail).toContain('integrator');
    expect(r?.detail).toContain('crew-docs.bundle');
    expect(r?.hint).toContain('install-hooks');
  });

  it('chạy qua sshd agent: node theo PATH của agent và runtime Electron của hook', async () => {
    const t = await withRepos(['a'], healthy);
    const r = await t.run();
    expect(r).toMatchObject({ status: 'ok', detail: expect.stringContaining('1 worktree') });
    expect(t.remotes.some((c) => c.includes('node ') && c.includes('--version'))).toBe(true);
    expect(t.remotes.some((c) => c.includes('ELECTRON_RUN_AS_NODE=1'))).toBe(true);
  });

  it('worktree không có docs/flows.yaml thì bỏ qua, không gọi ssh crew-docs', async () => {
    const t = await withRepos([], healthy);
    mkdirSync(join(t.root, 'b'), { recursive: true });
    const r = await t.run();
    expect(r).toMatchObject({ status: 'ok', detail: expect.stringContaining('không có worktree') });
    expect(t.remotes).toEqual([]);
  });

  it('bundle hoặc runtime dưới ~/Documents, ~/Desktop, ~/Downloads, /Volumes thì fail kèm gợi ý dời', async () => {
    for (const bundle of ['Documents/p/crew-docs.cjs', 'Desktop/x.cjs', 'Downloads/x.cjs']) {
      const t = await withRepos(['a'], (remote) =>
        remote.includes('BUNDLE=')
          ? { stdout: cfg(`__HOME__/${bundle}`, '/Users/owner/crew-tools/node') }
          : { stdout: 'crew-docs 0.1.0\n' },
      );
      t.mac.runner.on('ssh', (args) => {
        const remote = args.at(-1) as string;
        if (remote.includes('BUNDLE='))
          return { stdout: cfg(`${t.mac.home}/${bundle}`, '/Users/owner/crew-tools/node') };
        return remote.includes('--version') && !remote.includes('crew-claude-run')
          ? { stdout: 'crew-docs 0.1.0\n' }
          : okSsh(remote);
      });
      const r = await t.run();
      expect(r?.status).toBe('fail');
      expect(r?.detail).toContain('vùng TCC');
      expect(r?.hint).toContain('Dời');
    }
    const vol = await withRepos(['a'], (remote) =>
      remote.includes('BUNDLE=')
        ? { stdout: cfg('/Volumes/X/crew-docs.cjs', '/Users/owner/crew-tools/node') }
        : { stdout: 'crew-docs 0.1.0\n' },
    );
    expect((await vol.run())?.detail).toContain('/Volumes');
  });

  it('git dir dưới vùng TCC cũng fail', async () => {
    const t = await withRepos(['a'], (remote) =>
      remote.includes('BUNDLE=')
        ? { stdout: cfg('/o/crew-docs.cjs', '/o/node', '/Volumes/Disk/repo/.git') }
        : { stdout: 'crew-docs 0.1.0\n' },
    );
    const r = await t.run();
    expect(r?.status).toBe('fail');
    expect(r?.detail).toContain('git dir');
  });

  it('quá hạn (treo TCC) thì fail và nói rõ quá hạn, dừng kiểm worktree còn lại', async () => {
    const t = await withRepos(['a', 'b'], (remote) =>
      remote.includes('BUNDLE=') ? { code: 255, stdout: '', timedOut: true } : { stdout: '' },
    );
    const r = await t.run();
    expect(r?.status).toBe('fail');
    expect(r?.detail).toContain('quá 30 giây');
    expect(r?.detail).toContain('tcc-pending');
    expect(t.remotes).toHaveLength(1);
  });

  it('--version quá hạn hoặc file thiếu thì fail', async () => {
    const slow = await withRepos(['a'], (remote) =>
      remote.includes('BUNDLE=') ? { stdout: GOOD } : { code: 255, timedOut: true },
    );
    expect((await slow.run())?.detail).toContain('quá 20 giây');
    const missing = await withRepos(['a'], (remote) =>
      remote.includes('BUNDLE=') ? { stdout: GOOD } : { code: 92, stdout: 'CREW_MISSING\n' },
    );
    expect((await missing.run())?.detail).toContain('không tồn tại');
  });

  it('--version quá hạn thì dừng ngay, kể cả khi mỗi worktree một bundle khác nhau', async () => {
    let n = 0;
    const t = await withRepos(['a', 'b', 'c'], (remote) =>
      remote.includes('BUNDLE=')
        ? { stdout: cfg(`/o/b${n++}.cjs`, '/o/node') }
        : { code: 255, timedOut: true },
    );
    const r = await t.run();
    expect(r?.status).toBe('fail');
    expect(r?.detail).toContain('dừng kiểm các worktree còn lại');
    // 1 lệnh đọc config + 1 lệnh node --version quá hạn, không chạy runtime và không sang worktree sau.
    expect(t.remotes).toHaveLength(2);
  });

  it('nhiều worktree cùng bundle thì chỉ chạy --version một lần cho mỗi cặp runtime/bundle', async () => {
    const t = await withRepos(['a', 'b', 'c'], healthy);
    const r = await t.run();
    expect(r?.status).toBe('ok');
    expect(t.remotes.filter((c) => c.includes('--version'))).toHaveLength(2);
  });

  it('thư mục worktree không đọc được thì warn, không làm sập doctor; symlink worktree được theo link', async () => {
    const bad = await installed(okSsh);
    const root = macPaths(bad.home).defaultWorktreeRoot;
    rmSync(root, { recursive: true });
    writeFileSync(root, 'file thường');
    const warn = (await doctor(bad.ctx, OPTIONS)).find((c) => c.id === 'crew-docs');
    expect(warn?.status).toBe('warn');

    const t = await withRepos([], healthy);
    const real = join(t.mac.home, 'real-repo');
    mkdirSync(join(real, 'docs'), { recursive: true });
    writeFileSync(join(real, 'docs', 'flows.yaml'), 'version: 1\n');
    symlinkSync(real, join(t.root, 'linked'));
    expect(await t.run()).toMatchObject({ status: 'ok', detail: expect.stringContaining('1 worktree') });
  });
});

describe('isAgentTccSubject', () => {
  it('nhận claude, bản claude theo version và node', () => {
    expect(isAgentTccSubject('/Users/a/.local/share/claude/versions/2.1.289')).toBe(true);
    expect(isAgentTccSubject('/Users/a/.local/bin/claude')).toBe(true);
    expect(isAgentTccSubject('/opt/homebrew/bin/node')).toBe(true);
    expect(isAgentTccSubject('/opt/homebrew/Cellar/node/24.11.0/bin/node')).toBe(true);
    expect(isAgentTccSubject('/Applications/Orca.app')).toBe(false);
    expect(isAgentTccSubject('/Applications/Claude.app')).toBe(false);
    expect(isAgentTccSubject('/Applications/Weird.app', 'com.anthropic.claude-code')).toBe(true);
  });
});

describe('parsePendingTccPrompts', () => {
  it('chỉ trả hộp thoại chưa có kết quả', () => {
    expect(parsePendingTccPrompts(TCC_LOG)).toEqual({
      pending: [
        {
          msgId: '75841.27656',
          at: '2026-10-06 10:41:02.207',
          service: 'kTCCServiceSystemPolicyRemovableVolumes',
          subject: '/Users/owner/.local/share/claude/versions/2.1.289',
          identifier: 'com.anthropic.claude-code',
        },
      ],
      unparsed: 0,
    });
  });

  it('đếm dòng AUTHREQ_PROMPTING lệch định dạng thay vì bỏ qua', () => {
    expect(parsePendingTccPrompts(`${TCC_LOG}\n${TCC_PRIVATE_LINE}`).unparsed).toBe(1);
  });

  it('hướng dẫn nêu tên binary, loại quyền và chỗ bấm', () => {
    const [prompt] = parsePendingTccPrompts(TCC_LOG).pending;
    const hint = tccHint(prompt as NonNullable<typeof prompt>);
    expect(hint).toContain('"2.1.289"');
    expect(hint).toContain('ổ đĩa di động');
    expect(hint).toContain('Allow');
    expect(hint).toContain('Privacy & Security');
  });
});

describe('printProbeScript', () => {
  it('chạy claude -p trong git repo tạm dưới thư mục worktree, tự SIGKILL khi quá hạn và dọn', () => {
    const script = printProbeScript("/Users/owner/crew agents/it's", 90);
    expect(script).toContain(`mktemp -d '/Users/owner/crew agents/it'\\''s/.crew-mac-doctor-XXXXXX'`);
    expect(script).toContain('git -C "$d" init -q');
    expect(script).toContain(
      "claude -p 'Trả lời đúng một từ: ok' --model haiku --setting-sources project,local",
    );
    expect(script).toContain('-lt 90');
    expect(script).toContain("perl -e 'setpgrp(0, 0); exec @ARGV or die' claude -p");
    expect(script).toContain('kill -9 -- -"$p"');
    expect(script).toContain('echo CREW_MAC_TIMEOUT');
    expect(script).toContain(`trap 'cd /; rm -rf "$d" "$d.out"' EXIT`);
  });

  it('quá hạn thì giết cả nhóm process của claude và dọn thư mục tạm', async () => {
    const root = mkdtempSync(join(tmpdir(), 'crew-probe-root-'));
    const bin = mkdtempSync(join(tmpdir(), 'crew-probe-bin-'));
    const marker = `sleep ${3000 + (process.pid % 997)}`;
    // claude giả: bỏ qua SIGTERM, sinh một process con rồi treo.
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntrap '' TERM\n${marker} &\n${marker}\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const run = spawnSync('/bin/sh', ['-c', printProbeScript(root, 1)], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(run.stdout).toContain('CREW_MAC_TIMEOUT');
    expect(run.status).toBe(124);
    await sleep(300);
    const ps = spawnSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' }).stdout;
    expect(ps.split('\n').filter((line) => line.trim() === marker)).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });

  it('claude thoát bình thường nhưng để lại process con thì vẫn dọn cả nhóm', async () => {
    const root = mkdtempSync(join(tmpdir(), 'crew-probe-root-'));
    const bin = mkdtempSync(join(tmpdir(), 'crew-probe-bin-'));
    const marker = `sleep ${4000 + (process.pid % 997)}`;
    // claude giả: in ok, để lại một process con chạy nền rồi thoát mã 0.
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\n${marker} &\necho ok\nexit 0\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const run = spawnSync('/bin/sh', ['-c', printProbeScript(root, 10)], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('ok');
    await sleep(300);
    const ps = spawnSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' }).stdout;
    expect(ps.split('\n').filter((line) => line.trim() === marker)).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('parseLoad', () => {
  it('đọc load 1 phút, số CPU và phần trăm RAM trống', () => {
    expect(parseLoad('{ 1.47 1.53 1.45 }', '10', 'System-wide memory free percentage: 55%')).toEqual({
      load1: 1.47,
      ncpu: 10,
      freePct: 55,
    });
  });
});

describe('crew-mac doctor', () => {
  it('cho phép status bỏ probe TCC dài', async () => {
    const { ctx, runner } = await installed(() => ({}));
    await doctor(ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90, skipTcc: true });
    expect(runner.calls.some((call) => call.command === '/usr/bin/log')).toBe(false);
  });

  it('chưa cài thì chỉ báo một lỗi cài đặt', async () => {
    const { ctx } = fakeMac();
    const results = await doctor(ctx, { probe: true, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.map((r) => [r.id, r.status])).toEqual([['install', 'fail']]);
  });

  it('máy đã cài và khỏe thì mọi check đạt', async () => {
    const { ctx, runner } = await installed(okSsh);
    const results = await doctor(ctx, { probe: true, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.map((r) => [r.id, r.status])).toEqual([
      ['tailscale', 'ok'],
      ['sshd-agent', 'ok'],
      ['tcc-owner', 'warn'],
      ['reaper', 'ok'],
      ['status-job', 'ok'],
      ['status-last', 'warn'],
      ['sshd-port', 'ok'],
      ['zshenv-path', 'ok'],
      ['wrapper', 'ok'],
      ['agent-node', 'ok'],
      ['agent-uv', 'ok'],
      ['launcher', 'ok'],
      ['superpowers-pin', 'ok'],
      ['bmad-pin', 'ok'],
      ['worktree-root', 'ok'],
      ['worktree-workflows', 'ok'],
      ['crew-docs', 'ok'],
      ['claude-auth', 'ok'],
      ['claude-print-git', 'ok'],
      ['tcc-pending', 'ok'],
      ['load', 'ok'],
    ]);
    const log = runner.calls.find((c) => c.command === '/usr/bin/log');
    expect(log?.args).toEqual(['show', '--last', '24h', '--style', 'compact', '--predicate', TCC_PREDICATE]);
    const ssh = runner.calls.find((c) => c.command === 'ssh');
    expect(ssh?.args.slice(0, 2)).toEqual(['-F', '/dev/null']);
    expect(ssh?.args).toContain('BatchMode=yes');
    expect(ssh?.args).toContain('owner@100.102.189.67');
  });

  it('superpowers-pin: thiếu thư mục ghim hoặc lệch checksum thì fail kèm cách sửa', async () => {
    const { ctx, home } = await installed(okSsh);
    const dir = superpowersPinDir(home, FIXTURE_PIN);
    const pinCheck = async () =>
      (await doctor(ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 })).find(
        (r) => r.id === 'superpowers-pin',
      );
    expect(await pinCheck()).toMatchObject({ status: 'ok', detail: expect.stringContaining('2 file') });
    writeFileSync(join(dir, 'a.txt'), 'bị sửa\n');
    expect(await pinCheck()).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('lệch checksum'),
    });
    rmSync(dir, { recursive: true });
    expect(await pinCheck()).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('chưa có'),
      hint: expect.stringContaining('crew-mac setup'),
    });
    symlinkSync('/etc', dir);
    expect(await pinCheck()).toMatchObject({ status: 'fail', detail: expect.stringContaining('symlink') });
  });

  it('superpowers-pin: file thực thi mất bit x thì fail; bản owner khác pin thì warn', async () => {
    const { ctx, home } = await installed(okSsh);
    const dir = superpowersPinDir(home, FIXTURE_PIN);
    const pinCheck = async () =>
      (await doctor(ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 })).find(
        (r) => r.id === 'superpowers-pin',
      );
    chmodSync(join(dir, 'dir', 'b.txt'), 0o644);
    expect(await pinCheck()).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('thiếu bit thực thi: dir/b.txt'),
      hint: expect.stringContaining('crew-mac setup'),
    });
    chmodSync(join(dir, 'dir', 'b.txt'), 0o755);
    writeFileSync(
      installedPluginsFile(home),
      JSON.stringify({
        plugins: {
          'superpowers@claude-plugins-official': [
            { installPath: '/x', version: '9.9.10', gitCommitSha: 'a' },
          ],
        },
      }),
    );
    expect(await pinCheck()).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('9.9.10'),
      hint: expect.stringContaining('SUPERPOWERS_PIN'),
    });
  });

  it('worktree-workflows: worktree sẽ bị chặn thì fail kèm lệnh xử lý; chỉ sửa dở SKILL.md thì warn', async () => {
    const mac = await installed(okSsh);
    // Chỉ git chạy thật (repo tạm); các lệnh khác vẫn qua runner giả của máy khỏe.
    mac.runner.on('/usr/bin/git', (args) => {
      const r = spawnSync('/usr/bin/git', [...args], { encoding: 'utf8' });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    });
    const root = macPaths(mac.home).defaultWorktreeRoot;
    const wt = join(root, 'executor');
    mkdirSync(join(wt, '.claude', 'skills', 's'), { recursive: true });
    writeFileSync(join(wt, '.claude', 'skills', 's', 'SKILL.md'), 's');
    writeFileSync(join(wt, '.claude', 'settings.json'), '{}');
    for (const args of [
      ['init', '-q'],
      ['add', '.'],
      ['commit', '-q', '-m', 'i'],
    ]) {
      spawnSync('/usr/bin/git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
        cwd: wt,
      });
    }
    mkdirSync(join(root, '.an'), { recursive: true });
    const check = async () =>
      (await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 })).find(
        (r) => r.id === 'worktree-workflows',
      );
    expect(await check()).toMatchObject({ status: 'ok', detail: expect.stringContaining('1 worktree') });
    writeFileSync(join(wt, '.claude', 'skills', 's', 'SKILL.md'), 'sửa dở');
    expect(await check()).toMatchObject({ status: 'warn', detail: expect.stringContaining('executor') });
    writeFileSync(join(wt, '.claude', 'settings.json'), '{"hooks":{}}');
    const failed = await check();
    expect(failed).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('.claude/settings.json'),
    });
    expect(failed?.hint).toContain(`git -C '${wt}' checkout HEAD -- '.claude/settings.json'`);
  });

  it('worktree-workflows: mỗi worktree kiểm theo workflow của run gần nhất (dấu của workflow-check); chưa có dấu thì theo Superpowers', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('/usr/bin/git', (args) => {
      const r = spawnSync('/usr/bin/git', [...args], { encoding: 'utf8' });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    });
    const root = macPaths(mac.home).defaultWorktreeRoot;
    // Cùng một repo dự án: worktree của agent BMAD và của executor Superpowers, repo bật `bmad@bmad`.
    for (const name of ['bmad', 'executor']) {
      const wt = join(root, name);
      mkdirSync(join(wt, '.claude'), { recursive: true });
      writeFileSync(join(wt, '.claude', 'settings.json'), '{"enabledPlugins":{"bmad@bmad":true}}');
      for (const args of [
        ['init', '-q'],
        ['add', '.'],
        ['commit', '-q', '-m', 'i'],
      ]) {
        spawnSync('/usr/bin/git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
          cwd: wt,
        });
      }
    }
    const check = async () =>
      (await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 })).find(
        (r) => r.id === 'worktree-workflows',
      );
    // Chưa run nào: không biết workflow, giữ hành vi cũ (Superpowers) nên cả hai báo nạp chéo.
    const before = await check();
    expect(before?.status).toBe('fail');
    expect(before?.detail).toContain('bmad: ');
    expect(before?.detail).toContain('executor: ');

    const bmadRun = await workflowCheck(mac.ctx, {
      root: join(root, 'bmad'),
      pluginDir: pinDir(mac.home, FIXTURE_BMAD_PIN),
    });
    expect(bmadRun.ok).toBe(true);
    const execRun = await workflowCheck(mac.ctx, {
      root: join(root, 'executor'),
      pluginDir: superpowersPinDir(mac.home, FIXTURE_PIN),
    });
    expect(execRun.ok).toBe(false);
    const after = await check();
    expect(after?.status).toBe('fail');
    expect(after?.detail).not.toContain('bmad: ');
    expect(after?.detail).toContain('executor: ');
    expect(after?.detail).toContain('nạp chéo');

    writeFileSync(join(root, 'executor', '.claude', 'settings.json'), '{}');
    spawnSync(
      '/usr/bin/git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qam', 'bo'],
      {
        cwd: join(root, 'executor'),
      },
    );
    expect(await check()).toMatchObject({ status: 'ok', detail: expect.stringContaining('2 worktree') });
  });

  it('worktree-workflows: git quá hạn ở worktree đầu thì dừng, không kiểm các worktree còn lại', async () => {
    const mac = await installed(okSsh);
    const root = macPaths(mac.home).defaultWorktreeRoot;
    for (const name of ['a', 'b', 'c']) {
      mkdirSync(join(root, name, '.claude', 'skills', 's'), { recursive: true });
      writeFileSync(join(root, name, '.claude', 'skills', 's', 'SKILL.md'), 's');
    }
    const roots: string[] = [];
    mac.runner.on('/usr/bin/git', (args) => {
      roots.push(args[args.indexOf('-C') + 1] as string);
      return { code: 137, timedOut: true };
    });
    const r = (await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 })).find(
      (c) => c.id === 'worktree-workflows',
    );
    expect(r?.status).toBe('fail');
    expect(r?.detail).toContain('git quá hạn');
    expect(r?.detail).toContain('dừng kiểm các worktree còn lại');
    expect(new Set(roots)).toEqual(new Set([join(root, 'a')]));
  });

  it('bmad-pin: đạt khi đúng checksum; thiếu, lệch checksum, mất bit x thì fail kèm cách sửa', async () => {
    const { ctx, home } = await installed(okSsh);
    const dir = pinDir(home, FIXTURE_BMAD_PIN);
    const pinCheck = async () =>
      (await doctor(ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 })).find(
        (r) => r.id === 'bmad-pin',
      );
    expect(await pinCheck()).toMatchObject({
      status: 'ok',
      title: 'BMAD 9.9.9-next đã ghim',
      detail: expect.stringContaining('3 file'),
    });
    const script = join(dir, 'skills', 'bmad', 'scripts', 'setup.py');
    chmodSync(script, 0o644);
    expect(await pinCheck()).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('thiếu bit thực thi: skills/bmad/scripts/setup.py'),
      hint: expect.stringContaining('crew-mac workflows install'),
    });
    chmodSync(script, 0o755);
    writeFileSync(join(dir, 'skills', 'm1', 'SKILL.md'), 'sửa\n');
    expect(await pinCheck()).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('lệch checksum'),
    });
    rmSync(dir, { recursive: true });
    expect(await pinCheck()).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('chưa có'),
      hint: expect.stringContaining('crew-mac workflows install'),
    });
  });

  it('agent-uv: không thấy uv mà máy chưa có agent BMAD thì warn; đã có agent BMAD thì fail kèm lệnh cài', async () => {
    const mac = await installed((remote) =>
      remote.includes('command -v uv') ? { code: 1, stdout: '' } : okSsh(remote),
    );
    const uvCheck = async () =>
      (await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 })).find(
        (r) => r.id === 'agent-uv',
      );
    expect(await uvCheck()).toMatchObject({
      status: 'warn',
      title: 'uv trong PATH của sshd agent',
      detail: expect.stringContaining('chưa có agent BMAD'),
      hint: expect.stringContaining('cài uv: curl -LsSf https://astral.sh/uv/install.sh | sh'),
    });
    // Run BMAD đã chạy trên máy: dấu `.in_use` trong thư mục ghim BMAD.
    const marks = join(pinDir(mac.home, FIXTURE_BMAD_PIN), '.in_use');
    mkdirSync(marks, { recursive: true });
    writeFileSync(join(marks, '0b7f3c2e-7d1a-4c55-9a51-5d0e7a6b9c10'), '4242 1760000000\n');
    expect(await uvCheck()).toMatchObject({
      status: 'fail',
      hint: expect.stringContaining('cài uv: curl -LsSf https://astral.sh/uv/install.sh | sh'),
    });
    rmSync(marks, { recursive: true });
    expect((await uvCheck())?.status).toBe('warn');
    // Worktree agent đã dựng BMAD (`_bmad/`).
    mkdirSync(join(macPaths(mac.home).defaultWorktreeRoot, 'bmad', '_bmad'), { recursive: true });
    expect(await uvCheck()).toMatchObject({ status: 'fail', detail: expect.stringContaining('agent BMAD') });
    const ok = await installed((remote) =>
      remote.includes('command -v uv') ? { stdout: '/Users/owner/.local/bin/uv\n' } : okSsh(remote),
    );
    const again = await doctor(ok.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(again.find((r) => r.id === 'agent-uv')).toMatchObject({
      status: 'ok',
      detail: '/Users/owner/.local/bin/uv',
    });
  });

  it('agent-node: sshd agent không thấy node thì fail kèm cách sửa; khối PATH thiếu thư mục node thì zshenv-path fail', async () => {
    const mac = await installed((remote) =>
      remote.includes('command -v node') ? { code: 1, stdout: '' } : okSsh(remote),
    );
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'agent-node')).toMatchObject({
      status: 'fail',
      hint: expect.stringContaining('crew-mac setup'),
    });
    expect(results.find((r) => r.id === 'zshenv-path')?.status).toBe('ok');
    const zshenv = macPaths(mac.home).zshenv;
    // installed() dùng node đang chạy test: khối PATH chứa thư mục của nó.
    const nodeDir = dirname(process.execPath);
    expect(readFileSync(zshenv, 'utf8')).toContain(`:${nodeDir}:`);
    writeFileSync(zshenv, readFileSync(zshenv, 'utf8').replace(`:${nodeDir}`, ''));
    const again = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(again.find((r) => r.id === 'zshenv-path')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining(nodeDir),
    });
  });

  it('crew-docs: node của agent thoát 127 thì gợi ý sửa PATH, không gợi ý dời bundle', async () => {
    const mac = await installed(okSsh);
    const root = macPaths(mac.home).defaultWorktreeRoot;
    mkdirSync(join(root, 'integrator', 'docs'), { recursive: true });
    writeFileSync(join(root, 'integrator', 'docs', 'flows.yaml'), 'version: 1\n');
    mac.runner.on('ssh', (args) => {
      const remote = args.at(-1) as string;
      if (remote.includes('BUNDLE='))
        return {
          stdout:
            'BUNDLE=/Users/owner/crew-tools/crew-docs.cjs\nRUNTIME=/Users/owner/crew-tools/node\nGITDIR=/x/.git\n',
        };
      if (remote.includes('--version') && remote.includes('node ') && !remote.includes('ELECTRON'))
        return { code: 127, stderr: 'zsh: command not found: node' };
      if (remote.includes('--version') && !remote.includes('crew-claude-run'))
        return { stdout: 'crew-docs 0.1.0\n' };
      return okSsh(remote);
    });
    const r = (await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 })).find(
      (c) => c.id === 'crew-docs',
    );
    expect(r?.status).toBe('fail');
    expect(r?.detail).toContain('node không có trong PATH của sshd agent');
    expect(r?.hint).toContain('crew-mac setup');
    expect(r?.hint).not.toContain('Dời');
  });

  it('claude treo: phép thử fail và trỏ sang check TCC', async () => {
    const { ctx } = await installed((remote) =>
      remote.includes('claude -p') ? { code: 124, stdout: 'CREW_MAC_TIMEOUT\n' } : okSsh(remote),
    );
    const results = await doctor(ctx, { probe: true, tccWindow: '24h', probeTimeoutSec: 90 });
    const probe = results.find((r) => r.id === 'claude-print-git');
    expect(probe?.status).toBe('fail');
    expect(probe?.hint).toContain('tcc-pending');
  });

  it('runner phía Mac quá hạn cũng tính là treo', async () => {
    const { ctx } = await installed((remote) =>
      remote.includes('claude -p') ? { code: 137, timedOut: true } : okSsh(remote),
    );
    const results = await doctor(ctx, { probe: true, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'claude-print-git')?.status).toBe('fail');
  });

  it('hộp thoại TCC đang chờ thì fail kèm hướng dẫn', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('/usr/bin/log', () => ({ stdout: TCC_LOG }));
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    const tcc = results.find((r) => r.id === 'tcc-pending');
    expect(tcc?.status).toBe('fail');
    expect(tcc?.detail).toContain('2.1.289');
    expect(tcc?.hint).toContain('Allow');
    expect(results.some((r) => r.id === 'claude-print-git')).toBe(false);
  });

  it('hộp thoại TCC của app khác (không phải agent) chỉ warn', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('/usr/bin/log', () => ({
      stdout: TCC_LOG.replace(
        '/Users/owner/.local/share/claude/versions/2.1.289',
        '/Applications/Orca.app',
      ).replace('identifier=com.anthropic.claude-code', 'identifier=com.orca.app'),
    }));
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    const tcc = results.find((r) => r.id === 'tcc-pending');
    expect(tcc?.status).toBe('warn');
    expect(tcc?.detail).toContain('Orca.app');
  });

  it('có cả hộp thoại agent lẫn app khác thì fail, hint chỉ của agent', async () => {
    const mac = await installed(okSsh);
    const orca =
      '2026-10-06 11:00:00.000 Df tccd[1:1] [com.apple.TCC:access] AUTHREQ_PROMPTING: msgID=1.1, service=kTCCServiceSystemPolicyDocumentsFolder, subject=Sub:{/Applications/Orca.app}Resp:{TCCDProcess: identifier=com.orca.app, pid=9}';
    mac.runner.on('/usr/bin/log', () => ({ stdout: `${TCC_LOG}\n${orca}` }));
    const tcc = (await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 })).find(
      (r) => r.id === 'tcc-pending',
    );
    expect(tcc?.status).toBe('fail');
    expect(tcc?.detail).toContain('app khác:');
    expect(tcc?.hint).toContain('2.1.289');
    expect(tcc?.hint).not.toContain('Orca');
  });

  it('identifier com.anthropic.claude-code đủ để coi là agent dù đường dẫn lạ', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('/usr/bin/log', () => ({
      stdout:
        '2026-10-06 11:00:00.000 Df tccd[1:1] [com.apple.TCC:access] AUTHREQ_PROMPTING: msgID=2.2, service=kTCCServiceSystemPolicyDocumentsFolder, subject=Sub:{/opt/cask/Weird.app/Contents/MacOS/x}Resp:{TCCDProcess: identifier=com.anthropic.claude-code, pid=9}',
    }));
    const tcc = (await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 })).find(
      (r) => r.id === 'tcc-pending',
    );
    expect(tcc?.status).toBe('fail');
  });

  it('Claude chưa đăng nhập trong phiên sshd thì fail', async () => {
    const { ctx } = await installed((remote) =>
      remote.includes('auth status') ? { stdout: JSON.stringify({ loggedIn: false }) } : okSsh(remote),
    );
    const results = await doctor(ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'claude-auth')?.status).toBe('fail');
  });

  it('IP Tailscale đổi so với config thì fail', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('tailscale', () => ({ stdout: '100.101.1.1\n' }));
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'tailscale')?.status).toBe('fail');
  });

  it('wrapper bị xóa thì fail, bị sửa thì cảnh báo', async () => {
    const mac = await installed(okSsh);
    const paths = macPaths(mac.home);
    writeFileSync(paths.wrapper, '#!/bin/sh\nexec claude "$@"\n', { mode: 0o755 });
    let results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'wrapper')?.status).toBe('warn');
    rmSync(paths.wrapper);
    results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'wrapper')?.status).toBe('fail');
  });

  it('wrapper không chạy được qua sshd agent thì fail', async () => {
    const { ctx } = await installed((remote) =>
      remote.includes('crew-claude-run') ? { code: 127, stderr: 'claude: command not found' } : okSsh(remote),
    );
    const results = await doctor(ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'wrapper')?.status).toBe('fail');
  });

  it('log TCC có dòng lệch định dạng thì cảnh báo, không báo đạt', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('/usr/bin/log', () => ({
      stdout: `Timestamp               Ty Process[PID:TID]\n${TCC_PRIVATE_LINE}\n`,
    }));
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    const tcc = results.find((r) => r.id === 'tcc-pending');
    expect(tcc?.status).toBe('warn');
    expect(tcc?.detail).toContain('1 dòng');
  });

  it('không đọc được số liệu tải thì cảnh báo', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('/usr/bin/memory_pressure', () => ({ code: 1, stdout: '' }));
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'load')?.status).toBe('warn');
  });

  it('máy quá tải thì cảnh báo', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('/usr/sbin/sysctl', (args) => ({
      stdout: args.includes('vm.loadavg') ? '{ 25.0 20.0 18.0 }\n' : '10\n',
    }));
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    const load = results.find((r) => r.id === 'load');
    expect(load?.status).toBe('warn');
    expect(load?.hint).toBe('Máy đang bận; Paperclip sẽ cho run mới chờ tới khi tải giảm.');
  });

  it('reaper thoát lỗi thì fail', async () => {
    const mac = await installed(okSsh);
    const base = mac.runner;
    const original = base.run.bind(base);
    base.run = async (command, args, options) =>
      command === 'launchctl' && args[1] === 'gui/501/com.2p.crew-mac-reaper'
        ? { code: 0, stdout: 'state = not running\n\tlast exit code = 1\n', stderr: '', timedOut: false }
        : original(command, args, options);
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'reaper')?.status).toBe('fail');
  });

  it('launcher thiếu, hoặc trỏ tới node hay cli.js không còn, thì fail', async () => {
    const mac = await installed(okSsh);
    const paths = macPaths(mac.home);
    writeFileSync(paths.launcher, "#!/bin/sh\nexec '/khong/co/node' '/khong/co/cli.js' \"$@\"\n", {
      mode: 0o755,
    });
    let results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'launcher')?.status).toBe('fail');
    rmSync(paths.launcher);
    results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'launcher')?.status).toBe('fail');
  });
});

describe('doctor: chủ sshd agent và tcc-owner', () => {
  const OPTIONS = { probe: false, tccWindow: '24h', probeTimeoutSec: 90 };

  /** Máy khỏe đã chuyển sang chế độ app; `parent` là cha của listener 4242, null thì không có listener. */
  async function appMode(parent: { pid: number; exe: string } | null) {
    const mac = await installed(okSsh);
    await setup(mac.ctx, { sshdOwner: 'app' });
    const paths = macPaths(mac.home);
    if (parent !== null) {
      writeFileSync(paths.sshdPid, '4242\n');
      fakeProcs(mac.runner, () => ({
        4242: { ppid: parent.pid, command: `/usr/sbin/sshd -D -f ${paths.sshdConfig} -E ${paths.sshdLog}` },
        [parent.pid]: { ppid: 0, command: parent.exe, comm: parent.exe },
      }));
    } else {
      fakeProcs(mac.runner, () => ({}));
    }
    const results = await doctor(mac.ctx, OPTIONS);
    const byId = (id: string) => results.find((r) => r.id === id);
    return { mac, results, sshd: byId('sshd-agent'), tcc: byId('tcc-owner') };
  }

  it('listener là con của 2P Crew: sshd-agent và tcc-owner đạt, tcc-owner ngay sau sshd-agent', async () => {
    const t = await appMode({ pid: 4100, exe: APP_EXECUTABLE });
    expect(t.sshd).toMatchObject({ status: 'ok', detail: expect.stringContaining('con của 2P Crew') });
    expect(t.tcc).toMatchObject({ status: 'ok', detail: expect.stringContaining('quyền macOS gắn với app') });
    const ids = t.results.map((r) => r.id);
    expect(ids.indexOf('tcc-owner')).toBe(ids.indexOf('sshd-agent') + 1);
  });

  it('app đã thoát hoặc crash (listener mồ côi): cảnh báo, không fail, giải thích TCC vẫn gán theo app', async () => {
    const t = await appMode({ pid: 1, exe: '/sbin/launchd' });
    expect(t.sshd).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('listener mồ côi (app đã thoát hoặc crash)'),
      hint: expect.stringContaining('Mở 2P Crew'),
    });
    expect(t.tcc?.status).toBe('warn');
    expect(t.tcc?.detail).toContain('vẫn gán');
    expect(t.tcc?.hint).toContain('Mở 2P Crew');
  });

  it('cha không phải 2P Crew: cảnh báo, nêu tên cha', async () => {
    const t = await appMode({
      pid: 777,
      exe: '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
    });
    expect(t.sshd?.status).toBe('warn');
    expect(t.tcc).toMatchObject({ status: 'warn', detail: expect.stringContaining('Terminal') });
  });

  it('chế độ app mà không có listener: sshd-agent fail, gợi ý mở app; tcc-owner chỉ cảnh báo', async () => {
    const t = await appMode(null);
    expect(t.sshd).toMatchObject({ status: 'fail', hint: 'Mở 2P Crew (app giữ sshd agent ở chế độ này).' });
    expect(t.tcc?.status).toBe('warn');
  });

  it('chế độ app mà LaunchAgent sshd vẫn nạp: fail vì hai chủ một cổng', async () => {
    const mac = await installed(okSsh);
    await setup(mac.ctx, { sshdOwner: 'app' });
    mac.loaded.add(SSHD_LABEL);
    fakeProcs(mac.runner, () => ({}));
    const sshd = (await doctor(mac.ctx, OPTIONS)).find((r) => r.id === 'sshd-agent');
    expect(sshd).toMatchObject({ status: 'fail', detail: expect.stringContaining('hai chủ') });
  });

  it('chế độ LaunchAgent: sshd-agent như cũ, tcc-owner cảnh báo quyền gắn theo bản Claude', async () => {
    const mac = await installed(okSsh);
    const results = await doctor(mac.ctx, OPTIONS);
    expect(results.find((r) => r.id === 'sshd-agent')?.status).toBe('ok');
    expect(results.find((r) => r.id === 'tcc-owner')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('chế độ LaunchAgent, quyền macOS gắn theo bản Claude'),
    });
    expect(mac.runner.calls.some((c) => c.command === '/bin/ps' && c.args.includes('-p'))).toBe(false);
  });

  it('hộp thoại quyền của app 2P Crew tính là của agent', async () => {
    expect(isAgentTccSubject('com.2p-solutions.crew.mac')).toBe(true);
    expect(isAgentTccSubject('/x/y', 'com.2p-solutions.crew.mac')).toBe(true);
    expect(isAgentTccSubject('com.2p-solutions.crew')).toBe(false);
    // Dạng dòng log thật của tccd khi app (responsible) hỏi quyền ổ rời.
    const line =
      '2026-10-09 12:08:12.188 Df tccd[75697:6cc2771] [com.apple.TCC:access] AUTHREQ_PROMPTING: msgID=53246.17344, service=kTCCServiceSystemPolicyRemovableVolumes, subject=Sub:{com.2p-solutions.crew.mac}Resp:{TCCDProcess: identifier=com.2p-solutions.crew.mac, pid=21600, auid=501, euid=501, responsible_path=/Applications/2P Crew.app/Contents/MacOS/2P Crew, binary_path=/Applications/2P Crew.app/Contents/MacOS/2P Crew},';
    const mac = await installed(okSsh);
    mac.runner.on('/usr/bin/log', () => ({ stdout: `Timestamp\n${line}\n` }));
    const tcc = (await doctor(mac.ctx, OPTIONS)).find((r) => r.id === 'tcc-pending');
    expect(tcc?.status).toBe('fail');
  });
});
