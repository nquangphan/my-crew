import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { macPaths } from '@crew/mac';
import { describe, expect, it, vi } from 'vitest';
import { createLogs, LOG_READ_BYTES, logPaths, tailFile } from '../src/main/logs.js';

const dir = () => mkdtempSync(join(tmpdir(), 'crew-logs-'));

describe('tailFile', () => {
  it('cắt đúng số dòng cuối', async () => {
    const file = join(dir(), 'a.log');
    writeFileSync(file, 'l1\nl2\nl3\nl4\n');
    expect(await tailFile(file, 2)).toEqual(['l3', 'l4']);
    expect(await tailFile(file, 10)).toEqual(['l1', 'l2', 'l3', 'l4']);
  });

  it('lọc theo runId trước khi cắt', async () => {
    const file = join(dir(), 'a.log');
    writeFileSync(file, 'run-a start\nrun-b start\nrun-a mid\nrun-b end\nrun-a end\n');
    expect(await tailFile(file, 2, 'run-a')).toEqual(['run-a mid', 'run-a end']);
    expect(await tailFile(file, 5, 'khong-co')).toEqual([]);
  });

  it('chỉ đọc tối đa 512 KB cuối và bỏ dòng đứt ở đầu', async () => {
    const file = join(dir(), 'big.log');
    const line = `${'x'.repeat(99)}\n`;
    const total = Math.ceil((LOG_READ_BYTES * 2) / line.length);
    writeFileSync(file, `${line.repeat(total)}CUOI\n`);
    const lines = await tailFile(file, 100_000);
    expect(LOG_READ_BYTES).toBe(512 * 1024);
    expect(lines.length).toBeLessThanOrEqual(Math.ceil(LOG_READ_BYTES / line.length) + 1);
    expect(lines.at(-1)).toBe('CUOI');
    expect(lines.every((l) => l === 'CUOI' || l.length === 99)).toBe(true);
  });

  it('file không tồn tại thì rỗng', async () => {
    expect(await tailFile(join(dir(), 'khong-co.log'), 10)).toEqual([]);
  });
});

describe('createLogs', () => {
  it('bốn đường dẫn theo macPaths và Application Support', () => {
    const paths = logPaths('/Users/x');
    expect(paths.app).toBe('/Users/x/Library/Application Support/2P Crew/app.log');
    expect(paths.sshd).toBe(macPaths('/Users/x').sshdLog);
    expect(paths.reaper).toBe(macPaths('/Users/x').reaperLog);
    expect(paths.status).toBe(macPaths('/Users/x').statusLog);
  });

  it('file ngoài bốn giá trị thì lỗi', async () => {
    const logs = createLogs({ home: '/Users/x', reveal: () => undefined });
    await expect(logs.tail('passwd' as never, 10)).rejects.toThrow('File log không hợp lệ');
    expect(() => logs.reveal('../etc' as never)).toThrow('File log không hợp lệ');
  });

  it('reveal mở đúng đường dẫn trong Finder', () => {
    const reveal = vi.fn();
    createLogs({ home: '/Users/x', reveal }).reveal('sshd');
    expect(reveal).toHaveBeenCalledWith(macPaths('/Users/x').sshdLog);
  });

  it('số dòng được chặn trong 1..5000', async () => {
    const home = dir();
    const logs = createLogs({ home, reveal: () => undefined });
    expect(await logs.tail('app', 0)).toEqual([]);
    await expect(logs.tail('app', 1.5)).rejects.toThrow('Số dòng không hợp lệ');
  });
});
