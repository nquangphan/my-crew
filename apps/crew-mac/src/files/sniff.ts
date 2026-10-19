// Port từ v2/server/src/attachments/extract/formats.ts (a13dd7d).
// Giữ nguyên thuật toán OLE/ZIP của `detectFormat`; bổ sung chữ ký ảnh, HEIC, file thực thi, media, archive,
// tách OLE không mã hóa (Office cũ), PPTX, zip thường và SVG.
import { inflateRawSync } from 'node:zlib';
import type { BlockLabel, DetectedKind } from './types.js';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);
const MPEG_SECOND_BYTES = new Set([0xfb, 0xfa, 0xf3, 0xf2, 0xe3, 0xe2, 0xf1, 0xf9]);
const MACHO_MAGICS = ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'];

function hexAt(b: Buffer, start: number, length: number): string {
  return b.subarray(start, start + length).toString('hex');
}
function asciiAt(b: Buffer, start: number, length: number): string {
  return b.subarray(start, start + length).toString('latin1');
}

/** Đuôi file viết thường, không dấu chấm; không có thì chuỗi rỗng. */
export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function isExecutable(b: Buffer): boolean {
  if (asciiAt(b, 0, 2) === 'MZ') return true;
  if (hexAt(b, 0, 4) === '7f454c46') return true;
  return MACHO_MAGICS.includes(hexAt(b, 0, 4));
}

function imageKind(b: Buffer): DetectedKind | null {
  if (hexAt(b, 0, 8) === '89504e470d0a1a0a') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  const six = asciiAt(b, 0, 6);
  if (six === 'GIF87a' || six === 'GIF89a') return 'gif';
  if (asciiAt(b, 0, 4) === 'RIFF' && asciiAt(b, 8, 4) === 'WEBP') return 'webp';
  return null;
}

/** ISO-BMFF (`ftyp` ở byte 4–7): HEIC/HEIF theo major brand, còn lại (MP4, MOV, M4A…) là media. */
function isoKind(b: Buffer): DetectedKind | null {
  if (asciiAt(b, 4, 4) !== 'ftyp') return null;
  return HEIC_BRANDS.has(asciiAt(b, 8, 4)) ? 'heic' : 'media';
}

function isMedia(b: Buffer): boolean {
  const four = asciiAt(b, 0, 4);
  if (asciiAt(b, 0, 3) === 'ID3') return true;
  if (four === 'OggS' || four === 'fLaC') return true;
  if (four === 'RIFF' && ['WAVE', 'AVI '].includes(asciiAt(b, 8, 4))) return true;
  if (four === 'FORM' && ['AIFF', 'AIFC'].includes(asciiAt(b, 8, 4))) return true;
  if (hexAt(b, 0, 4) === '1a45dfa3') return true; // Matroska / WebM
  // Khung MP3 và ADTS (AAC) thường gặp. Không dùng mặt nạ 11 bit vì FF FE là BOM của text UTF-16.
  return b[0] === 0xff && b[1] !== undefined && MPEG_SECOND_BYTES.has(b[1]);
}

function isArchive(b: Buffer): boolean {
  if (hexAt(b, 0, 2) === '1f8b') return true; // gzip
  if (hexAt(b, 0, 6) === '377abcaf271c') return true; // 7z
  if (asciiAt(b, 0, 4) === 'Rar!') return true;
  if (asciiAt(b, 0, 3) === 'BZh') return true;
  if (hexAt(b, 0, 6) === 'fd377a585a00') return true; // xz
  if (asciiAt(b, 257, 5) === 'ustar') return true; // tar
  return hexAt(b, 0, 4) === '504b0506' || hexAt(b, 0, 4) === '504b0708'; // zip rỗng / zip chia phần
}

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

/** Zip: OOXML (docx/xlsx/pptx), OOXML có macro, hoặc zip thường. Không đọc được cấu trúc thì coi là zip. */
function zipKind(b: Buffer): DetectedKind {
  try {
    const end = b.lastIndexOf(Buffer.from('504b0506', 'hex'));
    if (end < 0 || end + 22 > b.length) return 'zip';
    const count = b.readUInt16LE(end + 10);
    if (count > 2000) return 'zip';
    let p = b.readUInt32LE(end + 16);
    const parts = new Map<string, string>();
    let presentation = false;
    for (let i = 0; i < count; i++) {
      if (b.readUInt32LE(p) !== 0x02014b50) return 'zip';
      const size = b.readUInt32LE(p + 20),
        n = b.readUInt16LE(p + 28),
        x = b.readUInt16LE(p + 30),
        comment = b.readUInt16LE(p + 32),
        offset = b.readUInt32LE(p + 42);
      const name = b.subarray(p + 46, p + 46 + n).toString();
      if (/vbaProject|\.bin$|macroEnabled/i.test(name)) return 'macro-office';
      if (name === 'ppt/presentation.xml') presentation = true;
      if (name === '[Content_Types].xml' || name === '_rels/.rels') {
        if (size > 1048576) return 'zip';
        const start = offset + 30 + b.readUInt16LE(offset + 26) + b.readUInt16LE(offset + 28);
        const compressed = b.subarray(start, start + size);
        const method = b.readUInt16LE(p + 10);
        const body =
          method === 0
            ? compressed
            : method === 8
              ? inflateRawSync(compressed, { maxOutputLength: 1048576 })
              : null;
        if (!body) return 'zip';
        parts.set(name, body.toString());
      }
      p += 46 + n + x + comment;
    }
    const ct = parts.get('[Content_Types].xml') ?? '',
      rels = parts.get('_rels/.rels') ?? '';
    if (/macroEnabled|vbaProject/i.test(ct)) return 'macro-office';
    if (!rels.includes('/officeDocument')) return 'zip';
    if (ct.includes('wordprocessingml.document.main+xml') && rels.includes('word/document.xml'))
      return 'docx';
    if (ct.includes('spreadsheetml.sheet.main+xml') && rels.includes('xl/workbook.xml')) return 'xlsx';
    if (presentation || rels.includes('ppt/presentation.xml')) return 'pptx';
    return 'zip';
  } catch {
    return 'zip';
  }
}

/** Giải mã nghiêm như v2 `decodeText` (BOM UTF-8/UTF-16); lỗi thì trả null. */
function strictDecode(b: Buffer): string | null {
  let encoding: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8';
  let bom = 0;
  if (b[0] === 0xff && b[1] === 0xfe) {
    encoding = 'utf-16le';
    bom = 2;
  } else if (b[0] === 0xfe && b[1] === 0xff) {
    encoding = 'utf-16be';
    bom = 2;
  } else if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) bom = 3;
  try {
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(b.subarray(bom));
  } catch {
    return null;
  }
}

/** Byte điều khiển không bao giờ có trong text (trừ tab, xuống dòng, form feed, ESC). */
function hasBinaryControl(b: Buffer): boolean {
  for (const c of b) if (c < 0x20 && c !== 9 && c !== 10 && c !== 12 && c !== 13 && c !== 0x1b) return true;
  return false;
}

/**
 * Nhận diện kiểu theo byte; tên file và mime khai báo chỉ dùng để tách csv/text/svg.
 * Cần toàn bộ nội dung file (zip đọc thư mục trung tâm ở cuối file).
 */
export function detectKind(bytes: Uint8Array, filename: string, declaredType: string): DetectedKind {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (isExecutable(b)) return 'executable';
  const image = imageKind(b);
  if (image) return image;
  const iso = isoKind(b);
  if (iso) return iso;
  if (asciiAt(b, 0, 5) === '%PDF-') return 'pdf';
  if (hexAt(b, 0, 8) === 'd0cf11e0a1b11ae1') return encryptedOle(b) ? 'encrypted-office' : 'legacy-office';
  if (b.length >= 4 && b.readUInt32LE(0) === 0x04034b50) return zipKind(b);
  if (isArchive(b)) return 'zip';
  if (isMedia(b)) return 'media';

  const text = strictDecode(b);
  if (text === null) {
    // Không phải UTF-8/UTF-16 hợp lệ: không có byte NUL/điều khiển thì coi là text mã cũ (trình đọc báo khong_utf8).
    return hasBinaryControl(b) ? 'unknown' : 'text';
  }
  if (text.includes('\0')) return 'unknown';
  const ext = extensionOf(filename);
  if (ext === 'svg' && /<svg/i.test(text.slice(0, 1024))) return 'svg';
  return ext === 'csv' || declaredType.toLowerCase() === 'text/csv' ? 'csv' : 'text';
}

/** Nhãn kiểu cấm trong ngoặc của lý do; null với kiểu không bị chặn theo nhãn (kể cả Office mã hóa). */
export function blockLabel(kind: DetectedKind, filename: string): BlockLabel | null {
  switch (kind) {
    case 'zip':
      return 'zip';
    case 'executable':
      return 'exe';
    case 'macro-office': {
      const ext = extensionOf(filename);
      if (['xlsx', 'xlsm', 'xltm', 'xltx', 'xls'].includes(ext)) return 'xlsm';
      if (['pptx', 'pptm', 'ppt', 'potm', 'ppsm'].includes(ext)) return 'pptx';
      return 'docm';
    }
    case 'legacy-office':
      return 'office-cu';
    case 'pptx':
      return 'pptx';
    case 'media':
      return 'media';
    case 'unknown':
      return 'khac';
    default:
      return null;
  }
}
