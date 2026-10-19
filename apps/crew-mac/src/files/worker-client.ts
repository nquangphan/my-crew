import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKER_MAX_OLD_SPACE_MB, WORKER_TIMEOUT_MS } from './config.js';
import type { AttachmentPaths } from './paths.js';
import type { ExtractFn, ExtractRequest, ExtractResult } from './run.js';
import type { NoteCode } from './types.js';

/** Thư mục con trong `derived/<sha>/v<N>/` chứa bản trích; công bố một lần bằng `rename` cả thư mục. */
export const EXTRACT_DIR = 'extract';
const INFO_FILE = 'info.json';
const MAX_STDOUT_BYTES = 1024 * 1024;
const STATUSES = new Set(['complete', 'partial', 'encrypted', 'blocked', 'unsupported', 'corrupt', 'failed']);
const NOTE_CODES = new Set<NoteCode>([
  'sheet_an',
  'thieu_formula_cache',
  'vuot_gioi_han',
  'anh_nhung_bo_qua',
  'pdf_doc_theo_trang',
  'anh_da_thu_nho',
]);

const MAX_FINDINGS = 1000;
const failed = (): ExtractResult => ({
  status: 'failed',
  outputs: [],
  notes: [],
  problemCodes: [],
  credentialFindings: [],
});

export interface WorkerExtractOptions {
  /** Mặc định `dist/files-worker.cjs` cạnh bản build. */
  workerPath?: string;
  timeoutMs?: number;
  maxOldSpaceMb?: number;
}

export function defaultWorkerPath(): string {
  return fileURLToPath(new URL('../files-worker.cjs', import.meta.url));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Đường tương đối an toàn: không tuyệt đối, không `..`, không ký tự điều khiển. */
function safeRelative(path: string): boolean {
  const control = [...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '\\');
  if (!path || isAbsolute(path) || control) return false;
  const n = normalize(path);
  return n === path && !n.split(sep).some((part) => part === '..' || part === '.' || part === '');
}

/** Kiểm chặt phản hồi của worker: mọi thứ lạ đều coi như worker hỏng. */
function parseResponse(value: unknown, outDir: string): ExtractResult | null {
  if (!isRecord(value) || typeof value.status !== 'string' || !STATUSES.has(value.status)) return null;
  if (!Array.isArray(value.outputs) || !Array.isArray(value.notes) || !Array.isArray(value.problemCodes))
    return null;
  const outputs: ExtractResult['outputs'] = [];
  for (const o of value.outputs) {
    if (!isRecord(o) || typeof o.path !== 'string' || (o.kind !== 'text' && o.kind !== 'image')) return null;
    if (!safeRelative(o.path)) return null;
    try {
      if (!lstatSync(join(outDir, o.path)).isFile()) return null;
    } catch {
      return null;
    }
    outputs.push({ path: o.path, kind: o.kind });
  }
  const notes: ExtractResult['notes'] = [];
  for (const n of value.notes) {
    if (!isRecord(n) || !NOTE_CODES.has(n.code as NoteCode)) return null;
    if (n.count !== undefined && !(Number.isSafeInteger(n.count) && (n.count as number) >= 0)) return null;
    if (n.name !== undefined && (typeof n.name !== 'string' || n.name.length > 200)) return null;
    notes.push({
      code: n.code as NoteCode,
      ...(n.count !== undefined ? { count: n.count as number } : {}),
      ...(n.name !== undefined ? { name: n.name as string } : {}),
    });
  }
  const problemCodes: string[] = [];
  for (const c of value.problemCodes) {
    if (typeof c !== 'string' || !/^[A-Z_]{1,40}$/.test(c)) return null;
    problemCodes.push(c);
  }
  if (problemCodes.length > 50) return null;
  // Thiếu danh sách che (bundle cũ chưa che, bản trích cũ) thì coi như chữ chưa che: không dùng.
  if (!Array.isArray(value.credentialFindings) || value.credentialFindings.length > MAX_FINDINGS) return null;
  const credentialFindings: ExtractResult['credentialFindings'] = [];
  for (const f of value.credentialFindings) {
    if (!isRecord(f) || Object.keys(f).length !== 2) return null;
    if (typeof f.rule !== 'string' || !/^[a-z0-9-]{1,64}$/.test(f.rule)) return null;
    if (!Number.isSafeInteger(f.line) || (f.line as number) < 1) return null;
    credentialFindings.push({ rule: f.rule, line: f.line as number });
  }
  const status = value.status as ExtractResult['status'];
  if (status !== 'complete' && status !== 'partial' && outputs.length > 0) return null;
  return { status, outputs, notes, problemCodes, credentialFindings };
}

/** Thư mục chỉ gồm file thường và thư mục con (không symlink); quyền 0700/0600. */
function lockDown(dir: string): boolean {
  chmodSync(dir, 0o700);
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = lstatSync(path);
    if (st.isDirectory()) {
      if (!lockDown(path)) return false;
    } else if (st.isFile()) chmodSync(path, 0o600);
    else return false;
  }
  return true;
}

function withPrefix(result: ExtractResult): ExtractResult {
  return { ...result, outputs: result.outputs.map((o) => ({ ...o, path: `${EXTRACT_DIR}/${o.path}` })) };
}

function readPublished(dir: string): ExtractResult | null {
  try {
    const parsed = parseResponse(JSON.parse(readFileSync(join(dir, INFO_FILE), 'utf8')), dir);
    return parsed ? withPrefix(parsed) : null;
  } catch {
    return null;
  }
}

/** Bản đã công bố dùng lại được; có thư mục mà không hợp lệ (ví dụ bản trích cũ chưa che) thì xóa để trích lại. */
function reusePublished(dir: string): ExtractResult | null {
  const cached = readPublished(dir);
  if (!cached && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  return cached;
}

function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8' };
  // crew-mac chạy bằng runtime Electron (bản app mang theo) thì process con cũng phải chạy như node.
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

/** Chạy worker; trả stdout khi thoát 0 trong hạn, null khi quá hạn, thoát khác 0, hay in quá nhiều. */
function runWorker(
  workerPath: string,
  request: string,
  cwd: string,
  timeoutMs: number,
  maxOldSpaceMb: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    let killed = false;
    let settled = false;
    let stdout = '';
    let size = 0;
    const child = spawn(process.execPath, [`--max-old-space-size=${maxOldSpaceMb}`, workerPath], {
      cwd,
      env: childEnv(cwd),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    // Giết rồi chờ `close` (process đã được thu dọn) mới trả, để không còn process con nào sống sau lệnh.
    const kill = () => {
      killed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(kill, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_STDOUT_BYTES) kill();
      else if (!killed) stdout += chunk.toString('utf8');
    });
    // stderr của parser có thể chứa nội dung file: đọc bỏ, không log.
    child.stderr.resume();
    child.on('error', () => settle(null));
    child.on('close', (code) => settle(!killed && code === 0 ? stdout : null));
    child.stdin.on('error', () => {});
    child.stdin.end(`${request}\n`);
  });
}

/**
 * Trình trích DOCX/XLSX/CSV/text bằng process con `node --max-old-space-size=512 files-worker.cjs`, hạn 60 giây.
 * Worker che credential trước khi ghi (`redact.ts`, gom trong bundle) và trả `credentialFindings`. Kết quả ghi vào
 * thư mục tạm trong `derived/<sha>/v<N>/`, danh sách che lưu trong `info.json`, rồi `rename` thành `extract/` khi
 * xong; bản đã có thì dùng lại cùng danh sách che. Lỗi, quá hạn, phản hồi lạ, thiếu danh sách che hay thiếu bundle
 * đều thành `failed` (không ném, không chép text lỗi).
 */
export function createWorkerExtract(_p: AttachmentPaths, opts: WorkerExtractOptions = {}): ExtractFn {
  const workerPath = opts.workerPath ?? defaultWorkerPath();
  const timeoutMs = opts.timeoutMs ?? WORKER_TIMEOUT_MS;
  const maxOldSpaceMb = opts.maxOldSpaceMb ?? WORKER_MAX_OLD_SPACE_MB;
  return async (req: ExtractRequest) => {
    const published = join(req.outDir, EXTRACT_DIR);
    const cached = reusePublished(published);
    if (cached) return cached;
    if (!existsSync(workerPath)) return failed();

    mkdirSync(req.outDir, { recursive: true, mode: 0o700 });
    const staging = mkdtempSync(join(req.outDir, '.tmp-'));
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'crew-files-worker-')));
    try {
      const request = JSON.stringify({
        kind: req.kind,
        input: req.blobPath,
        outDir: staging,
        filename: req.filename,
      });
      const stdout = await runWorker(workerPath, request, cwd, timeoutMs, maxOldSpaceMb);
      if (stdout === null) return failed();
      let parsed: ExtractResult | null;
      try {
        parsed = parseResponse(JSON.parse(stdout.trim().split('\n').pop() ?? ''), staging);
      } catch {
        parsed = null;
      }
      if (!parsed || !lockDown(staging)) return failed();
      // Lỗi trình đọc có thể là tạm thời (máy bận): không lưu, lượt sau đọc lại.
      if (parsed.status === 'failed') return parsed;
      writeFileSync(join(staging, INFO_FILE), JSON.stringify(parsed), { mode: 0o600 });
      try {
        renameSync(staging, published);
      } catch {
        // Lượt chạy khác đã công bố trước: dùng bản đó, bỏ bản của mình.
        return readPublished(published) ?? failed();
      }
      return withPrefix(parsed);
    } finally {
      rmSync(staging, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  };
}
