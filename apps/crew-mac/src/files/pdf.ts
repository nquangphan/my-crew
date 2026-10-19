import { readFileSync } from 'node:fs';
import type { CommandRunner } from '../system.js';
import { PDF_PAGES_PER_READ } from './config.js';

const OSASCRIPT_TIMEOUT_MS = 30_000;
/** PDF quá số trang này thì agent đọc theo `pages` (Claude Code `Read` không nhận quá 20 trang một lần). */
const READ_WHOLE_MAX_PAGES = 10;

let script: string | undefined;
/** Script JXA nằm cạnh file này (build chép `pdf-info.js` vào `dist/files/`). */
function pdfInfoScript(): string {
  script ??= readFileSync(new URL('./pdf-info.js', import.meta.url), 'utf8');
  return script;
}

export type PdfInfo = { pages: number; encrypted: boolean } | { error: 'hong_cau_truc' };

/** Đếm trang và phát hiện mã hóa bằng PDFKit qua osascript. Mọi đầu ra lạ đều là `hong_cau_truc`. */
export async function inspectPdf(runner: CommandRunner, blob: string): Promise<PdfInfo> {
  const result = await runner.run('osascript', ['-l', 'JavaScript', '-e', pdfInfoScript(), blob], {
    timeoutMs: OSASCRIPT_TIMEOUT_MS,
  });
  if (result.code !== 0 || result.timedOut) return { error: 'hong_cau_truc' };
  try {
    const parsed: unknown = JSON.parse(result.stdout.trim());
    if (typeof parsed !== 'object' || parsed === null) return { error: 'hong_cau_truc' };
    const { pages, encrypted } = parsed as { pages?: unknown; encrypted?: unknown };
    if (typeof pages !== 'number' || !Number.isInteger(pages) || pages < 0 || typeof encrypted !== 'boolean')
      return { error: 'hong_cau_truc' };
    return { pages, encrypted };
  } catch {
    return { error: 'hong_cau_truc' };
  }
}

/** Gợi ý đọc theo trang: rỗng khi ≤ 10 trang; còn lại chia đoạn tối đa 20 trang, ví dụ "pages 1-20, 21-40, 41-45". */
export function pdfReadHint(pages: number): string {
  if (pages <= READ_WHOLE_MAX_PAGES) return '';
  const ranges: string[] = [];
  for (let start = 1; start <= pages; start += PDF_PAGES_PER_READ)
    ranges.push(`${start}-${Math.min(start + PDF_PAGES_PER_READ - 1, pages)}`);
  return `pages ${ranges.join(', ')}`;
}
