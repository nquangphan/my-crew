// Port từ v2/server/test/attachments-ooxml.unit.test.ts (a13dd7d); tên ca và giá trị mong đợi giữ nguyên.
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractDocx, extractXlsx, parseXml, readOfficeParts } from '../../src/files/extract/index.js';
import { extractOutputs } from '../../src/files/extract/output.js';
import {
  extractContextFixture,
  makeOffice,
  makePng,
  makeZip,
  officeRelNs,
  relNs,
  sheetNs,
  wordNs,
} from '../fixtures/attachments/make-fixtures.js';

const text = (r: Awaited<ReturnType<typeof extractDocx>>) =>
  Buffer.concat(r.files.map((f) => Buffer.from(f.bytes))).toString();
const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main';

describe('trình đọc OOXML (port v2)', () => {
  it('attachment Vietnamese DOCX preserves actual part paragraph locator', async () => {
    const r = await extractDocx(makeOffice('docx'), extractContextFixture('application/docx'));
    expect(r.status).toBe('complete');
    expect(Buffer.from(r.files[0]?.bytes ?? []).toString()).toMatch(/Xin chào Việt Nam/);
    expect(r.units[0]?.locator).toEqual({
      kind: 'docx',
      part: 'word/document.xml',
      paragraph: 1,
      table: null,
      row: null,
      cell: null,
    });
  });

  it('attachment XLSX includes veryHidden sheet and literal cached formula', async () => {
    const r = await extractXlsx(makeOffice('xlsx'), extractContextFixture('application/xlsx'));
    expect(r.status).toBe('complete');
    expect(
      r.units.some((u) => u.locator.kind === 'sheet' && u.locator.hidden && u.locator.sheet === 'Ẩn'),
    ).toBe(true);
    expect(text(r)).toMatch(/1\+1/);
  });

  it('attachment XLSX absent formula cache is missing coverage', async () => {
    const r = await extractXlsx(
      makeOffice('xlsx', {
        'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1"><f>1+1</f></c></row></sheetData></worksheet>`,
      }),
      extractContextFixture('application/xlsx'),
    );
    expect(r.status).toBe('partial');
    expect(r.problems.some((p) => p.code === 'FORMULA_CACHE_MISSING')).toBe(true);
  });

  it('attachment XML rejects DTD and namespace alias is recognized', () => {
    expect(() =>
      parseXml(
        Buffer.from('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///sentinel">]><a>&x;</a>'),
        () => {},
        extractContextFixture('text/xml').config,
      ),
    ).toThrow(/CORRUPT_XML_DTD/);
    const events: string[] = [];
    parseXml(
      Buffer.from(`<z:p xmlns:z="${wordNs}">ok</z:p>`),
      (e) => events.push(`${e.uri}:${e.local}`),
      extractContextFixture('text/xml').config,
    );
    expect(events).toContain(`${wordNs}:p`);
  });

  for (const names of [['a', 'A'], ['é', 'é'], ['a/b', 'a\\b'], ['../a'], ['/a']])
    it(`attachment ZIP rejects paths ${JSON.stringify(names)}`, async () => {
      await expect(
        readOfficeParts(
          makeZip(names.map((name) => ({ name, body: 'x' }))),
          extractContextFixture('application/zip'),
        ),
      ).rejects.toThrow();
    });

  for (const [label, entry] of [
    ['encryption', { name: 'a', body: 'x', flags: 1 }],
    ['symlink', { name: 'a', body: 'x', attrs: 0xa1ff0000 }],
    ['size mismatch', { name: 'a', body: 'actual', declaredSize: 1 }],
    ['unknown compression', { name: 'a', body: 'x', method: 99 }],
  ] as const)
    it(`attachment ZIP rejects ${label}`, async () => {
      await expect(
        readOfficeParts(makeZip([entry]), extractContextFixture('application/zip')),
      ).rejects.toThrow();
    });

  it('attachment ZIP rejects CRC and invalid offsets', async () => {
    for (const offset of [14, 42]) {
      const b = makeZip([{ name: 'a', body: 'x' }]);
      if (offset === 14) b[14] = (b[14] ?? 0) ^ 1;
      else b.writeUInt32LE(0xfffffff0, b.indexOf(Buffer.from('504b0102', 'hex')) + 42);
      await expect(readOfficeParts(b, extractContextFixture('application/zip'))).rejects.toThrow();
    }
  });

  it('attachment ZIP 2001 entries refused', async () => {
    await expect(
      readOfficeParts(
        makeZip(Array.from({ length: 2001 }, (_, i) => ({ name: `x${i}`, body: '' }))),
        extractContextFixture('application/zip'),
      ),
    ).rejects.toThrow(/LIMIT_EXCEEDED/);
  });

  it('mục zip mã hóa → PASSWORD_REQUIRED (mật khẩu), không phải nội dung chủ động', async () => {
    await expect(
      readOfficeParts(
        makeZip([{ name: 'word/document.xml', body: 'x', flags: 0x801 }]),
        extractContextFixture('application/zip'),
      ),
    ).rejects.toThrow(/PASSWORD_REQUIRED/);
  });

  for (const name of ['word/vbaProject.bin', 'word/embeddings/oleObject1.bin'])
    it(`attachment office active content ${name} is blocked`, async () => {
      const r = await extractDocx(
        makeOffice('docx', { [name]: 'inert' }),
        extractContextFixture('application/docx'),
      );
      expect(r.status).toBe('blocked');
    });

  it('attachment DOCX image has real paragraph component and no fabricated cell', async () => {
    const r = await extractDocx(
      makeOffice('docx', {
        'word/document.xml': `<w:document xmlns:w="${wordNs}" xmlns:a="${drawingNs}" xmlns:r="${officeRelNs}"><w:body><w:p><w:r><w:t>Picture</w:t><w:drawing><a:blip r:embed="i1"/></w:drawing></w:r></w:p></w:body></w:document>`,
        'word/_rels/document.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="i1" Type="${officeRelNs}/image" Target="media/a.png"/></Relationships>`,
        'word/media/a.png': makePng(1, 1),
      }),
      extractContextFixture('application/docx'),
    );
    expect(r.status).toBe('complete');
    const image = r.units.find((u) => u.needs === 'vision');
    expect(image?.locator).toEqual({
      kind: 'docx',
      part: 'word/document.xml',
      paragraph: 1,
      table: null,
      row: null,
      cell: null,
      component: { kind: 'image', index: 1 },
    });
  });

  it('attachment ZIP expansion bounds count actual streamed bytes', async () => {
    const raw = Buffer.alloc(100 * 1024 * 1024, 65);
    const packed = deflateRawSync(raw);
    const b = makeZip([{ name: 'large.xml', body: packed, method: 8, declaredSize: 1024 * 1024 }]);
    const central = b.indexOf(Buffer.from('504b0102', 'hex'));
    b.writeUInt32LE(crc32(raw), 14);
    b.writeUInt32LE(crc32(raw), central + 16);
    await expect(readOfficeParts(b, extractContextFixture('application/zip'))).rejects.toThrow();
  });

  it('attachment ZIP overlapping local records and ZIP64 unsafe sizes are rejected', async () => {
    const b = makeZip([
      { name: 'a', body: 'x' },
      { name: 'b', body: 'y' },
    ]);
    const first = b.indexOf(Buffer.from('504b0102', 'hex'));
    const second = first + 47;
    b.writeUInt32LE(0, second + 42);
    await expect(readOfficeParts(b, extractContextFixture('application/zip'))).rejects.toThrow();
    const zip64 = makeZip([{ name: 'a', body: 'x' }]);
    zip64.writeUInt32LE(0xffffffff, zip64.indexOf(Buffer.from('504b0102', 'hex')) + 24);
    await expect(readOfficeParts(zip64, extractContextFixture('application/zip'))).rejects.toThrow();
  });

  it('attachment XML depth cap and undefined entity do not return useful text', () => {
    const c = extractContextFixture('text/xml');
    c.config.limits.maxXmlDepth = 2;
    expect(() => parseXml(Buffer.from('<a><b><c/></b></a>'), () => {}, c.config)).toThrow();
    expect(() => parseXml(Buffer.from('<a>&unknown;</a>'), () => {}, c.config)).toThrow();
  });

  it('attachment DOCX unanchored body altChunk is unsupported without fabricated paragraph', async () => {
    const r = await extractDocx(
      makeOffice('docx', {
        'word/document.xml': `<w:document xmlns:w="${wordNs}" xmlns:r="${officeRelNs}"><w:body><w:altChunk r:id="x"/></w:body></w:document>`,
        'word/_rels/document.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="x" Type="${officeRelNs}/aFChunk" Target="https://invalid.example/sentinel" TargetMode="External"/></Relationships>`,
      }),
      extractContextFixture('application/docx'),
    );
    expect(r.status).toBe('unsupported');
    expect(r.units.length).toBe(0);
    expect(r.files.length).toBe(0);
  });

  it('attachment renamed DOCM content type is blocked before paragraphs', async () => {
    const r = await extractDocx(
      makeOffice('docx', {
        '[Content_Types].xml':
          '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
      }),
      extractContextFixture('application/docx'),
    );
    expect(r.status).toBe('blocked');
    expect(r.files.length).toBe(0);
  });

  it('attachment DOCX unsupported drawing is explicit missing visual', async () => {
    const r = await extractDocx(
      makeOffice('docx', {
        'word/document.xml': `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>`,
      }),
      extractContextFixture('application/docx'),
    );
    expect(r.status).toBe('partial');
    expect(r.units.some((u) => u.state === 'missing' && u.needs === 'vision')).toBe(true);
  });

  it('attachment pre-anchor XML limit fails without fabricated geometry', async () => {
    const c = extractContextFixture('application/docx');
    c.config.limits.maxXmlDepth = 1;
    const r = await extractDocx(makeOffice('docx'), c);
    expect(r.status).toBe('failed');
    expect(r.units.length).toBe(0);
    expect(r.problems.some((p) => p.code === 'LIMIT_EXCEEDED')).toBe(true);
  });

  it('attachment workbook-level unsupported pivot has no invented sheet locator', async () => {
    const r = await extractXlsx(
      makeOffice('xlsx', { 'xl/pivotTables/pivot1.xml': '<pivot/>' }),
      extractContextFixture('application/xlsx'),
    );
    expect(r.status).toBe('unsupported');
    expect(r.units.length).toBe(0);
    expect(r.files.length).toBe(0);
  });

  it('attachment XLSX drawing image uses its C4 anchor instead of invented A1', async () => {
    const r = await extractXlsx(
      makeOffice('xlsx', {
        'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="d1" Type="${officeRelNs}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
        'xl/drawings/drawing1.xml': `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${drawingNs}" xmlns:r="${officeRelNs}"><xdr:oneCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:row>3</xdr:row></xdr:from><xdr:pic><a:blip r:embed="i1"/></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>`,
        'xl/drawings/_rels/drawing1.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="i1" Type="${officeRelNs}/image" Target="../media/a.png"/></Relationships>`,
        'xl/media/a.png': makePng(1, 1),
      }),
      extractContextFixture('application/xlsx'),
    );
    expect(r.status).toBe('complete');
    expect(
      r.units.some(
        (u) =>
          u.needs === 'vision' &&
          u.locator.kind === 'sheet' &&
          u.locator.range === 'C4:C4' &&
          u.locator.component?.kind === 'image',
      ),
    ).toBe(true);
  });

  it('attachment workbook coordinate limit retains real excluded cell and shared formula source', async () => {
    const c = extractContextFixture('application/xlsx');
    c.config.limits.maxCsvRows = 1;
    const r = await extractXlsx(
      makeOffice('xlsx', {
        'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A2">B1+1</f><v>2</v></c></row><row r="2"><c r="A2"><f t="shared" si="0"/><v>3</v></c></row></sheetData></worksheet>`,
      }),
      c,
    );
    expect(r.status).toBe('partial');
    expect(
      r.units.some((u) => u.state === 'missing' && u.locator.kind === 'sheet' && u.locator.range === 'A2'),
    ).toBe(true);
  });

  it('attachment wrong Office structural namespace cannot certify empty complete', async () => {
    const r = await extractDocx(
      makeOffice('docx', {
        'word/document.xml': '<document xmlns="urn:unknown"><body><p>lost</p></body></document>',
      }),
      extractContextFixture('application/docx'),
    );
    expect(r.status).not.toBe('complete');
    expect(r.files.length).toBe(0);
  });

  it('attachment DOCX nested tables restore actual outer cell and ordered header content', async () => {
    const xml = `<w:document xmlns:w="${wordNs}"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>outer-before</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:ins><w:t>outer-after</w:t></w:ins></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
    const r = await extractDocx(
      makeOffice('docx', {
        'word/document.xml': xml,
        'word/header1.xml': `<w:hdr xmlns:w="${wordNs}"><w:p><w:r><w:t>header</w:t></w:r></w:p></w:hdr>`,
      }),
      extractContextFixture('application/docx'),
    );
    expect(r.status).toBe('complete');
    const last = r.units.find(
      (u) => u.locator.kind === 'docx' && u.locator.part === 'word/document.xml' && u.locator.paragraph === 3,
    );
    expect(last?.locator).toEqual({
      kind: 'docx',
      part: 'word/document.xml',
      paragraph: 3,
      table: 1,
      row: 1,
      cell: 1,
    });
    expect(text(r)).toContain('[inserted]outer-after');
    expect(r.units.some((u) => u.locator.kind === 'docx' && u.locator.part === 'word/header1.xml')).toBe(
      true,
    );
  });

  it('attachment DOCX external image with actual paragraph anchor is partial without fetch', async () => {
    const r = await extractDocx(
      makeOffice('docx', {
        'word/document.xml': `<w:document xmlns:w="${wordNs}" xmlns:a="${drawingNs}" xmlns:r="${officeRelNs}"><w:body><w:p><w:r><w:drawing><a:blip r:link="x"/></w:drawing></w:r></w:p></w:body></w:document>`,
        'word/_rels/document.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="x" Type="${officeRelNs}/image" Target="https://invalid.example/sentinel" TargetMode="External"/></Relationships>`,
      }),
      extractContextFixture('application/docx'),
    );
    expect(r.status).toBe('partial');
    expect(
      r.units.some(
        (u) =>
          u.state === 'missing' &&
          u.locator.kind === 'docx' &&
          u.locator.paragraph === 1 &&
          u.locator.component?.kind === 'image',
      ),
    ).toBe(true);
  });

  it('attachment XLSX empty numeric formula cache is missing and shared formula retains base source', async () => {
    const bytes = makeOffice('xlsx', {
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A2">B1+1</f><v>2</v></c></row><row r="2"><c r="A2"><f t="shared" si="0"/><v/></c></row></sheetData></worksheet>`,
    });
    const r = await extractXlsx(bytes, extractContextFixture('application/xlsx'));
    expect(r.status).toBe('partial');
    expect(
      r.units.some(
        (u) =>
          u.state === 'missing' &&
          u.locator.kind === 'sheet' &&
          u.locator.range === 'A2' &&
          u.locator.component?.kind === 'calculated-value',
      ),
    ).toBe(true);
    const output = text(r);
    expect(output).toMatch(/sharedFormulaSource/);
    expect(output).toMatch(/B1\+1/);
  });

  it('attachment unknown DOCX header namespace cannot silently disappear', async () => {
    const r = await extractDocx(
      makeOffice('docx', { 'word/header1.xml': '<hdr xmlns="urn:unknown"><p>must not vanish</p></hdr>' }),
      extractContextFixture('application/docx'),
    );
    expect(r.status).not.toBe('complete');
    expect(r.files.length).toBe(0);
  });

  it('attachment workbook external relationship cannot silently disappear', async () => {
    const r = await extractXlsx(
      makeOffice('xlsx', {
        'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="s1" Type="${officeRelNs}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="s2" Type="${officeRelNs}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="external" Type="${officeRelNs}/externalLink" Target="https://invalid.example/sentinel" TargetMode="External"/></Relationships>`,
      }),
      extractContextFixture('application/xlsx'),
    );
    expect(r.status).toBe('unsupported');
    expect(r.files.length).toBe(0);
  });
});

describe('ảnh nhúng OOXML ở Mac (thay bước vẽ lại bằng canvas của v2)', () => {
  const docxWithImage = (body: Uint8Array, target = 'media/a.bin') =>
    makeOffice('docx', {
      'word/document.xml': `<w:document xmlns:w="${wordNs}" xmlns:a="${drawingNs}" xmlns:r="${officeRelNs}"><w:body><w:p><w:r><w:drawing><a:blip r:embed="i1"/></w:drawing></w:r></w:p></w:body></w:document>`,
      'word/_rels/document.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="i1" Type="${officeRelNs}/image" Target="${target}"/></Relationships>`,
      [`word/${target}`]: body,
    });

  it('PNG nhúng được giữ nguyên byte thành file ảnh media/<n>.png', async () => {
    const png = makePng(2, 2);
    const r = await extractDocx(docxWithImage(png), extractContextFixture());
    expect(r.status).toBe('complete');
    const image = r.files.find((f) => f.kind === 'image');
    expect(image?.relativeName).toMatch(/^media\/\d+\.png$/);
    expect(Buffer.from(image?.bytes ?? []).equals(png)).toBe(true);
  });

  it('JPEG nhúng ghi đuôi .jpg theo chữ ký byte, không theo tên trong gói', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const r = await extractDocx(docxWithImage(jpeg, 'media/a.png'), extractContextFixture());
    expect(r.files.find((f) => f.kind === 'image')?.relativeName).toMatch(/\.jpg$/);
  });

  it('ảnh nhúng kiểu khác (EMF) bị bỏ qua → partial, thiếu một ảnh', async () => {
    const emf = Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.alloc(60)]);
    const r = await extractDocx(docxWithImage(emf, 'media/a.emf'), extractContextFixture());
    expect(r.status).toBe('partial');
    expect(r.files.some((f) => f.kind === 'image')).toBe(false);
    expect(r.units.some((u) => u.state === 'missing' && u.needs === 'vision')).toBe(true);
  });
});

describe('đầu ra .md của DOCX/XLSX cho agent', () => {
  const md = (o: Awaited<ReturnType<typeof extractOutputs>>) =>
    Buffer.from(o.outputs.find((f) => f.kind === 'text')?.bytes ?? []).toString();

  it('DOCX: tiêu đề tên file, mỗi đoạn có [đoạn N], ô bảng có [bảng T, hàng R, ô C], phần đầu trang tách mục', async () => {
    const xml = `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:t>Mở đầu</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Giá</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>771 304</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/><w:p><w:r><w:t>Kết</w:t></w:r></w:p></w:body></w:document>`;
    const o = await extractOutputs(
      'docx',
      makeOffice('docx', {
        'word/document.xml': xml,
        'word/header1.xml': `<w:hdr xmlns:w="${wordNs}"><w:p><w:r><w:t>Đầu trang</w:t></w:r></w:p></w:hdr>`,
      }),
      'bao-gia.docx',
    );
    expect(o.status).toBe('complete');
    expect(o.outputs.map((f) => f.path)).toEqual(['bao-gia.md']);
    expect(md(o)).toBe(
      [
        '# bao-gia.docx',
        '',
        '[đoạn 1] Mở đầu',
        '[bảng 1, hàng 1, ô 1] Giá',
        '[bảng 1, hàng 1, ô 2] 771 304',
        '[đoạn 5] Kết',
        '',
        '## Phần word/header1.xml',
        '',
        '[đoạn 1] Đầu trang',
        '',
      ].join('\n'),
    );
  });

  it('DOCX: ảnh nhúng PNG thành output ảnh media/, .md trỏ đường dẫn tương đối', async () => {
    const o = await extractOutputs(
      'docx',
      makeOffice('docx', {
        'word/document.xml': `<w:document xmlns:w="${wordNs}" xmlns:a="${drawingNs}" xmlns:r="${officeRelNs}"><w:body><w:p><w:r><w:t>Hình</w:t><w:drawing><a:blip r:embed="i1"/></w:drawing></w:r></w:p></w:body></w:document>`,
        'word/_rels/document.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="i1" Type="${officeRelNs}/image" Target="media/a.png"/></Relationships>`,
        'word/media/a.png': makePng(1, 1),
      }),
      'hinh.docx',
    );
    expect(o.status).toBe('complete');
    const image = o.outputs.find((f) => f.kind === 'image');
    expect(image?.path).toMatch(/^media\/\d+\.png$/);
    expect(md(o)).toContain(`[đoạn 1, ảnh 1] ${image?.path}`);
  });

  it('DOCX: hình không đọc được → partial, ghi chú số ảnh nhúng bỏ qua', async () => {
    const o = await extractOutputs(
      'docx',
      makeOffice('docx', {
        'word/document.xml': `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:t>A</w:t><w:drawing/></w:r></w:p></w:body></w:document>`,
      }),
      'a.docx',
    );
    expect(o.status).toBe('partial');
    expect(o.notes).toEqual([{ code: 'anh_nhung_bo_qua', count: 1 }]);
    expect(md(o)).toContain('[đoạn 1, hình 1] (hình không đọc được)');
  });

  it('XLSX: mục theo sheet, sheet ẩn ghi (ẩn), ô [sheet!ô], công thức "=… → giá trị" → partial vì sheet ẩn', async () => {
    const o = await extractOutputs('xlsx', makeOffice('xlsx'), 'data.xlsx');
    expect(o.status).toBe('partial');
    expect(o.notes).toEqual([{ code: 'sheet_an', name: 'Ẩn' }]);
    expect(md(o)).toBe(
      [
        '# data.xlsx',
        '',
        '## Sheet "Hiện"',
        '',
        '[Hiện!A1] Việt Nam',
        '[Hiện!B1] =1+1 → 2',
        '',
        '## Sheet "Ẩn" (ẩn)',
        '',
        '[Ẩn!A1] 7',
        '',
      ].join('\n'),
    );
  });

  it('XLSX: chuỗi dùng chung, bool, công thức chung và ô thiếu giá trị công thức', async () => {
    const o = await extractOutputs(
      'xlsx',
      makeOffice('xlsx', {
        'xl/workbook.xml': `<workbook xmlns="${sheetNs}" xmlns:r="${officeRelNs}"><sheets><sheet name="S" sheetId="1" r:id="s1"/></sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="s1" Type="${officeRelNs}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
        'xl/sharedStrings.xml': `<sst xmlns="${sheetNs}"><si><t>Tổng</t></si></sst>`,
        'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="b"><v>1</v></c><c r="C1"><f t="shared" si="0" ref="C1:C2">A2+1</f><v>2</v></c></row><row r="2"><c r="C2"><f t="shared" si="0"/><v>3</v></c><c r="D2"><f>X1*2</f></c></row></sheetData></worksheet>`,
      }),
      's.xlsx',
    );
    expect(o.status).toBe('partial');
    expect(o.notes).toEqual([{ code: 'thieu_formula_cache', count: 1 }]);
    const out = md(o);
    expect(out).toContain('[S!A1] Tổng');
    expect(out).toContain('[S!B1] TRUE');
    expect(out).toContain('[S!C1] =A2+1 → 2');
    expect(out).toContain('[S!C2] =(công thức chung từ C1: A2+1) → 3');
    expect(out).toContain('[S!D2] =X1*2 → (chưa có giá trị tính sẵn)');
  });

  it('XLSX có macro/DTD → blocked; workbook có liên kết ngoài → unsupported; không có đầu ra', async () => {
    const macro = await extractOutputs(
      'xlsx',
      makeOffice('xlsx', { 'xl/vbaProject.bin': 'inert' }),
      'm.xlsx',
    );
    expect(macro.status).toBe('blocked');
    expect(macro.outputs).toEqual([]);
    const pivot = await extractOutputs(
      'xlsx',
      makeOffice('xlsx', { 'xl/pivotTables/p.xml': '<p/>' }),
      'p.xlsx',
    );
    expect(pivot.status).toBe('unsupported');
    expect(pivot.problemCodes).toEqual(['UNSUPPORTED_TYPE']);
  });

  it('zip bomb (tỉ lệ nén > 100) → failed với LIMIT_EXCEEDED, không có thông điệp lỗi', async () => {
    const raw = Buffer.alloc(5 * 1024 * 1024, 65);
    const packed = deflateRawSync(raw);
    const b = makeZip([{ name: 'word/document.xml', body: packed, method: 8, declaredSize: raw.length }]);
    const central = b.indexOf(Buffer.from('504b0102', 'hex'));
    b.writeUInt32LE(crc32(raw), 14);
    b.writeUInt32LE(crc32(raw), central + 16);
    const o = await extractOutputs('docx', b, 'bomb.docx');
    expect(o.status).toBe('failed');
    expect(o.problemCodes).toEqual(['LIMIT_EXCEEDED']);
    expect(o.outputs).toEqual([]);
  });

  it('XML sâu 1000 tầng → failed (LIMIT_EXCEEDED), không treo', async () => {
    const deep = `<w:document xmlns:w="${wordNs}">${'<w:x>'.repeat(1000)}${'</w:x>'.repeat(1000)}</w:document>`;
    const o = await extractOutputs('docx', makeOffice('docx', { 'word/document.xml': deep }), 'deep.docx');
    expect(o.status).toBe('failed');
    expect(o.problemCodes).toEqual(['LIMIT_EXCEEDED']);
  });
});
