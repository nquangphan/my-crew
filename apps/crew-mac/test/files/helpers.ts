import { createHash } from 'node:crypto';
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AttachmentPaths, blobPath, runDir } from '../../src/files/paths.js';
import type { RunManifest } from '../../src/files/types.js';

export function fakeHome(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'crew-att-home-')));
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Sha giả đủ dạng, ổn định theo số thứ tự. */
export function fakeSha(n: number): string {
  return sha256Hex(`blob-${n}`);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeedRun {
  id: string;
  ageDays: number;
  shas: string[];
}
export interface SeedBlob {
  sha: string;
  ageDays: number;
  bytes: number;
}

/** Dựng cây cache: blob là file thưa đủ cỡ, mtime lùi theo tuổi. */
export function seed(p: AttachmentPaths, now: Date, spec: { runs?: SeedRun[]; blobs?: SeedBlob[] }): void {
  mkdirSync(p.blobs, { recursive: true, mode: 0o700 });
  mkdirSync(p.derived, { recursive: true, mode: 0o700 });
  mkdirSync(p.runs, { recursive: true, mode: 0o700 });
  for (const b of spec.blobs ?? []) {
    const path = blobPath(p, b.sha);
    const fd = openSync(path, 'w', 0o600);
    ftruncateSync(fd, b.bytes);
    closeSync(fd);
    const when = new Date(now.getTime() - b.ageDays * DAY_MS);
    utimesSync(path, when, when);
    const d = join(p.derived, b.sha, 'v1');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'info.json'), '{}');
  }
  for (const r of spec.runs ?? []) {
    const dir = runDir(p, r.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const manifest: RunManifest = {
      version: 1,
      runId: r.id,
      issueId: 'i',
      transport: 'bridge',
      generatedAt: now.toISOString(),
      files: r.shas.map((sha) => ({
        attachmentId: 'a',
        issueId: 'i',
        issueKey: 'TPS-1',
        relation: 'self' as const,
        issueCommentId: null,
        source: 'mô tả TPS-1',
        filename: 'x.png',
        declaredType: 'image/png',
        detected: 'png' as const,
        byteSize: 1,
        sha256: sha,
        pages: null,
        status: 'san_sang' as const,
        reason: null,
        notes: [],
        readPaths: [],
        credentialFindings: [],
      })),
    };
    const file = join(dir, 'manifest.json');
    writeFileSync(file, JSON.stringify(manifest));
    const when = new Date(now.getTime() - r.ageDays * DAY_MS);
    utimesSync(file, when, when);
    utimesSync(dir, when, when);
  }
}
