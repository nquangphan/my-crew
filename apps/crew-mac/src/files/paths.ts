import { join } from 'node:path';
import { EXTRACTOR_VERSION } from './types.js';

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AttachmentPaths {
  root: string;
  blobs: string;
  derived: string;
  runs: string;
  incoming: string;
  gcLock: string;
  log: string;
}

export function attachmentPaths(home: string): AttachmentPaths {
  const root = join(home, '.crew', 'cache', 'attachments');
  return {
    root,
    blobs: join(root, 'blobs'),
    derived: join(root, 'derived'),
    runs: join(root, 'runs'),
    incoming: join(root, 'incoming'),
    gcLock: join(root, 'gc.lock'),
    log: join(home, '.crew', 'logs', 'attachments.log'),
  };
}

export function isSha256(value: string): boolean {
  return SHA256_RE.test(value);
}

export function isRunId(value: string): boolean {
  return UUID_RE.test(value);
}

export function blobPath(p: AttachmentPaths, sha256: string): string {
  if (!isSha256(sha256)) throw new Error('sha256 không hợp lệ');
  return join(p.blobs, sha256);
}

export function derivedDir(p: AttachmentPaths, sha256: string): string {
  if (!isSha256(sha256)) throw new Error('sha256 không hợp lệ');
  return join(p.derived, sha256, `v${EXTRACTOR_VERSION}`);
}

export function runDir(p: AttachmentPaths, runId: string): string {
  if (!isRunId(runId)) throw new Error('runId không hợp lệ');
  return join(p.runs, runId);
}
