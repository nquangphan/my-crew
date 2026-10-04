import { inflateRawSync } from 'node:zlib';
import { decodeText } from './text.ts';
export type Format =
  | 'png'
  | 'jpeg'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'text'
  | 'encrypted-office'
  | 'unsupported';
function encryptedOle(b: Buffer): boolean {
  try {
    if (b.length < 512 || b.readUInt16LE(28) !== 0xfffe) return false;
    const shift = b.readUInt16LE(30);
    if (shift !== 9 && shift !== 12) return false;
    const sector = 2 ** shift;
    const count = Math.floor(b.length / sector) - 1;
    const fatCount = b.readUInt32LE(44);
    if (fatCount < 1 || fatCount > 109 || fatCount > count) return false;
    const fat: number[] = [];
    for (let i = 0; i < fatCount; i++) {
      const id = b.readUInt32LE(76 + i * 4);
      if (id >= count) return false;
      for (let p = (id + 1) * sector; p < (id + 2) * sector; p += 4) fat.push(b.readUInt32LE(p));
    }
    let id = b.readUInt32LE(48);
    const visited = new Set<number>();
    const names = new Set<string>();
    while (id !== 0xfffffffe) {
      if (id >= count || visited.has(id) || visited.size >= count) return false;
      visited.add(id);
      for (let p = (id + 1) * sector; p < (id + 2) * sector; p += 128) {
        const length = b.readUInt16LE(p + 64);
        if (length >= 2 && length <= 64 && length % 2 === 0 && b[p + 66] === 2)
          names.add(b.subarray(p, p + length - 2).toString('utf16le'));
      }
      id = fat[id] ?? 0xffffffff;
    }
    return names.has('EncryptionInfo') && names.has('EncryptedPackage');
  } catch {
    return false;
  }
}
export function detectFormat(bytes: Uint8Array, fileName: string, declaredMime: string): Format {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpeg';
  if (b.subarray(0, 5).toString() === '%PDF-') return 'pdf';
  if (b.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')))
    return encryptedOle(b) ? 'encrypted-office' : 'unsupported';
  if (b.length >= 4 && b.readUInt32LE(0) === 0x04034b50) {
    try {
      const end = b.lastIndexOf(Buffer.from('504b0506', 'hex'));
      if (end < 0 || end + 22 > b.length) return 'unsupported';
      const count = b.readUInt16LE(end + 10);
      if (count > 2000) return 'unsupported';
      let p = b.readUInt32LE(end + 16);
      const parts = new Map<string, string>();
      for (let i = 0; i < count; i++) {
        if (b.readUInt32LE(p) !== 0x02014b50) return 'unsupported';
        const size = b.readUInt32LE(p + 20),
          n = b.readUInt16LE(p + 28),
          x = b.readUInt16LE(p + 30),
          comment = b.readUInt16LE(p + 32),
          offset = b.readUInt32LE(p + 42);
        const name = b.subarray(p + 46, p + 46 + n).toString();
        if (/vbaProject|\.bin$|macroEnabled/i.test(name)) return 'unsupported';
        if (name === '[Content_Types].xml' || name === '_rels/.rels') {
          if (size > 1048576) return 'unsupported';
          const start = offset + 30 + b.readUInt16LE(offset + 26) + b.readUInt16LE(offset + 28);
          const compressed = b.subarray(start, start + size);
          const method = b.readUInt16LE(p + 10);
          const body =
            method === 0
              ? compressed
              : method === 8
                ? inflateRawSync(compressed, { maxOutputLength: 1048576 })
                : null;
          if (!body) return 'unsupported';
          parts.set(name, body.toString());
        }
        p += 46 + n + x + comment;
      }
      const ct = parts.get('[Content_Types].xml') ?? '',
        rels = parts.get('_rels/.rels') ?? '';
      if (/macroEnabled|vbaProject/i.test(ct)) return 'unsupported';
      if (!rels.includes('/officeDocument')) return 'unsupported';
      if (ct.includes('wordprocessingml.document.main+xml') && rels.includes('word/document.xml'))
        return 'docx';
      if (ct.includes('spreadsheetml.sheet.main+xml') && rels.includes('xl/workbook.xml')) return 'xlsx';
      return 'unsupported';
    } catch {
      return 'unsupported';
    }
  }
  try {
    const { text } = decodeText(bytes);
    if (text.includes('\0')) return 'unsupported';
    return /\.csv$/i.test(fileName) || declaredMime === 'text/csv' ? 'csv' : 'text';
  } catch {
    return 'unsupported';
  }
}
