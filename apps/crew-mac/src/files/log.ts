import { chmodSync, closeSync, mkdirSync, openSync, renameSync, statSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { LOG_MAX_BYTES } from './config.js';
import type { AttachmentPaths } from './paths.js';
import type { FileStatus, ReasonCode } from './types.js';

export interface LogFields {
  now: Date;
  runId: string;
  attachmentId: string;
  sha256: string;
  bytes: number;
  status: FileStatus | 'cache_hit' | 'gc';
  reason: ReasonCode | null;
  note?: 'tai_bridge' | 'tai_ssh' | 'cache_hit' | 'gc';
}

const short = (value: string, length: number): string => value.replace(/[^0-9a-zA-Z-]/g, '').slice(0, length);

/**
 * Một dòng cố định: `<ISO> <runId8> <attachmentId8> <sha12> <bytes> <status> <reason|-> <note|->`.
 * Không bao giờ ghi nội dung file, tên file hay text lỗi bên ngoài. Lỗi ghi log không làm hỏng lệnh.
 */
export function logLine(p: AttachmentPaths, f: LogFields): void {
  const line = `${f.now.toISOString()} ${short(f.runId, 8)} ${short(f.attachmentId, 8)} ${short(f.sha256, 12)} ${Math.trunc(f.bytes)} ${f.status} ${f.reason ?? '-'} ${f.note ?? '-'}\n`;
  try {
    mkdirSync(dirname(p.log), { recursive: true, mode: 0o700 });
    try {
      if (statSync(p.log).size > LOG_MAX_BYTES) renameSync(p.log, `${p.log}.1`);
    } catch {
      // chưa có log
    }
    const fd = openSync(p.log, 'a', 0o600);
    try {
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
    chmodSync(p.log, 0o600);
  } catch {
    // log hỏng không được làm hỏng việc đọc file
  }
}

/** Lỗi nội bộ của lệnh: chỉ ghi tên lớp lỗi (chữ cái), không message vì message có thể chứa dữ liệu bên ngoài. */
export function logError(p: AttachmentPaths, now: Date, runId: string, error: unknown): void {
  const name =
    (error instanceof Error ? error.name : 'Error').replace(/[^A-Za-z]/g, '').slice(0, 40) || 'Error';
  const line = `${now.toISOString()} ${short(runId, 8)} - - 0 loi_noi_bo - ${name}\n`;
  try {
    mkdirSync(dirname(p.log), { recursive: true, mode: 0o700 });
    const fd = openSync(p.log, 'a', 0o600);
    try {
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
    chmodSync(p.log, 0o600);
  } catch {
    // log hỏng không được làm hỏng lệnh
  }
}
