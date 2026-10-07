import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type MacContext, SetupError } from '../context.js';
import { SUPERPOWERS_PLUGIN_KEY, superpowersPinDir, type WorkflowPin } from './pin.js';
import { treeChecksum } from './tree-checksum.js';

export interface InstalledPlugin {
  installPath: string;
  version: string;
  gitCommitSha: string | null;
}

/** Các bản plugin `key` mà Claude Code ghi trong `~/.claude/plugins/installed_plugins.json`; file thiếu hay hỏng thì rỗng. */
export function readInstalledPlugins(home: string, key: string): InstalledPlugin[] {
  const file = join(home, '.claude', 'plugins', 'installed_plugins.json');
  if (!existsSync(file)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const entries = (parsed as { plugins?: Record<string, unknown> } | null)?.plugins?.[key];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((raw: unknown) => {
    const e = (raw ?? {}) as { installPath?: unknown; version?: unknown; gitCommitSha?: unknown };
    if (typeof e.installPath !== 'string' || typeof e.version !== 'string') return [];
    return [
      {
        installPath: e.installPath,
        version: e.version,
        gitCommitSha: typeof e.gitCommitSha === 'string' ? e.gitCommitSha : null,
      },
    ];
  });
}

function checksumOrNull(dir: string): string | null {
  try {
    return treeChecksum(dir).checksum;
  } catch {
    return null;
  }
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** File trong `pin.executables` thiếu (không phải file thường) hoặc không có bit thực thi nào. */
export function missingExecutables(dir: string, pin: WorkflowPin): string[] {
  return pin.executables.filter((rel) => {
    try {
      const st = lstatSync(join(dir, rel));
      return !st.isFile() || (st.mode & 0o111) === 0;
    } catch {
      return true;
    }
  });
}

/** Đặt lại bit thực thi theo danh sách của pin (không đổi nội dung, nên không đổi checksum). Trả true nếu có sửa. */
function ensureExecutables(dir: string, pin: WorkflowPin): boolean {
  const missing = missingExecutables(dir, pin);
  for (const rel of missing) {
    const path = join(dir, rel);
    let mode: number;
    try {
      const st = lstatSync(path);
      if (!st.isFile()) throw new Error('không phải file thường');
      mode = st.mode & 0o777;
    } catch {
      throw new SetupError(
        `Bản Superpowers ${pin.version} không có file thực thi ${rel} như pin ghi; kiểm lại SUPERPOWERS_PIN.`,
      );
    }
    chmodSync(path, mode | 0o111);
  }
  return missing.length > 0;
}

/** Xóa bản tạm `<dir>.tmp-*` còn sót của lần setup bị ngắt (mọi pid). */
function removeStaleTemps(dir: string): void {
  const parent = dirname(dir);
  if (!existsSync(parent)) return;
  const prefix = `${basename(dir)}.tmp-`;
  for (const entry of readdirSync(parent)) {
    if (entry.startsWith(prefix)) rmSync(join(parent, entry), { recursive: true, force: true });
  }
}

/**
 * Copy bản Superpowers owner đã cài (đúng version, revision, checksum) vào thư mục ghim của crew-mac, giữ quyền file
 * và đặt bit thực thi theo `pin.executables`. Thư mục ghim có sẵn đúng checksum thì chỉ sửa bit thực thi nếu mất;
 * lệch checksum thì từ chối ghi đè (owner xóa tay rồi chạy lại).
 */
export function installSuperpowersPin(
  ctx: MacContext,
  pin: WorkflowPin = ctx.superpowersPin,
): { dir: string; changed: boolean } {
  const dir = superpowersPinDir(ctx.home, pin);
  removeStaleTemps(dir);
  if (pathExists(dir)) {
    if (checksumOrNull(dir) === pin.checksum) return { dir, changed: ensureExecutables(dir, pin) };
    throw new SetupError(
      `${dir} lệch checksum so với bản ghim Superpowers ${pin.version}; xóa thư mục đó rồi chạy lại crew-mac setup.`,
    );
  }
  const source = readInstalledPlugins(ctx.home, SUPERPOWERS_PLUGIN_KEY).find(
    (e) =>
      e.version === pin.version &&
      e.gitCommitSha === pin.revision &&
      existsSync(e.installPath) &&
      checksumOrNull(e.installPath) === pin.checksum,
  );
  if (!source) {
    throw new SetupError(
      `Chưa có Superpowers ${pin.version} (${pin.revision.slice(0, 12)}) đúng checksum trong ~/.claude/plugins. ` +
        `Cài bằng "/plugin install ${SUPERPOWERS_PLUGIN_KEY}" đúng bản ${pin.version} rồi chạy lại.`,
    );
  }
  const tmp = `${dir}.tmp-${process.pid}`;
  mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
  const inUse = join(source.installPath, '.in_use');
  try {
    // cpSync giữ mode của từng file; ensureExecutables chỉ bù khi cây nguồn đã mất bit.
    cpSync(source.installPath, tmp, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => src !== inUse,
    });
    if (checksumOrNull(tmp) !== pin.checksum) {
      throw new SetupError('Bản copy Superpowers lệch checksum (cây nguồn đổi giữa chừng?); không cài.');
    }
    ensureExecutables(tmp, pin);
    renameSync(tmp, dir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { dir, changed: true };
}
