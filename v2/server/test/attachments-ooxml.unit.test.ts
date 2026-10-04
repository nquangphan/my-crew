import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractDocx, extractXlsx, parseXml, readOfficeParts } from '../src/attachments/extract/index.ts';
import {
  extractContextFixture,
  makeOffice,
  makeZip,
  sheetNs,
  wordNs,
} from './fixtures/attachments/make-fixtures.ts';

test('attachment Vietnamese DOCX preserves actual part paragraph locator', async () => {
  const r = await extractDocx(makeOffice('docx'), extractContextFixture('application/docx'));
  assert.equal(r.status, 'complete');
  assert.match(Buffer.from(r.files[0]?.bytes ?? []).toString(), /Xin chào Việt Nam/);
  assert.deepEqual(r.units[0]?.locator, {
    kind: 'docx',
    part: 'word/document.xml',
    paragraph: 1,
    table: null,
    row: null,
    cell: null,
  });
});
test('attachment XLSX includes veryHidden sheet and literal cached formula', async () => {
  const r = await extractXlsx(makeOffice('xlsx'), extractContextFixture('application/xlsx'));
  assert.equal(r.status, 'complete');
  assert.ok(r.units.some((u) => u.locator.kind === 'sheet' && u.locator.hidden && u.locator.sheet === 'Ẩn'));
  assert.match(Buffer.concat(r.files.map((f) => Buffer.from(f.bytes))).toString(), /1\+1/);
});
test('attachment XLSX absent formula cache is missing coverage', async () => {
  const r = await extractXlsx(
    makeOffice('xlsx', {
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1"><f>1+1</f></c></row></sheetData></worksheet>`,
    }),
    extractContextFixture('application/xlsx'),
  );
  assert.equal(r.status, 'partial');
  assert.ok(r.problems.some((p) => p.code === 'FORMULA_CACHE_MISSING'));
});
test('attachment XML rejects DTD and namespace alias is recognized', () => {
  assert.throws(() =>
    parseXml(
      Buffer.from('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///sentinel">]><a>&x;</a>'),
      () => {},
      extractContextFixture('text/xml').config,
    ),
  );
  const events: string[] = [];
  parseXml(
    Buffer.from(`<z:p xmlns:z="${wordNs}">ok</z:p>`),
    (e) => events.push(`${e.uri}:${e.local}`),
    extractContextFixture('text/xml').config,
  );
  assert.ok(events.includes(`${wordNs}:p`));
});
for (const names of [['a', 'A'], ['é', 'e\u0301'], ['a/b', 'a\\b'], ['../a'], ['/a']])
  test(`attachment ZIP rejects paths ${JSON.stringify(names)}`, async () =>
    assert.rejects(
      readOfficeParts(
        makeZip(names.map((name) => ({ name, body: 'x' }))),
        extractContextFixture('application/zip'),
      ),
    ));
for (const [label, entry] of [
  ['encryption', { name: 'a', body: 'x', flags: 1 }],
  ['symlink', { name: 'a', body: 'x', attrs: 0xa1ff0000 }],
  ['size mismatch', { name: 'a', body: 'actual', declaredSize: 1 }],
  ['unknown compression', { name: 'a', body: 'x', method: 99 }],
] as const)
  test(`attachment ZIP rejects ${label}`, async () =>
    assert.rejects(readOfficeParts(makeZip([entry]), extractContextFixture('application/zip'))));
test('attachment ZIP rejects CRC and invalid offsets', async () => {
  for (const offset of [14, 42]) {
    const b = makeZip([{ name: 'a', body: 'x' }]);
    if (offset === 14) b[14] ^= 1;
    else b.writeUInt32LE(0xfffffff0, b.indexOf(Buffer.from('504b0102', 'hex')) + 42);
    await assert.rejects(readOfficeParts(b, extractContextFixture('application/zip')));
  }
});
test('attachment ZIP 2001 entries refused', async () =>
  assert.rejects(
    readOfficeParts(
      makeZip(Array.from({ length: 2001 }, (_, i) => ({ name: `x${i}`, body: '' }))),
      extractContextFixture('application/zip'),
    ),
  ));
for (const name of ['word/vbaProject.bin', 'word/embeddings/oleObject1.bin'])
  test(`attachment office active content ${name} is blocked`, async () =>
    assert.equal(
      (await extractDocx(makeOffice('docx', { [name]: 'inert' }), extractContextFixture('application/docx')))
        .status,
      'blocked',
    ));
test('attachment DOCX image has real paragraph component and no fabricated cell', async () => {
  const { makePng, officeRelNs, relNs } = await import('./fixtures/attachments/make-fixtures.ts');
  const r = await extractDocx(
    makeOffice('docx', {
      'word/document.xml': `<w:document xmlns:w="${wordNs}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${officeRelNs}"><w:body><w:p><w:r><w:t>Picture</w:t><w:drawing><a:blip r:embed="i1"/></w:drawing></w:r></w:p></w:body></w:document>`,
      'word/_rels/document.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="i1" Type="${officeRelNs}/image" Target="media/a.png"/></Relationships>`,
      'word/media/a.png': makePng(1, 1),
    }),
    extractContextFixture('application/docx'),
  );
  assert.equal(r.status, 'complete');
  const image = r.units.find((u) => u.needs === 'vision');
  assert.deepEqual(image?.locator, {
    kind: 'docx',
    part: 'word/document.xml',
    paragraph: 1,
    table: null,
    row: null,
    cell: null,
    component: { kind: 'image', index: 1 },
  });
});
test('attachment ZIP expansion bounds count actual streamed bytes', async () => {
  const { deflateRawSync, crc32 } = await import('node:zlib');
  const raw = Buffer.alloc(100 * 1024 * 1024, 65);
  const packed = deflateRawSync(raw);
  const b = makeZip([{ name: 'large.xml', body: packed, method: 8, declaredSize: 1024 * 1024 }]);
  const central = b.indexOf(Buffer.from('504b0102', 'hex'));
  b.writeUInt32LE(crc32(raw), 14);
  b.writeUInt32LE(crc32(raw), central + 16);
  await assert.rejects(readOfficeParts(b, extractContextFixture('application/zip')));
});
test('attachment ZIP overlapping local records and ZIP64 unsafe sizes are rejected', async () => {
  const b = makeZip([
    { name: 'a', body: 'x' },
    { name: 'b', body: 'y' },
  ]);
  const first = b.indexOf(Buffer.from('504b0102', 'hex'));
  const second = first + 47;
  b.writeUInt32LE(0, second + 42);
  await assert.rejects(readOfficeParts(b, extractContextFixture('application/zip')));
  const zip64 = makeZip([{ name: 'a', body: 'x' }]);
  zip64.writeUInt32LE(0xffffffff, zip64.indexOf(Buffer.from('504b0102', 'hex')) + 24);
  await assert.rejects(readOfficeParts(zip64, extractContextFixture('application/zip')));
});
test('attachment XML depth cap and undefined entity do not return useful text', () => {
  const c = extractContextFixture('text/xml');
  c.config.limits.maxXmlDepth = 2;
  assert.throws(() => parseXml(Buffer.from('<a><b><c/></b></a>'), () => {}, c.config));
  assert.throws(() => parseXml(Buffer.from('<a>&unknown;</a>'), () => {}, c.config));
});
test('attachment DOCX unanchored body altChunk is unsupported without fabricated paragraph', async () => {
  const { officeRelNs, relNs } = await import('./fixtures/attachments/make-fixtures.ts');
  const r = await extractDocx(
    makeOffice('docx', {
      'word/document.xml': `<w:document xmlns:w="${wordNs}" xmlns:r="${officeRelNs}"><w:body><w:altChunk r:id="x"/></w:body></w:document>`,
      'word/_rels/document.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="x" Type="${officeRelNs}/aFChunk" Target="https://invalid.example/sentinel" TargetMode="External"/></Relationships>`,
    }),
    extractContextFixture('application/docx'),
  );
  assert.equal(r.status, 'unsupported');
  assert.equal(r.units.length, 0);
  assert.equal(r.files.length, 0);
});
test('attachment renamed DOCM content type is blocked before paragraphs', async () => {
  const r = await extractDocx(
    makeOffice('docx', {
      '[Content_Types].xml':
        '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
    }),
    extractContextFixture('application/docx'),
  );
  assert.equal(r.status, 'blocked');
  assert.equal(r.files.length, 0);
});
test('attachment component locators retain old shape compatibility and reject malformed optional metadata', async () => {
  const { verifyExtraction } = await import('../src/attachments/extract/index.ts');
  const { validateWorkerResult } = await import('../src/attachments/worker-protocol.ts');
  const c = extractContextFixture('application/docx');
  const input = {
    version: 1 as const,
    jobId: '22222222-2222-4222-8222-222222222222',
    generation: '1',
    original: c.original,
    mime: c.mime,
    inputName: 'original' as const,
    extractorVersion: 'fixture',
    config: c.config,
  };
  const result = verifyExtraction(input, await extractDocx(makeOffice('docx'), c));
  assert.equal(validateWorkerResult(input, result).status, 'complete');
  for (const component of [
    { kind: 'image', index: 0 },
    { kind: 'image', index: 1.5 },
    { kind: 'image', index: 100001 },
    { kind: 'unknown', index: 1 },
    { kind: 'image', index: 1, extra: true },
  ]) {
    const copy = structuredClone(result);
    Object.assign(copy.units[0]?.locator, { component });
    assert.throws(() => validateWorkerResult(input, copy));
  }
});
test('attachment DOCX unsupported drawing is explicit missing visual', async () => {
  const r = await extractDocx(
    makeOffice('docx', {
      'word/document.xml': `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>`,
    }),
    extractContextFixture('application/docx'),
  );
  assert.equal(r.status, 'partial');
  assert.ok(r.units.some((u) => u.state === 'missing' && u.needs === 'vision'));
});
test('attachment pre-anchor XML limit fails without fabricated geometry', async () => {
  const c = extractContextFixture('application/docx');
  c.config.limits.maxXmlDepth = 1;
  const r = await extractDocx(makeOffice('docx'), c);
  assert.equal(r.status, 'failed');
  assert.equal(r.units.length, 0);
  assert.ok(r.problems.some((p) => p.code === 'LIMIT_EXCEEDED'));
});
test('attachment workbook-level unsupported pivot has no invented sheet locator', async () => {
  const r = await extractXlsx(
    makeOffice('xlsx', { 'xl/pivotTables/pivot1.xml': '<pivot/>' }),
    extractContextFixture('application/xlsx'),
  );
  assert.equal(r.status, 'unsupported');
  assert.equal(r.units.length, 0);
  assert.equal(r.files.length, 0);
});
test('attachment XLSX drawing image uses its C4 anchor instead of invented A1', async () => {
  const { makePng, officeRelNs, relNs } = await import('./fixtures/attachments/make-fixtures.ts');
  const r = await extractXlsx(
    makeOffice('xlsx', {
      'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="d1" Type="${officeRelNs}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      'xl/drawings/drawing1.xml': `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${officeRelNs}"><xdr:oneCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:row>3</xdr:row></xdr:from><xdr:pic><a:blip r:embed="i1"/></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>`,
      'xl/drawings/_rels/drawing1.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="i1" Type="${officeRelNs}/image" Target="../media/a.png"/></Relationships>`,
      'xl/media/a.png': makePng(1, 1),
    }),
    extractContextFixture('application/xlsx'),
  );
  assert.equal(r.status, 'complete');
  assert.ok(
    r.units.some(
      (u) =>
        u.needs === 'vision' &&
        u.locator.kind === 'sheet' &&
        u.locator.range === 'C4:C4' &&
        u.locator.component?.kind === 'image',
    ),
  );
});
test('attachment workbook coordinate limit retains real excluded cell and shared formula source', async () => {
  const c = extractContextFixture('application/xlsx');
  c.config.limits.maxCsvRows = 1;
  const r = await extractXlsx(
    makeOffice('xlsx', {
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A2">B1+1</f><v>2</v></c></row><row r="2"><c r="A2"><f t="shared" si="0"/><v>3</v></c></row></sheetData></worksheet>`,
    }),
    c,
  );
  assert.equal(r.status, 'partial');
  assert.ok(
    r.units.some((u) => u.state === 'missing' && u.locator.kind === 'sheet' && u.locator.range === 'A2'),
  );
});
test('attachment wrong Office structural namespace cannot certify empty complete', async () => {
  const r = await extractDocx(
    makeOffice('docx', {
      'word/document.xml': '<document xmlns="urn:unknown"><body><p>lost</p></body></document>',
    }),
    extractContextFixture('application/docx'),
  );
  assert.notEqual(r.status, 'complete');
  assert.equal(r.files.length, 0);
});
test('attachment DOCX nested tables restore actual outer cell and ordered header content', async () => {
  const xml = `<w:document xmlns:w="${wordNs}"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>outer-before</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:ins><w:t>outer-after</w:t></w:ins></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
  const r = await extractDocx(
    makeOffice('docx', {
      'word/document.xml': xml,
      'word/header1.xml': `<w:hdr xmlns:w="${wordNs}"><w:p><w:r><w:t>header</w:t></w:r></w:p></w:hdr>`,
    }),
    extractContextFixture('application/docx'),
  );
  assert.equal(r.status, 'complete');
  const last = r.units.find(
    (u) => u.locator.kind === 'docx' && u.locator.part === 'word/document.xml' && u.locator.paragraph === 3,
  );
  assert.deepEqual(last?.locator, {
    kind: 'docx',
    part: 'word/document.xml',
    paragraph: 3,
    table: 1,
    row: 1,
    cell: 1,
  });
  assert.ok(
    Buffer.concat(r.files.map((f) => Buffer.from(f.bytes)))
      .toString()
      .includes('[inserted]outer-after'),
  );
  assert.ok(r.units.some((u) => u.locator.kind === 'docx' && u.locator.part === 'word/header1.xml'));
});
test('attachment DOCX external image with actual paragraph anchor is partial without fetch', async () => {
  const { officeRelNs, relNs } = await import('./fixtures/attachments/make-fixtures.ts');
  const r = await extractDocx(
    makeOffice('docx', {
      'word/document.xml': `<w:document xmlns:w="${wordNs}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${officeRelNs}"><w:body><w:p><w:r><w:drawing><a:blip r:link="x"/></w:drawing></w:r></w:p></w:body></w:document>`,
      'word/_rels/document.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="x" Type="${officeRelNs}/image" Target="https://invalid.example/sentinel" TargetMode="External"/></Relationships>`,
    }),
    extractContextFixture('application/docx'),
  );
  assert.equal(r.status, 'partial');
  assert.ok(
    r.units.some(
      (u) =>
        u.state === 'missing' &&
        u.locator.kind === 'docx' &&
        u.locator.paragraph === 1 &&
        u.locator.component?.kind === 'image',
    ),
  );
});
test('attachment XLSX empty numeric formula cache is missing and shared formula retains base source', async () => {
  const bytes = makeOffice('xlsx', {
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A2">B1+1</f><v>2</v></c></row><row r="2"><c r="A2"><f t="shared" si="0"/><v/></c></row></sheetData></worksheet>`,
  });
  const r = await extractXlsx(bytes, extractContextFixture('application/xlsx'));
  assert.equal(r.status, 'partial');
  assert.ok(
    r.units.some(
      (u) =>
        u.state === 'missing' &&
        u.locator.kind === 'sheet' &&
        u.locator.range === 'A2' &&
        u.locator.component?.kind === 'calculated-value',
    ),
  );
  const output = Buffer.concat(r.files.map((f) => Buffer.from(f.bytes))).toString();
  assert.match(output, /sharedFormulaSource/);
  assert.match(output, /B1\+1/);
});
test('attachment unknown DOCX header namespace cannot silently disappear', async () => {
  const r = await extractDocx(
    makeOffice('docx', { 'word/header1.xml': '<hdr xmlns="urn:unknown"><p>must not vanish</p></hdr>' }),
    extractContextFixture('application/docx'),
  );
  assert.notEqual(r.status, 'complete');
  assert.equal(r.files.length, 0);
});
test('attachment workbook external relationship cannot silently disappear', async () => {
  const { officeRelNs, relNs } = await import('./fixtures/attachments/make-fixtures.ts');
  const r = await extractXlsx(
    makeOffice('xlsx', {
      'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relNs}"><Relationship Id="s1" Type="${officeRelNs}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="s2" Type="${officeRelNs}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="external" Type="${officeRelNs}/externalLink" Target="https://invalid.example/sentinel" TargetMode="External"/></Relationships>`,
    }),
    extractContextFixture('application/xlsx'),
  );
  assert.equal(r.status, 'unsupported');
  assert.equal(r.files.length, 0);
});
