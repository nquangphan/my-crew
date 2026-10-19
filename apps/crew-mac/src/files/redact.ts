// Che credential trong chữ trước khi agent đọc. Dùng chung bộ luật built-in R7 của `crew-docs`
// (`packages/docs-kit/src/secret-scan.ts`). File này chỉ chạy trong bundle worker `dist/files-worker.cjs`
// (esbuild gom luật vào), không nằm trong bản build tsc: `rootDir: src` không cho import ra ngoài gói.
import { SECRET_RULES } from '../../../../packages/docs-kit/src/secret-scan.js';
import type { CredentialFinding } from './types.js';

export type RedactFn = (text: string) => { text: string; findings: CredentialFinding[] };

/**
 * Khóa PEM: luật R7 chỉ khớp dòng mở đầu, nhưng thứ cần giấu là thân khóa. Có dòng kết thúc trong 64 KB sau đó thì
 * che luôn tới hết dòng kết thúc; không có thì chỉ che dòng mở đầu.
 */
const BLOCK_TAIL: Record<string, string> = {
  'private-key': String.raw`(?:[\s\S]{0,65536}?-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----)?`,
};

/** Luật đã thêm cờ `g` (và phần đuôi khối). `allow` của R7 bị bỏ qua: với file đính kèm, che thừa vô hại. */
const RULES = SECRET_RULES.map((rule) => {
  const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
  return {
    id: rule.id,
    pattern: new RegExp(`(?:${rule.pattern.source})${BLOCK_TAIL[rule.id] ?? ''}`, flags),
  };
});

/** Số dòng (từ 1) của vị trí `offset`, tìm nhị phân trên mảng đầu dòng. */
function lineAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/**
 * Thay mọi giá trị khớp luật bằng `[ĐÃ CHE: <luật>]`. Chuỗi khớp trải nhiều dòng được thay kèm đúng số ký tự xuống
 * dòng của nó, nên số dòng của phần còn lại không đổi. Phát hiện chỉ có tên luật và số dòng, xếp theo dòng.
 */
export function redactSecrets(text: string): { text: string; findings: CredentialFinding[] } {
  const findings: CredentialFinding[] = [];
  let out = text;
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(out)) continue;
    rule.pattern.lastIndex = 0;
    const starts = lineStarts(out);
    out = out.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      const offset = rest.find((x) => typeof x === 'number') as number;
      findings.push({ rule: rule.id, line: lineAt(starts, offset) });
      return `[ĐÃ CHE: ${rule.id}]${'\n'.repeat(match.split('\n').length - 1)}`;
    });
  }
  findings.sort((a, b) => a.line - b.line);
  return { text: out, findings };
}
