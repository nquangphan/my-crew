import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { assertNoLiveRuns } from './commands/uninstall.js';
import { type MacContext, SetupError } from './context.js';
import { writeIfChanged } from './fs-util.js';
import { renderLauncher } from './launcher.js';
import { macPaths } from './paths.js';

export interface InstallCrewMacResult {
  installed: boolean;
  version: string;
  /** Đường dẫn bản lui `crew-mac.prev` vừa được tạo; null khi không có bản cũ hoặc không cài. */
  backup: string | null;
  reason?: string;
}

/** Băm cả cây (đường dẫn, bit thực thi, nội dung, đích symlink) để biết hai thư mục có giống hệt nhau. */
function hashTree(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const info = lstatSync(path);
      const rel = relative(root, path);
      if (info.isSymbolicLink()) hash.update(`l\0${rel}\0${readlinkSync(path)}\0`);
      else if (info.isDirectory()) {
        hash.update(`d\0${rel}\0`);
        walk(path);
      } else hash.update(`f\0${rel}\0${info.mode & 0o111 ? 'x' : '-'}\0`).update(readFileSync(path));
    }
  };
  walk(root);
  return hash.digest('hex');
}

function readVersion(srcDir: string): string {
  try {
    const version = JSON.parse(readFileSync(join(srcDir, 'package.json'), 'utf8')).version;
    if (typeof version === 'string' && version.length > 0) return version;
  } catch {
    // rơi xuống lỗi bên dưới
  }
  throw new SetupError(`Gói crew-mac ở ${srcDir} thiếu package.json hợp lệ có version`);
}

/**
 * Cài bản `crew-mac` mà app mang theo vào `~/.crew/app/crew-mac`: chép sang `.new`, giữ đúng một bản lui `.prev`,
 * đổi thư mục bằng rename, rồi viết lại launcher `~/.crew/bin/crew-mac`. Nội dung giống hệt bản đang cài thì không
 * đổi gì; còn run đang chạy thì từ chối. Không chạy lại `setup`.
 */
export async function installCrewMacFrom(ctx: MacContext, srcDir: string): Promise<InstallCrewMacResult> {
  const paths = macPaths(ctx.home);
  const version = readVersion(srcDir);
  if (!existsSync(join(srcDir, 'dist', 'cli.js'))) {
    throw new SetupError(`Gói crew-mac ở ${srcDir} thiếu dist/cli.js`);
  }
  const target = paths.crewMacDir;
  const staging = `${target}.new`;
  const backup = `${target}.prev`;
  const launcherText = renderLauncher(ctx.nodePath, join(target, 'dist', 'cli.js'));

  const hasCurrent = existsSync(target);
  if (hasCurrent && existsSync(join(target, 'dist', 'cli.js')) && hashTree(target) === hashTree(srcDir)) {
    writeIfChanged(paths.launcher, launcherText, 0o755);
    return { installed: false, version, backup: null };
  }

  try {
    await assertNoLiveRuns(ctx);
  } catch (err) {
    if (!(err instanceof SetupError)) throw err;
    return {
      installed: false,
      version,
      backup: null,
      reason: `Từ chối cài vì còn run đang chạy. ${err.message}`,
    };
  }

  mkdirSync(join(target, '..'), { recursive: true, mode: 0o700 });
  rmSync(staging, { recursive: true, force: true });
  cpSync(srcDir, staging, { recursive: true });
  if (!existsSync(join(staging, 'dist', 'cli.js'))) {
    rmSync(staging, { recursive: true, force: true });
    throw new SetupError('Chép gói crew-mac không đủ dist/cli.js');
  }

  if (hasCurrent) rmSync(backup, { recursive: true, force: true });
  try {
    if (hasCurrent) renameSync(target, backup);
    renameSync(staging, target);
  } catch (err) {
    if (hasCurrent && !existsSync(target) && existsSync(backup)) renameSync(backup, target);
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  try {
    writeIfChanged(paths.launcher, launcherText, 0o755);
  } catch (err) {
    rmSync(target, { recursive: true, force: true });
    if (hasCurrent) renameSync(backup, target);
    throw err;
  }
  return { installed: true, version, backup: hasCurrent ? backup : null };
}
