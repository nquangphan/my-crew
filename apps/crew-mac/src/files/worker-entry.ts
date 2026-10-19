// Điểm vào của `dist/files-worker.cjs` (esbuild gom cả yauzl và saxes): process con chỉ đọc một file.
// stdin: một dòng JSON `WorkerRequest`; stdout: một dòng JSON `WorkerResponse`. Không bao giờ in thông điệp lỗi.
// Chữ trích được che credential NGAY trong process này, trước khi ghi ra đĩa: chữ chưa che không bao giờ chạm đĩa.
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MAX_FILE_BYTES } from './config.js';
import { type ExtractKind, extractOutputs, type Outputs } from './extract/output.js';
import { redactSecrets } from './redact.js';
import type { ExtractResult } from './run.js';
import type { CredentialFinding } from './types.js';

const MAX_REQUEST_BYTES = 64 * 1024;
/** Giữ stdout gọn (client giết worker khi stdout > 1 MB); mọi giá trị khớp vẫn bị che dù danh sách bị cắt. */
const MAX_FINDINGS = 1000;
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
  credentialFindings: [],
};

/** Che mọi file chữ và tên trong ghi chú. Phát hiện lấy theo số dòng của file chữ chứa nó. */
function redactOutputs(result: Outputs): { result: Outputs; findings: CredentialFinding[] } {
  const findings: CredentialFinding[] = [];
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  const outputs = result.outputs.map((file) => {
    if (file.kind !== 'text') return file;
    const redacted = redactSecrets(decoder.decode(file.bytes));
    if (redacted.findings.length === 0) return file;
    findings.push(...redacted.findings);
    return { ...file, bytes: Buffer.from(redacted.text, 'utf8') };
  });
  const notes = result.notes.map((n) =>
    n.name === undefined ? n : { ...n, name: redactSecrets(n.name).text },
  );
  return { result: { ...result, outputs, notes }, findings: findings.slice(0, MAX_FINDINGS) };
}

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
    const { result, findings } = redactOutputs(
      await extractOutputs(req.kind, readInput(req.input), req.filename),
    );
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
      credentialFindings: findings,
    };
  } catch {
    return FAILED;
  }
}

main().then(
  (response) => process.stdout.write(`${JSON.stringify(response)}\n`),
  () => process.stdout.write(`${JSON.stringify(FAILED)}\n`),
);
