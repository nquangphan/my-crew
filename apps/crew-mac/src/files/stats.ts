import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_MAX_BYTES } from './config.js';
import { attachmentPaths } from './paths.js';

export interface AttachmentCacheStats {
  bytes: number;
  blobBytes: number;
  blobs: number;
  runs: number;
  limitBytes: number;
  measuredAt: string;
}

const SHA256_NAME = /^[0-9a-f]{64}$/;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Byte thật của cache file đính kèm; quá giờ hoặc lỗi đọc thì null (bản tin bỏ key). Không theo symlink. */
export function attachmentCacheStats(
  home: string,
  now = new Date(),
  budgetMs = 2000,
): AttachmentCacheStats | null {
  const p = attachmentPaths(home);
  const deadline = Date.now() + budgetMs;
  let walked = 0;
  const walk = (dir: string): number => {
    let total = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (++walked % 256 === 0 && Date.now() > deadline) throw new Error('timeout');
      const full = join(dir, entry.name);
      if (entry.isDirectory()) total += walk(full);
      else if (entry.isFile()) total += lstatSync(full).size;
    }
    return total;
  };
  const list = (dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  };
  try {
    if (budgetMs < 0) return null;
    lstatSync(p.root);
    const blobBytes = list(p.blobs).length > 0 ? walk(p.blobs) : 0;
    const blobs = list(p.blobs).filter((e) => e.isFile() && SHA256_NAME.test(e.name)).length;
    const runs = list(p.runs).filter((e) => e.isDirectory()).length;
    const bytes = walk(p.root);
    return { bytes, blobBytes, blobs, runs, limitBytes: CACHE_MAX_BYTES, measuredAt: now.toISOString() };
  } catch {
    return null;
  }
}
