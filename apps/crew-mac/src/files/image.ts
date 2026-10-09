import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CommandRunner } from '../system.js';
import { INLINE_IMAGE_MAX_BYTES, INLINE_IMAGE_MAX_EDGE, RESIZE_EDGE } from './config.js';

const SIPS_TIMEOUT_MS = 60_000;

type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'heic';
export type PreparedImage = { readPath: string; resized: boolean } | { error: 'doi_anh_loi' };

/** Kích thước ảnh theo `sips -g`; sips thoát 0 cả khi file không phải ảnh, nên thiếu số là lỗi. */
async function dimensions(
  runner: CommandRunner,
  blob: string,
): Promise<{ width: number; height: number } | null> {
  const result = await runner.run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', blob], {
    timeoutMs: SIPS_TIMEOUT_MS,
  });
  if (result.code !== 0 || result.timedOut) return null;
  const width = Number(/pixelWidth:\s*(\d+)/.exec(result.stdout)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(result.stdout)?.[1]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // không có thì thôi
  }
}

/**
 * Chuẩn bị ảnh cho agent `Read`: ảnh vừa giới hạn thì đọc thẳng blob; HEIC đổi sang JPEG; ảnh quá 5 MB hoặc cạnh
 * quá 8000 px thì thu nhỏ (không phóng to) ra JPEG. Bản đổi nằm ở `<outDir>/<sha>.jpg` (0600), ghi tạm rồi rename.
 */
export async function prepareImage(
  runner: CommandRunner,
  blob: string,
  kind: ImageKind,
  outDir: string,
): Promise<PreparedImage> {
  const dims = await dimensions(runner, blob);
  if (!dims) return { error: 'doi_anh_loi' };
  const longest = Math.max(dims.width, dims.height);
  const tooBig = statSync(blob).size > INLINE_IMAGE_MAX_BYTES || longest > INLINE_IMAGE_MAX_EDGE;
  if (!tooBig && kind !== 'heic') return { readPath: blob, resized: false };

  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const target = join(outDir, `${basename(blob)}.jpg`);
  const temp = join(outDir, `${basename(blob)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp.jpg`);
  const resize = tooBig ? ['-Z', String(Math.min(RESIZE_EDGE, longest))] : [];
  const result = await runner.run('sips', [...resize, '-s', 'format', 'jpeg', blob, '--out', temp], {
    timeoutMs: SIPS_TIMEOUT_MS,
  });
  let written = false;
  try {
    written = statSync(temp).size > 0;
  } catch {
    written = false;
  }
  if (result.code !== 0 || result.timedOut || !written) {
    removeQuietly(temp);
    return { error: 'doi_anh_loi' };
  }
  chmodSync(temp, 0o600);
  renameSync(temp, target);
  return { readPath: target, resized: tooBig };
}
