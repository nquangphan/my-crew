import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type MacContext, SetupError } from '../context.js';
import { BMAD_PLUGIN_JSON, BMAD_SOURCE, type BmadSource } from './bmad-pin.js';
import { checksumOrNull, ensureExecutables, pathExists, removeStaleTemps } from './install.js';
import { pinDir, type WorkflowPin } from './pin.js';
import { treeChecksum } from './tree-checksum.js';

export interface BmadInstallResult {
  dir: string;
  source: 'existing' | 'marketplace' | 'github';
}

const GIT = '/usr/bin/git';
const TAR = '/usr/bin/tar';
const CLONE_TIMEOUT_MS = 120_000;
const COMMAND_TIMEOUT_MS = 30_000;

class FetchFailed extends Error {}

function archiveArgs(repo: string, pin: WorkflowPin, tar: string, trees: readonly string[]): string[] {
  return ['-C', repo, 'archive', '--format=tar', '-o', tar, pin.revision, ...trees];
}

/** `git archive` từ marketplace `bmad` của owner nếu có đúng commit ghim; chỉ đọc repo đó. */
async function archiveFromMarketplace(
  ctx: MacContext,
  source: BmadSource,
  pin: WorkflowPin,
  tar: string,
): Promise<boolean> {
  const market = join(ctx.home, source.marketplaceDir);
  if (!existsSync(market)) return false;
  const opts = { timeoutMs: COMMAND_TIMEOUT_MS };
  const has = await ctx.runner.run(GIT, ['-C', market, 'cat-file', '-e', `${pin.revision}^{commit}`], opts);
  if (has.code !== 0) return false;
  const archived = await ctx.runner.run(GIT, archiveArgs(market, pin, tar, source.trees), opts);
  return archived.code === 0;
}

/** Clone https không checkout (blob tải theo nhu cầu khi archive) vào bản tạm, archive rồi xóa clone. */
async function archiveFromClone(
  ctx: MacContext,
  source: BmadSource,
  pin: WorkflowPin,
  tar: string,
  tmp: string,
): Promise<'github'> {
  const clone = join(tmp, '.clone');
  const opts = { timeoutMs: CLONE_TIMEOUT_MS, env: { GIT_TERMINAL_PROMPT: '0' } };
  try {
    const cloned = await ctx.runner.run(
      GIT,
      ['clone', '--filter=blob:none', '--no-checkout', source.repoUrl, clone],
      opts,
    );
    if (cloned.code !== 0) throw new FetchFailed();
    const has = await ctx.runner.run(GIT, ['-C', clone, 'cat-file', '-e', `${pin.revision}^{commit}`], {
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    if (has.code !== 0) throw new FetchFailed();
    const archived = await ctx.runner.run(GIT, archiveArgs(clone, pin, tar, source.trees), opts);
    if (archived.code !== 0) throw new FetchFailed();
    return 'github';
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

/** Giải nén vào `<tmp>/.src` rồi chuyển từng `<cây>/<skill>` lên `<tmp>/skills/<skill>`; trùng tên là lỗi cài. */
async function extractAndAssemble(
  ctx: MacContext,
  tar: string,
  tmp: string,
  trees: readonly string[],
): Promise<void> {
  const src = join(tmp, '.src');
  mkdirSync(src, { mode: 0o700 });
  const extracted = await ctx.runner.run(TAR, ['-x', '-f', tar, '-C', src], {
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (extracted.code !== 0) {
    throw new SetupError(`giải nén bản BMAD lỗi: ${extracted.stderr.trim().slice(0, 200)}`);
  }
  const skills = join(tmp, 'skills');
  mkdirSync(skills, { mode: 0o755 });
  for (const tree of trees) {
    const treeDir = join(src, tree);
    if (!existsSync(treeDir)) throw new SetupError(`bản BMAD thiếu cây ${tree}`);
    for (const name of readdirSync(treeDir)) {
      if (pathExists(join(skills, name))) {
        throw new SetupError(`tên skill trùng giữa bmad-method và bmad-toolbox: ${name}`);
      }
      renameSync(join(treeDir, name), join(skills, name));
    }
  }
  rmSync(src, { recursive: true, force: true });
}

/**
 * Lắp bản ghim BMAD vào `~/.crew/workflows/bmad/<version>-<rev12>`: hai cây skill của `bmad-plugins` ở đúng
 * `pin.revision` (từ marketplace local, không thì clone https) hợp thành một plugin, thêm `plugin.json` của Crew, đặt
 * bit thực thi, kiểm checksum rồi mới đổi tên bản tạm thành thư mục ghim. Thư mục ghim có sẵn đúng checksum thì giữ
 * (chỉ bù bit thực thi); lệch checksum thì từ chối ghi đè. Không ghi gì dưới `~/.claude`.
 */
export async function installBmadPin(
  ctx: MacContext,
  source: BmadSource = BMAD_SOURCE,
): Promise<BmadInstallResult> {
  const pin = ctx.bmadPin;
  const dir = pinDir(ctx.home, pin);
  removeStaleTemps(dir);
  if (pathExists(dir)) {
    if (checksumOrNull(dir) !== pin.checksum) {
      throw new SetupError(
        `${dir} lệch checksum so với bản ghim BMAD ${pin.version} (WORKFLOW_SOURCE_MISMATCH); ` +
          'xóa thư mục đó rồi chạy lại "crew-mac workflows install".',
      );
    }
    ensureExecutables(dir, pin);
    return { dir, source: 'existing' };
  }
  mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
  const tmp = `${dir}.tmp-${process.pid}`;
  mkdirSync(tmp, { mode: 0o700 });
  try {
    const tar = join(tmp, '.src.tar');
    let from: BmadInstallResult['source'];
    try {
      from = (await archiveFromMarketplace(ctx, source, pin, tar))
        ? 'marketplace'
        : await archiveFromClone(ctx, source, pin, tar, tmp);
    } catch (err) {
      if (!(err instanceof FetchFailed)) throw err;
      throw new SetupError(
        `không lấy được BMAD ${pin.version} (${pin.revision.slice(0, 12)}): ` +
          'cần mạng tới github.com hoặc marketplace bmad có commit này',
      );
    }
    await extractAndAssemble(ctx, tar, tmp, source.trees);
    rmSync(tar, { force: true });
    mkdirSync(join(tmp, '.claude-plugin'), { mode: 0o755 });
    writeFileSync(join(tmp, '.claude-plugin', 'plugin.json'), BMAD_PLUGIN_JSON, { mode: 0o644 });
    ensureExecutables(tmp, pin);
    if (treeChecksum(tmp).checksum !== pin.checksum) {
      throw new SetupError('bản BMAD tải về lệch checksum ghim (WORKFLOW_SOURCE_MISMATCH)');
    }
    renameSync(tmp, dir);
    return { dir, source: from };
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}
