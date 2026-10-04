import type { WorkerConfig } from '../config.ts';
import type { AttachmentRef, CoverageUnit, ExtractStatus, Problem, SourceLocator } from '../contracts.ts';
import { extractCsv } from './csv.ts';
import { extractDocx } from './docx.ts';
import { detectFormat } from './formats.ts';
import { extractImage } from './image.ts';
import { extractPdf } from './pdf.ts';
import { extractText } from './text.ts';
import { extractXlsx } from './xlsx.ts';
export type ExtractedFile = {
  relativeName: string;
  kind: 'text' | 'image';
  mime: 'text/plain' | 'image/png';
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
  original: AttachmentRef;
  mime: string;
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
  | 'FORMULA_CACHE_MISSING'
  | 'STALE_EXTRACTION_GENERATION'
  | 'HASH_MISMATCH'
  | 'DATA_LOSS';
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
export function append(
  r: ExtractResult,
  locator: SourceLocator,
  bytes: Uint8Array,
  kind: 'text' | 'image',
  c: ExtractContext,
): boolean {
  c.signal.throwIfAborted();
  if (metadataLimited.has(r)) return false;
  // Reserve space for the independent terminal manifest before any file drains.
  // SHA/size/name fields have a fixed upper allowance; locator bytes are exact.
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
  r.files.push({
    relativeName: `part-${r.files.length + 1}.${kind === 'text' ? 'txt' : 'png'}`,
    kind,
    mime: kind === 'text' ? 'text/plain' : 'image/png',
    bytes,
    unitIds: [id],
  });
  return true;
}
export { extractCsv } from './csv.ts';
export { extractDocx } from './docx.ts';
export { detectFormat } from './formats.ts';
export { extractImage } from './image.ts';
export { extractPdf } from './pdf.ts';
export { extractText } from './text.ts';
export { verifyExtraction } from './verify.ts';
export { extractXlsx } from './xlsx.ts';
export { parseXml } from './xml.ts';
export { readOfficeParts } from './zip.ts';

export async function extractAttachment(bytes: Uint8Array, c: ExtractContext): Promise<ExtractResult> {
  const format = detectFormat(bytes, '', c.mime);
  switch (format) {
    case 'text':
      return extractText(bytes, c);
    case 'csv':
      return extractCsv(bytes, c);
    case 'png':
    case 'jpeg':
      return extractImage(bytes, c);
    case 'pdf':
      return extractPdf(bytes, c);
    case 'docx':
      return extractDocx(bytes, c);
    case 'xlsx':
      return extractXlsx(bytes, c);
    case 'encrypted-office':
      return failure(new ExtractError('PASSWORD_REQUIRED'));
    default:
      if (bytes[0] === 80 && bytes[1] === 75) {
        if (c.mime.includes('wordprocessingml')) return extractDocx(bytes, c);
        if (c.mime.includes('spreadsheetml')) return extractXlsx(bytes, c);
      }
      return failure(new ExtractError('UNSUPPORTED_TYPE'));
  }
}

const sinks = new WeakMap<ExtractContext, { sent: Set<string>; write(file: ExtractedFile): Promise<void> }>();
export async function drainFiles(result: ExtractResult, context: ExtractContext): Promise<void> {
  const sink = sinks.get(context);
  if (!sink) return;
  for (const file of result.files)
    if (!sink.sent.has(file.relativeName)) {
      await sink.write(file);
      sink.sent.add(file.relativeName);
    }
}
export async function extractToFrames(
  input: import('../worker-protocol.ts').WorkerInput,
  bytes: Uint8Array,
  output: import('node:stream').Writable,
): Promise<void> {
  const { createHash } = await import('node:crypto');
  const { writeFrame, workerBounds } = await import('../worker-protocol.ts');
  const { verifyExtraction } = await import('./verify.ts');
  const context: ExtractContext = {
    original: input.original,
    mime: input.mime,
    config: input.config,
    signal: new AbortController().signal,
  };
  sinks.set(context, {
    sent: new Set(),
    async write(file) {
      await writeFrame(output, {
        kind: 'file-start',
        name: file.relativeName,
        mime: file.mime,
        bytes: file.bytes.length,
        sha256: createHash('sha256').update(file.bytes).digest('hex'),
      });
      for (let n = 0; n < file.bytes.length; n += workerBounds.chunk)
        await writeFrame(output, {
          kind: 'file-chunk',
          name: file.relativeName,
          base64: Buffer.from(file.bytes.subarray(n, n + workerBounds.chunk)).toString('base64'),
        });
      await writeFrame(output, { kind: 'file-end', name: file.relativeName });
    },
  });
  try {
    const result = await extractAttachment(bytes, context);
    const verified = verifyExtraction(input, result);
    await drainFiles(result, context);
    await writeFrame(output, { kind: 'result', body: verified });
  } finally {
    sinks.delete(context);
  }
}
