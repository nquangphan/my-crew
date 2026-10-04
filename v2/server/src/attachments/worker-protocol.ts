import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import type { WorkerConfig } from './config.ts';
import type { AttachmentRef, WorkerResult } from './contracts.ts';
import { noSymlinkComponents, syncDirectory } from './storage.ts';
export type WorkerInput = {
  version: 1;
  jobId: string;
  generation: string;
  original: AttachmentRef;
  mime: string;
  inputName: 'original';
  extractorVersion: string;
  config: WorkerConfig;
};
export const workerBounds = Object.freeze({
  chunk: 65536,
  line: 131072,
  terminal: 8 * 1024 * 1024,
  output: 100 * 1024 * 1024,
  units: 100000,
  files: 10000,
});
export function workerError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
const sha = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const name = /^[a-z0-9-]+\.(txt|png)$/;
const problemCopy: Record<string, string> = {
  EXTRACTOR_UNAVAILABLE: 'Bộ trích xuất chưa khả dụng.',
  EXTRACTOR_FAILED: 'Không thể trích xuất tệp.',
  LIMIT_EXCEEDED: 'Vượt giới hạn xử lý tệp.',
  ACTIVE_CONTENT_BLOCKED: 'Nội dung chủ động đã bị chặn.',
  UNSUPPORTED_TYPE: 'Loại tệp chưa được hỗ trợ.',
  UNSUPPORTED_ENCODING: 'Mã hóa chưa được hỗ trợ.',
  CORRUPT_DOCUMENT: 'Tài liệu không hợp lệ.',
  CORRUPT_XML: 'XML không hợp lệ.',
  PASSWORD_REQUIRED: 'Tệp yêu cầu mật khẩu.',
  EXTERNAL_RESOURCE_UNAVAILABLE: 'Tài nguyên ngoài không khả dụng.',
  UNSUPPORTED_VISUAL: 'Nội dung hình ảnh chưa được hỗ trợ.',
  FORMULA_CACHE_MISSING: 'Thiếu giá trị công thức đã lưu.',
  STALE_EXTRACTION_GENERATION: 'Thế hệ trích xuất đã cũ.',
  HASH_MISMATCH: 'Checksum không khớp.',
  DATA_LOSS: 'Thiếu dữ liệu đầu vào.',
};
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function text(value: unknown, max = 1024): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    ![...value].some((c) => c.charCodeAt(0) < 32)
  );
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= workerBounds.units &&
    value.every((v) => text(v)) &&
    new Set(value).size === value.length
  );
}
function locator(value: unknown): boolean {
  if (!record(value)) return false;
  const box = (b: unknown) =>
    Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number' && Number.isFinite(v));
  const component = (v: unknown) =>
    record(v) &&
    exact(v, ['kind', 'index']) &&
    ['image', 'unsupported-visual', 'calculated-value', 'comment', 'external'].includes(String(v.kind)) &&
    integer(v.index, 1, 100000);
  const componentKeys = Object.hasOwn(value, 'component') ? ['component'] : [];
  switch (value.kind) {
    case 'text':
      return (
        exact(value, ['kind', 'byteStart', 'byteEnd', 'lineStart', 'lineEnd']) &&
        integer(value.byteStart) &&
        integer(value.byteEnd) &&
        value.byteEnd >= value.byteStart &&
        integer(value.lineStart, 1) &&
        integer(value.lineEnd, 1) &&
        value.lineEnd >= value.lineStart
      );
    case 'pdf':
      return (
        exact(value, ['kind', 'page', 'box', 'rotation']) &&
        integer(value.page, 1) &&
        box(value.box) &&
        integer(value.rotation, 0, 359)
      );
    case 'image':
      return (
        exact(value, [
          'kind',
          'width',
          'height',
          'box',
          ...(Object.hasOwn(value, 'transform') ? ['transform'] : []),
        ]) &&
        (!Object.hasOwn(value, 'transform') ||
          (record(value.transform) &&
            exact(value.transform, [
              'originalWidth',
              'originalHeight',
              'orientation',
              'normalizedWidth',
              'normalizedHeight',
              'rotation',
              'reflected',
            ]) &&
            integer(value.transform.originalWidth, 1, 40000000) &&
            integer(value.transform.originalHeight, 1, 40000000) &&
            value.transform.originalWidth * value.transform.originalHeight <= 40000000 &&
            integer(value.transform.orientation, 1, 8) &&
            value.transform.normalizedWidth === value.width &&
            value.transform.normalizedHeight === value.height &&
            value.width ===
              (value.transform.orientation >= 5
                ? value.transform.originalHeight
                : value.transform.originalWidth) &&
            value.height ===
              (value.transform.orientation >= 5
                ? value.transform.originalWidth
                : value.transform.originalHeight) &&
            value.transform.rotation === [0, 0, 0, 180, 180, 90, 90, 270, 270][value.transform.orientation] &&
            value.transform.reflected === [2, 4, 5, 7].includes(value.transform.orientation))) &&
        integer(value.width, 1) &&
        integer(value.height, 1) &&
        box(value.box)
      );
    case 'docx':
      return (
        exact(value, ['kind', 'part', 'paragraph', 'table', 'row', 'cell', ...componentKeys]) &&
        (!componentKeys.length || component(value.component)) &&
        text(value.part) &&
        integer(value.paragraph) &&
        ['table', 'row', 'cell'].every((k) => value[k] === null || integer(value[k]))
      );
    case 'sheet':
      return (
        exact(value, ['kind', 'part', 'sheet', 'range', 'hidden', ...componentKeys]) &&
        (!componentKeys.length || component(value.component)) &&
        text(value.part) &&
        text(value.sheet) &&
        text(value.range) &&
        typeof value.hidden === 'boolean'
      );
    case 'csv':
      return (
        exact(value, ['kind', 'rowStart', 'rowEnd', 'columnStart', 'columnEnd']) &&
        integer(value.rowStart, 1) &&
        integer(value.rowEnd, 1) &&
        value.rowEnd >= value.rowStart &&
        integer(value.columnStart, 1) &&
        integer(value.columnEnd, 1) &&
        value.columnEnd >= value.columnStart
      );
    default:
      return false;
  }
}
export function locatorKey(value: unknown): string {
  if (!record(value)) return '';
  const { component, transform: _transform, render: _render, ...origin } = value;
  // Pixel dimensions describe rendering; the normalized region identifies the
  // source component within the original already bound by WorkerResult.
  if (origin.kind === 'image') {
    delete origin.width;
    delete origin.height;
  }
  return (
    JSON.stringify(Object.fromEntries(Object.entries(origin).sort(([a], [b]) => a.localeCompare(b)))) +
    (record(component) ? `:${component.kind}:${component.index}` : ':default')
  );
}
export function validateWorkerInput(value: unknown): WorkerInput {
  if (
    !record(value) ||
    !exact(value, [
      'version',
      'jobId',
      'generation',
      'original',
      'mime',
      'inputName',
      'extractorVersion',
      'config',
    ]) ||
    value.version !== 1 ||
    !text(value.jobId) ||
    !uuid.test(value.jobId) ||
    !text(value.generation) ||
    !/^[1-9][0-9]{0,18}$/.test(value.generation) ||
    !text(value.mime, 255) ||
    value.inputName !== 'original' ||
    !text(value.extractorVersion, 512) ||
    !record(value.original) ||
    !exact(value.original, ['attachmentId', 'sha256', 'ownerId']) ||
    !text(value.original.attachmentId) ||
    !uuid.test(value.original.attachmentId) ||
    !text(value.original.sha256) ||
    !sha.test(value.original.sha256) ||
    value.original.ownerId !== 'owner' ||
    !record(value.config) ||
    !exact(value.config, ['policySha256', 'limits']) ||
    !text(value.config.policySha256) ||
    !sha.test(value.config.policySha256) ||
    !record(value.config.limits)
  )
    throw workerError('WORKER_INPUT_INVALID');
  const maxima: Record<string, number> = {
    maxExpandedBytes: 104857600,
    maxEntryBytes: 20971520,
    maxZipEntries: 2000,
    maxCompressionRatio: 100,
    maxXmlDepth: 64,
    maxTextNodeBytes: 1048576,
    maxTextBytes: 10485760,
    maxCsvRows: 100000,
    maxCsvColumns: 1000,
    maxCsvFieldBytes: 1048576,
    maxPdfPages: 200,
    pdfDpi: 144,
    maxPagePixels: 20000000,
    maxImagePixels: 40000000,
    maxOutputBytes: 104857600,
  };
  if (
    !exact(value.config.limits, Object.keys(maxima)) ||
    Object.entries(maxima).some(
      ([k, m]) => !integer((value.config as { limits: Record<string, unknown> }).limits?.[k], 1, m),
    )
  )
    throw workerError('WORKER_INPUT_INVALID');
  return JSON.parse(JSON.stringify(value)) as WorkerInput;
}
export function validateWorkerResult(input: WorkerInput, result: unknown): WorkerResult {
  validateWorkerInput(input);
  const fail = () => {
    throw workerError('WORKER_RESULT_INVALID');
  };
  if (record(result) && result.generation !== input.generation)
    throw workerError('STALE_EXTRACTION_GENERATION');
  if (
    !record(result) ||
    !exact(result, [
      'version',
      'jobId',
      'generation',
      'original',
      'extractorVersion',
      'configSha256',
      'status',
      'units',
      'files',
      'problems',
    ]) ||
    result.version !== 1 ||
    result.jobId !== input.jobId ||
    result.extractorVersion !== input.extractorVersion ||
    result.configSha256 !== input.config.policySha256 ||
    !record(result.original) ||
    !exact(result.original, ['attachmentId', 'sha256', 'ownerId']) ||
    result.original.attachmentId !== input.original.attachmentId ||
    result.original.sha256 !== input.original.sha256 ||
    result.original.ownerId !== 'owner' ||
    !['complete', 'partial', 'encrypted', 'corrupt', 'unsupported', 'blocked', 'failed'].includes(
      String(result.status),
    ) ||
    !Array.isArray(result.units) ||
    result.units.length > workerBounds.units ||
    !Array.isArray(result.files) ||
    result.files.length > workerBounds.files ||
    !Array.isArray(result.problems) ||
    result.problems.length > workerBounds.units
  )
    return fail();
  if (Buffer.byteLength(JSON.stringify(result)) > workerBounds.terminal) return fail();
  const units = new Map<string, { needs: unknown; state: unknown }>();
  const locators = new Set<string>();
  for (const unit of result.units) {
    if (
      !record(unit) ||
      !exact(unit, ['id', 'locator', 'needs', 'state', 'reason']) ||
      !text(unit.id) ||
      !locator(unit.locator) ||
      !['text', 'vision'].includes(String(unit.needs)) ||
      !['available', 'missing'].includes(String(unit.state)) ||
      (unit.state === 'available' ? unit.reason !== null : !text(unit.reason)) ||
      units.has(unit.id) ||
      locators.has(locatorKey(unit.locator))
    )
      return fail();
    units.set(unit.id, { needs: unit.needs, state: unit.state });
    locators.add(locatorKey(unit.locator));
  }
  let bytes = 0;
  const names = new Set<string>();
  const covered = new Set<string>();
  for (const file of result.files) {
    if (
      !record(file) ||
      !exact(file, ['relativeName', 'kind', 'mime', 'sha256', 'byteLength', 'unitIds']) ||
      !text(file.relativeName, 255) ||
      !name.test(file.relativeName) ||
      names.has(file.relativeName) ||
      !text(file.sha256) ||
      !sha.test(file.sha256) ||
      !integer(file.byteLength) ||
      !strings(file.unitIds) ||
      file.unitIds.length === 0 ||
      !(
        (file.kind === 'text' && file.mime === 'text/plain' && file.relativeName.endsWith('.txt')) ||
        (file.kind === 'image' && file.mime === 'image/png' && file.relativeName.endsWith('.png'))
      )
    )
      return fail();
    names.add(file.relativeName);
    bytes += file.byteLength;
    if (bytes > input.config.limits.maxOutputBytes || bytes > workerBounds.output) return fail();
    for (const id of file.unitIds) {
      const unit = units.get(id);
      if (unit?.state !== 'available' || unit.needs !== (file.kind === 'image' ? 'vision' : 'text'))
        return fail();
      covered.add(id);
    }
  }
  for (const [id, unit] of units) if (unit.state === 'available' && !covered.has(id)) return fail();
  if (
    result.status === 'complete' &&
    ([...units.values()].some((u) => u.state !== 'available') || result.problems.length > 0)
  )
    return fail();
  for (const problem of result.problems)
    if (
      !record(problem) ||
      !exact(problem, ['code', 'message', 'unitIds']) ||
      !text(problem.code, 64) ||
      !Object.hasOwn(problemCopy, problem.code) ||
      !text(problem.message, 512) ||
      !strings(problem.unitIds) ||
      problem.unitIds.some((id) => !units.has(id))
    )
      return fail();
  const safe = JSON.parse(JSON.stringify(result)) as WorkerResult;
  for (const problem of safe.problems)
    problem.message = problemCopy[problem.code] ?? 'Không thể trích xuất tệp.';
  return safe;
}
export type WorkerFrame =
  | { kind: 'file-start'; name: string; mime: string; bytes: number; sha256: string }
  | { kind: 'file-chunk'; name: string; base64: string }
  | { kind: 'file-end'; name: string }
  | { kind: 'result'; body: WorkerResult };
export async function writeFrame(output: Writable, frame: WorkerFrame): Promise<void> {
  const line = JSON.stringify(frame);
  const limit = frame.kind === 'result' ? workerBounds.terminal : workerBounds.line;
  if (
    Buffer.byteLength(line) > limit ||
    (frame.kind === 'file-chunk' && Buffer.from(frame.base64, 'base64').length > workerBounds.chunk)
  )
    throw workerError('WORKER_OUTPUT_LIMIT');
  await new Promise<void>((resolve, reject) =>
    output.write(`${line}\n`, (error) => (error ? reject(error) : resolve())),
  );
}
export async function readWorkerFrames(
  input: WorkerInput,
  stream: AsyncIterable<Uint8Array>,
  directory: string,
): Promise<WorkerResult> {
  validateWorkerInput(input);
  await noSymlinkComponents(directory, directory);
  const files = new Map<string, { bytes: number; sha256: string; mime: string }>();
  type Active = {
    name: string;
    fd: FileHandle;
    bytes: number;
    expected: number;
    expectedHash: string;
    mime: string;
    hash: ReturnType<typeof createHash>;
  };
  let active: Active | null = null;
  let result: WorkerResult | null = null;
  let pending = Buffer.alloc(0);
  let total = 0;
  let wire = 0;
  async function line(bytes: Buffer): Promise<void> {
    let frame: unknown;
    try {
      frame = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw workerError('WORKER_FRAME_INVALID');
    }
    if (!record(frame) || result) throw workerError('WORKER_FRAME_INVALID');
    if (frame.kind !== 'result' && bytes.length > workerBounds.line) throw workerError('WORKER_OUTPUT_LIMIT');
    switch (frame.kind) {
      case 'file-start': {
        if (
          active ||
          !exact(frame, ['kind', 'name', 'mime', 'bytes', 'sha256']) ||
          !text(frame.name, 255) ||
          !name.test(frame.name) ||
          files.has(frame.name) ||
          files.size >= workerBounds.files ||
          !integer(frame.bytes, 0, input.config.limits.maxOutputBytes) ||
          !text(frame.sha256) ||
          !sha.test(frame.sha256) ||
          !['text/plain', 'image/png'].includes(String(frame.mime))
        )
          throw workerError('WORKER_FRAME_INVALID');
        const fd = await open(
          join(directory, frame.name),
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        active = {
          name: frame.name,
          fd,
          bytes: 0,
          expected: frame.bytes,
          expectedHash: frame.sha256,
          mime: String(frame.mime),
          hash: createHash('sha256'),
        };
        break;
      }
      case 'file-chunk': {
        if (
          !active ||
          !exact(frame, ['kind', 'name', 'base64']) ||
          frame.name !== active.name ||
          typeof frame.base64 !== 'string' ||
          frame.base64.length > 87384 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.base64)
        )
          throw workerError('WORKER_FRAME_INVALID');
        const decoded = Buffer.from(frame.base64, 'base64');
        if (decoded.toString('base64') !== frame.base64 || decoded.length > workerBounds.chunk)
          throw workerError('WORKER_OUTPUT_LIMIT');
        active.bytes += decoded.length;
        total += decoded.length;
        if (
          active.bytes > active.expected ||
          total > input.config.limits.maxOutputBytes ||
          total > workerBounds.output
        )
          throw workerError('WORKER_OUTPUT_LIMIT');
        active.hash.update(decoded);
        await active.fd.writeFile(decoded);
        break;
      }
      case 'file-end': {
        if (!active || !exact(frame, ['kind', 'name']) || frame.name !== active.name)
          throw workerError('WORKER_FRAME_INVALID');
        const actual = active.hash.digest('hex');
        if (actual !== active.expectedHash || active.bytes !== active.expected)
          throw workerError('WORKER_FILE_MISMATCH');
        await active.fd.sync();
        await active.fd.close();
        files.set(active.name, { bytes: active.bytes, sha256: actual, mime: active.mime });
        active = null;
        break;
      }
      case 'result': {
        if (active || !exact(frame, ['kind', 'body'])) throw workerError('WORKER_FRAME_INVALID');
        result = validateWorkerResult(input, frame.body);
        if (result.files.length !== files.size) throw workerError('WORKER_FILE_MISMATCH');
        for (const file of result.files) {
          const saved = files.get(file.relativeName);
          if (
            !saved ||
            saved.bytes !== file.byteLength ||
            saved.sha256 !== file.sha256 ||
            saved.mime !== file.mime
          )
            throw workerError('WORKER_FILE_MISMATCH');
        }
        break;
      }
      default:
        throw workerError('WORKER_FRAME_INVALID');
    }
  }
  try {
    for await (const chunk of stream) {
      wire += chunk.length;
      if (wire > Math.ceil((workerBounds.output * 4) / 3) + workerBounds.terminal + workerBounds.files * 1024)
        throw workerError('WORKER_OUTPUT_LIMIT');
      pending = Buffer.concat([pending, chunk]);
      let end = pending.indexOf(10);
      while (end >= 0) {
        if (end > workerBounds.terminal) throw workerError('WORKER_OUTPUT_LIMIT');
        await line(pending.subarray(0, end));
        pending = pending.subarray(end + 1);
        end = pending.indexOf(10);
      }
      if (pending.length > workerBounds.terminal) throw workerError('WORKER_OUTPUT_LIMIT');
      if (
        pending.length > workerBounds.line &&
        !pending.subarray(0, 24).toString('utf8').startsWith('{"kind":"result","body":')
      )
        throw workerError('WORKER_OUTPUT_LIMIT');
    }
    if (active || pending.length || !result) throw workerError('WORKER_FRAME_TRUNCATED');
    await syncDirectory(directory);
    return result;
  } finally {
    const handle = active as Active | null;
    if (handle) await handle.fd.close();
  }
}
