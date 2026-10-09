import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultProbes,
  detectFullDiskAccess,
  diskAccessOutcome,
  FULL_DISK_ACCESS_PANE,
} from '../src/main/setup/disk-access.js';

const refuse = (code: string) => () => {
  throw Object.assign(new Error(code), { code });
};

describe('detectFullDiskAccess', () => {
  it('đọc được thì granted, kể cả khi probe đầu bị từ chối', () => {
    expect(detectFullDiskAccess([() => undefined], 'darwin')).toBe('granted');
    expect(detectFullDiskAccess([refuse('EPERM'), () => undefined], 'darwin')).toBe('granted');
  });
  it('EPERM hoặc EACCES và không nơi nào đọc được thì denied', () => {
    expect(detectFullDiskAccess([refuse('EPERM')], 'darwin')).toBe('denied');
    expect(detectFullDiskAccess([refuse('ENOENT'), refuse('EACCES')], 'darwin')).toBe('denied');
  });
  it('đường dẫn không tồn tại thì unknown; không phải macOS thì unsupported', () => {
    expect(detectFullDiskAccess([refuse('ENOENT')], 'darwin')).toBe('unknown');
    expect(detectFullDiskAccess([() => undefined], 'linux')).toBe('unsupported');
  });
  it('probe mặc định trỏ dưới HOME và chỉ đọc (HOME giả: Safari tồn tại thì granted)', () => {
    const home = mkdtempSync(join(tmpdir(), 'fda-'));
    expect(detectFullDiskAccess(defaultProbes(home), 'darwin')).toBe('unknown');
    mkdirSync(join(home, 'Library', 'Safari'), { recursive: true });
    expect(detectFullDiskAccess(defaultProbes(home), 'darwin')).toBe('granted');
  });
});

describe('diskAccessOutcome', () => {
  it('bấm Tiếp khi denied hoặc unknown thì không đi tiếp', () => {
    const denied = diskAccessOutcome('denied');
    expect(denied.ok).toBe(false);
    expect(denied.message).toContain('Chưa cấp quyền ổ đĩa');
    expect(denied.stay).toBeUndefined();
    expect(diskAccessOutcome('unknown').ok).toBe(false);
  });
  it('bấm Tiếp khi granted hoặc không phải macOS thì đi tiếp', () => {
    expect(diskAccessOutcome('granted')).toMatchObject({ ok: true });
    expect(diskAccessOutcome('unsupported')).toMatchObject({ ok: true });
  });
  it('dò lại chỉ báo trạng thái, không đi tiếp', () => {
    expect(diskAccessOutcome('denied', true)).toMatchObject({ ok: false, stay: true });
    expect(diskAccessOutcome('granted', true)).toMatchObject({ ok: true, stay: true, state: 'granted' });
  });
  it('mở đúng pane Truy cập toàn bộ ổ đĩa', () => {
    expect(FULL_DISK_ACCESS_PANE).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    );
  });
});
