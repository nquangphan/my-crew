import { createHash } from 'node:crypto';
import type { WorkerResult } from '../contracts.ts';
import type { WorkerInput } from '../worker-protocol.ts';
import { locatorKey, validateWorkerResult } from '../worker-protocol.ts';
import { ExtractError, type ExtractResult, missing } from './index.ts';
export function verifyExtraction(input: WorkerInput, result: ExtractResult): WorkerResult {
  let r = result;
  const base = () => ({
    version: 1 as const,
    jobId: input.jobId,
    generation: input.generation,
    original: input.original,
    extractorVersion: input.extractorVersion,
    configSha256: input.config.policySha256,
    status: r.status,
    units: r.units,
    files: r.files.map((f) => ({
      relativeName: f.relativeName,
      kind: f.kind,
      mime: f.mime,
      sha256: createHash('sha256').update(f.bytes).digest('hex'),
      byteLength: f.bytes.length,
      unitIds: f.unitIds,
    })),
    problems: r.problems,
  });
  if (r.units.length > 100000 || Buffer.byteLength(JSON.stringify(base())) > 8 * 1024 * 1024) {
    const first = r.units[0];
    const tail = first?.locator ? structuredClone(first.locator) : undefined;
    if (!tail) throw new ExtractError('LIMIT_EXCEEDED');
    const last = r.units.at(-1)?.locator;
    if (tail.kind === 'text' && last?.kind === 'text') {
      tail.byteEnd = last.byteEnd;
      tail.lineEnd = last.lineEnd;
    }
    if (tail.kind === 'csv' && last?.kind === 'csv') {
      tail.rowEnd = last.rowEnd;
      tail.columnEnd = Math.max(tail.columnEnd, last.columnEnd);
    }
    if (
      tail.kind === 'sheet' &&
      last?.kind === 'sheet' &&
      tail.sheet === last.sheet &&
      tail.part === last.part
    )
      tail.range = `${tail.range.split(':')[0]}:${last.range.split(':').at(-1)}`;
    r = { status: 'partial', units: [], files: [], problems: [] };
    missing(r, tail, first?.needs ?? 'text', 'LIMIT_EXCEEDED');
  }
  const locations = new Set<string>();
  for (const u of r.units) {
    const key = locatorKey(u.locator);
    if (locations.has(key)) throw new ExtractError('DATA_LOSS');
    locations.add(key);
    if (
      u.state === 'available' &&
      !r.files.some(
        (f) =>
          f.unitIds.includes(u.id) &&
          ((f.kind === 'text' && u.needs === 'text') || (f.kind === 'image' && u.needs === 'vision')),
      )
    )
      throw new ExtractError('DATA_LOSS');
  }
  if (r.files.reduce((n, f) => n + f.bytes.length, 0) > input.config.limits.maxOutputBytes)
    throw new ExtractError('LIMIT_EXCEEDED');
  return validateWorkerResult(input, base());
}
