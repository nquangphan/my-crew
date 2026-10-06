import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import {
  doctor,
  parseLoad,
  parsePendingTccPrompts,
  printProbeScript,
  TCC_PREDICATE,
  tccHint,
} from '../src/commands/doctor.js';
import { setup } from '../src/commands/setup.js';
import { macPaths } from '../src/paths.js';
import { fakeMac, PAPERCLIP_PUB } from './helpers/fake-mac.js';

// Dòng log thật trên Mac mini 06/10/2026 (rút gọn phần đuôi), xem spike-claude-mac.md mục D1.
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
  const mac = fakeMac();
  await setup(mac.ctx, { paperclipKey: PAPERCLIP_PUB });
  mac.runner
    .on('/usr/bin/nc', () => ({}))
    .on('ssh', (args) => sshHandler(args.at(-1) as string))
    .on('/usr/bin/log', () => ({ stdout: 'Timestamp               Ty Process[PID:TID]\n' }))
    .on('sysctl', (args) => ({ stdout: args.includes('vm.loadavg') ? '{ 1.47 1.53 1.45 }\n' : '10\n' }))
    .on('memory_pressure', () => ({ stdout: 'System-wide memory free percentage: 55%\n' }));
  return mac;
}

const okSsh = (remote: string) => {
  if (remote.includes('auth status')) return { stdout: AUTH_OK };
  if (remote.includes('crew-claude-run')) return { stdout: '2.1.289 (Claude Code)\n' };
  return { stdout: 'ok\n' };
};

describe('parsePendingTccPrompts', () => {
  it('chỉ trả hộp thoại chưa có kết quả', () => {
    expect(parsePendingTccPrompts(TCC_LOG)).toEqual({
      pending: [
        {
          msgId: '75841.27656',
          at: '2026-10-06 10:41:02.207',
          service: 'kTCCServiceSystemPolicyRemovableVolumes',
          subject: '/Users/owner/.local/share/claude/versions/2.1.289',
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
      ['sshd-port', 'ok'],
      ['zshenv-path', 'ok'],
      ['wrapper', 'ok'],
      ['worktree-root', 'ok'],
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
    mac.runner.on('memory_pressure', () => ({ code: 1, stdout: '' }));
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(results.find((r) => r.id === 'load')?.status).toBe('warn');
  });

  it('máy quá tải thì cảnh báo', async () => {
    const mac = await installed(okSsh);
    mac.runner.on('sysctl', (args) => ({
      stdout: args.includes('vm.loadavg') ? '{ 25.0 20.0 18.0 }\n' : '10\n',
    }));
    const results = await doctor(mac.ctx, { probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    const load = results.find((r) => r.id === 'load');
    expect(load?.status).toBe('warn');
    expect(load?.hint).toBe('Máy đang bận; Paperclip sẽ cho run mới chờ tới khi tải giảm.');
  });
});
