import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AppLog, formatEntry, localTimestamp, redactFields } from '../src/main/app-log.js';

it('ẩn token, webhookSecret, authorization trong fields lồng nhau', () => {
  const out = redactFields({ token: 'abc', nested: { webhookSecret: 'x', authorization: 'Bearer y' } });
  expect(out).toEqual({ token: '[đã ẩn]', nested: { webhookSecret: '[đã ẩn]', authorization: '[đã ẩn]' } });
});

it('chuỗi Bearer trong message cũng bị ẩn', () => {
  const line = formatEntry(
    {
      level: 'warn',
      source: 'main',
      event: 'api',
      fields: { message: 'gọi lỗi Authorization: Bearer abc.def-123' },
    },
    new Date(),
  );
  expect(line).not.toContain('abc.def-123');
  expect(JSON.parse(line)).toMatchObject({ level: 'warn', source: 'main', event: 'api' });
});

it('giờ ghi theo Asia/Ho_Chi_Minh (+07:00) dù múi giờ máy là gì', () => {
  expect(localTimestamp(new Date('2026-10-09T05:30:15.123Z'))).toBe('2026-10-09T12:30:15.123+07:00');
});

it('file mode 600, xoay khi vượt trần và chỉ giữ một bản app.log.1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-log-'));
  const log = new AppLog(join(dir, 'app.log'), { maxBytes: 300 });
  for (let i = 0; i < 12; i++)
    log.write({ level: 'info', source: 'main', event: `e${i}`, fields: { pad: 'x'.repeat(60) } });
  expect(statSync(join(dir, 'app.log')).mode & 0o777).toBe(0o600);
  expect(existsSync(join(dir, 'app.log.1'))).toBe(true);
  expect(existsSync(join(dir, 'app.log.2'))).toBe(false);
  expect(statSync(join(dir, 'app.log')).size).toBeLessThanOrEqual(300);
  expect(readFileSync(join(dir, 'app.log'), 'utf8').trim().split('\n').pop()).toContain('"event":"e11"');
});

it('lỗi ghi file không ném ra ngoài', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-log-'));
  writeFileSync(join(dir, 'file'), '');
  expect(() =>
    new AppLog(join(dir, 'file', 'app.log')).write({ level: 'info', source: 'main', event: 'x', fields: {} }),
  ).not.toThrow();
});
