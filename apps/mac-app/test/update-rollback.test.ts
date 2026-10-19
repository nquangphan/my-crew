import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROBATION_MAX_MS } from '../src/main/update/probation.js';
import {
  APP_BUNDLE_NAME,
  bundleFromExe,
  developerIdFromCodesign,
  fileMarkers,
  HELPER_SCRIPT,
  previousAppPath,
  readPreviousVersion,
  snapshotPrevious,
  spawnRollbackHelper,
} from '../src/main/update/rollback.js';

const tmps: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'crew-update-rollback-'));
  tmps.push(dir);
  return dir;
}
const procs: ChildProcess[] = [];
afterEach(() => {
  for (const proc of procs.splice(0)) proc.kill('SIGKILL');
  for (const dir of tmps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Process node sống `ms` mili giây, argv mang `tag` (để `pgrep -f` của helper thấy). */
function sleeper(ms: number, tag = 'crew-test-sleeper'): ChildProcess {
  const proc = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`, tag], { stdio: 'ignore' });
  procs.push(proc);
  return proc;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function exitOf(proc: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) resolve(proc.exitCode);
    else proc.on('exit', (code) => resolve(code));
  });
}

function fakeApp(dir: string, version: string): string {
  const bundle = join(dir, APP_BUNDLE_NAME);
  mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(bundle, 'Contents', 'version.txt'), version);
  return bundle;
}

describe('bundleFromExe', () => {
  it('lấy thư mục .app từ đường dẫn binary', () => {
    expect(bundleFromExe('/Applications/2P Crew.app/Contents/MacOS/2P Crew')).toBe(
      '/Applications/2P Crew.app',
    );
    expect(bundleFromExe('/usr/local/bin/electron')).toBeNull();
  });
});

describe('developerIdFromCodesign', () => {
  it('chỉ nhận Authority Developer ID Application', () => {
    const devId = [
      'Executable=/Applications/2P Crew.app/Contents/MacOS/2P Crew',
      'Identifier=com.2p-solutions.crew.mac',
      'Authority=Developer ID Application: 2P SOLUTIONS (J7Y2DL6HZV)',
      'Authority=Developer ID Certification Authority',
      'Authority=Apple Root CA',
      'TeamIdentifier=J7Y2DL6HZV',
    ].join('\n');
    const appleDev = [
      'Authority=Apple Development: Nhật Quang Phan (29CVPDJ2XX)',
      'Authority=Apple Worldwide Developer Relations Certification Authority',
      'TeamIdentifier=J7Y2DL6HZV',
    ].join('\n');
    expect(developerIdFromCodesign(devId)).toBe(true);
    expect(developerIdFromCodesign(appleDev)).toBe(false);
    expect(developerIdFromCodesign('code object is not signed at all')).toBe(false);
  });
});

describe('snapshotPrevious', () => {
  it('xóa bản cũ trong previous/ rồi ditto bản đang chạy vào, ghi version', async () => {
    const root = tmp();
    const support = join(root, 'support');
    const old = fakeApp(join(support, 'previous'), '0.0.9');
    writeFileSync(join(old, 'Contents', 'stale.txt'), 'cũ');
    mkdirSync(join(support, 'probation'), { recursive: true });
    writeFileSync(join(support, 'probation', '0.0.9.ok'), '');
    const bundle = fakeApp(join(root, 'Applications'), '0.1.0');
    const calls: string[][] = [];
    await snapshotPrevious({
      bundle,
      support,
      version: '0.1.0',
      ditto: async (src, dst) => {
        calls.push([src, dst]);
        expect(existsSync(dst)).toBe(false);
        spawnSync('/usr/bin/ditto', [src, dst]);
      },
    });
    expect(calls).toEqual([[bundle, previousAppPath(support)]]);
    expect(readFileSync(join(previousAppPath(support), 'Contents', 'version.txt'), 'utf8')).toBe('0.1.0');
    expect(existsSync(join(previousAppPath(support), 'Contents', 'stale.txt'))).toBe(false);
    expect(readPreviousVersion(support)).toBe('0.1.0');
    expect(existsSync(join(support, 'probation', '0.0.9.ok'))).toBe(false);
  });

  it('chưa có previous/ thì không có bản trước', () => {
    expect(readPreviousVersion(tmp())).toBeNull();
  });

  it('ditto hỏng thì không để lại version (nút quay lui vẫn tắt)', async () => {
    const root = tmp();
    const support = join(root, 'support');
    await expect(
      snapshotPrevious({
        bundle: fakeApp(root, '0.1.0'),
        support,
        version: '0.1.0',
        ditto: async () => {
          throw new Error('ditto: đầy đĩa');
        },
      }),
    ).rejects.toThrow('ditto');
    expect(readPreviousVersion(support)).toBeNull();
  });
});

describe('spawnRollbackHelper', () => {
  it('chạy /bin/sh helper tách rời, stdio bỏ, unref', () => {
    const seen: { cmd: string; args: string[]; opts: Record<string, unknown>; unref: boolean }[] = [];
    spawnRollbackHelper({
      mode: 'watchdog',
      waitPid: 4242,
      support: '/s',
      toVersion: '0.1.1',
      resourcesPath: '/r',
      spawn: (cmd, args, opts) => {
        const entry = { cmd, args, opts: opts as Record<string, unknown>, unref: false };
        seen.push(entry);
        return {
          unref: () => {
            entry.unref = true;
          },
        };
      },
    });
    expect(seen).toEqual([
      {
        cmd: '/bin/sh',
        args: [join('/r', HELPER_SCRIPT), 'watchdog', '4242', '/s', '0.1.1'],
        opts: { detached: true, stdio: 'ignore' },
        unref: true,
      },
    ]);
  });
});

describe('fileMarkers', () => {
  it('ghi/đọc ok, failed, rolled-back trong probation/', () => {
    const support = tmp();
    const markers = fileMarkers(support);
    expect(markers.readRolledBack()).toBeNull();
    markers.writeOk('0.1.1');
    markers.writeFailed('0.1.2');
    markers.writeStarted('0.1.3');
    markers.writeCancelled('0.1.4');
    expect(existsSync(join(support, 'probation', '0.1.1.ok'))).toBe(true);
    expect(existsSync(join(support, 'probation', '0.1.2.failed'))).toBe(true);
    expect(existsSync(join(support, 'probation', '0.1.3.started'))).toBe(true);
    expect(existsSync(join(support, 'probation', '0.1.4.cancelled'))).toBe(true);
    expect(markers.readPending()).toBeNull();
    markers.writePending('0.1.5');
    expect(readFileSync(join(support, 'probation', 'pending'), 'utf8').trim()).toBe('0.1.5');
    expect(markers.readPending()).toBe('0.1.5');
    markers.clearPending();
    expect(markers.readPending()).toBeNull();
    writeFileSync(join(support, 'probation', 'rolled-back'), '0.1.2\n');
    expect(markers.readRolledBack()).toBe('0.1.2');
    markers.clearRolledBack();
    expect(markers.readRolledBack()).toBeNull();
  });
});

describe('rollback-helper.sh (chạy thật trong thư mục tạm)', () => {
  const helper = join(import.meta.dirname, '..', 'src', 'main', 'update', HELPER_SCRIPT);

  function setup() {
    const root = tmp();
    const support = join(root, 'support');
    fakeApp(join(support, 'previous'), '0.1.0');
    const target = fakeApp(join(root, 'Applications'), '0.1.1');
    const env = {
      ...process.env,
      CREW_ROLLBACK_TARGET: target,
      CREW_ROLLBACK_OPEN: '/usr/bin/true',
      CREW_ROLLBACK_START_WAIT: '0',
      CREW_ROLLBACK_WATCH: '0',
      CREW_ROLLBACK_SHIPIT_WAIT: '0',
    };
    const exited = spawnSync('/bin/sleep', ['0']).pid ?? 999_999;
    const mark = join(support, 'probation');
    const version = () => readFileSync(join(target, 'Contents', 'version.txt'), 'utf8');
    const watchdog = (env: Record<string, string | undefined>, pid = exited) =>
      spawn('/bin/sh', [helper, 'watchdog', String(pid), support, '0.1.1'], { env, stdio: 'ignore' });
    return { root, support, target, env, exited, mark, version, watchdog };
  }

  it('now: thay app bằng previous, không còn rollback-tmp, ghi rolled-back và .failed', () => {
    const s = setup();
    const run = spawnSync('/bin/sh', [helper, 'now', String(s.exited), s.support, '0.1.1'], { env: s.env });
    expect(run.status).toBe(0);
    expect(readFileSync(join(s.target, 'Contents', 'version.txt'), 'utf8')).toBe('0.1.0');
    expect(existsSync(`${s.target}.rollback-tmp`)).toBe(false);
    expect(readFileSync(join(s.support, 'probation', 'rolled-back'), 'utf8').trim()).toBe('0.1.1');
    expect(existsSync(join(s.support, 'probation', '0.1.1.failed'))).toBe(true);
  });

  it('watchdog: bản mới đã ghi .ok thì không làm gì', () => {
    const s = setup();
    mkdirSync(join(s.support, 'probation'), { recursive: true });
    writeFileSync(join(s.support, 'probation', '0.1.1.ok'), '');
    const run = spawnSync('/bin/sh', [helper, 'watchdog', String(s.exited), s.support, '0.1.1'], {
      env: s.env,
    });
    expect(run.status).toBe(0);
    expect(readFileSync(join(s.target, 'Contents', 'version.txt'), 'utf8')).toBe('0.1.1');
    expect(existsSync(join(s.support, 'probation', 'rolled-back'))).toBe(false);
  });

  it('watchdog: bản mới đã tự quay lui (.failed) thì không quay lui lần hai', () => {
    const s = setup();
    mkdirSync(join(s.support, 'probation'), { recursive: true });
    writeFileSync(join(s.support, 'probation', '0.1.1.failed'), '');
    const run = spawnSync('/bin/sh', [helper, 'watchdog', String(s.exited), s.support, '0.1.1'], {
      env: s.env,
    });
    expect(run.status).toBe(0);
    expect(readFileSync(join(s.target, 'Contents', 'version.txt'), 'utf8')).toBe('0.1.1');
  });

  it('watchdog: hết giờ không có marker thì quay lui', () => {
    const s = setup();
    const run = spawnSync('/bin/sh', [helper, 'watchdog', String(s.exited), s.support, '0.1.1'], {
      env: s.env,
    });
    expect(run.status).toBe(0);
    expect(readFileSync(join(s.target, 'Contents', 'version.txt'), 'utf8')).toBe('0.1.0');
    expect(readFileSync(join(s.support, 'probation', 'rolled-back'), 'utf8').trim()).toBe('0.1.1');
  });

  it('watchdog chờ app cũ thoát (không đếm giờ trước đó); cài hỏng mà app cũ ở lại thì .cancelled cho nó thôi', async () => {
    const s = setup();
    const old = sleeper(30_000);
    const run = s.watchdog(s.env, old.pid);
    procs.push(run);
    await delay(1500);
    expect(run.exitCode).toBeNull();
    expect(s.version()).toBe('0.1.1');
    mkdirSync(s.mark, { recursive: true });
    writeFileSync(join(s.mark, '0.1.1.cancelled'), '');
    expect(await exitOf(run)).toBe(0);
    expect(s.version()).toBe('0.1.1');
    expect(existsSync(join(s.mark, 'rolled-back'))).toBe(false);
    expect(existsSync(join(s.mark, '0.1.1.failed'))).toBe(false);
    expect(old.exitCode).toBeNull();
  });

  it('watchdog: bản mới đã mở (.started) nhưng hết hạn thử mà không .ok thì quay lui', async () => {
    const s = setup();
    mkdirSync(s.mark, { recursive: true });
    writeFileSync(join(s.mark, '0.1.1.started'), '');
    const run = s.watchdog({ ...s.env, CREW_ROLLBACK_WATCH: '1' });
    expect(await exitOf(run)).toBe(0);
    expect(s.version()).toBe('0.1.0');
    expect(readFileSync(join(s.mark, 'rolled-back'), 'utf8').trim()).toBe('0.1.1');
  });

  it('watchdog: bản mới chưa mở và không có app nào chạy thì mở app một lần; bản mới mở và qua thử thì không quay lui', async () => {
    const s = setup();
    const opener = join(s.root, 'open.sh');
    writeFileSync(
      opener,
      `#!/bin/sh\nmkdir -p '${s.mark}'\n: > '${s.mark}/0.1.1.started'\n: > '${s.mark}/0.1.1.ok'\n: > '${s.root}/opened'\n`,
    );
    chmodSync(opener, 0o755);
    const run = s.watchdog({ ...s.env, CREW_ROLLBACK_OPEN: opener, CREW_ROLLBACK_START_WAIT: '1' });
    expect(await exitOf(run)).toBe(0);
    expect(existsSync(join(s.root, 'opened'))).toBe(true);
    expect(s.version()).toBe('0.1.1');
    expect(existsSync(join(s.mark, 'rolled-back'))).toBe(false);
  });

  it('watchdog: ShipIt còn chạy thì không ghi đè app, chờ nó xong rồi mới xét', async () => {
    const s = setup();
    const shipIt = join(s.target, 'Contents', 'Frameworks', 'Squirrel.framework', 'Resources', 'ShipIt');
    sleeper(1500, shipIt);
    await delay(200);
    const run = s.watchdog({ ...s.env, CREW_ROLLBACK_SHIPIT_WAIT: '10' });
    await delay(800);
    expect(s.version()).toBe('0.1.1');
    expect(existsSync(join(s.mark, '0.1.1.failed'))).toBe(false);
    expect(await exitOf(run)).toBe(0);
    expect(s.version()).toBe('0.1.0');
  });

  it('watchdog: ShipIt chạy quá hạn chờ thì thoát 5, không đụng app', async () => {
    const s = setup();
    const shipIt = join(s.target, 'Contents', 'Frameworks', 'Squirrel.framework', 'Resources', 'ShipIt');
    sleeper(30_000, shipIt);
    await delay(200);
    const run = s.watchdog({ ...s.env, CREW_ROLLBACK_SHIPIT_WAIT: '1' });
    expect(await exitOf(run)).toBe(5);
    expect(s.version()).toBe('0.1.1');
    expect(existsSync(join(s.mark, 'rolled-back'))).toBe(false);
  });

  it('watchdog: bản mới treo lúc mở (process chạy, không .started) thì TERM nó rồi quay lui', async () => {
    const s = setup();
    const hung = sleeper(30_000, join(s.target, 'Contents', 'MacOS', '2P Crew'));
    await delay(200);
    const run = s.watchdog(s.env);
    expect(await exitOf(run)).toBe(0);
    expect(hung.exitCode !== null || hung.signalCode !== null).toBe(true);
    expect(s.version()).toBe('0.1.0');
  });

  it('hạn mặc định của watchdog đủ cho toàn bộ probation cộng biên', () => {
    const text = readFileSync(helper, 'utf8');
    const watch = Number(/CREW_ROLLBACK_WATCH:-(\d+)/.exec(text)?.[1]);
    expect(watch * 1000).toBeGreaterThanOrEqual(PROBATION_MAX_MS + 2 * 60_000);
  });

  it('không có previous/ thì thoát 3, app giữ nguyên', () => {
    const s = setup();
    rmSync(join(s.support, 'previous'), { recursive: true });
    const run = spawnSync('/bin/sh', [helper, 'now', String(s.exited), s.support, '0.1.1'], { env: s.env });
    expect(run.status).toBe(3);
    expect(readFileSync(join(s.target, 'Contents', 'version.txt'), 'utf8')).toBe('0.1.1');
  });
});
