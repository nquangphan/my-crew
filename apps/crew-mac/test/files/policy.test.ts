import { describe, expect, it } from 'vitest';
import {
  ALLOWED_EXTENSIONS,
  decide,
  EXTENSION_LABELS,
  MACRO_EXTENSIONS,
  SNIFF_CHECKED,
} from '../../src/files/policy.js';

describe('bảng kiểu (giống hệt bản của plugin crew.core)', () => {
  it('ALLOWED_EXTENSIONS', () =>
    expect(ALLOWED_EXTENSIONS.join(' ')).toBe(
      'png jpg jpeg gif webp heic heif pdf docx xlsx csv txt md json yaml yml log html htm xml svg ts tsx js jsx mjs cjs py sh css sql',
    ));
  it('SNIFF_CHECKED', () =>
    expect(SNIFF_CHECKED.join(' ')).toBe('png jpg jpeg gif webp heic heif pdf docx xlsx'));
  it('MACRO_EXTENSIONS', () => expect(MACRO_EXTENSIONS.join(' ')).toBe('docm xlsm pptm dotm xltm'));
  // Bảng đuôi → nhãn chuẩn; plugin chép nguyên các chuỗi này.
  it.each([
    ['zip', 'zip 7z rar gz tgz tar bz2 xz'],
    ['exe', 'exe msi dmg pkg app bat cmd com scr dll dylib jar apk ps1 vbs deb rpm so'],
    ['docm', 'docm dotm'],
    ['xlsm', 'xlsm xltm'],
    ['office-cu', 'doc xls ppt dot xlt pot pps'],
    ['pptx', 'pptx pptm ppsx potx'],
    ['media', 'mp3 mp4 m4a m4v mov wav avi mkv webm aac flac ogg aiff wmv'],
  ] as const)('EXTENSION_LABELS %s', (label, exts) => expect(EXTENSION_LABELS[label].join(' ')).toBe(exts));
  it('EXTENSION_LABELS chỉ có 7 nhãn, đuôi không trùng', () => {
    expect(Object.keys(EXTENSION_LABELS)).toEqual([
      'zip',
      'exe',
      'docm',
      'xlsm',
      'office-cu',
      'pptx',
      'media',
    ]);
    const all = Object.values(EXTENSION_LABELS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('decide', () => {
  it('exe đổi đuôi png bị chặn nhãn exe', () =>
    expect(decide('executable', 'a.png')).toEqual({
      action: 'reject',
      status: 'bi_chan',
      reason: 'kieu_cam',
      label: 'exe',
    }));
  it('zip bị chặn nhãn zip', () =>
    expect(decide('zip', 'tool.zip')).toEqual({
      action: 'reject',
      status: 'bi_chan',
      reason: 'kieu_cam',
      label: 'zip',
    }));
  it('docm: macro', () =>
    expect(decide('macro-office', 'a.docm')).toEqual({
      action: 'reject',
      status: 'bi_chan',
      reason: 'office_macro',
      label: 'docm',
    }));
  it('docx có vbaProject: macro nhãn docm', () =>
    expect(decide('macro-office', 'a.docx')).toMatchObject({ reason: 'office_macro', label: 'docm' }));
  it('Office mã hóa', () =>
    expect(decide('encrypted-office', 'a.docx')).toEqual({
      action: 'reject',
      status: 'ma_hoa',
      reason: 'office_ma_hoa',
    }));
  it.each([
    ['legacy-office', 'a.doc', 'office-cu'],
    ['pptx', 'a.pptx', 'pptx'],
    ['media', 'a.mp4', 'media'],
    ['unknown', 'a.txt', 'khac'],
    ['zip', 'a.docx', 'zip'],
  ] as const)('%s %s → bị chặn (%s)', (kind, name, label) =>
    expect(decide(kind, name)).toEqual({ action: 'reject', status: 'bi_chan', reason: 'kieu_cam', label }),
  );

  it.each(['png', 'jpeg', 'gif', 'webp', 'heic'] as const)('%s → image', (kind) =>
    expect(decide(kind, 'a.png')).toEqual({ action: 'image' }),
  );
  it('pdf → pdf', () => expect(decide('pdf', 'a.pdf')).toEqual({ action: 'pdf' }));
  it('docx/xlsx → extract', () => {
    expect(decide('docx', 'a.docx')).toEqual({ action: 'extract', kind: 'docx' });
    expect(decide('xlsx', 'a.xlsx')).toEqual({ action: 'extract', kind: 'xlsx' });
  });
  it('csv → extract csv; svg đọc như text', () => {
    expect(decide('csv', 'a.csv')).toEqual({ action: 'extract', kind: 'csv' });
    expect(decide('svg', 'a.svg')).toEqual({ action: 'extract', kind: 'text' });
  });
  it('text với đuôi được phép → extract text', () => {
    expect(decide('text', 'script.sh')).toEqual({ action: 'extract', kind: 'text' });
    expect(decide('text', 'README.MD')).toEqual({ action: 'extract', kind: 'text' });
  });

  it('đuôi ngoài danh sách thì chặn dù byte là text; nhãn theo đuôi như plugin', () => {
    expect(decide('text', 'a.exe')).toEqual({
      action: 'reject',
      status: 'bi_chan',
      reason: 'kieu_cam',
      label: 'exe',
    });
    expect(decide('text', 'Makefile')).toMatchObject({ reason: 'kieu_cam', label: 'khac' });
    expect(decide('text', 'notes.rtf')).toMatchObject({ reason: 'kieu_cam', label: 'khac' });
    expect(decide('png', 'a.bmp')).toMatchObject({ reason: 'kieu_cam', label: 'khac' });
    expect(decide('text', 'a.doc')).toMatchObject({ reason: 'kieu_cam', label: 'office-cu' });
    expect(decide('text', 'a.mp4')).toMatchObject({ reason: 'kieu_cam', label: 'media' });
    expect(decide('text', 'a.tar.gz')).toMatchObject({ reason: 'kieu_cam', label: 'zip' });
  });
  it.each([
    ['a.ps1', 'exe'],
    ['a.vbs', 'exe'],
    ['a.deb', 'exe'],
    ['a.rpm', 'exe'],
    ['libx.so', 'exe'],
    ['a.pps', 'office-cu'],
    ['a.wmv', 'media'],
    ['a.aiff', 'media'],
  ])('%s → kieu_cam nhãn %s (khớp plugin)', (name, label) =>
    expect(decide('unknown', name)).toEqual({
      action: 'reject',
      status: 'bi_chan',
      reason: 'kieu_cam',
      label,
    }),
  );
  it.each([
    ['a.pptm', 'pptx'],
    ['a.dotm', 'docm'],
    ['a.xltm', 'xlsm'],
  ])('%s → office_macro nhãn %s (nhãn thuộc tập I2)', (name, label) =>
    expect(decide('docx', name)).toMatchObject({ reason: 'office_macro', label }),
  );
  it('đuôi macro luôn là office_macro', () => {
    expect(decide('docx', 'a.docm')).toMatchObject({ reason: 'office_macro', label: 'docm' });
    expect(decide('xlsx', 'a.xltm')).toMatchObject({ reason: 'office_macro', label: 'xlsm' });
  });
  it('byte lệch đuôi (cả hai đều được phép) thì xử lý theo byte', () => {
    expect(decide('jpeg', 'a.png')).toEqual({ action: 'image' });
    expect(decide('png', 'notes.txt')).toEqual({ action: 'image' });
    expect(decide('pdf', 'a.docx')).toEqual({ action: 'pdf' });
    expect(decide('text', 'a.png')).toEqual({ action: 'extract', kind: 'text' });
  });
});
