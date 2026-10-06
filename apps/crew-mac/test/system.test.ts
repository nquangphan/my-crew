import { describe, expect, it } from 'vitest';
import { createRunner } from '../src/system.js';

describe('createRunner', () => {
  it('trả stdout, stderr và mã thoát', async () => {
    const result = await createRunner().run(process.execPath, [
      '-e',
      "process.stdout.write('ra'); process.stderr.write('loi'); process.exit(3)",
    ]);
    expect(result).toEqual({ code: 3, stdout: 'ra', stderr: 'loi', timedOut: false });
  });

  it('đưa input vào stdin', async () => {
    const result = await createRunner().run(
      process.execPath,
      ['-e', "process.stdin.on('data', (d) => process.stdout.write(String(d).toUpperCase()))"],
      { input: 'abc' },
    );
    expect(result.stdout).toBe('ABC');
  });

  it('hết giờ thì SIGKILL kể cả khi process bỏ qua SIGTERM', async () => {
    const started = Date.now();
    const result = await createRunner().run(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { timeoutMs: 300 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.code).toBe(137);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('lệnh không tồn tại trả 127', async () => {
    const result = await createRunner().run('/khong/co/lenh-nay', []);
    expect(result.code).toBe(127);
  });
});
