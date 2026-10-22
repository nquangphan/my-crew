import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { redactSecrets } from 'jev-use';
import type { Category } from './classify.js';

export type GateVerdict = 'allow' | 'deny' | 'escalate' | 'error';
export type GateErrorCode = 'no_key' | 'timeout' | 'unreachable' | 'bad_response' | 'bad_event' | 'internal';

/** Một dòng `gate.log` (JSONL v1, một dòng một lệnh). Không bao giờ chứa key, env hay đầu ra của lệnh. */
export interface GateLogEntry {
  v: 1;
  eventId: string;
  ts: string;
  companyId: string;
  runId: string | null;
  agentId: string | null;
  cwd: string | null;
  mode: 'shadow' | 'enforce';
  category: Category | null;
  blocking: boolean;
  verdict: GateVerdict;
  applied: 'allow' | 'deny';
  confidence: number | null;
  reason: string | null;
  errorCode: GateErrorCode | null;
  latencyMs: number | null;
  model: string | null;
  command: string;
}

export type GateLogInput = Omit<GateLogEntry, 'v' | 'eventId' | 'ts'> & { at: Date };

export const COMMAND_MAX_CHARS = 2000;
const CWD_MAX_CHARS = 500;
/** Dưới PIPE_BUF (4 KiB): một lần `write` với O_APPEND không bị dòng của process khác chen vào. */
const LINE_MAX_BYTES = 4000;

/** Che credential bằng `redactSecrets` của jev-use (giống phần Jev nhận), rồi cắt 2000 ký tự. */
export function redactCommand(command: string): string {
  return redactSecrets(command).slice(0, COMMAND_MAX_CHARS);
}

/** Dựng dòng JSONL; lệnh dài (nhiều byte UTF-8 hay ký tự phải thoát) bị cắt tiếp cho tới khi cả dòng < 4000 byte. */
export function formatGateLine(input: GateLogInput, eventId: string = randomUUID()): string {
  // Thứ tự trường cố định như định dạng v1 để đọc log bằng mắt dễ hơn.
  const entry: GateLogEntry = {
    v: 1,
    eventId,
    ts: input.at.toISOString(),
    companyId: input.companyId,
    runId: input.runId,
    agentId: input.agentId,
    cwd: input.cwd === null ? null : input.cwd.slice(0, CWD_MAX_CHARS),
    mode: input.mode,
    category: input.category,
    blocking: input.blocking,
    verdict: input.verdict,
    applied: input.applied,
    confidence: input.confidence,
    reason: input.reason,
    errorCode: input.errorCode,
    latencyMs: input.latencyMs,
    model: input.model,
    command: redactCommand(input.command),
  };
  let line = JSON.stringify(entry);
  while (Buffer.byteLength(line, 'utf8') >= LINE_MAX_BYTES && entry.command.length > 0) {
    const over = Buffer.byteLength(line, 'utf8') - LINE_MAX_BYTES + 1;
    entry.command = entry.command.slice(0, Math.max(0, entry.command.length - Math.max(16, over)));
    line = JSON.stringify(entry);
  }
  return line;
}

/** Ghi một dòng vào `gate.log` (0600, thư mục 0700) bằng một lần append; trả dòng đã ghi (không có `\n`). */
export function appendGateLog(path: string, input: GateLogInput): string {
  const line = formatGateLine(input);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, `${line}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return line;
}
