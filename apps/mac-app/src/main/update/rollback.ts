import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const APP_BUNDLE_NAME = '2P Crew.app';
/** Helper quay lui, đóng vào `Contents/Resources/` qua `extraResources`. */
export const HELPER_SCRIPT = 'rollback-helper.sh';

const previousDir = (support: string) => join(support, 'previous');
const probationDir = (support: string) => join(support, 'probation');

/** `<support>/previous/2P Crew.app`: bản app trước lần cài gần nhất (giữ đúng một bản). */
export function previousAppPath(support: string): string {
  return join(previousDir(support), APP_BUNDLE_NAME);
}

/** `/Applications/2P Crew.app/Contents/MacOS/2P Crew` → `/Applications/2P Crew.app`; không phải bundle thì null. */
export function bundleFromExe(exe: string): string | null {
  const match = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(exe);
  return match?.[1] ?? null;
}

/**
 * Đầu ra `codesign -dv --verbose=2` có ký Developer ID Application không. Bản Apple Development cũng có
 * `TeamIdentifier` nhưng designated requirement theo tên leaf (không theo `subject.OU`), nên không dùng cho updater.
 */
export function developerIdFromCodesign(output: string): boolean {
  return /^Authority=Developer ID Application: /m.test(output);
}

/** Phiên bản của bản trong `previous/`; null khi chưa có (nút "Quay về bản trước" tắt). */
export function readPreviousVersion(support: string): string | null {
  try {
    if (!existsSync(previousAppPath(support))) return null;
    const version = readFileSync(join(previousDir(support), 'version'), 'utf8').trim();
    return version || null;
  } catch {
    return null;
  }
}

function defaultDitto(src: string, dst: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/ditto', [src, dst], (error) => (error ? reject(error) : resolve()));
  });
}

export interface SnapshotInput {
  /** Bundle đang chạy. */
  bundle: string;
  support: string;
  /** Bản đang chạy, ghi vào `previous/version`. */
  version: string;
  ditto?: (src: string, dst: string) => Promise<void>;
}

/**
 * Chép app đang chạy vào `previous/` trước khi cài bản mới: xóa bản cũ (giữ 1), `ditto`, rồi mới ghi `version`
 * (ditto hỏng thì không có bản trước). Dọn marker probation của các lần cài trước.
 */
export async function snapshotPrevious(input: SnapshotInput): Promise<void> {
  const dir = previousDir(input.support);
  rmSync(dir, { recursive: true, force: true });
  rmSync(probationDir(input.support), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await (input.ditto ?? defaultDitto)(input.bundle, previousAppPath(input.support));
  writeFileSync(join(dir, 'version'), `${input.version}\n`);
}

export type RollbackMode = 'now' | 'watchdog';

interface Detachable {
  unref(): void;
}

export interface SpawnRollbackInput {
  mode: RollbackMode;
  /** `now`: pid phải thoát trước khi thay app (thường là chính app). */
  waitPid: number;
  support: string;
  /** Bản đang thử / bản bị bỏ: ghi vào `probation/rolled-back` để bản cũ biết khi mở lại. */
  toVersion: string;
  resourcesPath: string;
  spawn: (command: string, args: string[], options: { detached: true; stdio: 'ignore' }) => Detachable;
}

/** Sinh helper shell tách rời: sống qua lúc app thoát, không giữ stdio của app. */
export function spawnRollbackHelper(input: SpawnRollbackInput): void {
  const child = input.spawn(
    '/bin/sh',
    [
      join(input.resourcesPath, HELPER_SCRIPT),
      input.mode,
      String(input.waitPid),
      input.support,
      input.toVersion,
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
}

/** Marker trong `<support>/probation/`, cùng tên với helper shell. */
export interface ProbationMarkers {
  /** Bản bị helper quay lui (nội dung `rolled-back`), null khi không có. */
  readRolledBack(): string | null;
  clearRolledBack(): void;
  /** Bản mới qua probation: watchdog thôi. */
  writeOk(version: string): void;
  /** Bản mới hỏng và đã tự xử lý: watchdog thôi. */
  writeFailed(version: string): void;
}

export function fileMarkers(support: string): ProbationMarkers {
  const dir = probationDir(support);
  const rolledBack = join(dir, 'rolled-back');
  const touch = (name: string) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, name), '');
  };
  return {
    readRolledBack: () => {
      try {
        return readFileSync(rolledBack, 'utf8').trim() || null;
      } catch {
        return null;
      }
    },
    clearRolledBack: () => rmSync(rolledBack, { force: true }),
    writeOk: (version) => touch(`${version}.ok`),
    writeFailed: (version) => touch(`${version}.failed`),
  };
}
