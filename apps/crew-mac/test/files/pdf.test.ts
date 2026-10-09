import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspectPdf, pdfReadHint } from '../../src/files/pdf.js';
import { createRunner } from '../../src/system.js';
import { FakeRunner } from '../helpers/fake-runner.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/attachments/${name}`, import.meta.url));

function fakeOsascript(stdout: string, code = 0): FakeRunner {
  return new FakeRunner().on('osascript', () => ({ stdout, code }));
}

describe('inspectPdf (runner giả)', () => {
  it('đọc JSON số trang và mã hóa', async () => {
    const runner = fakeOsascript('{"pages":3,"encrypted":false}\n');
    expect(await inspectPdf(runner, '/x/blob')).toEqual({ pages: 3, encrypted: false });
    const call = runner.calls[0];
    expect(call?.args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e']);
    expect(call?.args[3]).toContain('PDFDocument');
    expect(call?.args[4]).toBe('/x/blob');
    expect(call?.options.timeoutMs).toBeGreaterThan(0);
  });
  it('PDF mã hóa', async () =>
    expect(await inspectPdf(fakeOsascript('{"pages":1,"encrypted":true}'), '/x')).toEqual({
      pages: 1,
      encrypted: true,
    }));
  it.each([
    ['{"error":"open"}', 0],
    ['rác không phải JSON', 0],
    ['{"pages":-1,"encrypted":false}', 0],
    ['{"pages":"3","encrypted":false}', 0],
    ['{"pages":3,"encrypted":false}', 1],
    ['', 0],
  ])('đầu ra %j (mã %d) → hong_cau_truc', async (stdout, code) =>
    expect(await inspectPdf(fakeOsascript(stdout, code), '/x')).toEqual({ error: 'hong_cau_truc' }),
  );
  it('osascript quá thời gian → hong_cau_truc', async () => {
    const runner = new FakeRunner().on('osascript', () => ({ code: 137, timedOut: true }));
    expect(await inspectPdf(runner, '/x')).toEqual({ error: 'hong_cau_truc' });
  });
});

it('build chép script PDFKit vào dist cạnh pdf.js', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(pkg.scripts.build).toContain('cp src/files/pdf-info.js dist/files/');
});

describe('pdfReadHint', () => {
  it.each([
    [1, ''],
    [8, ''],
    [10, ''],
    [11, 'pages 1-11'],
    [20, 'pages 1-20'],
    [21, 'pages 1-20, 21-21'],
    [45, 'pages 1-20, 21-40, 41-45'],
  ])('%d trang → %j', (pages, hint) => expect(pdfReadHint(pages)).toBe(hint));
});

describe.runIf(process.platform === 'darwin')('inspectPdf (PDFKit thật)', () => {
  it('encrypted.pdf → encrypted', async () =>
    expect(await inspectPdf(createRunner(), fixture('encrypted.pdf'))).toMatchObject({ encrypted: true }));
  it.each(['text.pdf', 'scan.pdf'])('%s → có trang, không mã hóa', async (name) => {
    const result = await inspectPdf(createRunner(), fixture(name));
    if (!('pages' in result)) throw new Error('không mở được PDF');
    expect(result.pages).toBeGreaterThanOrEqual(1);
    expect(result.encrypted).toBe(false);
  });
  it('file không phải PDF → hong_cau_truc', async () =>
    expect(await inspectPdf(createRunner(), fixture('orientation-6.jpg'))).toEqual({
      error: 'hong_cau_truc',
    }));
});
