import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { loadAttachmentConfig } from '../../../src/attachments/config.ts';
import type { ExtractContext } from '../../../src/attachments/extract/index.ts';
export const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const sheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const officeRelNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export function makeZip(
  entries: {
    name: string;
    body: string | Uint8Array;
    flags?: number;
    attrs?: number;
    method?: number;
    declaredSize?: number;
  }[],
): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const body = Buffer.from(e.body);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.flags ?? 0x800, 6);
    lh.writeUInt16LE(e.method ?? 0, 8);
    lh.writeUInt32LE(crc32(body), 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(e.declaredSize ?? body.length, 22);
    lh.writeUInt16LE(name.length, 26);
    local.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50);
    ch.writeUInt16LE(0x314, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(e.flags ?? 0x800, 8);
    ch.writeUInt16LE(e.method ?? 0, 10);
    ch.writeUInt32LE(crc32(body), 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(e.declaredSize ?? body.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(e.attrs ?? 0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
export function makeOffice(
  kind: 'docx' | 'xlsx',
  parts: Record<string, string | Uint8Array> = {},
): Uint8Array {
  const main = kind === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
  const type = kind === 'docx' ? 'wordprocessingml.document' : 'spreadsheetml.sheet';
  const defaults: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${type}.main+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${relNs}"><Relationship Id="r1" Type="${officeRelNs}/officeDocument" Target="${main}"/></Relationships>`,
  };
  if (kind === 'docx')
    defaults[main] =
      `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:t>Xin chào Việt Nam</w:t></w:r></w:p></w:body></w:document>`;
  else {
    defaults[main] =
      `<workbook xmlns="${sheetNs}" xmlns:r="${officeRelNs}"><sheets><sheet name="Hiện" sheetId="1" r:id="s1"/><sheet name="Ẩn" sheetId="2" state="veryHidden" r:id="s2"/></sheets></workbook>`;
    defaults['xl/_rels/workbook.xml.rels'] =
      `<Relationships xmlns="${relNs}"><Relationship Id="s1" Type="${officeRelNs}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="s2" Type="${officeRelNs}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
    defaults['xl/worksheets/sheet1.xml'] =
      `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Việt Nam</t></is></c><c r="B1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>`;
    defaults['xl/worksheets/sheet2.xml'] =
      `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>`;
  }
  return makeZip(Object.entries({ ...defaults, ...parts }).map(([name, body]) => ({ name, body })));
}
export function makePng(width: number, height: number): Uint8Array {
  const chunk = (name: string, b: Buffer) => {
    const tag = Buffer.from(name);
    const h = Buffer.alloc(4);
    h.writeUInt32BE(b.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(Buffer.concat([tag, b])));
    return Buffer.concat([h, tag, b, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const data = width * height <= 1000000 ? Buffer.alloc((width * 3 + 1) * height, 0) : Buffer.alloc(0);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(data)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function makePdf(mode: 'text' | 'scan' | 'mixed' | 'encrypted' | 'corrupt'): Uint8Array {
  return mode === 'corrupt'
    ? Buffer.from('%PDF-1.7\nbroken')
    : readFileSync(new URL(`${mode}.pdf`, import.meta.url));
}
export function extractContextFixture(mime: string): ExtractContext {
  const c = loadAttachmentConfig({ CREW_V2_ATTACHMENT_STORAGE_ROOT: '/tmp/crew-v2-fixture' });
  return {
    original: {
      attachmentId: '11111111-1111-4111-8111-111111111111',
      sha256: 'a'.repeat(64),
      ownerId: 'owner',
    },
    mime,
    config: { policySha256: c.policySha256, limits: { ...c.limits } },
    signal: new AbortController().signal,
  };
}
export function corpusCases(): {
  name: string;
  mime: string;
  bytes: Uint8Array;
  status: 'complete' | 'partial' | 'encrypted' | 'corrupt' | 'blocked' | 'unsupported' | 'failed';
  text?: string;
}[] {
  const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const saved = (name: string) => readFileSync(new URL(name, import.meta.url));
  const zeroRatio = makeZip([{ name: 'a', body: 'x', declaredSize: 1 }]);
  zeroRatio.writeUInt32LE(0, 18);
  zeroRatio.writeUInt32LE(0, zeroRatio.indexOf(Buffer.from('504b0102', 'hex')) + 20);
  const invalidCrc = makeZip([{ name: 'a', body: 'x' }]);
  invalidCrc[14] ^= 1;
  return [
    { name: 'zip-zero-compressed', mime: docxMime, bytes: zeroRatio, status: 'failed' },
    { name: 'zip-invalid-crc', mime: docxMime, bytes: invalidCrc, status: 'corrupt' },
    {
      name: 'zip-2001-entries',
      mime: docxMime,
      bytes: makeZip(Array.from({ length: 2001 }, (_, i) => ({ name: `a${i}`, body: '' }))),
      status: 'failed',
    },
    {
      name: 'xml-depth-limit',
      mime: docxMime,
      bytes: makeOffice('docx', { 'word/document.xml': '<x>'.repeat(70) + '</x>'.repeat(70) }),
      status: 'failed',
    },
    {
      name: 'embedded-ole-docx',
      mime: docxMime,
      bytes: makeOffice('docx', { 'word/embeddings/inert.bin': 'inert' }),
      status: 'blocked',
    },
    {
      name: 'launch-escaped-pdf',
      mime: 'application/pdf',
      bytes: saved('launch-escaped.pdf'),
      status: 'blocked',
    },
    {
      name: 'launch-incremental-pdf',
      mime: 'application/pdf',
      bytes: saved('launch-incremental.pdf'),
      status: 'blocked',
    },
    {
      name: 'launch-compressed-pdf',
      mime: 'application/pdf',
      bytes: saved('launch-compressed.pdf'),
      status: 'blocked',
    },
    { name: 'launch-pdf', mime: 'application/pdf', bytes: saved('launch.pdf'), status: 'blocked' },
    { name: 'javascript-pdf', mime: 'application/pdf', bytes: saved('javascript.pdf'), status: 'blocked' },
    {
      name: 'executable-pdf',
      mime: 'application/pdf',
      bytes: saved('embedded-executable.pdf'),
      status: 'blocked',
    },
    { name: 'portfolio-pdf', mime: 'application/pdf', bytes: saved('portfolio.pdf'), status: 'partial' },
    { name: 'rotated-pdf', mime: 'application/pdf', bytes: saved('rotated.pdf'), status: 'complete' },
    { name: 'exif6-jpeg', mime: 'image/jpeg', bytes: saved('orientation-6.jpg'), status: 'complete' },
    { name: 'truncated-png', mime: 'image/png', bytes: makePng(3, 2).slice(0, 36), status: 'corrupt' },
    { name: 'huge-png', mime: 'image/png', bytes: makePng(100000, 100000), status: 'blocked' },
    { name: 'malformed-csv', mime: 'text/csv', bytes: Buffer.from('a,"unclosed'), status: 'corrupt' },
    {
      name: 'utf16le-text',
      mime: 'text/plain',
      bytes: Buffer.concat([Buffer.from([255, 254]), Buffer.from('Việt Nam\n', 'utf16le')]),
      status: 'complete',
      text: 'Việt Nam',
    },
    { name: 'binary-text', mime: 'text/plain', bytes: Buffer.from([0, 1, 2, 255]), status: 'unsupported' },
    {
      name: 'zip-traversal',
      mime: docxMime,
      bytes: makeZip([{ name: '../escape', body: 'inert' }]),
      status: 'corrupt',
    },
    {
      name: 'zip-case-collision',
      mime: docxMime,
      bytes: makeZip([
        { name: 'a', body: '1' },
        { name: 'A', body: '2' },
      ]),
      status: 'corrupt',
    },
    {
      name: 'zip-encrypted',
      mime: docxMime,
      bytes: makeZip([{ name: 'a', body: 'inert', flags: 1 }]),
      status: 'blocked',
    },
    {
      name: 'zip-symlink',
      mime: docxMime,
      bytes: makeZip([{ name: 'a', body: 'inert', attrs: 0xa1ff0000 }]),
      status: 'corrupt',
    },
    {
      name: 'xml-dtd',
      mime: docxMime,
      bytes: makeOffice('docx', {
        'word/document.xml': '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///sentinel">]><a>&x;</a>',
      }),
      status: 'blocked',
    },
    {
      name: 'docx-unsupported-drawing',
      mime: docxMime,
      bytes: makeOffice('docx', {
        'word/document.xml': `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:drawing/></w:p></w:body></w:document>`,
      }),
      status: 'partial',
    },
    {
      name: 'vietnamese-docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: makeOffice('docx'),
      status: 'complete',
      text: 'Xin chào Việt Nam',
    },
    {
      name: 'hidden-xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: makeOffice('xlsx'),
      status: 'complete',
      text: 'Việt Nam',
    },
    { name: 'scan-pdf', mime: 'application/pdf', bytes: makePdf('scan'), status: 'complete' },
    {
      name: 'text-pdf',
      mime: 'application/pdf',
      bytes: makePdf('text'),
      status: 'complete',
      text: 'Crew fixture text',
    },
    { name: 'mixed-pdf', mime: 'application/pdf', bytes: makePdf('mixed'), status: 'complete' },
    { name: 'encrypted-pdf', mime: 'application/pdf', bytes: makePdf('encrypted'), status: 'encrypted' },
    { name: 'corrupt-pdf', mime: 'application/pdf', bytes: makePdf('corrupt'), status: 'corrupt' },
    { name: 'png', mime: 'image/png', bytes: makePng(3, 2), status: 'complete' },
    {
      name: 'code',
      mime: 'text/plain',
      bytes: Buffer.from('const secret = "literal";\n// Việt Nam\n'),
      status: 'complete',
      text: 'const secret',
    },
    {
      name: 'quoted-csv',
      mime: 'text/csv',
      bytes: Buffer.from('name,value\r\n"a\nb","=1+1"\r\n'),
      status: 'complete',
      text: '=1+1',
    },
    {
      name: 'macro-docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: makeOffice('docx', { 'word/vbaProject.bin': 'inert' }),
      status: 'blocked',
    },
    {
      name: 'formula-missing-xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: makeOffice('xlsx', {
        'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1"><f>1+1</f></c></row></sheetData></worksheet>`,
      }),
      status: 'partial',
    },
  ];
}
