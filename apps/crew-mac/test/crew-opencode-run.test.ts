import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPENCODE_WRAPPER_SOURCE } from '../src/wrapper.js';

const RUN = '11111111-2222-4333-8444-555555555555';
const AGENT = '22222222-3333-4444-8555-666666666666';
/** Chuỗi mốc thay key thật: không được xuất hiện ở đâu ngoài env của process opencode. */
const KEY = 'MOC-KEY-7Q4ZK-r24';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'crew-rt-'));
  const root = join(home, 'wt');
  mkdirSync(root);
  const bin = join(home, 'opencode');
  const seen = join(home, 'opencode.env');
  writeFileSync(
    bin,
    `#!/bin/sh\nenv > '${seen}'\necho --argv-- >> '${seen}'\nprintf '%s\\n' "$@" >> '${seen}'\n`,
    {
      mode: 0o755,
    },
  );
  const security = join(home, 'security');
  const securityArgs = join(home, 'security.args');
  writeFileSync(
    security,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > '${securityArgs}'`,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: biến shell trong script giả, không phải template JS.
      '[ "${FAKE_NO_KEY:-}" = 1 ] && { echo "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain." >&2; exit 44; }',
      `for a in "$@"; do [ "$a" = -w ] && { echo '${KEY}'; exit 0; }; done`,
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const crewMac = join(home, 'crew-mac');
  const crewMacArgs = join(home, 'crew-mac.args');
  writeFileSync(crewMac, `#!/bin/sh\nprintf '%s\\n' "$@" > '${crewMacArgs}'\nexit 0\n`, { mode: 0o755 });
  return { home, root, bin, seen, security, securityArgs, crewMac, crewMacArgs };
}

type T = ReturnType<typeof setup>;

function run(
  t: T,
  env: Record<string, string>,
  args: string[] = ['run', '--format', 'json', 'làm việc'],
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('/bin/sh', [OPENCODE_WRAPPER_SOURCE, ...args], {
      cwd: t.root,
      stdio: 'pipe',
      encoding: 'utf8',
      env: {
        PATH: '/usr/bin:/bin',
        HOME: t.home,
        CREW_OPENCODE_BIN: t.bin,
        CREW_SECURITY_BIN: t.security,
        CREW_MAC_BIN: t.crewMac,
        ...env,
      },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    const x = e as { status: number; stdout: string; stderr: string };
    return { code: x.status, stdout: x.stdout, stderr: x.stderr };
  }
}

const IN_RUN = { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT };

function grepTree(dir: string, needle: string): string {
  if (!existsSync(dir)) return '';
  try {
    return execFileSync('/usr/bin/grep', ['-rl', needle, dir], { encoding: 'utf8' }).trim();
  } catch (e) {
    if ((e as { status: number }).status === 1) return '';
    throw e;
  }
}

describe('crew-opencode-run', () => {
  it('key chỉ vào env của opencode; không có trong argv, stderr, stdout, file dưới HOME', () => {
    const t = setup();
    const r = run(t, IN_RUN);
    expect(r.code).toBe(0);
    const seen = readFileSync(t.seen, 'utf8');
    expect(seen).toMatch(new RegExp(`^CREW_OPENCODE_GO_KEY=${KEY}$`, 'm'));
    expect(seen).toMatch(new RegExp(`^OPENCODE_API_KEY=${KEY}$`, 'm'));
    expect(seen.split('--argv--\n')[1]).not.toContain('MOC-KEY');
    expect(r.stdout + r.stderr).not.toContain('MOC-KEY');
    expect(grepTree(join(t.home, '.crew'), 'MOC-KEY')).toBe('');
    expect(grepTree(t.root, 'MOC-KEY')).toBe('');
    // Keychain đọc đúng service/account, key không bao giờ là đối số của security.
    expect(readFileSync(t.securityArgs, 'utf8').trim().split('\n')).toEqual([
      'find-generic-password',
      '-s',
      'crew.opencode-go',
      '-a',
      'crew',
      '-w',
    ]);
  });

  it('OPENCODE_CONFIG_CONTENT trỏ {env:CREW_OPENCODE_GO_KEY} và cho phép external_directory', () => {
    const t = setup();
    run(t, IN_RUN);
    const line = readFileSync(t.seen, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('OPENCODE_CONFIG_CONTENT=')) as string;
    const cfg = JSON.parse(line.slice('OPENCODE_CONFIG_CONTENT='.length));
    expect(cfg.provider['opencode-go'].options.apiKey).toBe('{env:CREW_OPENCODE_GO_KEY}');
    expect(cfg.permission).toEqual({ edit: 'allow', bash: 'allow', external_directory: 'allow' });
  });

  it('opencode run thêm --print-logs để lỗi quota ra stderr ngay; lệnh khác giữ nguyên', () => {
    const t = setup();
    run(t, IN_RUN);
    expect(readFileSync(t.seen, 'utf8').split('--argv--\n')[1]).toBe(
      'run\n--print-logs\n--format\njson\nlàm việc\n',
    );
    run(t, IN_RUN, ['run', '--print-logs', 'x']);
    expect(readFileSync(t.seen, 'utf8').split('--argv--\n')[1]).toBe('run\n--print-logs\nx\n');
    run(t, {}, ['--version']);
    expect(readFileSync(t.seen, 'utf8').split('--argv--\n')[1]).toBe('--version\n');
  });

  it('XDG_DATA_HOME riêng của agent, giữ XDG_CONFIG_HOME adapter đưa vào', () => {
    const t = setup();
    run(t, { ...IN_RUN, XDG_CONFIG_HOME: join(t.home, 'asset-xdg') });
    const seen = readFileSync(t.seen, 'utf8');
    const base = join(t.home, '.crew', 'runtimes', 'opencode', AGENT);
    expect(seen).toContain(`XDG_DATA_HOME=${join(base, 'data')}`);
    expect(seen).toContain(`XDG_STATE_HOME=${join(base, 'state')}`);
    expect(seen).toContain(`XDG_CACHE_HOME=${join(base, 'cache')}`);
    expect(seen).toContain(`XDG_CONFIG_HOME=${join(t.home, 'asset-xdg')}`);
    expect(existsSync(join(t.root, '.paperclip-runtime', 'runs', RUN, 'pgid'))).toBe(true);
    const args = readFileSync(t.crewMacArgs, 'utf8').trim().split('\n');
    expect(args.slice(0, 3)).toEqual(['workflow-check', '--runtime', 'opencode_local']);
  });

  it('không có XDG_CONFIG_HOME thì dùng thư mục config riêng của agent', () => {
    const t = setup();
    run(t, IN_RUN);
    expect(readFileSync(t.seen, 'utf8')).toContain(
      `XDG_CONFIG_HOME=${join(t.home, '.crew', 'runtimes', 'opencode', AGENT, 'config')}`,
    );
  });

  it('thiếu key trong Keychain thì 78 với câu cố định, không chạy opencode', () => {
    const t = setup();
    const r = run(t, { ...IN_RUN, FAKE_NO_KEY: '1' });
    expect(r.code).toBe(78);
    expect(r.stderr).toContain(
      'crew-runtime blocked: thiếu key OpenCode Go trong Keychain (service crew.opencode-go)',
    );
    expect(r.stderr).not.toContain('SecKeychain');
    expect(existsSync(t.seen)).toBe(false);
  });

  it('PAPERCLIP_AGENT_ID sai dạng trong run thì 78, không đọc Keychain', () => {
    const t = setup();
    const r = run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: 'x y' });
    expect(r.code).toBe(78);
    expect(r.stderr).toMatch(/^crew-runtime blocked: thiếu PAPERCLIP_AGENT_ID/m);
    expect(existsSync(t.securityArgs)).toBe(false);
  });

  it('workflow-check từ chối thì 78, không đọc Keychain', () => {
    const t = setup();
    writeFileSync(t.crewMac, '#!/bin/sh\necho "crew-workflow blocked: x" >&2\nexit 1\n', { mode: 0o755 });
    expect(run(t, IN_RUN).code).toBe(78);
    expect(existsSync(t.securityArgs)).toBe(false);
    expect(existsSync(t.seen)).toBe(false);
  });

  it('ngoài run dùng thư mục shared, không ghi run marker', () => {
    const t = setup();
    expect(run(t, {}, ['--version']).code).toBe(0);
    expect(readFileSync(t.seen, 'utf8')).toContain(
      `XDG_DATA_HOME=${join(t.home, '.crew', 'runtimes', 'opencode', 'shared', 'data')}`,
    );
    expect(existsSync(join(t.root, '.paperclip-runtime'))).toBe(false);
  });
});
