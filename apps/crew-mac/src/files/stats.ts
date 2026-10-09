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
  let bytes = 0;
  let blobBytes = 0;
  // Một lượt duyệt cho cả hai tổng: GC xóa blob giữa chừng cũng không làm blobBytes vượt bytes.
  const walk = (dir: string, inBlobs: boolean): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (++walked % 256 === 0 && Date.now() > deadline) throw new Error('timeout');
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, inBlobs || full === p.blobs);
      else if (entry.isFile()) {
        const size = lstatSync(full).size;
        bytes += size;
        if (inBlobs) blobBytes += size;
      }
    }
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
    walk(p.root, false);
    const blobs = list(p.blobs).filter((e) => e.isFile() && SHA256_NAME.test(e.name)).length;
    const runs = list(p.runs).filter((e) => e.isDirectory()).length;
    return { bytes, blobBytes, blobs, runs, limitBytes: CACHE_MAX_BYTES, measuredAt: now.toISOString() };
  } catch {
    return null;
  }
}
