import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectFormat } from '../src/attachments/extract/formats.ts';
import { makeOffice, makePng, makeZip } from './fixtures/attachments/make-fixtures.ts';

test('attachment signatures outrank names and declared MIME', () => {
  assert.equal(detectFormat(makePng(1, 1), 'fake.txt', 'text/plain'), 'png');
  assert.equal(detectFormat(Buffer.from('%PDF-1.7\n'), 'fake.docx', 'text/plain'), 'pdf');
  assert.equal(detectFormat(makeOffice('docx'), 'x.zip', 'application/zip'), 'docx');
  assert.equal(detectFormat(makeOffice('xlsx'), 'x.txt', 'text/plain'), 'xlsx');
  assert.equal(
    detectFormat(
      makeZip([{ name: 'other', body: 'x' }]),
      'x.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ),
    'unsupported',
  );
});
test('attachment OLE magic alone cannot prove encryption', () =>
  assert.equal(
    detectFormat(Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'a.docx', 'application/octet-stream'),
    'unsupported',
  ));
test('attachment binary masquerading as text is unsupported', () =>
  assert.equal(detectFormat(Buffer.from([0, 1, 255, 2]), 'a.txt', 'text/plain'), 'unsupported'));
test('attachment OLE confirms named encryption streams only with finite valid FAT directory chain', () => {
  const b = Buffer.alloc(1536);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(b);
  b.writeUInt16LE(0xfffe, 28);
  b.writeUInt16LE(9, 30);
  b.writeUInt32LE(1, 44);
  b.writeUInt32LE(1, 48);
  b.writeUInt32LE(0, 76);
  b.writeUInt32LE(0xfffffffd, 512);
  b.writeUInt32LE(0xfffffffe, 516);
  for (const [i, name] of ['EncryptionInfo', 'EncryptedPackage'].entries()) {
    const p = 1024 + i * 128;
    Buffer.from(`${name}\0`, 'utf16le').copy(b, p);
    b.writeUInt16LE((name.length + 1) * 2, p + 64);
    b[p + 66] = 2;
  }
  assert.equal(detectFormat(b, 'a.docx', 'application/octet-stream'), 'encrypted-office');
  b.writeUInt32LE(1, 516);
  assert.equal(detectFormat(b, 'a.docx', 'application/octet-stream'), 'unsupported');
  b.writeUInt32LE(99, 516);
  assert.equal(detectFormat(b, 'a.docx', 'application/octet-stream'), 'unsupported');
});
