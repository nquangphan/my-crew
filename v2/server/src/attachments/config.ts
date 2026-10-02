import { createHash } from 'node:crypto';
import { isAbsolute, normalize, parse } from 'node:path';
import { canonicalJson } from '../journal/canonical.ts';
import type { Sha256 } from './contracts.ts';
export type ParserLimits = {
  maxExpandedBytes: number;
  maxEntryBytes: number;
  maxZipEntries: number;
  maxCompressionRatio: number;
  maxXmlDepth: number;
  maxTextNodeBytes: number;
  maxTextBytes: number;
  maxCsvRows: number;
  maxCsvColumns: number;
  maxCsvFieldBytes: number;
  maxPdfPages: number;
  pdfDpi: number;
  maxPagePixels: number;
  maxImagePixels: number;
  maxOutputBytes: number;
};
export type AttachmentConfig = {
  storageRoot: string;
  policySha256: Sha256;
  maxFileBytes: number;
  maxComposeFiles: number;
  maxComposeBytes: number;
  maxOwnerStagingBytes: number;
  stagingTtlMs: number;
  cleanupGraceMs: number;
  uploadLeaseMs: number;
  uploadHeartbeatMs: number;
  uploadMaxWallMs: number;
  chunkBytes: number;
  workerConcurrency: number;
  workerMemoryMiB: number;
  workerCpu: number;
  workerPids: number;
  workerWallMs: number;
  allowedExtensions: string[];
  limits: ParserLimits;
};
export type WorkerConfig = { policySha256: Sha256; limits: ParserLimits };
const MiB = 1024 * 1024;
const defaults = {
  maxFileBytes: 25 * MiB,
  maxComposeFiles: 20,
  maxComposeBytes: 100 * MiB,
  maxOwnerStagingBytes: 500 * MiB,
  stagingTtlMs: 24 * 60 * 60 * 1000,
  cleanupGraceMs: 60 * 60 * 1000,
  uploadLeaseMs: 2 * 60 * 1000,
  uploadHeartbeatMs: 15 * 1000,
  uploadMaxWallMs: 5 * 60 * 1000,
  chunkBytes: 64 * 1024,
  workerConcurrency: 1,
  workerMemoryMiB: 512,
  workerCpu: 1,
  workerPids: 32,
  workerWallMs: 120000,
};
const parserDefaults: ParserLimits = {
  maxExpandedBytes: 100 * MiB,
  maxEntryBytes: 20 * MiB,
  maxZipEntries: 2000,
  maxCompressionRatio: 100,
  maxXmlDepth: 64,
  maxTextNodeBytes: MiB,
  maxTextBytes: 10 * MiB,
  maxCsvRows: 100000,
  maxCsvColumns: 1000,
  maxCsvFieldBytes: MiB,
  maxPdfPages: 200,
  pdfDpi: 144,
  maxPagePixels: 20_000_000,
  maxImagePixels: 40_000_000,
  maxOutputBytes: 100 * MiB,
};
const extensions = [
  'png',
  'jpg',
  'jpeg',
  'pdf',
  'docx',
  'xlsx',
  'csv',
  'txt',
  'md',
  'json',
  'yaml',
  'yml',
  'ts',
  'js',
  'py',
  'sh',
  'css',
  'html',
  'xml',
  'log',
];
export function loadAttachmentConfig(env: Record<string, string | undefined>): AttachmentConfig {
  const root = env.CREW_V2_ATTACHMENT_STORAGE_ROOT;
  if (
    !root ||
    !isAbsolute(root) ||
    normalize(root) !== root ||
    root === parse(root).root ||
    root.split('/').includes('..')
  )
    throw new Error('ATTACHMENT_ROOT_INVALID');
  const read = <T extends Record<string, number>>(source: T, prefix: string): T =>
    Object.fromEntries(
      Object.entries(source).map(([key, maximum]) => {
        const name = `CREW_V2_ATTACHMENT_${prefix}${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
        const raw = env[name];
        const value = raw === undefined ? maximum : Number(raw);
        if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
          throw new Error(`ATTACHMENT_LIMIT_INVALID:${name}`);
        return [key, value];
      }),
    ) as T;
  const base = read(defaults, '');
  const limits = read(parserDefaults, 'LIMIT_');
  if (
    base.uploadHeartbeatMs >= base.uploadLeaseMs ||
    base.maxFileBytes > base.maxComposeBytes ||
    base.maxComposeBytes > base.maxOwnerStagingBytes
  )
    throw new Error('ATTACHMENT_LIMIT_INVALID');
  const policySha256 = createHash('sha256').update(canonicalJson({ base, limits, extensions })).digest('hex');
  Object.freeze(limits);
  const allowedExtensions = [...extensions];
  Object.freeze(allowedExtensions);
  return Object.freeze({ storageRoot: root, policySha256, ...base, allowedExtensions, limits });
}
