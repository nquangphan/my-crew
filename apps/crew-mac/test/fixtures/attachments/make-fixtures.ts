// Port từ v2/server/test/fixtures/attachments/make-fixtures.ts (a13dd7d), bản tối thiểu cho nhận diện byte.
import { crc32, deflateSync } from 'node:zlib';

export const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const sheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const officeRelNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface ZipEntry {
  name: string;
  body: string | Uint8Array;
  flags?: number;
  attrs?: number;
  method?: number;
  declaredSize?: number;
}

/** Zip "store" (không nén) dựng tay; nhận mảng mục kiểu v2 hoặc bảng tên → nội dung. */
export function makeZip(input: ZipEntry[] | Record<string, string | Uint8Array>): Buffer {
  const entries = Array.isArray(input)
    ? input
    : Object.entries(input).map(([name, body]) => ({ name, body }) as ZipEntry);
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

const OFFICE_MAIN = {
  docx: { part: 'word/document.xml', type: 'wordprocessingml.document' },
  xlsx: { part: 'xl/workbook.xml', type: 'spreadsheetml.sheet' },
  pptx: { part: 'ppt/presentation.xml', type: 'presentationml.presentation' },
} as const;

export function makeOffice(
  kind: 'docx' | 'xlsx' | 'pptx',
  parts: Record<string, string | Uint8Array> = {},
): Buffer {
  const { part: main, type } = OFFICE_MAIN[kind];
  const defaults: Record<string, string | Uint8Array> = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${type}.main+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${relNs}"><Relationship Id="r1" Type="${officeRelNs}/officeDocument" Target="${main}"/></Relationships>`,
  };
  if (kind === 'docx')
    defaults[main] =
      `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:t>Xin chào Việt Nam</w:t></w:r></w:p></w:body></w:document>`;
  else if (kind === 'xlsx') {
    defaults[main] =
      `<workbook xmlns="${sheetNs}" xmlns:r="${officeRelNs}"><sheets><sheet name="Hiện" sheetId="1" r:id="s1"/><sheet name="Ẩn" sheetId="2" state="veryHidden" r:id="s2"/></sheets></workbook>`;
    defaults['xl/_rels/workbook.xml.rels'] =
      `<Relationships xmlns="${relNs}"><Relationship Id="s1" Type="${officeRelNs}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="s2" Type="${officeRelNs}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
    defaults['xl/worksheets/sheet1.xml'] =
      `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Việt Nam</t></is></c><c r="B1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>`;
    defaults['xl/worksheets/sheet2.xml'] =
      `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>`;
  } else defaults[main] = '<p:presentation xmlns:p="urn:p"/>';
  return makeZip({ ...defaults, ...parts });
}

export function makePng(width: number, height: number): Buffer {
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

/** Hộp `ftyp` ISO-BMFF với major brand cho trước (HEIC, MP4, MOV…). */
export function ftypHeader(brand: string): Buffer {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(24, 0);
  b.write('ftyp', 4, 'latin1');
  b.write(brand.padEnd(4, ' '), 8, 'latin1');
  b.write(brand.padEnd(4, ' '), 16, 'latin1');
  return b;
}

/**
 * Tệp OLE (Compound File) tối thiểu, một sector thư mục chứa các stream tên cho trước.
 * Có `EncryptionInfo` + `EncryptedPackage` thì là Office có mật khẩu (dạng v2 kiểm).
 */
export function makeOle(streams: readonly string[]): Buffer {
  const b = Buffer.alloc(1536);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(b);
  b.writeUInt16LE(0xfffe, 28);
  b.writeUInt16LE(9, 30);
  b.writeUInt32LE(1, 44);
  b.writeUInt32LE(1, 48);
  b.writeUInt32LE(0, 76);
  b.writeUInt32LE(0xfffffffd, 512);
  b.writeUInt32LE(0xfffffffe, 516);
  for (const [i, name] of streams.slice(0, 4).entries()) {
    const p = 1024 + i * 128;
    Buffer.from(`${name}\0`, 'utf16le').copy(b, p);
    b.writeUInt16LE((name.length + 1) * 2, p + 64);
    b[p + 66] = 2;
  }
  return b;
}
