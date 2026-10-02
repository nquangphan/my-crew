import { createHash } from 'node:crypto';
import { canonicalJson } from '../journal/canonical.ts';
import type { DocsFile, DocsImport } from './contracts.ts';

export function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function decodeFileBytes(file: DocsFile): Buffer {
  const bytes = Buffer.from(file.bytesBase64, 'base64');
  if (bytes.toString('base64') !== file.bytesBase64) throw new Error('INVALID_BASE64');
  if (bytes.length > 1024 * 1024) throw new Error('FILE_TOO_LARGE');
  if (hashBytes(bytes) !== file.sha256) throw new Error('CHECKSUM_MISMATCH');
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return bytes;
}

export function snapshotHash(files: DocsFile[]): string {
  const seen = new Set<string>();
  const tuples = files
    .map((file) => {
      if (seen.has(file.path)) throw new Error('DUPLICATE_PATH');
      seen.add(file.path);
      const bytes = decodeFileBytes(file);
      return [file.path, file.sha256, bytes.length, file.contentClass] as const;
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return hashBytes(Buffer.from(canonicalJson(tuples), 'utf8'));
}

export function sourceTreeHash(paths: string[]): string {
  return hashBytes(Buffer.from(canonicalJson([...paths].sort()), 'utf8'));
}

export function bundleHash(input: Omit<DocsImport, 'bundleSha256'>): string {
  return hashBytes(Buffer.from(canonicalJson(input), 'utf8'));
}
