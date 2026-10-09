import { describe, expect, it } from 'vitest';
import { sanitizeJobError, stripUrlCredentials } from '../../src/main/jobs/sanitize.js';

// Chuỗi giống token ghép lúc chạy để chính file nguồn không mang token.
const awsKey = `AKIA${'IOSFODNN7EXAMPLE'}`;
const githubToken = `ghp_${'a1B2'.repeat(9)}`;

describe('sanitizeJobError', () => {
  it('stderr git có URL kèm token và mã màu: bỏ token, bỏ \\x1b, tối đa 300 ký tự', () => {
    const stderr = `\x1b[31mfatal:\x1b[0m unable to access 'https://user:token@github.com/x/y.git/': 403 ${'z'.repeat(400)}`;
    const out = sanitizeJobError(stderr);
    expect(out).not.toContain('token@');
    expect(out).not.toContain('user:');
    expect(out).not.toContain('\x1b');
    expect(out).toContain('https://[ĐÃ CHE]@github.com/x/y.git/');
    expect(Array.from(out).length).toBeLessThanOrEqual(300);
  });

  it('che khóa AWS và token GitHub như plugin, giữ xuống dòng', () => {
    expect(sanitizeJobError(`a\u0000b ${awsKey}\nremote: ${githubToken}`)).toBe(
      'ab [ĐÃ CHE]\nremote: [ĐÃ CHE]',
    );
  });

  it('không cắt đôi ký tự ngoài BMP', () => {
    expect(sanitizeJobError('😀'.repeat(400))).toBe('😀'.repeat(300));
  });
});

describe('stripUrlCredentials', () => {
  it('bỏ user:pass của URL remote, giữ URL kiểu scp', () => {
    expect(stripUrlCredentials('https://u:p@github.com/a/b.git')).toBe('https://github.com/a/b.git');
    expect(stripUrlCredentials('git@github.com:a/b.git')).toBe('git@github.com:a/b.git');
    expect(stripUrlCredentials('/srv/origin.git')).toBe('/srv/origin.git');
  });
});
