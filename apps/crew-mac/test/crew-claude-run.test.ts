import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { WRAPPER_SOURCE } from '../src/wrapper.js';

const RUN_A = '11111111-2222-4333-8444-555555555555';
const roots: string[] = [];
const groups: number[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'crew-wrapper-'));
  roots.push(root);
  return root;
}

/** `crew-mac` giả: ghi tham số vào `<dir>/crew-mac.args` rồi thoát với mã `code`. */
function fakeCrewMac(code = 0): { bin: string; argsFile: string } {
  const dir = newRoot();
  const bin = join(dir, 'crew-mac');
  const argsFile = join(dir, 'crew-mac.args');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\nexit ${code}\n`, { mode: 0o755 });
  return { bin, argsFile };
}

/** claude giả: ghi dấu rằng đã được exec. */
function fakeClaude(): { bin: string; marker: string } {
  const dir = newRoot();
  const bin = join(dir, 'claude');
  const marker = join(dir, 'claude.ran');
  writeFileSync(bin, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  return { bin, marker };
}

function runWrapper(root: string, args: string[], env: NodeJS.ProcessEnv): number {
  try {
    execFileSync('/bin/sh', [WRAPPER_SOURCE, ...args], { cwd: root, env, stdio: 'pipe' });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

function realRoot(path: string): string {
  return realpathSync(path);
}

function envWithout(name: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env[name];
  return env;
}

afterEach(() => {
  for (const pgid of groups.splice(0)) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {}
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('crew-claude-run', () => {
  it('file nguồn có quyền chạy', () => {
    expect(statSync(WRAPPER_SOURCE).mode & 0o755).toBe(0o755);
  });

  it('không có PAPERCLIP_RUN_ID thì chỉ exec và chuyển nguyên tham số', () => {
    const root = newRoot();
    const out = execFileSync('/bin/sh', [WRAPPER_SOURCE, '--print', 'a b'], {
      cwd: root,
      env: envWithout('PAPERCLIP_RUN_ID', { CREW_CLAUDE_BIN: '/bin/echo' }),
      encoding: 'utf8',
    });
    expect(out).toBe('--print a b\n');
    expect(existsSync(join(root, '.paperclip-runtime'))).toBe(false);
  });

  it('run id sai dạng thì không ghi gì', () => {
    const root = newRoot();
    execFileSync('/bin/sh', [WRAPPER_SOURCE, '-c', 'true', '--plugin-dir', '/x'], {
      cwd: root,
      env: {
        ...process.env,
        PAPERCLIP_RUN_ID: '../../etc',
        CREW_CLAUDE_BIN: '/bin/sh',
        CREW_MAC_BIN: fakeCrewMac().bin,
      },
    });
    expect(existsSync(join(root, '.paperclip-runtime'))).toBe(false);
  });

  it.skipIf(process.platform !== 'darwin')('ghi PGID và thời điểm bắt đầu trước khi exec agent', async () => {
    const root = newRoot();
    const child = spawn('/bin/sh', [WRAPPER_SOURCE, '-c', 'exec sleep 301', '--plugin-dir', '/x'], {
      cwd: root,
      env: {
        ...process.env,
        PAPERCLIP_RUN_ID: RUN_A,
        CREW_CLAUDE_BIN: '/bin/sh',
        CREW_MAC_BIN: fakeCrewMac().bin,
      },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    groups.push(child.pid as number);
    const dir = join(root, '.paperclip-runtime', 'runs', RUN_A);
    // Wrapper chạy workflow-check (giả) trước khi ghi: chờ file thay vì ngủ cố định để không chập chờn khi máy bận.
    for (let i = 0; i < 50 && !existsSync(join(dir, 'pgid')); i++) await sleep(100);
    expect(readFileSync(join(dir, 'pgid'), 'utf8').trim()).toBe(String(child.pid));
    const started = Number(readFileSync(join(dir, 'started'), 'utf8').trim());
    expect(Math.abs(started - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });

  it.skipIf(process.platform !== 'darwin')(
    'started là thời điểm SINH của process, không phải lúc wrapper chạy (profile chậm không làm lệch)',
    async () => {
      const root = newRoot();
      const beforeSpawn = Math.floor(Date.now() / 1000);
      // Mô phỏng phiên SSH: shell sinh ra, mất 3 giây (profile chậm), rồi exec wrapper trong cùng process.
      const child = spawn(
        '/bin/sh',
        ['-c', `sleep 3; exec /bin/sh '${WRAPPER_SOURCE}' -c 'exec sleep 301' --plugin-dir /x`],
        {
          cwd: root,
          env: {
            ...process.env,
            PAPERCLIP_RUN_ID: RUN_A,
            CREW_CLAUDE_BIN: '/bin/sh',
            CREW_MAC_BIN: fakeCrewMac().bin,
          },
          detached: true,
          stdio: 'ignore',
        },
      );
      child.unref();
      const afterSpawn = Math.floor(Date.now() / 1000);
      groups.push(child.pid as number);
      const dir = join(root, '.paperclip-runtime', 'runs', RUN_A);
      // Wrapper chỉ ghi sau 3 giây ngủ cộng thời gian ps/awk/workflow-check: chờ file thay vì ngủ cố định, vì máy bận
      // (nhiều vitest chạy song song) làm wrapper chậm quá mốc cũ 3,8 giây.
      for (let i = 0; i < 150 && !existsSync(join(dir, 'pgid')); i++) await sleep(100);
      const started = Number(readFileSync(join(dir, 'started'), 'utf8').trim());
      // Process sinh trong [beforeSpawn, afterSpawn]; ps etime và date +%s đều làm tròn xuống giây nên chừa 1 giây mỗi
      // phía. Nếu started là lúc wrapper chạy (>= sinh + 3 giây) thì vượt afterSpawn + 1, nên vẫn bắt được lỗi.
      expect(started).toBeGreaterThanOrEqual(beforeSpawn - 1);
      expect(started).toBeLessThanOrEqual(afterSpawn + 1);
      expect(readFileSync(join(dir, 'pgid'), 'utf8').trim()).toBe(String(child.pid));
    },
    25_000,
  );

  describe('kiểm workflow trước run Paperclip', () => {
    const runEnv = (extra: Record<string, string>) => ({ ...process.env, PAPERCLIP_RUN_ID: RUN_A, ...extra });

    it('gọi crew-mac workflow-check với worktree hiện tại và --plugin-dir rồi mới exec agent', () => {
      const root = newRoot();
      const mac = fakeCrewMac(0);
      const claude = fakeClaude();
      const code = runWrapper(
        root,
        ['--print', '--plugin-dir', '/pin dir'],
        runEnv({ CREW_MAC_BIN: mac.bin, CREW_CLAUDE_BIN: claude.bin }),
      );
      expect(code).toBe(0);
      expect(readFileSync(mac.argsFile, 'utf8')).toBe(
        `workflow-check\n--root\n${realRoot(root)}\n--plugin-dir\n/pin dir\n`,
      );
      expect(existsSync(claude.marker)).toBe(true);
    });

    it('nhận dạng --plugin-dir=<dir>', () => {
      const root = newRoot();
      const mac = fakeCrewMac(0);
      const claude = fakeClaude();
      expect(
        runWrapper(root, ['--plugin-dir=/p'], runEnv({ CREW_MAC_BIN: mac.bin, CREW_CLAUDE_BIN: claude.bin })),
      ).toBe(0);
      expect(readFileSync(mac.argsFile, 'utf8')).toContain('--plugin-dir\n/p\n');
    });

    it('thiếu --plugin-dir thì exit 78, không chạy agent, không ghi pgid', () => {
      const root = newRoot();
      const mac = fakeCrewMac(0);
      const claude = fakeClaude();
      expect(
        runWrapper(root, ['--print'], runEnv({ CREW_MAC_BIN: mac.bin, CREW_CLAUDE_BIN: claude.bin })),
      ).toBe(78);
      expect(existsSync(claude.marker)).toBe(false);
      expect(existsSync(mac.argsFile)).toBe(false);
      expect(existsSync(join(root, '.paperclip-runtime'))).toBe(false);
    });

    it('hai --plugin-dir thì exit 78 (chỉ được nạp đúng bản ghim)', () => {
      const root = newRoot();
      const mac = fakeCrewMac(0);
      const claude = fakeClaude();
      const args = ['--plugin-dir', '/pin', '--plugin-dir', '/khac'];
      const r = spawnSync('/bin/sh', [WRAPPER_SOURCE, ...args], {
        cwd: root,
        env: runEnv({ CREW_MAC_BIN: mac.bin, CREW_CLAUDE_BIN: claude.bin }),
        encoding: 'utf8',
      });
      expect(r.status).toBe(78);
      expect(r.stderr).toBe(
        'crew-workflow blocked: cần đúng một --plugin-dir (bản workflow đã ghim) trong adapterConfig.extraArgs, có 2; ' +
          'chạy "crew-mac workflows list" để xem giá trị\n',
      );
      expect(existsSync(claude.marker)).toBe(false);
    });

    /** claude giả in pid của chính nó (cũng là pid của wrapper vì `exec` giữ pid) vào `<dir>/claude.pid`. */
    function pidClaude(): { bin: string; pidFile: string } {
      const dir = newRoot();
      const bin = join(dir, 'claude');
      const pidFile = join(dir, 'claude.pid');
      writeFileSync(bin, `#!/bin/sh\necho $$ > '${pidFile}'\n`, { mode: 0o755 });
      return { bin, pidFile };
    }

    it('workflow-check đạt thì ghi dấu <plugin_dir>/.in_use/<runId> = "<pid claude> <started>"', () => {
      const root = newRoot();
      const pin = newRoot();
      const claude = pidClaude();
      expect(
        runWrapper(
          root,
          ['--print', '--plugin-dir', pin],
          runEnv({ CREW_MAC_BIN: fakeCrewMac(0).bin, CREW_CLAUDE_BIN: claude.bin }),
        ),
      ).toBe(0);
      const mark = readFileSync(join(pin, '.in_use', RUN_A), 'utf8');
      expect(mark).toMatch(/^\d+ \d+\n$/);
      const [pid, started] = mark.trim().split(' ');
      expect(pid).toBe(readFileSync(claude.pidFile, 'utf8').trim());
      const runDir = join(root, '.paperclip-runtime', 'runs', RUN_A);
      expect(started).toBe(readFileSync(join(runDir, 'started'), 'utf8').trim());
      expect(existsSync(join(runDir, 'pgid'))).toBe(true);
      expect(readdirSync(join(pin, '.in_use'))).toEqual([RUN_A]);
    });

    it('PAPERCLIP_RUN_ID có ký tự lạ thì không ghi .in_use', () => {
      const root = newRoot();
      const pin = newRoot();
      const claude = fakeClaude();
      expect(
        runWrapper(
          root,
          ['--plugin-dir', pin],
          runEnv({
            PAPERCLIP_RUN_ID: 'a/../b',
            CREW_MAC_BIN: fakeCrewMac(0).bin,
            CREW_CLAUDE_BIN: claude.bin,
          }),
        ),
      ).toBe(0);
      expect(existsSync(join(pin, '.in_use'))).toBe(false);
      expect(existsSync(claude.marker)).toBe(true);
    });

    it('.in_use không ghi được (thư mục ghim chỉ đọc) thì vẫn chạy agent', () => {
      const root = newRoot();
      const pin = newRoot();
      chmodSync(pin, 0o555);
      const claude = fakeClaude();
      try {
        expect(
          runWrapper(
            root,
            ['--plugin-dir', pin],
            runEnv({ CREW_MAC_BIN: fakeCrewMac(0).bin, CREW_CLAUDE_BIN: claude.bin }),
          ),
        ).toBe(0);
      } finally {
        chmodSync(pin, 0o755);
      }
      expect(existsSync(join(pin, '.in_use'))).toBe(false);
      expect(existsSync(claude.marker)).toBe(true);
    });

    it('workflow-check từ chối hoặc không có crew-mac thì exit 78, không chạy agent', () => {
      const root = newRoot();
      const claude = fakeClaude();
      const blocked = fakeCrewMac(78);
      expect(
        runWrapper(
          root,
          ['--plugin-dir', '/pin'],
          runEnv({ CREW_MAC_BIN: blocked.bin, CREW_CLAUDE_BIN: claude.bin }),
        ),
      ).toBe(78);
      expect(
        runWrapper(
          root,
          ['--plugin-dir', '/pin'],
          runEnv({ CREW_MAC_BIN: join(root, 'không-có'), CREW_CLAUDE_BIN: claude.bin }),
        ),
      ).toBe(78);
      expect(existsSync(claude.marker)).toBe(false);
      expect(existsSync(join(root, '.paperclip-runtime'))).toBe(false);
    });

    it('không có PAPERCLIP_RUN_ID thì không gọi crew-mac', () => {
      const root = newRoot();
      const mac = fakeCrewMac(78);
      const claude = fakeClaude();
      const env = envWithout('PAPERCLIP_RUN_ID', { CREW_MAC_BIN: mac.bin, CREW_CLAUDE_BIN: claude.bin });
      expect(runWrapper(root, ['--print'], env)).toBe(0);
      expect(existsSync(mac.argsFile)).toBe(false);
      expect(existsSync(claude.marker)).toBe(true);
    });
  });
});
