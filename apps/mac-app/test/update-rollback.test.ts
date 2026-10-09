import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
afterEach(() => {
  for (const dir of tmps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
    expect(existsSync(join(support, 'probation', '0.1.1.ok'))).toBe(true);
    expect(existsSync(join(support, 'probation', '0.1.2.failed'))).toBe(true);
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
      CREW_ROLLBACK_WAIT: '0',
    };
    const exited = spawnSync('/bin/sleep', ['0']).pid ?? 999_999;
    return { root, support, target, env, exited };
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

  it('không có previous/ thì thoát 3, app giữ nguyên', () => {
    const s = setup();
    rmSync(join(s.support, 'previous'), { recursive: true });
    const run = spawnSync('/bin/sh', [helper, 'now', String(s.exited), s.support, '0.1.1'], { env: s.env });
    expect(run.status).toBe(3);
    expect(readFileSync(join(s.target, 'Contents', 'version.txt'), 'utf8')).toBe('0.1.1');
  });
});
