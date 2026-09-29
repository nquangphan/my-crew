import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppLogEntry, scrubSecrets } from '@crew/shared';

/** Field names whose values never reach the log, whatever they hold (tokens, cookies, pairing codes, OTPs). */
const SECRET_FIELD =
  /token|secret|password|passwd|cookie|authorization|pairing|^code$|otp|api[-_]?key|credential|private[-_]?key/i;
const REDACTED = '[đã ẩn]';
const MAX_STRING = 4_000;
const MAX_DEPTH = 4;

/** Drops the values of secret-named fields and caps long strings; the whole line is scrubbed afterwards. */
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

/** `2026-09-29T10:08:14.729+07:00`: the machine's local time with its offset (the owner reads this file). */
export function localTimestamp(date: Date): string {
  const pad = (value: number, width = 2) => String(Math.abs(value)).padStart(width, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

/** One JSON line: time, level, source, event, then the redacted fields, scrubbed of credential patterns. */
export function formatEntry(entry: AppLogEntry, now: Date): string {
  const parsed = AppLogEntry.parse(entry);
  const {
    at: _at,
    level: _level,
    source: _source,
    event: _event,
    ...fields
  } = redactFields(parsed.fields) as Record<string, unknown>;
  const line = JSON.stringify({
    at: localTimestamp(now),
    level: parsed.level,
    source: parsed.source,
    event: parsed.event,
    ...fields,
  });
  return scrubSecrets(line).text;
}

export interface AppLogOptions {
  /** Rotate once the file would grow past this size (default 2 MB). */
  maxBytes?: number;
  /** Rotated files kept: `app.log.1` … `app.log.<backups>` (default 2). */
  backups?: number;
  now?: () => Date;
}

/**
 * `~/.crew/logs/app.log`: JSON lines written only by the Electron main process (the daemon host sends its
 * entries over its port), size-capped with a couple of rotated backups, mode 0600. The daemon's job activity
 * stays in `daemon.log`. Writing never throws: a failing disk must not break the app.
 */
export class AppLog {
  private readonly maxBytes: number;
  private readonly backups: number;
  private readonly now: () => Date;
  private secured = false;

  constructor(
    readonly file: string,
    options: AppLogOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
    this.backups = options.backups ?? 2;
    this.now = options.now ?? (() => new Date());
  }

  write(entry: AppLogEntry): void {
    try {
      const line = `${formatEntry(entry, this.now())}\n`;
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      if (existsSync(this.file) && statSync(this.file).size + Buffer.byteLength(line) > this.maxBytes) {
        this.rotate();
      }
      const created = !existsSync(this.file);
      appendFileSync(this.file, line, { mode: 0o600 });
      if (created || !this.secured) {
        // The mode of appendFileSync only applies to a new file; an older file may have looser bits.
        chmodSync(this.file, 0o600);
        this.secured = true;
      }
    } catch (error) {
      process.stderr.write(`app log write failed: ${(error as Error).message}\n`);
    }
  }

  private rotate(): void {
    rmSync(`${this.file}.${this.backups}`, { force: true });
    for (let index = this.backups - 1; index >= 1; index--) {
      if (existsSync(`${this.file}.${index}`))
        renameSync(`${this.file}.${index}`, `${this.file}.${index + 1}`);
    }
    if (this.backups > 0) renameSync(this.file, `${this.file}.1`);
    else rmSync(this.file, { force: true });
  }
}
