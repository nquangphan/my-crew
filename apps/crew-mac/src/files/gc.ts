import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import {
  CACHE_MAX_BYTES,
  CACHE_TTL_MS,
  GC_LOCK_STALE_MS,
  PART_MAX_AGE_MS,
  RUN_PROTECT_MS,
} from './config.js';
import { type AttachmentPaths, isRunId, isSha256 } from './paths.js';

export interface GcReport {
  removedRuns: number;
  removedBlobs: number;
  removedDerived: number;
  freedBytes: number;
  skippedLocked: boolean;
}

interface Ref {
  /** Tuổi (ms) của run mới nhất tham chiếu blob. */
  minAgeMs: number;
  current: boolean;
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Chiếm `gc.lock` (O_EXCL); khóa của pid chết hoặc quá hạn thì chiếm lại. Trả false khi run khác đang giữ. */
export function tryLockGc(p: AttachmentPaths, nowMs: number): boolean {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(p.gcLock, 'wx', 0o600);
      writeSync(fd, JSON.stringify({ pid: process.pid, at: nowMs }));
      closeSync(fd);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let stale = true;
      try {
        const held = JSON.parse(readFileSync(p.gcLock, 'utf8')) as { pid?: number; at?: number };
        stale = !pidAlive(held.pid ?? 0) || nowMs - (held.at ?? 0) > GC_LOCK_STALE_MS;
      } catch {
        stale = true;
      }
      if (!stale) return false;
      try {
        unlinkSync(p.gcLock);
      } catch {
        // người khác vừa chiếm: vòng sau sẽ thấy khóa sống
      }
    }
  }
  return false;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function mtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** Sha của file trong manifest, gồm cả `pendingSha256` của manifest giữ chỗ (run đang chạy, chưa xử lý xong). */
function manifestShas(path: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      files?: { sha256?: unknown }[];
      pendingSha256?: unknown;
    };
    const pending = Array.isArray(parsed.pendingSha256) ? (parsed.pendingSha256 as unknown[]) : [];
    return [...(parsed.files ?? []).map((f) => f.sha256), ...pending].filter(
      (s): s is string => typeof s === 'string' && isSha256(s),
    );
  } catch {
    return [];
  }
}

/**
 * Dọn cache: `.part` cũ, run quá TTL (trừ run hiện tại), blob không ai tham chiếu quá TTL, rồi LRU tới trần dung
 * lượng. Thứ tự LRU: blob mồ côi > 24 giờ (cũ nhất trước), rồi blob chỉ run > 24 giờ tham chiếu. Blob của run hiện
 * tại, của run < 24 giờ và blob mồ côi < 24 giờ (đang tải) không bao giờ bị xóa.
 */
export async function runGc(
  p: AttachmentPaths,
  opts: { now: Date; currentRunId: string | null },
): Promise<GcReport> {
  const report: GcReport = {
    removedRuns: 0,
    removedBlobs: 0,
    removedDerived: 0,
    freedBytes: 0,
    skippedLocked: false,
  };
  if (!existsSync(p.root)) return report;
  const nowMs = opts.now.getTime();
  if (!tryLockGc(p, nowMs)) return { ...report, skippedLocked: true };
  try {
    await yieldTurn();

    for (const name of listDir(p.blobs)) {
      if (!name.includes('.part')) continue;
      const m = mtimeMs(join(p.blobs, name));
      if (m !== null && nowMs - m > PART_MAX_AGE_MS) rmSync(join(p.blobs, name), { force: true });
    }

    const refs = new Map<string, Ref>();
    for (const id of listDir(p.runs)) {
      if (!isRunId(id)) continue;
      const dir = join(p.runs, id);
      const files = ['manifest.json', 'server-manifest.json'].map((n) => join(dir, n));
      const stamps = files.map(mtimeMs).filter((m): m is number => m !== null);
      const stamp = stamps.length > 0 ? Math.max(...stamps) : (mtimeMs(dir) ?? nowMs);
      const age = nowMs - stamp;
      const current = id === opts.currentRunId;
      if (age > CACHE_TTL_MS && !current) {
        rmSync(dir, { recursive: true, force: true });
        report.removedRuns += 1;
        continue;
      }
      for (const sha of files.flatMap(manifestShas)) {
        const prev = refs.get(sha);
        refs.set(sha, {
          minAgeMs: Math.min(prev?.minAgeMs ?? Number.POSITIVE_INFINITY, age),
          current: (prev?.current ?? false) || current,
        });
      }
    }

    interface BlobInfo {
      sha: string;
      size: number;
      mtime: number;
    }
    const blobs: BlobInfo[] = [];
    for (const sha of listDir(p.blobs)) {
      if (!isSha256(sha)) continue;
      try {
        const st = statSync(join(p.blobs, sha));
        blobs.push({ sha, size: st.size, mtime: st.mtimeMs });
      } catch {
        // vừa bị xóa
      }
    }
    const remove = (b: BlobInfo): void => {
      rmSync(join(p.blobs, b.sha), { force: true });
      report.removedBlobs += 1;
      report.freedBytes += b.size;
    };

    let alive: BlobInfo[] = [];
    for (const b of blobs) {
      if (!refs.has(b.sha) && nowMs - b.mtime > CACHE_TTL_MS) remove(b);
      else alive.push(b);
    }

    let total = alive.reduce((n, b) => n + b.size, 0);
    if (total > CACHE_MAX_BYTES) {
      const orphans = alive
        .filter((b) => !refs.has(b.sha) && nowMs - b.mtime > RUN_PROTECT_MS)
        .sort((a, b) => a.mtime - b.mtime);
      const oldRuns = alive
        .filter((b) => {
          const r = refs.get(b.sha);
          return r !== undefined && !r.current && r.minAgeMs > RUN_PROTECT_MS;
        })
        .sort((a, b) => (refs.get(b.sha)?.minAgeMs ?? 0) - (refs.get(a.sha)?.minAgeMs ?? 0));
      const gone = new Set<string>();
      for (const b of [...orphans, ...oldRuns]) {
        if (total <= CACHE_MAX_BYTES) break;
        remove(b);
        gone.add(b.sha);
        total -= b.size;
      }
      alive = alive.filter((b) => !gone.has(b.sha));
    }

    const kept = new Set(alive.map((b) => b.sha));
    for (const sha of listDir(p.derived)) {
      if (!isSha256(sha) || kept.has(sha)) continue;
      rmSync(join(p.derived, sha), { recursive: true, force: true });
      report.removedDerived += 1;
    }
    return report;
  } finally {
    releaseGcLock(p);
  }
}

export function releaseGcLock(p: AttachmentPaths): void {
  try {
    unlinkSync(p.gcLock);
  } catch {
    // đã bị chiếm lại vì quá hạn
  }
}
