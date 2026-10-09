// Port từ v2/server/test/attachments-text-csv.unit.test.ts (a13dd7d); tên ca và giá trị mong đợi giữ nguyên.
// Không port các ca của khung worker Docker/frame/verify v2 (không có ở Mac).
import { describe, expect, it } from 'vitest';
import { empty, extractCsv, extractText, missing, problem } from '../../src/files/extract/index.js';
import { parserDefaults } from '../../src/files/extract/limits.js';
import { extractOutputs } from '../../src/files/extract/output.js';
import { corpusCases, extractContextFixture } from '../fixtures/attachments/make-fixtures.js';

const text = (r: Awaited<ReturnType<typeof extractText>>) =>
  Buffer.concat(r.files.map((f) => Buffer.from(f.bytes))).toString();

describe('trình đọc text/CSV (port v2)', () => {
  it('attachment text preserves UTF8 source byte spans and literal scripts', async () => {
    const b = Buffer.from('Việt\n<script>x()</script>\u0000');
    const r = await extractText(b, extractContextFixture('text/plain'));
    expect(r.status).toBe('complete');
    expect(text(r)).toMatch(/Việt/);
    expect(text(r)).toMatch(/\\u0000/);
    expect(r.units[0]?.locator).toEqual({
      kind: 'text',
      byteStart: 0,
      byteEnd: b.length,
      lineStart: 1,
      lineEnd: 2,
    });
  });

  it('attachment text UTF16 endian BOM and invalid UTF8', async () => {
    expect(
      (await extractText(Buffer.from([0xff, 0xfe, 65, 0]), extractContextFixture('text/plain'))).status,
    ).toBe('complete');
    expect(
      (await extractText(Buffer.from([0xfe, 0xff, 0, 65]), extractContextFixture('text/plain'))).status,
    ).toBe('complete');
    expect((await extractText(Buffer.from([0xc0, 0xaf]), extractContextFixture('text/plain'))).status).toBe(
      'unsupported',
    );
  });

  it('attachment text cap preserves missing original tail', async () => {
    const c = extractContextFixture('text/plain');
    c.config.limits.maxTextBytes = 4;
    const r = await extractText(Buffer.from('abc\ndef'), c);
    expect(r.status).toBe('partial');
    expect(
      r.units.some((u) => u.state === 'missing' && u.locator.kind === 'text' && u.locator.byteEnd === 7),
    ).toBe(true);
  });

  it('attachment csv retains multiline quoted cells without evaluating formula', async () => {
    const r = await extractCsv(
      Buffer.from('name,value\r\n"a\nb","=1+1"\r\n'),
      extractContextFixture('text/csv'),
    );
    expect(r.status).toBe('complete');
    expect(text(r)).toMatch(/=1\+1/);
    expect(text(r)).toMatch(/a\\nb/);
    expect(r.units.some((u) => u.locator.kind === 'csv' && u.locator.rowStart === 2)).toBe(true);
  });

  for (const bad of ['a"b,c', '"a"x,c', '"unclosed'])
    it(`attachment malformed CSV ${JSON.stringify(bad)}`, async () => {
      expect((await extractCsv(Buffer.from(bad), extractContextFixture('text/csv'))).status).toBe('corrupt');
    });

  it('attachment CSV cap reports missing rows', async () => {
    const c = extractContextFixture('text/csv');
    c.config.limits.maxCsvRows = 1;
    const r = await extractCsv(Buffer.from('a\nb\nc'), c);
    expect(r.status).toBe('partial');
    expect(r.units.some((u) => u.state === 'missing')).toBe(true);
  });

  it('attachment UTF16 capped tail uses real byte and line boundaries', async () => {
    const c = extractContextFixture('text/plain');
    c.config.limits.maxTextBytes = 2;
    const r = await extractText(
      Buffer.concat([Buffer.from([255, 254]), Buffer.from('a\nb\nc', 'utf16le')]),
      c,
    );
    const tail = r.units.find((u) => u.state === 'missing');
    expect(tail?.locator).toEqual({ kind: 'text', byteStart: 6, byteEnd: 12, lineStart: 2, lineEnd: 3 });
  });

  it('attachment complete text whitespace has explicit zero content coverage', async () => {
    const r = await extractText(Buffer.from(' \n\t'), extractContextFixture('text/plain'));
    expect(r.status).toBe('complete');
    expect(r.units.length).toBe(1);
    expect(r.units[0]?.state).toBe('available');
  });

  it('attachment entire golden corpus keeps v2 status and text (phần DOCX/XLSX/CSV/text)', async () => {
    const { extractDocx, extractXlsx } = await import('../../src/files/extract/index.js');
    const run = { text: extractText, csv: extractCsv, docx: extractDocx, xlsx: extractXlsx };
    for (const item of corpusCases()) {
      const r = await run[item.kind](item.bytes, extractContextFixture());
      expect(r.status, item.name).toBe(item.status);
      if (item.text) expect(text(r).includes(item.text), item.name).toBe(true);
    }
  });

  it('attachment CSV Unicode field byte cap uses codepoints and large row sets group coverage', async () => {
    const c = extractContextFixture('text/csv');
    c.config.limits.maxCsvFieldBytes = 4;
    expect((await extractCsv(Buffer.from('😀'), c)).status).toBe('complete');
    const rows = await extractCsv(Buffer.from('x\n'.repeat(12000)), extractContextFixture('text/csv'));
    expect(rows.status).toBe('complete');
    expect(rows.units.length).toBeLessThan(10000);
    expect(rows.units.some((u) => u.locator.kind === 'csv' && u.locator.rowEnd === 12000)).toBe(true);
  });

  it('attachment missing coverage append is bounded before allocation grows', () => {
    const r = empty();
    r.problems = Array(100000).fill(problem('LIMIT_EXCEEDED'));
    expect(() =>
      missing(
        r,
        { kind: 'text', byteStart: 0, byteEnd: 1, lineStart: 1, lineEnd: 1 },
        'text',
        'LIMIT_EXCEEDED',
      ),
    ).toThrow(/LIMIT_EXCEEDED/);
  });

  it('trần ParserLimits giữ nguyên số v2', () => {
    expect(parserDefaults).toEqual({
      maxExpandedBytes: 100 * 1024 * 1024,
      maxEntryBytes: 20 * 1024 * 1024,
      maxZipEntries: 2000,
      maxCompressionRatio: 100,
      maxXmlDepth: 64,
      maxTextNodeBytes: 1024 * 1024,
      maxTextBytes: 10 * 1024 * 1024,
      maxCsvRows: 100000,
      maxCsvColumns: 1000,
      maxCsvFieldBytes: 1024 * 1024,
      maxPdfPages: 200,
      pdfDpi: 144,
      maxPagePixels: 20_000_000,
      maxImagePixels: 40_000_000,
      maxOutputBytes: 100 * 1024 * 1024,
    });
  });
});

describe('đầu ra text/CSV cho agent', () => {
  const body = (o: Awaited<ReturnType<typeof extractOutputs>>) =>
    Buffer.from(o.outputs.find((f) => f.kind === 'text')?.bytes ?? []).toString();

  it('text giữ nguyên nội dung, ghi ra .txt dù tên gốc có đuôi khác', async () => {
    const source = 'const a = 1;\n// Việt Nam\n<script>x()</script>\n';
    const o = await extractOutputs('text', Buffer.from(source), 'main.ts');
    expect(o.status).toBe('complete');
    expect(o.outputs.map((f) => f.path)).toEqual(['main.txt']);
    expect(body(o)).toBe(source);
  });

  it('text có đuôi .png (byte là chữ) vẫn ra .txt để Read không coi là ảnh', async () => {
    const o = await extractOutputs('text', Buffer.from('xin chào'), 'anh.png');
    expect(o.outputs[0]?.path).toBe('anh.txt');
  });

  it('text không phải UTF-8 → unsupported với mã UNSUPPORTED_ENCODING, không có đầu ra', async () => {
    const o = await extractOutputs('text', Buffer.from([0x61, 0xc0, 0xaf]), 'a.txt');
    expect(o.status).toBe('unsupported');
    expect(o.problemCodes).toEqual(['UNSUPPORTED_ENCODING']);
    expect(o.outputs).toEqual([]);
  });

  it('CSV giữ nguyên bản gốc (không đổi sang JSON), đuôi .csv', async () => {
    const source = 'name,value\r\n"a\nb","=1+1"\r\n';
    const o = await extractOutputs('csv', Buffer.from(source), 'bang.csv');
    expect(o.status).toBe('complete');
    expect(o.outputs.map((f) => f.path)).toEqual(['bang.csv']);
    expect(body(o)).toBe(source);
  });

  it('CSV hỏng (ngoặc kép không đóng) → corrupt', async () => {
    const o = await extractOutputs('csv', Buffer.from('a,"unclosed'), 'x.csv');
    expect(o.status).toBe('corrupt');
    expect(o.outputs).toEqual([]);
  });

  it('CSV 200000 dòng → partial, giữ trọn 100000 dòng đầu, ghi chú vượt giới hạn', async () => {
    const source = Array.from({ length: 200000 }, (_, i) => `${i + 1},x`).join('\n');
    const o = await extractOutputs('csv', Buffer.from(source), 'lon.csv');
    expect(o.status).toBe('partial');
    expect(o.notes).toEqual([{ code: 'vuot_gioi_han' }]);
    const lines = body(o).split('\n').filter(Boolean);
    expect(lines.length).toBe(100000);
    expect(lines.at(-1)).toBe('100000,x');
  });

  it('tên file được làm sạch: bỏ đường dẫn, ký tự điều khiển, dấu chấm đầu', async () => {
    const o = await extractOutputs('text', Buffer.from('x'), '..\u0007bí mật.md');
    expect(o.outputs[0]?.path).toBe('bí-mật.txt');
    const blank = await extractOutputs('text', Buffer.from('x'), '...');
    expect(blank.outputs[0]?.path).toBe('noi-dung.txt');
  });
});
