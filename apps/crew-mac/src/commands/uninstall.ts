import { existsSync, readdirSync, rmSync } from 'node:fs';
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

export async function uninstall(ctx: MacContext): Promise<UninstallReport> {
  if (ctx.platform !== 'darwin') throw new SetupError('crew-mac chỉ chạy trên macOS.');
  const paths = macPaths(ctx.home);
  const manifest = manifestOrNull(paths.manifest);
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
    if (writeIfChanged(paths.authorizedKeys, keys, 0o600))
      removed.push(`${paths.authorizedKeys} (key crew-mac và spike)`);
  }
  if (existsSync(paths.zshenv)) {
    const next = removeSpikePathLines(removePathBlock(readText(paths.zshenv)));
    if (next.trim() === '') {
      rmSync(paths.zshenv);
      removed.push(paths.zshenv);
    } else if (writeIfChanged(paths.zshenv, next, 0o644)) {
      removed.push(`${paths.zshenv} (dòng PATH crew-mac và spike)`);
    }
  }
  if (existsSync(paths.wrapper)) {
    rmSync(paths.wrapper);
    removed.push(paths.wrapper);
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
