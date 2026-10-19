import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Khóa một instance của Electron nằm trong thư mục userData. App 2P Crew cũ dùng chung tên nên dùng chung
// thư mục mặc định: nếu xin khóa trước khi đổi userData, app mới đụng khóa của app cũ và tự thoát im lặng.
describe('thứ tự khởi động của Main', () => {
  it('đổi userData sang thư mục Chromium riêng trước khi xin khóa một instance', () => {
    const source = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8');
    const setPath = source.indexOf("app.setPath('userData'");
    const lock = source.indexOf('app.requestSingleInstanceLock()');
    expect(setPath).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(-1);
    expect(setPath).toBeLessThan(lock);
  });
});
