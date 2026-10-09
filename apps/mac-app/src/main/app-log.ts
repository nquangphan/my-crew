import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AppLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  event: string;
  fields?: Record<string, unknown>;
}

/** Tên field mà giá trị không bao giờ vào log (token, cookie, secret, mã ghép cặp...). */
const SECRET_FIELD =
  /token|secret|password|passwd|cookie|authorization|pairing|^code$|otp|api[-_]?key|credential|private[-_]?key/i;
const REDACTED = '[đã ẩn]';
const MAX_STRING = 4_000;
const MAX_DEPTH = 4;

/** Dạng chuỗi credential phổ biến, quét cả dòng log sau khi đã ẩn theo tên field. */
const SECRET_PATTERNS: Array<[id: string, pattern: RegExp]> = [
  ['bearer', /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/g],
  ['github-fine-grained-token', /\bgithub_pat_[0-9A-Za-z_]{82}\b/g],
  ['anthropic-api-key', /\bsk-ant-(?:api03|admin01|oat01)-[A-Za-z0-9_-]{20,}/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['crew-machine-token', /\bcrew_mt_[A-Za-z0-9_-]{20,}/g],
  [
    'private-key',
    /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----|$)/g,
  ],
];

export function scrubLine(input: string): string {
  let text = input;
  for (const [id, pattern] of SECRET_PATTERNS) text = text.replace(pattern, `[đã ẩn: ${id}]`);
  // URL có mật khẩu: giữ user, ẩn phần mật khẩu.
  return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(@)/gi, '$1[đã ẩn: basic-auth-url]$2');
}

/** Bỏ giá trị field có tên nhạy cảm và cắt chuỗi dài. */
export function redactFields(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (cắt bớt)` : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactFields(item, depth + 1));
  if (value instanceof Error) return redactFields({ message: value.message, stack: value.stack }, depth);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_FIELD.test(key) ? REDACTED : redactFields(item, depth + 1),
    ]),
  );
}

/** `2026-10-09T12:30:15.123+07:00`: giờ Asia/Ho_Chi_Minh (UTC+7, không đổi giờ mùa hè), không phụ thuộc múi giờ máy. */
export function localTimestamp(date: Date): string {
  return `${new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, -1)}+07:00`;
}

/** Một dòng JSON: giờ, mức, nguồn, sự kiện, rồi các field đã ẩn; cả dòng được quét credential. */
export function formatEntry(entry: AppLogEntry, now: Date): string {
  const fields = redactFields(entry.fields ?? {}) as Record<string, unknown>;
  const { at: _at, level: _level, source: _source, event: _event, ...rest } = fields;
  const line = JSON.stringify({
    at: localTimestamp(now),
    level: entry.level,
    source: entry.source,
    event: entry.event,
    ...rest,
  });
  return scrubLine(line);
}

export interface AppLogOptions {
  /** Xoay khi file sẽ vượt cỡ này (mặc định 10 MB). */
  maxBytes?: number;
  now?: () => Date;
}

/**
 * `~/Library/Application Support/2P Crew/app.log`: JSON lines, chỉ Main process ghi, mode 600, xoay một bản
 * `app.log.1`. Ghi không bao giờ ném lỗi: ổ đĩa hỏng không được làm app sập.
 */
export class AppLog {
  private readonly maxBytes: number;
  private readonly now: () => Date;
  private secured = false;

  constructor(
    readonly file: string,
    options: AppLogOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
    this.now = options.now ?? (() => new Date());
  }

  write(entry: AppLogEntry): void {
    try {
      const line = `${formatEntry(entry, this.now())}\n`;
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      if (existsSync(this.file) && statSync(this.file).size + Buffer.byteLength(line) > this.maxBytes) {
        rmSync(`${this.file}.1`, { force: true });
        renameSync(this.file, `${this.file}.1`);
      }
      const created = !existsSync(this.file);
      appendFileSync(this.file, line, { mode: 0o600 });
      if (created || !this.secured) {
        chmodSync(this.file, 0o600);
        this.secured = true;
      }
    } catch (error) {
      process.stderr.write(`app log write failed: ${(error as Error).message}\n`);
    }
  }
}
