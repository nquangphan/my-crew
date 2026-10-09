import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandRunner } from '@crew/mac';
import { describe, expect, it } from 'vitest';
import { defaultAppState } from '../src/main/app-state.js';
import {
  createSystemDeps,
  exitReasonFromLog,
  readLogSince,
  summarizeLsof,
} from '../src/main/sshd/system-deps.js';

const LSOF = `COMMAND   PID          USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
sshd    16059 phannhatquang    7u  IPv4 0x1      0t0  TCP 127.0.0.1:2222 (LISTEN)
sshd    16059 phannhatquang    8u  IPv6 0x2      0t0  TCP [::1]:2222 (LISTEN)
`;

describe('lý do listener thoát', () => {
  it('cổng bị chiếm: nêu cổng và chủ cổng', () => {
    expect(summarizeLsof(LSOF)).toBe('sshd 16059');
    expect(
      exitReasonFromLog(
        'error: Bind to port 2222 on 127.0.0.1 failed: Address already in use.\n',
        2222,
        'sshd 16059',
      ),
    ).toBe('Cổng 2222 đang bị chiếm: sshd 16059');
  });
  it('lỗi khác lấy dòng lỗi cuối; không có dòng lỗi thì null', () => {
    expect(exitReasonFromLog('a\n/x/sshd_config line 3: Bad option\n\n', 2222, null)).toBe(
      'sshd: /x/sshd_config line 3: Bad option',
    );
    expect(exitReasonFromLog('', 2222, null)).toBeNull();
    expect(exitReasonFromLog('Server listening on 127.0.0.1 port 22998.\n', 22998, null)).toBeNull();
  });
  it('chỉ đọc phần log ghi sau mốc spawn', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sshd-log-'));
    const file = join(dir, 'sshd.log');
    expect(readLogSince(file, 0)).toBe('');
    writeFileSync(file, 'cũ: Address already in use\n');
    const offset = Buffer.byteLength('cũ: Address already in use\n');
    appendFileSync(file, 'mới\n');
    expect(readLogSince(file, offset)).toBe('mới\n');
    expect(readLogSince(file, offset + 999)).toContain('mới');
  });
});

describe('createSystemDeps', () => {
  const runner = (out: Record<string, string>): CommandRunner => ({
    run: async (_command, args) => {
      const key = args.join(' ');
      const stdout = out[key];
      return stdout === undefined
        ? { code: 1, stdout: '', stderr: '', timedOut: false }
        : { code: 0, stdout, stderr: '', timedOut: false };
    },
  });

  it('procInfo đọc tiêu đề thật của listener; pid đã chết thì null', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sshd-home-'));
    const cfg = join(home, '.crew-mac', 'sshd', 'sshd_config');
    const deps = createSystemDeps({
      home,
      runner: runner({
        '-ww -o pid=,command= -p 16059': `16059 sshd: /usr/sbin/sshd -D -f ${cfg} -E x [listener] 0 of 10-100 startups\n`,
        '-o comm= -p 16059': 'sshd: /usr/sbin/\n',
      }),
      store: { update: async () => defaultAppState('0.1.0') } as never,
      log: () => undefined,
    });
    expect(deps.sshdConfig).toBe(cfg);
    expect(await deps.procInfo(16059)).toEqual({
      pid: 16059,
      comm: 'sshd: /usr/sbin/',
      command: `sshd: /usr/sbin/sshd -D -f ${cfg} -E x [listener] 0 of 10-100 startups`,
    });
    expect(await deps.procInfo(4242)).toBeNull();
  });

  it('readOwner/readPidFile theo manifest và pidfile dưới home', () => {
    const home = mkdtempSync(join(tmpdir(), 'sshd-home-'));
    const deps = createSystemDeps({
      home,
      runner: runner({}),
      store: {} as never,
      log: () => undefined,
    });
    expect(deps.readOwner()).toBe('launchd');
    expect(deps.readPidFile()).toBeNull();
    mkdirSync(join(home, '.crew-mac', 'sshd'), { recursive: true });
    writeFileSync(
      join(home, '.crew-mac', 'manifest.json'),
      JSON.stringify({
        version: 1,
        port: 2222,
        listenAddress: '127.0.0.1',
        worktreeRoot: '/w',
        paperclipKey: 'k',
        installedAt: 'x',
        sshdOwner: 'app',
      }),
    );
    writeFileSync(join(home, '.crew-mac', 'sshd', 'sshd.pid'), '777\n');
    expect(deps.readOwner()).toBe('app');
    expect(deps.readPidFile()).toBe(777);
  });

  it('readListenConfig: đổi theo nội dung sshd_config và host key; chưa có sshd_config thì null', () => {
    const home = mkdtempSync(join(tmpdir(), 'sshd-home-'));
    const deps = createSystemDeps({ home, runner: runner({}), store: {} as never, log: () => undefined });
    expect(deps.readListenConfig()).toBeNull();
    const dir = join(home, '.crew-mac', 'sshd');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sshd_config'), 'Port 2222\nListenAddress 100.105.105.12\n');
    writeFileSync(join(dir, 'host_ed25519'), 'k1');
    const first = deps.readListenConfig();
    expect(first).toContain('Port 2222');
    expect(deps.readListenConfig()).toBe(first);
    writeFileSync(join(dir, 'sshd_config'), 'Port 2223\nListenAddress 100.105.105.12\n');
    const second = deps.readListenConfig();
    expect(second).not.toBe(first);
    utimesSync(join(dir, 'host_ed25519'), new Date(5_000), new Date(5_000));
    expect(deps.readListenConfig()).not.toBe(second);
  });

  it('watchConfig: báo khi sshd_config đổi; thôi theo dõi thì im', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sshd-home-'));
    const dir = join(home, '.crew-mac', 'sshd');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sshd_config'), 'Port 2222\n');
    const deps = createSystemDeps({
      home,
      runner: runner({}),
      store: {} as never,
      log: () => undefined,
      watchIntervalMs: 20,
    });
    let calls = 0;
    const stop = deps.watchConfig(() => {
      calls += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    writeFileSync(join(dir, 'sshd_config'), 'Port 2223\nListenAddress 100.64.0.9\n');
    for (let i = 0; i < 50 && calls === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBeGreaterThan(0);
    stop();
    const seen = calls;
    writeFileSync(join(dir, 'sshd_config'), 'Port 2224\n');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls).toBe(seen);
  });
});
