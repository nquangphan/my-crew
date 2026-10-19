import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { AGENT_SHELL, runtimesCommand } from '../src/runtimes/command.js';
import { SECURITY_BIN } from '../src/runtimes/keychain.js';
import { runtimePaths } from '../src/runtimes/paths.js';
import { fakeMac } from './helpers/fake-mac.js';

const KEY = 'MOC-KEY-7Q4ZK-r24';

interface ShellAnswers {
  [command: string]: { code?: number; stdout?: string; stderr?: string };
}

/** Máy giả: lệnh của agent chạy qua `/bin/zsh -c`, Keychain qua security giả. */
function machine(shell: ShellAnswers, keyCode = 0) {
  const mac = fakeMac();
  mac.runner
    .on(AGENT_SHELL, (args) => shell[args.at(-1) as string] ?? { code: 127, stderr: 'command not found' })
    .on(SECURITY_BIN, (args) => {
      if (args[0] === 'add-generic-password') return {};
      if (keyCode !== 0) return { code: keyCode };
      return args.includes('-w') ? { stdout: `${KEY}\n` } : { stdout: 'attributes\n' };
    });
  const err: string[] = [];
  const run = (args: string[], stdinIsTTY = true) =>
    runtimesCommand(mac.ctx, args, { err: (l) => err.push(l), stdinIsTTY });
  const output = () => [...mac.out, ...err].join('\n');
  return { ...mac, err, run, output };
}

const ALL_OK: ShellAnswers = {
  'claude --version': { stdout: '2.1.289 (Claude Code)\n' },
  'claude auth status': { stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) },
  'codex --version': { stdout: 'codex-cli 0.130.0\n' },
  // `codex login status` in câu trạng thái ra stderr.
  'codex login status': { stderr: 'Logged in using ChatGPT\n' },
  'opencode --version': { stdout: '1.18.35\n' },
};

function installWrappers(home: string) {
  const p = runtimePaths(home);
  mkdirSync(join(home, '.crew', 'bin'), { recursive: true });
  for (const f of [p.codexWrapper, p.opencodeWrapper]) writeFileSync(f, '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(p.runMark, '# mark\n', { mode: 0o644 });
}

describe('crew-mac runtimes key opencode', () => {
  it('gọi security add-generic-password với -w cuối, không giá trị, stdio inherit', async () => {
    const m = machine(ALL_OK);
    expect(await m.run(['key', 'opencode'])).toBe(0);
    const call = m.runner.calls.find((c) => c.args[0] === 'add-generic-password');
    expect(call?.command).toBe('/usr/bin/security');
    expect(call?.args).toEqual(['add-generic-password', '-U', '-s', 'crew.opencode-go', '-a', 'crew', '-w']);
    expect(call?.options.stdio).toBe('inherit');
    expect(call?.options.input).toBeUndefined();
    expect(m.output()).toContain('đã lưu');
    expect(m.output()).not.toContain('MOC-KEY');
  });

  it('không có TTY thì thoát 2, không gọi security', async () => {
    const m = machine(ALL_OK);
    expect(await m.run(['key', 'opencode'], false)).toBe(2);
    expect(m.err.join('\n')).toContain('runtimes: cần chạy trong Terminal của owner');
    expect(m.runner.calls).toEqual([]);
  });

  it('security lỗi thì thoát 1', async () => {
    const m = machine(ALL_OK);
    m.runner.on(SECURITY_BIN, () => ({ code: 128 }));
    expect(await m.run(['key', 'opencode'])).toBe(1);
    expect(m.err.join('\n')).toMatch(/mã 128/);
  });

  it('runtime khác opencode thì lỗi dùng', async () => {
    const m = machine(ALL_OK);
    expect(await m.run(['key', 'codex'])).toBe(2);
  });
});

describe('crew-mac runtimes key-fingerprint opencode', () => {
  it('in 12 hex đầu của sha256(key), không in key', async () => {
    const m = machine(ALL_OK);
    expect(await m.run(['key-fingerprint', 'opencode'])).toBe(0);
    expect(m.out).toEqual([createHash('sha256').update(KEY).digest('hex').slice(0, 12)]);
    expect(m.output()).not.toContain('MOC-KEY');
  });

  it('chưa có key thì thoát 1 kèm gợi ý', async () => {
    const m = machine(ALL_OK, 44);
    expect(await m.run(['key-fingerprint', 'opencode'])).toBe(1);
    expect(m.err.join('\n')).toContain('crew-mac runtimes key opencode');
  });
});

describe('crew-mac runtimes status', () => {
  it('in ba dòng claude/codex/opencode, kiểm key không dùng -w', async () => {
    const m = machine(ALL_OK);
    expect(await m.run(['status'])).toBe(0);
    expect(m.out).toEqual([
      'claude_local: 2.1.289 (Claude Code) · đăng nhập có',
      'codex_local: codex-cli 0.130.0 · đăng nhập có',
      'opencode_local: 1.18.35 · key có',
    ]);
    const security = m.runner.calls.filter((c) => c.command === SECURITY_BIN);
    expect(security.every((c) => !c.args.includes('-w'))).toBe(true);
  });

  it('--json đúng hợp đồng việc máy runtimes-setup', async () => {
    const m = machine(ALL_OK);
    installWrappers(m.home);
    expect(await m.run(['status', '--json'])).toBe(0);
    expect(JSON.parse(m.out.join('\n'))).toEqual({
      wrappers: { codex: true, opencode: true },
      codex: { version: 'codex-cli 0.130.0', loggedIn: true },
      opencode: { version: '1.18.35', keyPresent: true },
    });
  });

  it('CLI chưa cài, chưa đăng nhập, không có key, wrapper thiếu bit x', async () => {
    const m = machine(
      {
        'claude --version': { stdout: '2.1.289 (Claude Code)\n' },
        'claude auth status': { code: 1, stdout: JSON.stringify({ loggedIn: false }) },
        'codex --version': { stdout: 'codex-cli 0.130.0\n' },
        'codex login status': { code: 1, stderr: 'Not logged in\n' },
      },
      44,
    );
    installWrappers(m.home);
    chmodSync(runtimePaths(m.home).codexWrapper, 0o644);
    expect(await m.run(['status'])).toBe(0);
    expect(m.out).toEqual([
      'claude_local: 2.1.289 (Claude Code) · đăng nhập không',
      'codex_local: codex-cli 0.130.0 · đăng nhập không',
      'opencode_local: chưa cài · key không',
    ]);
    m.out.length = 0;
    await m.run(['status', '--json']);
    expect(JSON.parse(m.out.join('\n'))).toEqual({
      wrappers: { codex: false, opencode: true },
      codex: { version: 'codex-cli 0.130.0', loggedIn: false },
      opencode: { version: null, keyPresent: false },
    });
  });

  it('codex chưa cài thì loggedIn null; Keychain lỗi lạ thì keyPresent null', async () => {
    const m = machine({}, 51);
    await m.run(['status', '--json']);
    expect(JSON.parse(m.out.join('\n'))).toEqual({
      wrappers: { codex: false, opencode: false },
      codex: { version: null, loggedIn: null },
      opencode: { version: null, keyPresent: null },
    });
  });

  it('lệnh agent chạy qua zsh để có PATH của ~/.zshenv như sshd agent', async () => {
    const m = machine(ALL_OK);
    await m.run(['status']);
    const shell = m.runner.calls.filter((c) => c.command === AGENT_SHELL);
    expect(shell.map((c) => c.args)).toContainEqual(['-c', 'codex login status']);
    expect(shell.every((c) => c.options.timeoutMs !== undefined)).toBe(true);
  });
});

describe('crew-mac runtimes skills-checksum', () => {
  it('thư mục thiếu thì in "không có"', async () => {
    const m = machine(ALL_OK);
    expect(await m.run(['skills-checksum'])).toBe(0);
    expect(m.out).toEqual(['không có']);
  });

  it('sha256 của cây ~/.claude/skills, tính cả symlink (không theo link), đổi khi cây đổi', async () => {
    const m = machine(ALL_OK);
    const dir = join(m.home, '.claude', 'skills');
    mkdirSync(join(dir, 'a'), { recursive: true });
    writeFileSync(join(dir, 'a', 'SKILL.md'), 'a\n');
    symlinkSync('/nowhere/b', join(dir, 'b'));
    await m.run(['skills-checksum']);
    const first = m.out.at(-1) as string;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await m.run(['skills-checksum']);
    expect(m.out.at(-1)).toBe(first);
    writeFileSync(join(dir, 'a', 'SKILL.md'), 'b\n');
    await m.run(['skills-checksum']);
    expect(m.out.at(-1)).not.toBe(first);
  });
});

describe('crew-mac runtimes (CLI)', () => {
  it('nhánh runtimes trong main; lệnh lạ thoát 2', async () => {
    const m = machine(ALL_OK);
    const err: string[] = [];
    const io = {
      out: (l: string) => m.out.push(l),
      err: (l: string) => err.push(l),
      env: {},
      context: m.ctx,
    };
    expect(await main(['runtimes', 'status'], { ...io, stdinIsTTY: false })).toBe(0);
    expect(m.out.at(-1)).toBe('opencode_local: 1.18.35 · key có');
    expect(await main(['runtimes', 'xyz'], { ...io, stdinIsTTY: false })).toBe(2);
    expect(await main(['runtimes', 'key', 'opencode'], { ...io, stdinIsTTY: false })).toBe(2);
    expect(err.join('\n')).toContain('cần chạy trong Terminal của owner');
  });
});
