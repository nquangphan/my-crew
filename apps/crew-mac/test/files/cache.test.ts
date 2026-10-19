import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureCacheDirs,
  hasBlob,
  readRunManifest,
  storeBlob,
  writeRunManifest,
} from '../../src/files/cache.js';
import { MAX_FILE_BYTES } from '../../src/files/config.js';
import { attachmentPaths, blobPath, derivedDir, runDir } from '../../src/files/paths.js';
import type { RunManifest } from '../../src/files/types.js';
import { fakeHome, fakeSha, sha256Hex } from './helpers.js';

const RUN = '11111111-2222-4333-8444-555555555555';

async function* chunks(parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield part;
}

describe('storeBlob', () => {
  it('ghi .part rồi rename, quyền 0600, thư mục 0700', async () => {
    const p = attachmentPaths(fakeHome());
    ensureCacheDirs(p);
    const data = Buffer.from('xin chao');
    const sha = sha256Hex(data);
    const r = await storeBlob(p, sha, data, MAX_FILE_BYTES);
    expect(r).toEqual({ ok: true, path: blobPath(p, sha), bytes: 8 });
    expect(statSync(p.root).mode & 0o777).toBe(0o700);
    expect(statSync(blobPath(p, sha)).mode & 0o777).toBe(0o600);
    expect(readdirSync(p.blobs).filter((n) => n.includes('.part'))).toEqual([]);
    expect(readFileSync(blobPath(p, sha), 'utf8')).toBe('xin chao');
  });

  it('nhận AsyncIterable và ghép đúng byte', async () => {
    const p = attachmentPaths(fakeHome());
    ensureCacheDirs(p);
    const sha = sha256Hex('abcdef');
    const r = await storeBlob(p, sha, chunks([Buffer.from('abc'), Buffer.from('def')]), MAX_FILE_BYTES);
    expect(r).toEqual({ ok: true, path: blobPath(p, sha), bytes: 6 });
  });

  it('sha lệch thì không để lại blob, trả sai_ma_bam', async () => {
    const p = attachmentPaths(fakeHome());
    ensureCacheDirs(p);
    const r = await storeBlob(p, sha256Hex('chuoi khac'), Buffer.from('xin chao'), MAX_FILE_BYTES);
    expect(r).toEqual({ ok: false, reason: 'sai_ma_bam' });
    expect(readdirSync(p.blobs)).toEqual([]);
  });

  it('vượt trần trong lúc stream thì dừng, xóa .part, trả vuot_10mb', async () => {
    const p = attachmentPaths(fakeHome());
    ensureCacheDirs(p);
    const mib4 = new Uint8Array(4 * 1024 * 1024);
    let yielded = 0;
    async function* gen(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < 3; i += 1) {
        yielded += 1;
        yield mib4;
      }
    }
    const r = await storeBlob(p, fakeSha(1), gen(), MAX_FILE_BYTES);
    expect(r).toEqual({ ok: false, reason: 'vuot_10mb' });
    expect(yielded).toBe(3);
    expect(readdirSync(p.blobs)).toEqual([]);
  });

  it('hai lần ghi song song cùng sha vẫn ra một blob nguyên vẹn', async () => {
    const p = attachmentPaths(fakeHome());
    ensureCacheDirs(p);
    const data = Buffer.from('giong nhau');
    const sha = sha256Hex(data);
    const [a, b] = await Promise.all([
      storeBlob(p, sha, data, MAX_FILE_BYTES),
      storeBlob(p, sha, data, MAX_FILE_BYTES),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(readdirSync(p.blobs)).toEqual([sha]);
  });
});

describe('hasBlob', () => {
  it('blob đúng mã băm thì true, sai tên file thì false', async () => {
    const p = attachmentPaths(fakeHome());
    ensureCacheDirs(p);
    const data = Buffer.from('noi dung');
    const sha = sha256Hex(data);
    expect(hasBlob(p, sha)).toBe(false);
    await storeBlob(p, sha, data, MAX_FILE_BYTES);
    expect(hasBlob(p, sha)).toBe(true);
    expect(hasBlob(p, sha)).toBe(true);
  });

  it('blob có sẵn bị sửa nội dung thì hasBlob = false và blob bị xóa', async () => {
    const p = attachmentPaths(fakeHome());
    ensureCacheDirs(p);
    const data = Buffer.from('noi dung goc');
    const sha = sha256Hex(data);
    await storeBlob(p, sha, data, MAX_FILE_BYTES);
    expect(hasBlob(p, sha)).toBe(true);
    const path = blobPath(p, sha);
    writeFileSync(path, 'noi dung bi sua');
    const later = new Date(Date.now() + 60_000);
    utimesSync(path, later, later);
    expect(hasBlob(p, sha)).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  it('blob bị đặt vào mà chưa từng kiểm thì được băm lại lần đầu', () => {
    const p = attachmentPaths(fakeHome());
    ensureCacheDirs(p);
    const sha = sha256Hex('khong khop');
    writeFileSync(blobPath(p, sha), 'noi dung la', { mode: 0o600 });
    expect(hasBlob(p, sha)).toBe(false);
    expect(existsSync(blobPath(p, sha))).toBe(false);
  });
});

describe('đường dẫn và quyền', () => {
  it('runDir từ chối runId không phải UUID; blobPath/derivedDir từ chối sha sai dạng', () => {
    const p = attachmentPaths(fakeHome());
    expect(() => runDir(p, '../etc')).toThrow();
    expect(() => blobPath(p, '../../x')).toThrow();
    expect(() => blobPath(p, 'ABC')).toThrow();
    expect(() => derivedDir(p, 'zz')).toThrow();
    expect(derivedDir(p, fakeSha(1))).toBe(join(p.derived, fakeSha(1), 'v1'));
    expect(runDir(p, RUN)).toBe(join(p.runs, RUN));
  });

  it('quyền thư mục cũ 0755 được sửa về 0700', () => {
    const p = attachmentPaths(fakeHome());
    mkdirSync(p.blobs, { recursive: true, mode: 0o755 });
    ensureCacheDirs(p);
    for (const dir of [p.root, p.blobs, p.derived, p.runs, p.incoming]) {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  });
});

describe('manifest của run', () => {
  const manifest: RunManifest = {
    version: 1,
    runId: RUN,
    issueId: 'i-1',
    transport: 'bridge',
    generatedAt: '2026-10-09T12:00:00.000Z',
    files: [],
  };

  it('ghi atomic quyền 0600 rồi đọc lại đúng', () => {
    const p = attachmentPaths(fakeHome());
    ensureCacheDirs(p);
    const path = writeRunManifest(p, manifest);
    expect(path).toBe(join(runDir(p, RUN), 'manifest.json'));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(runDir(p, RUN))).toEqual(['manifest.json']);
    expect(readRunManifest(p, RUN)).toEqual(manifest);
  });

  it('thiếu file hoặc JSON hỏng hoặc sai version thì trả null', () => {
    const p = attachmentPaths(fakeHome());
    ensureCacheDirs(p);
    expect(readRunManifest(p, RUN)).toBeNull();
    mkdirSync(runDir(p, RUN), { recursive: true });
    writeFileSync(join(runDir(p, RUN), 'manifest.json'), '{khong phai json');
    expect(readRunManifest(p, RUN)).toBeNull();
    writeFileSync(join(runDir(p, RUN), 'manifest.json'), JSON.stringify({ ...manifest, version: 2 }));
    expect(readRunManifest(p, RUN)).toBeNull();
  });
});
