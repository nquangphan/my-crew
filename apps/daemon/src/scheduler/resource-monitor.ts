import { execFileSync } from 'node:child_process';
import { readFileSync, statfsSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import type { DaemonConfig } from '../config.js';

export interface ResourceSnapshot {
  cpus: number;
  loadAvg1: number;
  /** Memory available to new work (not just "free": the OS cache counts as available). */
  freeMemGb: number;
  totalMemGb: number;
  diskFreeGb: number | null;
}

const GB = 1024 ** 3;
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Available memory. `os.freemem()` on macOS leaves out inactive and purgeable pages, so a busy Mac would
 * always look full; `vm_stat` and `/proc/meminfo` give the number the OS itself would hand out.
 */
export function availableMemBytes(platform: NodeJS.Platform = process.platform): number {
  try {
    if (platform === 'linux') {
      const match = /^MemAvailable:\s+(\d+) kB/m.exec(readFileSync('/proc/meminfo', 'utf8'));
      if (match) return Number(match[1]) * 1024;
    }
    if (platform === 'darwin') {
      const out = execFileSync('vm_stat', { encoding: 'utf8', timeout: 5_000 });
      const pageSize = Number(/page size of (\d+) bytes/.exec(out)?.[1] ?? 4096);
      const pages = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
      const available =
        pages('Pages free') + pages('Pages inactive') + pages('Pages speculative') + pages('Pages purgeable');
      if (available > 0) return available * pageSize;
    }
  } catch {
    // fall through to the portable number
  }
  return freemem();
}

export function diskFreeGb(path: string): number | null {
  try {
    const stats = statfsSync(path);
    return round((stats.bavail * stats.bsize) / GB);
  } catch {
    return null;
  }
}

export function takeSnapshot(diskPath: string): ResourceSnapshot {
  return {
    cpus: Math.max(1, cpus().length),
    loadAvg1: round(loadavg()[0] ?? 0),
    freeMemGb: round(availableMemBytes() / GB),
    totalMemGb: round(totalmem() / GB),
    diskFreeGb: diskFreeGb(diskPath),
  };
}

/**
 * Job slots the machine can run now: `min(maxConcurrentJobs, floor(cpus / 2))`, and none while memory is
 * below `minFreeMemGb` or the 1-minute load per CPU is above `maxLoadPerCpu`.
 */
export function totalSlots(resources: DaemonConfig['resources'], snapshot: ResourceSnapshot): number {
  if (snapshot.freeMemGb < resources.minFreeMemGb) return 0;
  if (snapshot.loadAvg1 / snapshot.cpus > resources.maxLoadPerCpu) return 0;
  return Math.max(0, Math.min(resources.maxConcurrentJobs, Math.floor(snapshot.cpus / 2)));
}
