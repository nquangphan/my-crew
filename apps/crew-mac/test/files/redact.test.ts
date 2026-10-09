import { describe, expect, it } from 'vitest';
import { SECRET_RULES } from '../../../../packages/docs-kit/src/secret-scan.js';
import { redactSecrets } from '../../src/files/redact.js';

// Mọi chuỗi giống credential được ghép lúc chạy: hook R7 lúc commit chặn chuỗi nguyên khối trong file nguồn.
const join = (...parts: string[]) => parts.join('');
const AWS_KEY = join('AKIA', 'IOSFODNN7', 'EXAMPLE');
const PEM_BEGIN = join('-----', 'BEGIN RSA ', 'PRIVATE KEY', '-----');
const PEM_END = join('-----', 'END RSA ', 'PRIVATE KEY', '-----');

/** Một mẫu cho mỗi luật của `crew-docs` R7; thêm luật mà quên mẫu thì ca đếm luật đỏ. */
const SAMPLES: Record<string, string> = {
  'aws-access-key-id': AWS_KEY,
  'aws-secret-access-key': join('aws_secret_access_key = ', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCY', 'EXAMPLEKEY'),
  'github-token': join('ghp', '_', 'A1b2'.repeat(9)),
  'github-fine-grained-token': join('github', '_pat_', 'x'.repeat(82)),
  'gitlab-token': join('glpat', '-', 'x'.repeat(20)),
  'slack-token': join('xox', 'b-', '1234567890-abc'),
  'slack-webhook': join('hooks.slack', '.com/services/', 'T00000000/B00000000/XXXXXXXX'),
  'stripe-key': join('sk', '_live_', '0123456789abcdef'),
  'google-api-key': join('AI', 'za', 'x'.repeat(35)),
  'openai-api-key': join('sk-', 'proj-', 'a'.repeat(20), 'T3Blbk', 'FJ', 'b'.repeat(20)),
  'anthropic-api-key': join('sk-', 'ant-', 'api03-', 'a'.repeat(80)),
  'npm-token': join('npm', '_', 'a'.repeat(36)),
  'private-key': PEM_BEGIN,
  jwt: join('ey', 'J', 'a'.repeat(10), '.ey', 'J', 'b'.repeat(10), '.', 'c'.repeat(10)),
  'crew-machine-token': join('crew', '_mt_', 'a'.repeat(40)),
};

describe('redactSecrets', () => {
  it('khóa AWS mẫu (đuôi EXAMPLE, R7 cho qua) vẫn bị che; giữ phần không phải credential', () => {
    expect(redactSecrets(`aws_access_key_id = ${AWS_KEY}`)).toEqual({
      text: 'aws_access_key_id = [ĐÃ CHE: aws-access-key-id]',
      findings: [{ rule: 'aws-access-key-id', line: 1 }],
    });
  });

  it('hai khóa trên một dòng → hai lần thay, hai phát hiện', () => {
    const token = SAMPLES['github-token'] as string;
    const r = redactSecrets(`a ${AWS_KEY} b ${AWS_KEY} c ${token}`);
    expect(r.text).toBe(
      'a [ĐÃ CHE: aws-access-key-id] b [ĐÃ CHE: aws-access-key-id] c [ĐÃ CHE: github-token]',
    );
    expect(r.findings).toEqual([
      { rule: 'aws-access-key-id', line: 1 },
      { rule: 'aws-access-key-id', line: 1 },
      { rule: 'github-token', line: 1 },
    ]);
  });

  it('số dòng đếm từ 1, theo dòng bắt đầu của chuỗi khớp', () => {
    const r = redactSecrets(`dòng 1\r\ndòng 2\n\nkhóa: ${AWS_KEY}\n`);
    expect(r.findings).toEqual([{ rule: 'aws-access-key-id', line: 4 }]);
    expect(r.text).toBe('dòng 1\r\ndòng 2\n\nkhóa: [ĐÃ CHE: aws-access-key-id]\n');
  });

  it('PEM nhiều dòng: dòng mở đầu bị che, thân khóa và dòng kết thúc cũng bị che, giữ số dòng', () => {
    const body = ['MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun', 'VTLw7onLRnrq0'];
    const text = ['trước', PEM_BEGIN, ...body, PEM_END, 'sau'].join('\n');
    const r = redactSecrets(text);
    expect(r.findings).toEqual([{ rule: 'private-key', line: 2 }]);
    expect(r.text).not.toContain(PEM_BEGIN);
    for (const part of body) expect(r.text).not.toContain(part);
    expect(r.text).not.toContain(PEM_END);
    expect(r.text.split('\n')).toHaveLength(text.split('\n').length);
    expect(r.text.split('\n')[0]).toBe('trước');
    expect(r.text.split('\n')[1]).toBe('[ĐÃ CHE: private-key]');
    expect(r.text.split('\n').at(-1)).toBe('sau');
  });

  it('PEM không có dòng kết thúc: che dòng mở đầu', () => {
    const r = redactSecrets(`${PEM_BEGIN}\nabc`);
    expect(r).toEqual({ text: '[ĐÃ CHE: private-key]\nabc', findings: [{ rule: 'private-key', line: 1 }] });
  });

  it('chuỗi khớp trải qua xuống dòng: số dòng sau đó không lệch, phát hiện xếp theo dòng', () => {
    const secret = join('wJalrXUtnFEMI/K7MDENG/bPxRfiCY', 'EXAMPLEKEY');
    const r = redactSecrets(`aws_secret_access_key:\n${secret}\nsau ${AWS_KEY}`);
    expect(r.findings).toEqual([
      { rule: 'aws-secret-access-key', line: 1 },
      { rule: 'aws-access-key-id', line: 3 },
    ]);
    expect(r.text.split('\n')).toHaveLength(3);
    expect(r.text).not.toContain(secret);
  });

  it('text sạch giữ nguyên, không có phát hiện', () => {
    const text = 'Xin chào\nBáo giá: 771 304 đồng\nAKIA ngắn\n';
    expect(redactSecrets(text)).toEqual({ text, findings: [] });
  });

  it('gọi lại nhiều lần cho cùng kết quả (regex cờ g không giữ trạng thái giữa các lần)', () => {
    const text = `x ${AWS_KEY}`;
    expect(redactSecrets(text)).toEqual(redactSecrets(text));
  });

  it('bản đã che không còn gì để che', () => {
    const once = redactSecrets(Object.values(SAMPLES).join('\n'));
    expect(redactSecrets(once.text).findings).toEqual([]);
  });

  it('áp đủ mọi luật SECRET_RULES của crew-docs (đếm luật để phát hiện khi docs-kit thêm luật)', () => {
    expect(SECRET_RULES).toHaveLength(15);
    expect(Object.keys(SAMPLES).sort()).toEqual(SECRET_RULES.map((r) => r.id).sort());
  });

  it.each(Object.entries(SAMPLES))('luật %s', (rule, sample) => {
    const r = redactSecrets(`giá trị: ${sample}\n`);
    expect(r.findings).toEqual([{ rule, line: 1 }]);
    expect(r.text).toBe(`giá trị: [ĐÃ CHE: ${rule}]\n`);
  });
});
