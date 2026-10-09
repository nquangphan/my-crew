// Port từ v2/server/src/attachments/extract/index.ts (a13dd7d).
// Bỏ phần khung worker Docker/frame của v2: ở Mac kết quả được ghi thẳng ra file trong process con.
import type { CoverageUnit, ExtractStatus, Problem, SourceLocator, WorkerConfig } from './limits.js';

export type ExtractedFile = {
  relativeName: string;
  kind: 'text' | 'image';
  bytes: Uint8Array;
  unitIds: string[];
};
export type ExtractResult = {
  status: ExtractStatus;
  units: CoverageUnit[];
  files: ExtractedFile[];
  problems: Problem[];
};
export type ExtractContext = {
  config: WorkerConfig;
  signal: AbortSignal;
};
export type ErrorCode =
  | 'EXTRACTOR_UNAVAILABLE'
  | 'EXTRACTOR_FAILED'
  | 'LIMIT_EXCEEDED'
  | 'ACTIVE_CONTENT_BLOCKED'
  | 'UNSUPPORTED_TYPE'
  | 'UNSUPPORTED_ENCODING'
  | 'CORRUPT_DOCUMENT'
  | 'CORRUPT_XML'
  | 'PASSWORD_REQUIRED'
  | 'EXTERNAL_RESOURCE_UNAVAILABLE'
  | 'UNSUPPORTED_VISUAL'
  | 'FORMULA_CACHE_MISSING';
export class ExtractError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}
export function empty(): ExtractResult {
  return { status: 'complete', units: [], files: [], problems: [] };
}
export function problem(code: ErrorCode, unitIds: string[] = []): Problem {
  return { code, message: 'Không thể xử lý đầy đủ nội dung tệp.', unitIds };
}
export function failure(e: unknown): ExtractResult {
  const code = e instanceof ExtractError ? e.code : 'EXTRACTOR_FAILED';
  return {
    status:
      code === 'PASSWORD_REQUIRED'
        ? 'encrypted'
        : code === 'ACTIVE_CONTENT_BLOCKED'
          ? 'blocked'
          : code.startsWith('UNSUPPORTED')
            ? 'unsupported'
            : code.startsWith('CORRUPT')
              ? 'corrupt'
              : 'failed',
    units: [],
    files: [],
    problems: [problem(code)],
  };
}
const metadataBytes = new WeakMap<ExtractResult, number>();
const metadataLimited = new WeakSet<ExtractResult>();
const metadataBudget = 7 * 1024 * 1024;
export function missing(
  r: ExtractResult,
  locator: SourceLocator,
  needs: 'text' | 'vision',
  code: ErrorCode,
): void {
  if (r.units.length >= 100000 || r.problems.length >= 100000) throw new ExtractError('LIMIT_EXCEEDED');
  if (metadataLimited.has(r)) {
    const last = r.units.at(-1);
    const tail = last?.locator;
    if (
      last?.state === 'missing' &&
      last.needs === needs &&
      last.reason === 'LIMIT_EXCEEDED' &&
      code === 'LIMIT_EXCEEDED'
    ) {
      if (tail?.kind === 'text' && locator.kind === 'text') {
        tail.byteEnd = Math.max(tail.byteEnd, locator.byteEnd);
        tail.lineEnd = Math.max(tail.lineEnd, locator.lineEnd);
      }
      if (tail?.kind === 'csv' && locator.kind === 'csv') {
        tail.rowEnd = Math.max(tail.rowEnd, locator.rowEnd);
        tail.columnEnd = Math.max(tail.columnEnd, locator.columnEnd);
      }
    }
    return;
  }
  const id = `u${r.units.length + 1}`;
  const unit = { id, locator, needs, state: 'missing' as const, reason: code };
  const issue = problem(code, [id]);
  const size =
    (metadataBytes.get(r) ?? 0) +
    Buffer.byteLength(JSON.stringify(unit)) +
    Buffer.byteLength(JSON.stringify(issue)) +
    16;
  metadataBytes.set(r, size);
  if (size >= metadataBudget) metadataLimited.add(r);
  r.units.push(unit);
  r.problems.push(issue);
  r.status = 'partial';
}
/** `ext` chỉ dùng cho ảnh nhúng: đuôi theo chữ ký byte (png, jpg, gif, webp). */
export function append(
  r: ExtractResult,
  locator: SourceLocator,
  bytes: Uint8Array,
  kind: 'text' | 'image',
  c: ExtractContext,
  ext = 'png',
): boolean {
  c.signal.throwIfAborted();
  if (metadataLimited.has(r)) return false;
  const cost = Buffer.byteLength(JSON.stringify(locator)) + 512;
  if (
    (metadataBytes.get(r) ?? 0) + cost > metadataBudget ||
    r.units.length >= 99998 ||
    r.files.length >= 9998 ||
    r.files.reduce((n, f) => n + f.bytes.length, 0) + bytes.length > c.config.limits.maxOutputBytes
  ) {
    missing(r, locator, kind === 'text' ? 'text' : 'vision', 'LIMIT_EXCEEDED');
    metadataLimited.add(r);
    return false;
  }
  metadataBytes.set(r, (metadataBytes.get(r) ?? 0) + cost);
  const id = `u${r.units.length + 1}`;
  r.units.push({ id, locator, needs: kind === 'text' ? 'text' : 'vision', state: 'available', reason: null });
  const n = r.files.length + 1;
  r.files.push({
    relativeName: kind === 'text' ? `part-${n}.txt` : `media/${n}.${ext}`,
    kind,
    bytes,
    unitIds: [id],
  });
  return true;
}
/** v2 đẩy file ra luồng frame theo từng đợt; ở đây kết quả nằm trong bộ nhớ tới cuối nên không cần làm gì. */
export async function drainFiles(_result: ExtractResult, _context: ExtractContext): Promise<void> {}

export { extractCsv } from './csv.js';
export { extractDocx } from './docx.js';
export { extractText } from './text.js';
export { extractXlsx } from './xlsx.js';
export { parseXml } from './xml.js';
export { readOfficeParts } from './zip.js';
