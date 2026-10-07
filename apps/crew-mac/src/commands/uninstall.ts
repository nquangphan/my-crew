import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { removeKeysByComment } from '../authorized-keys.js';
import { type MacContext, SetupError } from '../context.js';
import { readText, writeIfChanged } from '../fs-util.js';
import { bootout } from '../launchctl.js';
import { type Manifest, readManifest } from '../manifest.js';
import {
  DOCTOR_KEY_COMMENT,
  macPaths,
  PAPERCLIP_KEY_COMMENT,
  REAPER_LABEL,
  SPIKE_KEY_COMMENT,
  SPIKE_LABEL,
  SSHD_LABEL,
} from '../paths.js';
import { listProcesses } from '../reaper/process-table.js';
import { isClaudePrint } from '../reaper/run-members.js';
import type { CommandRunner } from '../system.js';
import { removePathBlock, removeSpikePathLines } from '../zshenv.js';

export interface UninstallReport {
  removed: string[];
  kept: string[];
}

function manifestOrNull(path: string): Manifest | null {
  try {
    return readManifest(path);
  } catch {
    return null;
  }
}

/** Run id của các `claude --print` do Paperclip chạy (PAPERCLIP_RUN_ID trong env), không tính claude thủ công. */
export async function liveRunIds(runner: CommandRunner): Promise<string[]> {
  const procs = await listProcesses(runner);
  return [...new Set(procs.filter(isClaudePrint).map((p) => p.runId as string))].sort();
}

export async function uninstall(
  ctx: MacContext,
  options: { force?: boolean } = {},
): Promise<UninstallReport> {
  if (ctx.platform !== 'darwin') throw new SetupError('crew-mac chỉ chạy trên macOS.');
  if (!options.force) {
    let live: string[];
    try {
      live = await liveRunIds(ctx.runner);
    } catch (err) {
      throw new SetupError(
        `Không đọc được bảng process (${err instanceof Error ? err.message : String(err)}); ` +
          'không chắc còn run nào đang chạy. Thêm --force nếu chắc chắn.',
      );
    }
    if (live.length > 0) {
      throw new SetupError(
        `Còn ${live.length} run Paperclip đang chạy trên máy này (${live.join(', ')}). ` +
          'Hủy hoặc chờ các run đó xong trên Paperclip rồi chạy lại, hoặc thêm --force.',
      );
    }
  }
  const paths = macPaths(ctx.home);
  const manifest = manifestOrNull(paths.manifest);
  // Kiểm ~/.zshenv trước mọi thao tác: khối hỏng thì dừng khi chưa gỡ gì.
  const zshenvNext = existsSync(paths.zshenv)
    ? removeSpikePathLines(removePathBlock(readText(paths.zshenv)))
    : null;
  const removed: string[] = [];

  for (const label of [REAPER_LABEL, SSHD_LABEL, SPIKE_LABEL]) {
    if (await bootout(ctx.runner, ctx.uid, label)) removed.push(`LaunchAgent ${label}`);
  }
  for (const file of [paths.reaperPlist, paths.sshdPlist, paths.spikePlist]) {
    if (existsSync(file)) {
      rmSync(file);
      removed.push(file);
    }
  }
  if (existsSync(paths.authorizedKeys)) {
    let keys = readText(paths.authorizedKeys);
    for (const comment of [PAPERCLIP_KEY_COMMENT, DOCTOR_KEY_COMMENT, SPIKE_KEY_COMMENT]) {
      keys = removeKeysByComment(keys, comment);
    }
    if (writeIfChanged(paths.authorizedKeys, keys, 0o600, { keepExistingMode: true }))
      removed.push(`${paths.authorizedKeys} (key crew-mac và spike)`);
  }
  if (zshenvNext !== null) {
    // File rỗng thì xóa, trừ khi là symlink từ dotfiles của owner: khi đó chỉ làm rỗng file đích.
    if (zshenvNext.trim() === '' && !lstatSync(paths.zshenv).isSymbolicLink()) {
      rmSync(paths.zshenv);
      removed.push(paths.zshenv);
    } else if (writeIfChanged(paths.zshenv, zshenvNext, 0o644, { keepExistingMode: true })) {
      removed.push(`${paths.zshenv} (dòng PATH crew-mac và spike)`);
    }
  }
  for (const file of [paths.wrapper, paths.launcher]) {
    if (existsSync(file)) {
      rmSync(file);
      removed.push(file);
    }
  }
  if (existsSync(paths.crewBin) && readdirSync(paths.crewBin).length === 0)
    rmSync(paths.crewBin, { recursive: true });
  for (const dir of [paths.root, paths.spikeDir]) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    }
  }
  return { removed, kept: manifest ? [manifest.worktreeRoot] : [] };
}
