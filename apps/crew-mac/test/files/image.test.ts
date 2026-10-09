import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareImage } from '../../src/files/image.js';
import { createRunner, type RunOptions } from '../../src/system.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { fakeSha } from './helpers.js';

const MB = 1024 * 1024;
const FIXTURES = new URL('../fixtures/attachments/', import.meta.url);

/** Đầu ra thật của `sips -g pixelWidth -g pixelHeight` trên máy này (macOS 26). */
function sipsDims(path: string, width: number, height: number): string {
  return `${path}\n  pixelWidth: ${width}\n  pixelHeight: ${height}\n`;
}

let dir: string;
let blob: string;
let outDir: string;
const sha = fakeSha(1);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crew-att-img-'));
  blob = join(dir, sha);
  outDir = join(dir, 'derived', sha, 'v1');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function sizedBlob(bytes: number): void {
  writeFileSync(blob, '');
  truncateSync(blob, bytes);
}

/** Runner giả: `-g` trả kích thước cho trước; lệnh đổi thì ghi file `--out` (hoặc thoát mã cho trước). */
function fakeSips(width: number, height: number, convertCode = 0): FakeRunner {
  return new FakeRunner().on('sips', (args: readonly string[], _o: RunOptions) => {
    if (args[0] === '-g') return { stdout: sipsDims(args[args.length - 1] ?? '', width, height) };
    const out = args[args.indexOf('--out') + 1];
    if (convertCode === 0 && out) writeFileSync(out, 'jpeg');
    return { code: convertCode };
  });
}

describe('prepareImage (runner giả)', () => {
  it('PNG 3 MB, 2000×1500: đọc thẳng blob, không đổi', async () => {
    sizedBlob(3 * MB);
    const runner = fakeSips(2000, 1500);
    expect(await prepareImage(runner, blob, 'png', outDir)).toEqual({ readPath: blob, resized: false });
    expect(runner.commands()).toEqual([`sips -g pixelWidth -g pixelHeight ${blob}`]);
  });

  it('PNG 6 MB, 5000×4000: thu nhỏ còn cạnh 4096 ra JPEG', async () => {
    sizedBlob(6 * MB);
    const runner = fakeSips(5000, 4000);
    const result = await prepareImage(runner, blob, 'png', outDir);
    const target = join(outDir, `${sha}.jpg`);
    expect(result).toEqual({ readPath: target, resized: true });
    const convert = runner.calls[1];
    expect(convert?.args.slice(0, 6)).toEqual(['-Z', '4096', '-s', 'format', 'jpeg', blob]);
    expect(convert?.args[6]).toBe('--out');
    expect(existsSync(target)).toBe(true);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readdirSync(outDir)).toEqual([`${sha}.jpg`]);
  });

  it('PNG 6 MB nhưng cạnh nhỏ: không phóng to, giữ cạnh dài nhất', async () => {
    sizedBlob(6 * MB);
    const runner = fakeSips(3000, 2000);
    await prepareImage(runner, blob, 'png', outDir);
    expect(runner.calls[1]?.args.slice(0, 2)).toEqual(['-Z', '3000']);
  });

  it('ảnh nhỏ nhưng cạnh > 8000 px: thu nhỏ', async () => {
    sizedBlob(1 * MB);
    const runner = fakeSips(9000, 100);
    expect(await prepareImage(runner, blob, 'gif', outDir)).toMatchObject({ resized: true });
  });

  it('HEIC: đổi sang JPEG, không thu nhỏ khi không cần', async () => {
    sizedBlob(2 * MB);
    const runner = fakeSips(4032, 3024);
    const result = await prepareImage(runner, blob, 'heic', outDir);
    expect(result).toEqual({ readPath: join(outDir, `${sha}.jpg`), resized: false });
    expect(runner.calls[1]?.args.slice(0, 4)).toEqual(['-s', 'format', 'jpeg', blob]);
  });

  it('HEIC rất lớn: đổi và thu nhỏ', async () => {
    sizedBlob(2 * MB);
    const runner = fakeSips(12000, 9000);
    const result = await prepareImage(runner, blob, 'heic', outDir);
    expect(result).toMatchObject({ resized: true });
    expect(runner.calls[1]?.args.slice(0, 5)).toEqual(['-Z', '4096', '-s', 'format', 'jpeg']);
  });

  it('sips thoát 1 khi đổi → doi_anh_loi, không để file dở', async () => {
    sizedBlob(6 * MB);
    const runner = fakeSips(5000, 4000, 1);
    expect(await prepareImage(runner, blob, 'png', outDir)).toEqual({ error: 'doi_anh_loi' });
    expect(existsSync(outDir) ? readdirSync(outDir) : []).toEqual([]);
  });

  it('sips thoát 0 nhưng không ghi file (file hỏng) → doi_anh_loi', async () => {
    sizedBlob(6 * MB);
    const runner = new FakeRunner().on('sips', (args) =>
      args[0] === '-g' ? { stdout: sipsDims(blob, 5000, 4000) } : { code: 0 },
    );
    expect(await prepareImage(runner, blob, 'png', outDir)).toEqual({ error: 'doi_anh_loi' });
  });

  it('sips -g không có kích thước (sips chỉ in cảnh báo, thoát 0) → doi_anh_loi', async () => {
    sizedBlob(1 * MB);
    const runner = new FakeRunner().on('sips', () => ({
      stdout: '',
      stderr: `Warning: ${blob} not a valid file - skipping\n`,
    }));
    expect(await prepareImage(runner, blob, 'png', outDir)).toEqual({ error: 'doi_anh_loi' });
  });

  it('mọi lời gọi sips có timeout', async () => {
    sizedBlob(6 * MB);
    const runner = fakeSips(5000, 4000);
    await prepareImage(runner, blob, 'png', outDir);
    for (const call of runner.calls) expect(call.options.timeoutMs).toBeGreaterThan(0);
  });
});

describe.runIf(process.platform === 'darwin')('prepareImage (sips thật)', () => {
  it('orientation-6.jpg nhỏ: đọc thẳng', async () => {
    copyFileSync(new URL('orientation-6.jpg', FIXTURES), blob);
    expect(await prepareImage(createRunner(), blob, 'jpeg', outDir)).toEqual({
      readPath: blob,
      resized: false,
    });
  });

  it('HEIC tạo bằng sips → JPEG đọc được', async () => {
    const heic = join(dir, 'src.heic');
    execFileSync(
      'sips',
      ['-s', 'format', 'heic', new URL('orientation-6.jpg', FIXTURES).pathname, '--out', heic],
      {
        stdio: 'ignore',
      },
    );
    copyFileSync(heic, blob);
    const result = await prepareImage(createRunner(), blob, 'heic', outDir);
    if (!('readPath' in result)) throw new Error('đổi HEIC thất bại');
    expect(result.readPath).toBe(join(outDir, `${sha}.jpg`));
    expect(execFileSync('sips', ['-g', 'format', result.readPath], { encoding: 'utf8' })).toMatch(
      /format: jpeg/,
    );
  });

  it('file không phải ảnh → doi_anh_loi', async () => {
    writeFileSync(blob, 'không phải ảnh');
    expect(await prepareImage(createRunner(), blob, 'heic', outDir)).toEqual({ error: 'doi_anh_loi' });
  });
});
