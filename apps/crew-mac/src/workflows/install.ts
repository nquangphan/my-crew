import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

/**
 * Copy bản Superpowers owner đã cài (đúng version, revision, checksum) vào thư mục ghim của crew-mac. Thư mục ghim có
 * sẵn đúng checksum thì không làm gì; lệch thì từ chối ghi đè (owner xóa tay rồi chạy lại).
 */
export function installSuperpowersPin(
  ctx: MacContext,
  pin: WorkflowPin = ctx.superpowersPin,
): { dir: string; changed: boolean } {
  const dir = superpowersPinDir(ctx.home, pin);
  if (pathExists(dir)) {
    if (checksumOrNull(dir) === pin.checksum) return { dir, changed: false };
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
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
  const inUse = join(source.installPath, '.in_use');
  try {
    cpSync(source.installPath, tmp, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => src !== inUse,
    });
    if (checksumOrNull(tmp) !== pin.checksum) {
      throw new SetupError('Bản copy Superpowers lệch checksum (cây nguồn đổi giữa chừng?); không cài.');
    }
    renameSync(tmp, dir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { dir, changed: true };
}
