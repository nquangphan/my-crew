import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

// Lets a test run code (a GC deleting a blob) right when the walk opens a given directory.
const onRead = vi.hoisted(() => ({ dir: '', run: () => {} }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const readdirSync = ((dir: string, ...rest: unknown[]) => {
    if (dir === onRead.dir) {
      onRead.dir = '';
      onRead.run();
    }
    return (fs.readdirSync as (...args: unknown[]) => unknown)(dir, ...rest);
  }) as typeof fs.readdirSync;
  return { ...fs, readdirSync, default: { ...fs, readdirSync } };
});

import { CACHE_MAX_BYTES } from '../../src/files/config.js';
import { attachmentPaths } from '../../src/files/paths.js';
import { attachmentCacheStats } from '../../src/files/stats.js';

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function tmpHome(prefix: string): string {
  const h = mkdtempSync(join(tmpdir(), prefix));
  homes.push(h);
  return h;
}

function home(): string {
  const h = tmpHome('crew-stats-');
  const p = attachmentPaths(h);
  for (const d of [p.blobs, join(p.derived, 'a'.repeat(64), 'v1'), join(p.runs, 'r1'), join(p.runs, 'r2')])
    mkdirSync(d, { recursive: true });
  writeFileSync(join(p.blobs, 'a'.repeat(64)), Buffer.alloc(1000));
  writeFileSync(join(p.blobs, 'b'.repeat(64)), Buffer.alloc(24));
  writeFileSync(join(p.blobs, `${'c'.repeat(64)}.part`), Buffer.alloc(7));
  writeFileSync(join(p.derived, 'a'.repeat(64), 'v1', 'x.md'), 'hello');
  writeFileSync(join(p.runs, 'r1', 'manifest.json'), '{}');
  return h;
}

it('counts every file, blob bytes against the limit, and runs', () => {
  const stats = attachmentCacheStats(home(), new Date('2026-10-10T01:00:00Z'));
  expect(stats).toEqual({
    bytes: 1000 + 24 + 7 + 5 + 2,
    blobBytes: 1031,
    blobs: 2,
    runs: 2,
    limitBytes: CACHE_MAX_BYTES,
    measuredAt: '2026-10-10T01:00:00.000Z',
  });
});

it('returns null when the cache does not exist or the walk runs out of time', () => {
  expect(attachmentCacheStats(tmpHome('crew-stats-empty-'))).toBeNull();
  expect(attachmentCacheStats(home(), new Date(), -1)).toBeNull();
});

it('keeps blob bytes within total bytes when a GC removes a blob during the measurement', () => {
  const h = home();
  const p = attachmentPaths(h);
  onRead.dir = p.root;
  onRead.run = () => rmSync(join(p.blobs, 'a'.repeat(64)));
  const stats = attachmentCacheStats(h);
  expect(stats?.blobBytes).toBeLessThanOrEqual(stats?.bytes ?? -1);
  expect(stats).toMatchObject({ bytes: 24 + 7 + 5 + 2, blobBytes: 31 });
});
