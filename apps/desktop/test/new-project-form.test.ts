import { describe, expect, it } from 'vitest';
import { draftProblem } from '../src/renderer/components/new-project-form.js';

const ready = { key: 'KIDYBE', name: 'kidy', repoUrl: 'git@github.com:o/r.git', description: 'backend' };

describe('draftProblem', () => {
  it('is null for a complete draft', () => {
    expect(draftProblem(ready)).toBeNull();
  });

  it('says a typed key is too long instead of calling it missing', () => {
    expect(draftProblem({ ...ready, key: 'KIDYBACKEND' })).toBe('Key dài 11 ký tự, tối đa 10.');
  });

  it('explains the key format', () => {
    expect(draftProblem({ ...ready, key: '1KIDY' })).toBe(
      'Key phải có 2–10 chữ in hoa hoặc số, bắt đầu bằng chữ.',
    );
  });

  it('lists empty fields as missing', () => {
    expect(draftProblem({ ...ready, key: '', description: ' ' })).toBe('Còn thiếu key, mô tả.');
  });
});
