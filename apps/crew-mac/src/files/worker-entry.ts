// Điểm vào của `dist/files-worker.cjs` (esbuild gom cả yauzl và saxes): process con chỉ đọc một file.
// stdin: một dòng JSON `WorkerRequest`; stdout: một dòng JSON `WorkerResponse`. Không bao giờ in thông điệp lỗi.
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MAX_FILE_BYTES } from './config.js';
import { type ExtractKind, extractOutputs } from './extract/output.js';
import type { ExtractResult } from './run.js';

const MAX_REQUEST_BYTES = 64 * 1024;
const KINDS: readonly ExtractKind[] = ['text', 'csv', 'docx', 'xlsx'];

export interface WorkerRequest {
  kind: ExtractKind;
  input: string;
  outDir: string;
  filename: string;
}
export type WorkerResponse = ExtractResult;

const FAILED: WorkerResponse = {
  status: 'failed',
  outputs: [],
  notes: [],
  problemCodes: ['EXTRACTOR_FAILED'],
};

async function readRequest(): Promise<WorkerRequest> {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += String(chunk);
    if (raw.length > MAX_REQUEST_BYTES) throw new Error('request');
  }
  const value: unknown = JSON.parse(raw.split('\n')[0] ?? '');
  if (typeof value !== 'object' || value === null) throw new Error('request');
  const r = value as Record<string, unknown>;
  if (
    !KINDS.includes(r.kind as ExtractKind) ||
    typeof r.input !== 'string' ||
    typeof r.outDir !== 'string' ||
    typeof r.filename !== 'string'
  )
    throw new Error('request');
  return { kind: r.kind as ExtractKind, input: r.input, outDir: r.outDir, filename: r.filename };
}

function readInput(path: string): Buffer {
  const fd = openSync(path, 'r');
  try {
    if (fstatSync(fd).size > MAX_FILE_BYTES) throw new Error('input');
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

async function main(): Promise<WorkerResponse> {
  try {
    const req = await readRequest();
    const result = await extractOutputs(req.kind, readInput(req.input), req.filename);
    for (const file of result.outputs) {
      const target = join(req.outDir, file.path);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, file.bytes, { mode: 0o600, flag: 'wx' });
    }
    return {
      status: result.status,
      outputs: result.outputs.map(({ path, kind }) => ({ path, kind })),
      notes: result.notes,
      problemCodes: result.problemCodes,
    };
  } catch {
    return FAILED;
  }
}

main().then(
  (response) => process.stdout.write(`${JSON.stringify(response)}\n`),
  () => process.stdout.write(`${JSON.stringify(FAILED)}\n`),
);
