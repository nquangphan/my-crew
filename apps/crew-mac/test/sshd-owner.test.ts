import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SetupError } from '../src/context.js';
import { readManifest } from '../src/manifest.js';
import { macPaths } from '../src/paths.js';
import { isCrewListener, probeListener, resolveSshdOwner, takeBackToLaunchd } from '../src/sshd-owner.js';
import { APP_EXECUTABLE, BASE_MANIFEST, fakeMac, fakeProcs } from './helpers/fake-mac.js';

describe('resolveSshdOwner', () => {
  it('không cờ thì giữ chủ hiện có; cài mới là launchd', () => {
    expect(resolveSshdOwner(null, undefined)).toBe('launchd');
    expect(resolveSshdOwner({ ...BASE_MANIFEST }, undefined)).toBe('launchd');
    expect(resolveSshdOwner({ ...BASE_MANIFEST, sshdOwner: 'app' }, undefined)).toBe('app');
    expect(resolveSshdOwner({ ...BASE_MANIFEST, sshdOwner: 'app' }, 'launchd')).toBe('launchd');
    expect(resolveSshdOwner(null, 'app')).toBe('app');
  });
});

describe('manifest sshdOwner', () => {
  it('đọc được manifest cũ, manifest có sshdOwner; giá trị lạ thì báo hỏng', () => {
    const { home } = fakeMac();
    const path = macPaths(home).manifest;
    mkdirSync(macPaths(home).root, { recursive: true });
    writeFileSync(path, JSON.stringify(BASE_MANIFEST));
    expect(readManifest(path)?.sshdOwner).toBeUndefined();
    writeFileSync(path, JSON.stringify({ ...BASE_MANIFEST, sshdOwner: 'app' }));
    expect(readManifest(path)?.sshdOwner).toBe('app');
    writeFileSync(path, JSON.stringify({ ...BASE_MANIFEST, sshdOwner: 'systemd' }));
    expect(() => readManifest(path)).toThrow(SetupError);
  });
});

describe('isCrewListener', () => {
  const config = '/Users/owner/.crew-mac/sshd/sshd_config';
  it('chỉ nhận /usr/sbin/sshd có đúng -f <sshd_config> của crew-mac', () => {
    expect(isCrewListener(`/usr/sbin/sshd -D -f ${config} -E /x/sshd.log`, config)).toBe(true);
    expect(isCrewListener(`/usr/sbin/sshd -D -f ${config}`, config)).toBe(true);
    expect(isCrewListener('sshd-session: owner@notty', config)).toBe(false);
    expect(isCrewListener(`/usr/sbin/sshd -D -f ${config}.bak`, config)).toBe(false);
    expect(isCrewListener('/usr/sbin/sshd -D -f /etc/ssh/sshd_config', config)).toBe(false);
    expect(isCrewListener(`/opt/sshd -D -f ${config}`, config)).toBe(false);
  });
});

describe('probeListener', () => {
  function withPid(pid: number | null) {
    const mac = fakeMac();
    const paths = macPaths(mac.home);
    mkdirSync(paths.sshdDir, { recursive: true });
    if (pid !== null) writeFileSync(paths.sshdPid, `${pid}\n`);
    return { ...mac, paths };
  }

  it('không có pidfile hoặc pid chết thì none', async () => {
    const t = withPid(null);
    fakeProcs(t.runner, () => ({}));
    expect(await probeListener(t.ctx, t.paths)).toEqual({ kind: 'none', pid: null });
    const dead = withPid(4242);
    fakeProcs(dead.runner, () => ({}));
    expect(await probeListener(dead.ctx, dead.paths)).toEqual({ kind: 'none', pid: 4242 });
  });

  it('pid sống mà argv không phải listener crew-mac thì foreign', async () => {
    const t = withPid(4242);
    fakeProcs(t.runner, () => ({ 4242: { ppid: 4100, command: 'sshd-session: owner@notty' } }));
    expect(await probeListener(t.ctx, t.paths)).toMatchObject({ kind: 'foreign', pid: 4242 });
  });

  it('listener sống: trả cha và đường dẫn file thực thi của cha', async () => {
    const t = withPid(4242);
    fakeProcs(t.runner, () => ({
      4242: { ppid: 4100, command: `/usr/sbin/sshd -D -f ${t.paths.sshdConfig}` },
      4100: { ppid: 1, command: APP_EXECUTABLE, comm: APP_EXECUTABLE },
    }));
    expect(await probeListener(t.ctx, t.paths)).toEqual({
      kind: 'live',
      pid: 4242,
      ppid: 4100,
      parent: APP_EXECUTABLE,
    });
  });
});

describe('takeBackToLaunchd', () => {
  function seeded() {
    const mac = fakeMac();
    const paths = macPaths(mac.home);
    mkdirSync(paths.sshdDir, { recursive: true });
    writeFileSync(paths.sshdPid, '4242\n');
    return { ...mac, paths };
  }
  const kills = (runner: ReturnType<typeof fakeMac>['runner']) =>
    runner.commands().filter((c) => c.startsWith('/bin/kill'));

  it('listener của app tự thoát trong thời gian chờ thì không gửi tín hiệu', async () => {
    const t = seeded();
    let checks = 0;
    fakeProcs(t.runner, () =>
      ++checks <= 2 ? { 4242: { ppid: 4100, command: `/usr/sbin/sshd -D -f ${t.paths.sshdConfig}` } } : {},
    );
    await takeBackToLaunchd(t.ctx, t.paths, { waitMs: 200, pollMs: 10 });
    expect(checks).toBeGreaterThanOrEqual(3);
    expect(kills(t.runner)).toEqual([]);
  });

  it('listener mồ côi còn sống sau thời gian chờ thì TERM đúng một lần', async () => {
    const t = seeded();
    let killed = false;
    fakeProcs(t.runner, () =>
      killed ? {} : { 4242: { ppid: 1, command: `/usr/sbin/sshd -D -f ${t.paths.sshdConfig} -E /x` } },
    );
    t.runner.on('/bin/kill', () => {
      killed = true;
      return {};
    });
    await takeBackToLaunchd(t.ctx, t.paths, { waitMs: 50, pollMs: 10 });
    expect(kills(t.runner)).toEqual(['/bin/kill -TERM 4242']);
  });

  it('pid trong pidfile là sshd-session thì không gửi tín hiệu và báo lỗi', async () => {
    const t = seeded();
    fakeProcs(t.runner, () => ({ 4242: { ppid: 4100, command: 'sshd-session: u@notty' } }));
    const err = await takeBackToLaunchd(t.ctx, t.paths, { waitMs: 50, pollMs: 10 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect((err as Error).message).toContain('pid 4242 không phải listener của crew-mac');
    expect(kills(t.runner)).toEqual([]);
  });

  it('không có pidfile thì trả ngay, không gọi ps', async () => {
    const t = seeded();
    writeFileSync(t.paths.sshdPid, '');
    await takeBackToLaunchd(t.ctx, t.paths, { waitMs: 50, pollMs: 10 });
    expect(t.runner.commands().some((c) => c.startsWith('/bin/ps') || c.startsWith('/bin/kill'))).toBe(false);
  });
});
