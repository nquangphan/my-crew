import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { MAX_FILE_BYTES } from './config.js';
import { type AttachmentPaths, blobPath, runDir } from './paths.js';
import type { RunManifest } from './types.js';

export function ensureCacheDirs(p: AttachmentPaths): void {
  for (const dir of [p.root, p.blobs, p.derived, p.runs, p.incoming]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if ((statSync(dir).mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
  }
}

function markerPath(p: AttachmentPaths, sha256: string): string {
  return join(p.derived, sha256, 'verified');
}

function fingerprint(path: string): string {
  const st = statSync(path);
  return `${st.mtimeMs}:${st.size}`;
}

function unlinkQuiet(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // đã mất hoặc không xóa được: GC dọn sau
  }
}

/**
 * Blob dùng được khi tồn tại và sha256 bytes khớp tên. Băm lười: dấu `verified` lưu mtime và cỡ lúc kiểm; blob
 * đổi mtime/cỡ thì băm lại, sai thì xóa blob.
 */
export function hasBlob(p: AttachmentPaths, sha256: string): boolean {
  const path = blobPath(p, sha256);
  if (!existsSync(path)) return false;
  const marker = markerPath(p, sha256);
  const print = fingerprint(path);
  try {
    if (readFileSync(marker, 'utf8') === print) return true;
  } catch {
    // chưa kiểm lần nào
  }
  if (statSync(path).size > MAX_FILE_BYTES) {
    unlinkQuiet(path);
    return false;
  }
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== sha256) {
    unlinkQuiet(path);
    unlinkQuiet(marker);
    return false;
  }
  mkdirSync(join(p.derived, sha256), { recursive: true, mode: 0o700 });
  writeFileSync(marker, print, { mode: 0o600 });
  return true;
}

export type StoreBlobResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; reason: 'sai_ma_bam' | 'vuot_10mb' };

/** Ghi `<sha>.part.<pid>.<rand>` (0600, fsync) rồi rename; sha lệch hoặc quá trần thì không để lại gì. */
export async function storeBlob(
  p: AttachmentPaths,
  expectedSha: string,
  data: AsyncIterable<Uint8Array> | Uint8Array,
  maxBytes: number,
): Promise<StoreBlobResult> {
  const finalPath = blobPath(p, expectedSha);
  mkdirSync(p.blobs, { recursive: true, mode: 0o700 });
  const part = `${finalPath}.part.${process.pid}.${randomBytes(4).toString('hex')}`;
  const fd = openSync(part, 'wx', 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  let tooBig = false;
  try {
    const iterable: AsyncIterable<Uint8Array> =
      data instanceof Uint8Array
        ? (async function* () {
            yield data;
          })()
        : data;
    for await (const chunk of iterable) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        tooBig = true;
        break;
      }
      hash.update(chunk);
      writeSync(fd, chunk);
    }
    if (!tooBig) fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkQuiet(part);
    throw error;
  }
  closeSync(fd);
  if (tooBig) {
    unlinkQuiet(part);
    return { ok: false, reason: 'vuot_10mb' };
  }
  if (hash.digest('hex') !== expectedSha) {
    unlinkQuiet(part);
    return { ok: false, reason: 'sai_ma_bam' };
  }
  renameSync(part, finalPath);
  return { ok: true, path: finalPath, bytes };
}

export function writeRunManifest(p: AttachmentPaths, m: RunManifest): string {
  const dir = runDir(p, m.runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'manifest.json');
  const temp = join(dir, `.manifest.json.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeSync(fd, `${JSON.stringify(m, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  return path;
}

export function readRunManifest(p: AttachmentPaths, runId: string): RunManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(join(runDir(p, runId), 'manifest.json'), 'utf8')) as RunManifest;
    return parsed && parsed.version === 1 && Array.isArray(parsed.files) ? parsed : null;
  } catch {
    return null;
  }
}
