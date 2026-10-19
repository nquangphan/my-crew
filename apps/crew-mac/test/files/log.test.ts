import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOG_MAX_BYTES } from '../../src/files/config.js';
import { logLine } from '../../src/files/log.js';
import { attachmentPaths } from '../../src/files/paths.js';
import { fakeHome, fakeSha } from './helpers.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const fields = {
  now: NOW,
  runId: '11111111-2222-4333-8444-555555555555',
  attachmentId: 'aaaaaaaa-2222-4333-8444-555555555555',
  sha256: fakeSha(1),
  bytes: 412,
  status: 'san_sang' as const,
  reason: null,
  note: 'tai_bridge' as const,
};

describe('logLine', () => {
  it('ghi một dòng cố định, file 0600, không chứa nội dung', () => {
    const p = attachmentPaths(fakeHome());
    logLine(p, fields);
    const text = readFileSync(p.log, 'utf8');
    expect(text).toBe(
      `2026-10-09T12:00:00.000Z 11111111 aaaaaaaa ${fakeSha(1).slice(0, 12)} 412 san_sang - tai_bridge\n`,
    );
    expect(statSync(p.log).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(p.log)).mode & 0o777).toBe(0o700);
  });

  it('có reason và thiếu note thì dùng dấu gạch', () => {
    const p = attachmentPaths(fakeHome());
    logLine(p, { ...fields, status: 'hong', reason: 'sai_ma_bam', note: undefined });
    expect(readFileSync(p.log, 'utf8')).toContain(' hong sai_ma_bam -\n');
  });

  it('xoay vòng khi lớn hơn 5 MB: giữ một bản .1', () => {
    const p = attachmentPaths(fakeHome());
    mkdirSync(dirname(p.log), { recursive: true });
    writeFileSync(p.log, 'x'.repeat(LOG_MAX_BYTES + 1));
    logLine(p, fields);
    expect(existsSync(`${p.log}.1`)).toBe(true);
    expect(statSync(`${p.log}.1`).size).toBe(LOG_MAX_BYTES + 1);
    expect(readFileSync(p.log, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
  });
});
