import { closeSync, openSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FullDiskAccess } from '@crew/shared';

/** System Settings → Privacy & Security → Full Disk Access. */
export const FULL_DISK_ACCESS_PANE =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

/** One read of a path only Full Disk Access opens; macOS answers EPERM at once and never shows a prompt. */
export type Probe = () => void;

/**
 * Reads that need Full Disk Access and exist on every Mac: the Safari folder and the user's privacy database.
 * They never trigger a permission prompt (these locations are never offered in one).
 */
export function defaultProbes(home = homedir()): Probe[] {
  return [
    () => void readdirSync(join(home, 'Library', 'Safari')),
    () => closeSync(openSync(join(home, 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db'), 'r')),
  ];
}

/**
 * Granted when any probe reads; denied when a probe is refused (EPERM/EACCES) and none reads; unknown when the
 * probed paths do not exist or fail otherwise. Not macOS: unsupported.
 */
export function detectFullDiskAccess(
  probes: readonly Probe[],
  platform: NodeJS.Platform = process.platform,
  now: () => Date = () => new Date(),
): FullDiskAccess {
  const checkedAt = now().toISOString();
  if (platform !== 'darwin') return { state: 'unsupported', checkedAt };
  let denied = false;
  for (const probe of probes) {
    try {
      probe();
      return { state: 'granted', checkedAt };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') denied = true;
    }
  }
  return { state: denied ? 'denied' : 'unknown', checkedAt };
}
