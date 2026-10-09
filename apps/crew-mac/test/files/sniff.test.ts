import { describe, expect, it } from 'vitest';
import { blockLabel, detectKind } from '../../src/files/sniff.js';
import type { DetectedKind } from '../../src/files/types.js';
import { ftypHeader, makeOffice, makeOle, makePng, makeZip } from '../fixtures/attachments/make-fixtures.js';

const MACHO = Buffer.concat([Buffer.from('cffaedfe', 'hex'), Buffer.alloc(64)]);
const png1x1 = makePng(1, 1);
const encryptedOleFixture = makeOle(['EncryptionInfo', 'EncryptedPackage']);
const plainOleFixture = makeOle(['WordDocument']);

describe('detectKind', () => {
  it.each<[string, Uint8Array, string, string, DetectedKind]>([
    ['png thật', png1x1, 'a.png', 'image/png', 'png'],
    ['png khai báo là text', png1x1, 'fake.txt', 'text/plain', 'png'],
    ['jpeg', Buffer.from('ffd8ffe000104a464946', 'hex'), 'a.jpg', 'image/jpeg', 'jpeg'],
    ['exe đổi đuôi png, mime khai báo png', MACHO, 'a.png', 'image/png', 'executable'],
    ['Mach-O 32 bit', Buffer.from('feedface00000000', 'hex'), 'a.png', 'image/png', 'executable'],
    ['Mach-O fat', Buffer.from('cafebabe00000002', 'hex'), 'a.gif', 'image/gif', 'executable'],
    ['MZ', Buffer.from('4d5a9000', 'hex'), 'a.jpg', 'image/jpeg', 'executable'],
    ['ELF', Buffer.from('7f454c46', 'hex'), 'x.txt', 'text/plain', 'executable'],
    ['heic ftyp', ftypHeader('heic'), 'IMG_1.HEIC', 'image/heic', 'heic'],
    ['heif mif1', ftypHeader('mif1'), 'a.heif', 'image/heif', 'heic'],
    ['webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'a.webp', '', 'webp'],
    ['gif', Buffer.from('GIF89a'), 'a.gif', '', 'gif'],
    ['gif87', Buffer.from('GIF87a'), 'a.gif', '', 'gif'],
    ['pdf', Buffer.from('%PDF-1.7\n'), 'x.bin', 'application/octet-stream', 'pdf'],
    ['docx', makeOffice('docx'), 'a.docx', '', 'docx'],
    ['docx đặt tên zip', makeOffice('docx'), 'x.zip', 'application/zip', 'docx'],
    ['xlsx', makeOffice('xlsx'), 'x.txt', 'text/plain', 'xlsx'],
    ['docm (vbaProject)', makeOffice('docx', { 'word/vbaProject.bin': 'x' }), 'a.docx', '', 'macro-office'],
    ['xlsm (vbaProject)', makeOffice('xlsx', { 'xl/vbaProject.bin': 'x' }), 'a.xlsx', '', 'macro-office'],
    [
      'content type macroEnabled',
      makeOffice('docx', {
        '[Content_Types].xml':
          '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
      }),
      'a.docx',
      '',
      'macro-office',
    ],
    ['zip thường', makeZip({ 'a.txt': 'x' }), 'tool.zip', 'application/zip', 'zip'],
    ['zip thường đặt tên docx', makeZip({ other: 'x' }), 'x.docx', '', 'zip'],
    [
      'zip 2001 mục',
      makeZip(Array.from({ length: 2001 }, (_, i) => ({ name: `a${i}`, body: '' }))),
      'a.docx',
      '',
      'zip',
    ],
    ['zip cụt (không có EOCD)', Buffer.from('504b030400000000', 'hex'), 'a.docx', '', 'zip'],
    ['pptx', makeOffice('pptx'), 'a.pptx', '', 'pptx'],
    ['OLE mã hóa', encryptedOleFixture, 'a.docx', '', 'encrypted-office'],
    ['OLE cũ (doc)', plainOleFixture, 'a.doc', '', 'legacy-office'],
    ['chỉ có magic OLE', Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'a.docx', '', 'legacy-office'],
    ['gzip', Buffer.from('1f8b0800', 'hex'), 'a.tar.gz', '', 'zip'],
    ['7z', Buffer.from('377abcaf271c', 'hex'), 'a.7z', '', 'zip'],
    ['rar', Buffer.from('526172211a0700', 'hex'), 'a.rar', '', 'zip'],
    ['csv', Buffer.from('a,b\n1,2\n'), 'a.csv', 'text/csv', 'csv'],
    ['csv theo mime', Buffer.from('a,b\n1,2\n'), 'a', 'text/csv', 'csv'],
    ['text', Buffer.from('xin chào\n'), 'a.md', 'text/markdown', 'text'],
    ['text rỗng', Buffer.alloc(0), 'a.txt', 'text/plain', 'text'],
    [
      'text UTF-16 có BOM',
      Buffer.concat([Buffer.from('fffe', 'hex'), Buffer.from('chào', 'utf16le')]),
      'a.txt',
      '',
      'text',
    ],
    ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'a.svg', 'image/svg+xml', 'svg'],
    ['svg có khai báo xml', Buffer.from('<?xml version="1.0"?>\n<SVG/>'), 'b.SVG', '', 'svg'],
    ['có <svg nhưng đuôi html', Buffer.from('<html><svg/></html>'), 'a.html', 'text/html', 'text'],
    ['đuôi svg nhưng không có <svg', Buffer.from('xin chào'), 'a.svg', 'image/svg+xml', 'text'],
    ['text có NUL', Buffer.from('ab\0cd'), 'a.txt', 'text/plain', 'unknown'],
    ['nhị phân có byte điều khiển', Buffer.from([1, 2, 255, 3]), 'a.txt', 'text/plain', 'unknown'],
    ['text sai UTF-8 (latin1)', Buffer.from('caf\xe9\n', 'latin1'), 'a.txt', 'text/plain', 'text'],
    ['mp4', ftypHeader('isom'), 'a.mp4', 'video/mp4', 'media'],
    ['mov', ftypHeader('qt'), 'a.mov', 'video/quicktime', 'media'],
    ['mp3 ID3', Buffer.from('ID3\x04\0\0'), 'a.mp3', 'audio/mpeg', 'media'],
    ['wav', Buffer.from('RIFF\0\0\0\0WAVEfmt '), 'a.wav', '', 'media'],
    ['mp3 khung MPEG', Buffer.from('fffb9064', 'hex'), 'a.mp3', 'audio/mpeg', 'media'],
    ['ogg', Buffer.from('OggS\0\x02'), 'a.ogg', '', 'media'],
    ['mkv/webm', Buffer.from('1a45dfa3', 'hex'), 'a.webm', '', 'media'],
  ])('%s', (_n, bytes, name, mime, kind) => expect(detectKind(bytes, name, mime)).toBe(kind));

  it('theo byte trước tên và mime khai báo', () => {
    expect(detectKind(Buffer.from('%PDF-1.7\n'), 'a.docx', 'text/plain')).toBe('pdf');
    expect(detectKind(MACHO, 'a.pdf', 'application/pdf')).toBe('executable');
  });

  it('OLE có chuỗi FAT vòng lặp hoặc vượt giới hạn không được coi là mã hóa', () => {
    const loop = makeOle(['EncryptionInfo', 'EncryptedPackage']);
    loop.writeUInt32LE(1, 516);
    expect(detectKind(loop, 'a.docx', '')).toBe('legacy-office');
    const outOfRange = makeOle(['EncryptionInfo', 'EncryptedPackage']);
    outOfRange.writeUInt32LE(99, 516);
    expect(detectKind(outOfRange, 'a.docx', '')).toBe('legacy-office');
  });
});

describe('blockLabel', () => {
  it.each<[DetectedKind, string, string | null]>([
    ['zip', 'tool.zip', 'zip'],
    ['executable', 'a.png', 'exe'],
    ['macro-office', 'a.docx', 'docm'],
    ['macro-office', 'a.docm', 'docm'],
    ['macro-office', 'a.xlsx', 'xlsm'],
    ['macro-office', 'a.XLSM', 'xlsm'],
    ['macro-office', 'a.pptm', 'pptx'],
    ['legacy-office', 'a.doc', 'office-cu'],
    ['pptx', 'a.pptx', 'pptx'],
    ['media', 'a.mp4', 'media'],
    ['unknown', 'a.txt', 'khac'],
    ['encrypted-office', 'a.docx', null],
    ['png', 'a.png', null],
    ['pdf', 'a.pdf', null],
    ['text', 'a.md', null],
  ])('%s %s → %s', (kind, name, label) => expect(blockLabel(kind, name)).toBe(label));
});
