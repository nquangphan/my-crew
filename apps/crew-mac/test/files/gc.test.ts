import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CACHE_MAX_BYTES } from '../../src/files/config.js';
import { runGc } from '../../src/files/gc.js';
import { attachmentPaths, blobPath, derivedDir, runDir } from '../../src/files/paths.js';
import { fakeHome, fakeSha, seed } from './helpers.js';

const NOW = new Date('2026-10-09T12:00:00Z');
const GB = 1024 * 1024 * 1024;
const R1 = '11111111-2222-4333-8444-555555555551';
const R2 = '11111111-2222-4333-8444-555555555552';
const CUR = '11111111-2222-4333-8444-5555555555ff';

function setup() {
  return attachmentPaths(fakeHome());
}

describe('runGc', () => {
  it('xóa run 8 ngày cùng blob và derived chỉ nó tham chiếu', async () => {
    const p = setup();
    seed(p, NOW, {
      runs: [{ id: R1, ageDays: 8, shas: [fakeSha(1)] }],
      blobs: [{ sha: fakeSha(1), ageDays: 8, bytes: 10 }],
    });
    const r = await runGc(p, { now: NOW, currentRunId: null });
    expect(existsSync(runDir(p, R1))).toBe(false);
    expect(existsSync(blobPath(p, fakeSha(1)))).toBe(false);
    expect(existsSync(derivedDir(p, fakeSha(1)))).toBe(false);
    expect(r).toMatchObject({
      removedRuns: 1,
      removedBlobs: 1,
      removedDerived: 1,
      freedBytes: 10,
      skippedLocked: false,
    });
  });

  it('giữ blob 8 ngày còn được run 2 ngày tham chiếu', async () => {
    const p = setup();
    seed(p, NOW, {
      runs: [
        { id: R1, ageDays: 8, shas: [fakeSha(1)] },
        { id: R2, ageDays: 2, shas: [fakeSha(1)] },
      ],
      blobs: [{ sha: fakeSha(1), ageDays: 8, bytes: 10 }],
    });
    await runGc(p, { now: NOW, currentRunId: null });
    expect(existsSync(runDir(p, R1))).toBe(false);
    expect(existsSync(runDir(p, R2))).toBe(true);
    expect(existsSync(blobPath(p, fakeSha(1)))).toBe(true);
  });

  it('không xóa run hiện tại dù manifest cũ', async () => {
    const p = setup();
    seed(p, NOW, {
      runs: [{ id: CUR, ageDays: 9, shas: [fakeSha(1)] }],
      blobs: [{ sha: fakeSha(1), ageDays: 9, bytes: 10 }],
    });
    await runGc(p, { now: NOW, currentRunId: CUR });
    expect(existsSync(runDir(p, CUR))).toBe(true);
    expect(existsSync(blobPath(p, fakeSha(1)))).toBe(true);
  });

  it('vượt 2 GB: bỏ blob không ai tham chiếu cũ nhất trước, giữ blob run mới', async () => {
    const p = setup();
    // 3 x 0,9 GB = 2,7 GB; một blob mồ côi 3 ngày, hai blob được run 2 ngày tham chiếu.
    seed(p, NOW, {
      runs: [{ id: R2, ageDays: 2, shas: [fakeSha(2), fakeSha(3)] }],
      blobs: [
        { sha: fakeSha(1), ageDays: 3, bytes: Math.floor(0.9 * GB) },
        { sha: fakeSha(2), ageDays: 2, bytes: Math.floor(0.9 * GB) },
        { sha: fakeSha(3), ageDays: 2, bytes: Math.floor(0.9 * GB) },
      ],
    });
    const r = await runGc(p, { now: NOW, currentRunId: null });
    expect(existsSync(blobPath(p, fakeSha(1)))).toBe(false);
    expect(existsSync(blobPath(p, fakeSha(2)))).toBe(true);
    expect(existsSync(blobPath(p, fakeSha(3)))).toBe(true);
    expect(r.removedBlobs).toBe(1);
  });

  it('vẫn vượt trần thì xóa blob chỉ run > 24 giờ tham chiếu, không bao giờ blob của run hiện tại hay run < 24 giờ', async () => {
    const p = setup();
    const big = Math.floor(1.1 * GB);
    seed(p, NOW, {
      runs: [
        { id: R1, ageDays: 3, shas: [fakeSha(1)] },
        { id: R2, ageDays: 0.5, shas: [fakeSha(2)] },
        { id: CUR, ageDays: 0, shas: [fakeSha(3)] },
      ],
      blobs: [
        { sha: fakeSha(1), ageDays: 3, bytes: big },
        { sha: fakeSha(2), ageDays: 0.5, bytes: big },
        { sha: fakeSha(3), ageDays: 0, bytes: big },
      ],
    });
    await runGc(p, { now: NOW, currentRunId: CUR });
    expect(existsSync(blobPath(p, fakeSha(1)))).toBe(false);
    expect(existsSync(blobPath(p, fakeSha(2)))).toBe(true);
    expect(existsSync(blobPath(p, fakeSha(3)))).toBe(true);
  });

  it('blob mồ côi mới (< 24 giờ, đang tải cho run hiện tại) không bị LRU xóa', async () => {
    const p = setup();
    seed(p, NOW, { blobs: [{ sha: fakeSha(1), ageDays: 0.1, bytes: CACHE_MAX_BYTES + 1 }] });
    await runGc(p, { now: NOW, currentRunId: CUR });
    expect(existsSync(blobPath(p, fakeSha(1)))).toBe(true);
  });

  it('blob mồ côi quá 7 ngày bị xóa dù cache chưa đầy', async () => {
    const p = setup();
    seed(p, NOW, {
      blobs: [
        { sha: fakeSha(1), ageDays: 8, bytes: 5 },
        { sha: fakeSha(2), ageDays: 6, bytes: 5 },
      ],
    });
    await runGc(p, { now: NOW, currentRunId: null });
    expect(existsSync(blobPath(p, fakeSha(1)))).toBe(false);
    expect(existsSync(blobPath(p, fakeSha(2)))).toBe(true);
  });

  it('manifest giữ chỗ (pendingSha256, ghi trước khi tải) cũng được tính là tham chiếu', async () => {
    const p = setup();
    seed(p, NOW, { blobs: [{ sha: fakeSha(1), ageDays: 8, bytes: 5 }] });
    mkdirSync(runDir(p, R1), { recursive: true });
    writeFileSync(
      join(runDir(p, R1), 'manifest.json'),
      JSON.stringify({ version: 1, runId: R1, files: [], pendingSha256: [fakeSha(1)] }),
    );
    await runGc(p, { now: NOW, currentRunId: CUR });
    expect(existsSync(blobPath(p, fakeSha(1)))).toBe(true);
    expect(existsSync(derivedDir(p, fakeSha(1)))).toBe(true);
  });

  it('server-manifest.json của run cũng được tính là tham chiếu', async () => {
    const p = setup();
    seed(p, NOW, {
      runs: [{ id: R2, ageDays: 2, shas: [] }],
      blobs: [{ sha: fakeSha(1), ageDays: 8, bytes: 5 }],
    });
    writeFileSync(
      join(runDir(p, R2), 'server-manifest.json'),
      JSON.stringify({ version: 1, files: [{ sha256: fakeSha(1) }] }),
    );
    await runGc(p, { now: NOW, currentRunId: null });
    expect(existsSync(blobPath(p, fakeSha(1)))).toBe(true);
  });

  it('gc.lock của pid sống và còn mới thì bỏ qua, không xóa gì', async () => {
    const p = setup();
    seed(p, NOW, { blobs: [{ sha: fakeSha(1), ageDays: 8, bytes: 5 }] });
    writeFileSync(p.gcLock, JSON.stringify({ pid: process.pid, at: NOW.getTime() - 60_000 }));
    const r = await runGc(p, { now: NOW, currentRunId: null });
    expect(r.skippedLocked).toBe(true);
    expect(existsSync(blobPath(p, fakeSha(1)))).toBe(true);
    expect(existsSync(p.gcLock)).toBe(true);
  });

  it('khóa của pid chết hoặc cũ hơn 10 phút thì chiếm lại', async () => {
    const dead = spawnSync(process.execPath, ['-e', '0']).pid ?? 0;
    for (const lock of [
      { pid: dead, at: NOW.getTime() - 1000 },
      { pid: process.pid, at: NOW.getTime() - 11 * 60_000 },
    ]) {
      const p = setup();
      seed(p, NOW, { blobs: [{ sha: fakeSha(1), ageDays: 8, bytes: 5 }] });
      writeFileSync(p.gcLock, JSON.stringify(lock));
      const r = await runGc(p, { now: NOW, currentRunId: null });
      expect(r.skippedLocked).toBe(false);
      expect(existsSync(blobPath(p, fakeSha(1)))).toBe(false);
      expect(existsSync(p.gcLock)).toBe(false);
    }
  });

  it('.part cũ hơn 1 giờ bị xóa, .part mới giữ', async () => {
    const p = setup();
    seed(p, NOW, {});
    const old = join(p.blobs, `${fakeSha(1)}.part.1.a`);
    const fresh = join(p.blobs, `${fakeSha(2)}.part.1.b`);
    writeFileSync(old, 'x');
    writeFileSync(fresh, 'x');
    const twoHours = new Date(NOW.getTime() - 2 * 3600_000);
    const tenMin = new Date(NOW.getTime() - 10 * 60_000);
    utimesSync(old, twoHours, twoHours);
    utimesSync(fresh, tenMin, tenMin);
    await runGc(p, { now: NOW, currentRunId: null });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('hai lần runGc song song: đúng một lần dọn, lần kia skippedLocked', async () => {
    const p = setup();
    seed(p, NOW, { blobs: [{ sha: fakeSha(1), ageDays: 8, bytes: 5 }] });
    const reports = await Promise.all([
      runGc(p, { now: NOW, currentRunId: null }),
      runGc(p, { now: NOW, currentRunId: null }),
    ]);
    expect(reports.filter((r) => r.skippedLocked)).toHaveLength(1);
    expect(reports.reduce((n, r) => n + r.removedBlobs, 0)).toBe(1);
  });

  it('cache chưa có thì không lỗi', async () => {
    const p = setup();
    mkdirSync(p.root, { recursive: true });
    const r = await runGc(p, { now: NOW, currentRunId: null });
    expect(r).toEqual({
      removedRuns: 0,
      removedBlobs: 0,
      removedDerived: 0,
      freedBytes: 0,
      skippedLocked: false,
    });
  });

  it('derived mồ côi (không còn blob) bị xóa', async () => {
    const p = setup();
    seed(p, NOW, {});
    mkdirSync(join(p.derived, fakeSha(9), 'v1'), { recursive: true });
    const r = await runGc(p, { now: NOW, currentRunId: null });
    expect(existsSync(join(p.derived, fakeSha(9)))).toBe(false);
    expect(r.removedDerived).toBe(1);
  });
});
