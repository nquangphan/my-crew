import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODEX_WRAPPER_SOURCE } from '../src/wrapper.js';

const RUN = '11111111-2222-4333-8444-555555555555';
const AGENT = '22222222-3333-4444-8555-666666666666';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'crew-rt-'));
  const root = join(home, 'wt');
  mkdirSync(root);
  const asset = join(home, 'asset-home');
  mkdirSync(join(asset, 'skills'), { recursive: true });
  writeFileSync(join(asset, 'config.toml'), 'model = "gpt-6-luna"\n');
  mkdirSync(join(home, '.codex'));
  writeFileSync(join(home, '.codex', 'auth.json'), '{"x":1}', { mode: 0o600 });
  const bin = join(home, 'codex');
  const seen = join(home, 'codex.env');
  writeFileSync(
    bin,
    `#!/bin/sh\nenv > '${seen}'\necho --argv-- >> '${seen}'\nprintf '%s\\n' "$@" >> '${seen}'\n`,
    {
      mode: 0o755,
    },
  );
  const crewMac = join(home, 'crew-mac');
  const crewMacArgs = join(home, 'crew-mac.args');
  writeFileSync(crewMac, `#!/bin/sh\nprintf '%s\\n' "$@" > '${crewMacArgs}'\nexit 0\n`, { mode: 0o755 });
  return { home, root, asset, bin, seen, crewMac, crewMacArgs };
}

type T = ReturnType<typeof setup>;

function run(t: T, env: Record<string, string>): { code: number; stderr: string } {
  try {
    execFileSync('/bin/sh', [CODEX_WRAPPER_SOURCE, 'exec', '--json', '-'], {
      cwd: t.root,
      stdio: 'pipe',
      env: {
        PATH: '/usr/bin:/bin',
        HOME: t.home,
        CODEX_HOME: t.asset,
        CREW_CODEX_BIN: t.bin,
        CREW_MAC_BIN: t.crewMac,
        ...env,
      },
    });
    return { code: 0, stderr: '' };
  } catch (e) {
    const x = e as { status: number; stderr: Buffer };
    return { code: x.status, stderr: x.stderr.toString() };
  }
}

describe('crew-codex-run', () => {
  it('dựng CODEX_HOME riêng của agent, auth.json là symlink; asset chỉ thêm auth.json rỗng', () => {
    const t = setup();
    expect(run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT }).code).toBe(0);
    const home = join(t.home, '.crew', 'runtimes', 'codex', AGENT);
    expect(readlinkSync(join(home, 'auth.json'))).toBe(join(t.home, '.codex', 'auth.json'));
    expect(lstatSync(join(home, 'skills')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(home, 'skills'))).toBe(join(t.asset, 'skills'));
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toContain('gpt-6-luna');
    expect(statSync(join(home, 'config.toml')).mode & 0o777).toBe(0o600);
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(existsSync(join(home, 'sessions'))).toBe(true);
    expect(readdirSync(t.asset).sort()).toEqual(['auth.json', 'config.toml', 'skills']);
    const seen = readFileSync(t.seen, 'utf8');
    expect(seen).toContain(`CODEX_HOME=${home}`);
    expect(seen.split('--argv--\n')[1]).toBe('exec\n--json\n-\n');
    expect(existsSync(join(t.root, '.paperclip-runtime', 'runs', RUN, 'pgid'))).toBe(true);
    expect(existsSync(join(t.root, '.paperclip-runtime', 'runs', RUN, 'started'))).toBe(true);
  });

  it('asset thiếu auth.json thì tạo {} 0600 (file thường) và giữ lại sau khi thoát, để copy-back của adapter không ném', () => {
    const t = setup();
    expect(run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT }).code).toBe(0);
    const placeholder = join(t.asset, 'auth.json');
    expect(lstatSync(placeholder).isFile()).toBe(true);
    expect(readFileSync(placeholder, 'utf8')).toBe('{}');
    expect(statSync(placeholder).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(t.home, '.codex', 'auth.json'), 'utf8')).toBe('{"x":1}');
    // Ngoài run (adapter gọi --version) cũng vậy.
    const u = setup();
    expect(run(u, {}).code).toBe(0);
    expect(readFileSync(join(u.asset, 'auth.json'), 'utf8')).toBe('{}');
  });

  it('asset đã có auth.json thì để nguyên', () => {
    const t = setup();
    writeFileSync(join(t.asset, 'auth.json'), '{"giu":1}', { mode: 0o600 });
    expect(run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT }).code).toBe(0);
    expect(readFileSync(join(t.asset, 'auth.json'), 'utf8')).toBe('{"giu":1}');
  });

  it('không tạo được auth.json rỗng trong asset thì 78, không chạy codex', () => {
    const t = setup();
    chmodSync(t.asset, 0o500);
    try {
      const r = run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
      expect(r.code).toBe(78);
      expect(r.stderr).toMatch(/^crew-runtime blocked: không tạo được auth\.json rỗng/m);
      expect(existsSync(t.seen)).toBe(false);
    } finally {
      chmodSync(t.asset, 0o700);
    }
  });

  it('gọi workflow-check với runtime codex_local và worktree của run', () => {
    const t = setup();
    run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
    const args = readFileSync(t.crewMacArgs, 'utf8').trim().split('\n');
    expect(args.slice(0, 3)).toEqual(['workflow-check', '--runtime', 'codex_local']);
    expect(args[3]).toBe('--root');
  });

  it('CREW_SUPERPOWERS_DIR lấy từ file setup ghi', () => {
    const t = setup();
    mkdirSync(join(t.home, '.crew', 'runtimes'), { recursive: true });
    writeFileSync(join(t.home, '.crew', 'runtimes', 'superpowers-dir'), '/x/superpowers/9.9.9\n');
    run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
    expect(readFileSync(t.seen, 'utf8')).toMatch(/^CREW_SUPERPOWERS_DIR=\/x\/superpowers\/9\.9\.9$/m);
  });

  it('workflow-check thấy CREW_SUPERPOWERS_DIR từ file setup ghi (để kiểm checksum bản ghim)', () => {
    const t = setup();
    mkdirSync(join(t.home, '.crew', 'runtimes'), { recursive: true });
    writeFileSync(join(t.home, '.crew', 'runtimes', 'superpowers-dir'), '/x/superpowers/9.9.9\n');
    const envSeen = join(t.home, 'crew-mac.env');
    writeFileSync(t.crewMac, `#!/bin/sh\nenv > '${envSeen}'\nexit 0\n`, { mode: 0o755 });
    expect(run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT }).code).toBe(0);
    expect(readFileSync(envSeen, 'utf8')).toMatch(/^CREW_SUPERPOWERS_DIR=\/x\/superpowers\/9\.9\.9$/m);
  });

  it('chạy lại thì cập nhật config.toml và giữ sessions', () => {
    const t = setup();
    run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
    const home = join(t.home, '.crew', 'runtimes', 'codex', AGENT);
    writeFileSync(join(home, 'sessions', 'a.jsonl'), '{}\n');
    writeFileSync(join(t.asset, 'config.toml'), 'model = "gpt-6-sol"\n');
    expect(run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT }).code).toBe(0);
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toContain('gpt-6-sol');
    expect(existsSync(join(home, 'sessions', 'a.jsonl'))).toBe(true);
  });

  it('thiếu đăng nhập thì thoát 78, không chạy codex', () => {
    const t = setup();
    rmSync(join(t.home, '.codex', 'auth.json'));
    const r = run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
    expect(r.code).toBe(78);
    expect(r.stderr).toMatch(/^crew-runtime blocked: Codex chưa đăng nhập trên máy/m);
    expect(existsSync(t.seen)).toBe(false);
  });

  it('PAPERCLIP_AGENT_ID sai dạng trong run thì thoát 78', () => {
    const t = setup();
    const r = run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: '../x' });
    expect(r.code).toBe(78);
    expect(r.stderr).toMatch(/^crew-runtime blocked: thiếu PAPERCLIP_AGENT_ID/m);
    expect(existsSync(join(t.home, '.crew', 'runtimes', 'codex'))).toBe(false);
  });

  it('workflow-check từ chối thì thoát 78', () => {
    const t = setup();
    writeFileSync(t.crewMac, '#!/bin/sh\necho "crew-workflow blocked: x" >&2\nexit 1\n', { mode: 0o755 });
    const r = run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
    expect(r.code).toBe(78);
    expect(r.stderr).toContain('crew-workflow blocked:');
    expect(existsSync(t.seen)).toBe(false);
  });

  it('ngoài run (adapter gọi --version) thì dùng thư mục shared, không ghi run marker', () => {
    const t = setup();
    expect(run(t, {}).code).toBe(0);
    expect(readFileSync(t.seen, 'utf8')).toContain(
      `CODEX_HOME=${join(t.home, '.crew', 'runtimes', 'codex', 'shared')}`,
    );
    expect(existsSync(join(t.root, '.paperclip-runtime'))).toBe(false);
    expect(existsSync(t.crewMacArgs)).toBe(false);
  });
  describe('auth.json của agent đã bị Codex thay bằng file thường (refresh token ghi tạm rồi rename)', () => {
    const TOKEN = '{"tokens":{"refresh_token":"MOC-BI-MAT-MOI"},"last_refresh":"2026-10-10T07:00:00Z"}';
    function agentFile(t: T, content: string, agentAge: number, ownerAge: number) {
      const home = join(t.home, '.crew', 'runtimes', 'codex', AGENT);
      mkdirSync(home, { recursive: true });
      const f = join(home, 'auth.json');
      writeFileSync(f, content, { mode: 0o600 });
      const now = Date.now() / 1000;
      utimesSync(f, now - agentAge, now - agentAge);
      const owner = join(t.home, '.codex', 'auth.json');
      utimesSync(owner, now - ownerAge, now - ownerAge);
      return { home, f, owner };
    }
    function noTempLeft(t: T) {
      expect(readdirSync(join(t.home, '.codex'))).toEqual(['auth.json']);
    }

    it('file của agent mới hơn thì đồng bộ ngược về ~/.codex/auth.json (0600, nguyên tử) rồi khôi phục symlink', () => {
      const t = setup();
      const p = agentFile(t, TOKEN, 10, 3600);
      const r = run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
      expect(r.code).toBe(0);
      expect(readFileSync(p.owner, 'utf8')).toBe(TOKEN);
      expect(lstatSync(p.owner).isFile()).toBe(true);
      expect(statSync(p.owner).mode & 0o777).toBe(0o600);
      expect(readlinkSync(p.f)).toBe(p.owner);
      expect(r.stderr).not.toContain('MOC-BI-MAT');
      expect(readFileSync(t.seen, 'utf8')).not.toContain('MOC-BI-MAT');
      noTempLeft(t);
    });

    it('~/.codex/auth.json mới hơn (owner đăng nhập lại) thì bỏ bản cũ của agent, khôi phục symlink', () => {
      const t = setup();
      const p = agentFile(t, TOKEN, 3600, 10);
      expect(run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT }).code).toBe(0);
      expect(readFileSync(p.owner, 'utf8')).toBe('{"x":1}');
      expect(readlinkSync(p.f)).toBe(p.owner);
      noTempLeft(t);
    });

    it('nội dung giống nhau thì chỉ khôi phục symlink', () => {
      const t = setup();
      const p = agentFile(t, '{"x":1}', 10, 10);
      expect(run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT }).code).toBe(0);
      expect(readFileSync(p.owner, 'utf8')).toBe('{"x":1}');
      expect(readlinkSync(p.f)).toBe(p.owner);
    });

    it('không xác định được bản nào mới hơn thì chặn run, không đụng hai file', () => {
      const t = setup();
      const p = agentFile(t, TOKEN, 10, 10);
      const r = run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
      expect(r.code).toBe(78);
      expect(r.stderr).toMatch(/^crew-runtime blocked: Codex chưa đăng nhập đồng bộ/m);
      expect(r.stderr).not.toContain('MOC-BI-MAT');
      expect(lstatSync(p.f).isFile()).toBe(true);
      expect(readFileSync(p.f, 'utf8')).toBe(TOKEN);
      expect(readFileSync(p.owner, 'utf8')).toBe('{"x":1}');
      expect(existsSync(t.seen)).toBe(false);
      noTempLeft(t);
    });

    it('file của agent mới hơn nhưng không giống thông tin đăng nhập thì chặn, không đè ~/.codex/auth.json', () => {
      const t = setup();
      const p = agentFile(t, '{}', 10, 3600);
      const r = run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
      expect(r.code).toBe(78);
      expect(r.stderr).toMatch(/^crew-runtime blocked: Codex chưa đăng nhập đồng bộ/m);
      expect(readFileSync(p.owner, 'utf8')).toBe('{"x":1}');
      expect(readFileSync(p.f, 'utf8')).toBe('{}');
      expect(existsSync(t.seen)).toBe(false);
    });

    it('~/.codex/auth.json là symlink thì không đồng bộ ngược mà chặn', () => {
      const t = setup();
      const real = join(t.home, 'real-auth.json');
      writeFileSync(real, '{"x":1}', { mode: 0o600 });
      rmSync(join(t.home, '.codex', 'auth.json'));
      execFileSync('/bin/ln', ['-s', real, join(t.home, '.codex', 'auth.json')]);
      const home = join(t.home, '.crew', 'runtimes', 'codex', AGENT);
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, 'auth.json'), TOKEN, { mode: 0o600 });
      const now = Date.now() / 1000;
      utimesSync(real, now - 3600, now - 3600);
      const r = run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
      expect(r.code).toBe(78);
      expect(readFileSync(real, 'utf8')).toBe('{"x":1}');
      expect(lstatSync(join(t.home, '.codex', 'auth.json')).isSymbolicLink()).toBe(true);
    });

    it('auth.json của agent là thư mục thì chặn', () => {
      const t = setup();
      mkdirSync(join(t.home, '.crew', 'runtimes', 'codex', AGENT, 'auth.json'), { recursive: true });
      const r = run(t, { PAPERCLIP_RUN_ID: RUN, PAPERCLIP_AGENT_ID: AGENT });
      expect(r.code).toBe(78);
      expect(existsSync(t.seen)).toBe(false);
    });
  });
});
