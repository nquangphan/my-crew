import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forbiddenDebugSwitch } from '../src/main/debug-switch.js';

// Process cùng user mở lại app với cờ debug là điều khiển được renderer qua CDP, rồi gọi mọi kênh IPC
// nhân danh board key. Fuse không phủ các cờ Chromium này nên Main tự từ chối.
describe('chặn cờ debug từ xa', () => {
  const commandLine = (switches: string[]) => ({ hasSwitch: (name: string) => switches.includes(name) });

  it.each(['remote-debugging-port', 'remote-debugging-pipe', 'remote-allow-origins'])(
    'có %s thì từ chối',
    (name) => {
      expect(forbiddenDebugSwitch(commandLine([name]))).toBe(name);
    },
  );

  it('không có cờ nào thì cho chạy', () => {
    expect(forbiddenDebugSwitch(commandLine(['enable-logging']))).toBeNull();
  });

  it('Main kiểm cờ trước mọi việc khác (trước cả đổi userData)', () => {
    const source = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8');
    const check = source.indexOf('forbiddenDebugSwitch(app.commandLine)');
    const setPath = source.indexOf("app.setPath('userData'");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(setPath);
    expect(source).toMatch(/forbiddenDebugSwitch\(app\.commandLine\)[\s\S]{0,200}app\.exit\(1\)/);
    // app.exit không dừng mã đồng bộ: start() chỉ được gọi khi không có cờ debug.
    expect(source).toMatch(/if \(debugSwitch\) \{[^}]*\} else if \(!app\.requestSingleInstanceLock\(\)\)/);
  });
});
