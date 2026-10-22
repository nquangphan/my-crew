import { randomUUID } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { readStatusConfig } from '../commands/status.js';
import type { MacContext } from '../context.js';
import { macPaths } from '../paths.js';
import { signCrewBody } from '../status/sign.js';
import {
  listTargets,
  readKeychainSecret,
  type StatusTarget,
  writeKeychainSecret,
} from '../status/targets.js';
import {
  COMPANY_ID,
  deleteJevKey,
  FINGERPRINT_PATTERN,
  type JevCompanyConfig,
  jevKeychainService,
  keyFingerprint,
  parseCompanyConfig,
  readJevConfig,
  readJevKey,
  writeJevConfig,
} from './config.js';

/** Mã lỗi một dòng cho `status send`; không bao giờ chứa secret, URL hay message của server. */
export type JevSyncError =
  | 'no_machine'
  | 'keychain'
  | 'network'
  | `http_${number}`
  | 'bad_response'
  | 'keychain_write'
  | 'local_io';

export interface JevSyncResult {
  ok: boolean;
  errorCode: JevSyncError | null;
}

export interface JevPushResult extends JevSyncResult {
  /** Số dòng đã được server nhận (2xx) trong lượt này. */
  sent: number;
}

export const EVENTS_MAX_LINES = 500;
export const EVENTS_MAX_BYTES = 256 * 1024;
/** Đã đẩy hết mà file lớn hơn mức này thì cắt về 0. */
export const LOG_TRUNCATE_BYTES = 5 * 1024 * 1024;
/** Mỗi lượt `status send` đẩy tối đa chừng này lô cho một đích; phần còn lại đợi lượt sau. */
const MAX_BATCHES = 64;
const REQUEST_TIMEOUT_MS = 10_000;
const API_KEY_MIN = 20;
const API_KEY_MAX = 200;

class SyncFailure extends Error {
  constructor(readonly code: JevSyncError) {
    super(code);
  }
}

function jevUrl(target: StatusTarget, path: 'pull' | 'events'): string {
  return `${target.url}/api/crew/companies/${target.companyId}/jev/machine/${path}`;
}

async function signedPost(
  ctx: MacContext,
  target: StatusTarget,
  secret: string,
  path: 'pull' | 'events',
  body: string,
  fetcher: typeof fetch,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(jevUrl(target, path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signCrewBody(body, secret, Math.floor(ctx.now().getTime() / 1000)),
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SyncFailure('network');
  }
  if (response.status < 200 || response.status >= 300) throw new SyncFailure(`http_${response.status}`);
  return response;
}

async function targetSecret(
  ctx: MacContext,
  target: StatusTarget,
): Promise<{ secret: string; machineId: string }> {
  const machineId = readStatusConfig(ctx)?.machineId;
  if (!machineId || !COMPANY_ID.test(machineId)) throw new SyncFailure('no_machine');
  const read = await readKeychainSecret(ctx, target.keychainService);
  if (!read.ok) throw new SyncFailure('keychain');
  return { secret: read.secret, machineId };
}

interface PullResponse {
  config: Omit<JevCompanyConfig, 'keyFingerprint' | 'pulledAt'>;
  hasKey: boolean;
  apiKey: string | null;
}

function parsePullResponse(value: unknown): PullResponse | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.hasKey !== 'boolean') return null;
  if (!(v.keyFingerprint === undefined || v.keyFingerprint === null || typeof v.keyFingerprint === 'string'))
    return null;
  const config = parseCompanyConfig({ ...v, keyFingerprint: null, pulledAt: new Date(0).toISOString() });
  if (!config) return null;
  let apiKey: string | null = null;
  if (v.apiKey !== undefined && v.apiKey !== null) {
    if (typeof v.apiKey !== 'string') return null;
    const key = v.apiKey;
    if (key.length < API_KEY_MIN || key.length > API_KEY_MAX || /[\r\n]/.test(key)) return null;
    apiKey = key;
  }
  const { keyFingerprint: _k, pulledAt: _p, ...rest } = config;
  return { config: rest, hasKey: v.hasKey, apiKey };
}

/**
 * Kéo cấu hình Jev của một đích: POST ký HMAC (secret Keychain của đích) tới `/jev/machine/pull`, rồi ghi
 * `config.json`. Server chỉ kèm `apiKey` khi vân tay Mac gửi lên khác vân tay server; key đi thẳng vào Keychain
 * `crew.jev.<companyId>` qua stdin của `security -i`. `hasKey:false` thì xóa mục Keychain. Không bao giờ ném.
 */
export async function pullJevConfig(
  ctx: MacContext,
  target: StatusTarget,
  fetcher: typeof fetch = fetch,
): Promise<JevSyncResult> {
  const paths = macPaths(ctx.home);
  const companyId = target.companyId.toLowerCase();
  try {
    const { secret, machineId } = await targetSecret(ctx, target);
    const localKey = await readJevKey(ctx, companyId, 10_000);
    let fingerprint = localKey === null ? null : keyFingerprint(localKey);
    const current = readJevConfig(paths.jevConfig);
    const body = JSON.stringify({
      version: 1,
      companyId: target.companyId,
      machineId,
      sentAt: ctx.now().toISOString(),
      appliedVersion: current?.companies[companyId]?.version ?? 0,
      keyFingerprint: fingerprint,
    });
    const response = await signedPost(ctx, target, secret, 'pull', body, fetcher);
    let parsed: PullResponse | null;
    try {
      parsed = parsePullResponse(await response.json());
    } catch {
      parsed = null;
    }
    if (!parsed) throw new SyncFailure('bad_response');
    if (parsed.apiKey !== null) {
      try {
        await writeKeychainSecret(ctx, jevKeychainService(companyId), parsed.apiKey);
      } catch {
        throw new SyncFailure('keychain_write');
      }
      fingerprint = keyFingerprint(parsed.apiKey);
    } else if (!parsed.hasKey && fingerprint !== null) {
      try {
        await deleteJevKey(ctx, companyId);
      } catch {
        throw new SyncFailure('keychain_write');
      }
      fingerprint = null;
    }
    if (fingerprint !== null && !FINGERPRINT_PATTERN.test(fingerprint)) fingerprint = null;
    try {
      const latest = readJevConfig(paths.jevConfig) ?? { companies: {} };
      latest.companies[companyId] = {
        ...parsed.config,
        keyFingerprint: fingerprint,
        pulledAt: ctx.now().toISOString(),
      };
      writeJevConfig(paths.jevConfig, latest);
    } catch {
      throw new SyncFailure('local_io');
    }
    return { ok: true, errorCode: null };
  } catch (error) {
    return { ok: false, errorCode: error instanceof SyncFailure ? error.code : 'local_io' };
  }
}

type Offsets = Record<string, number>;

function readOffsets(path: string): Offsets {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { offsets?: unknown };
    const offsets: Offsets = {};
    if (typeof raw.offsets === 'object' && raw.offsets !== null)
      for (const [id, value] of Object.entries(raw.offsets))
        if (COMPANY_ID.test(id) && Number.isSafeInteger(value) && (value as number) >= 0)
          offsets[id.toLowerCase()] = value as number;
    return offsets;
  } catch {
    return {};
  }
}

function writeOffsets(path: string, offsets: Offsets): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify({ v: 1, offsets })}\n`, { mode: 0o600 });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

function readFrom(path: string, offset: number, size: number): Buffer {
  const length = size - offset;
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buffer, read, length - read, offset + read);
      if (n === 0) break;
      read += n;
    }
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** Dòng log của company này (JSON object hợp lệ có `companyId` khớp); dòng khác hay hỏng thì bỏ qua. */
function lineFor(text: string, companyId: string): boolean {
  try {
    const value = JSON.parse(text) as { companyId?: unknown } | null;
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof value.companyId === 'string' &&
      value.companyId.toLowerCase() === companyId
    );
  } catch {
    return false;
  }
}

/**
 * Đẩy `gate.log` của company đích lên `/jev/machine/events`, từ con trỏ riêng của company trong `gate.cursor`. Mỗi lô
 * ≤ 500 dòng và body ≤ 256 KiB; chỉ tiến con trỏ khi server trả 2xx. Đẩy hết mà file > 5 MiB và mọi đích đã đẩy hết
 * thì cắt file về 0. Không bao giờ ném.
 */
export async function pushJevEvents(
  ctx: MacContext,
  target: StatusTarget,
  fetcher: typeof fetch = fetch,
): Promise<JevPushResult> {
  const paths = macPaths(ctx.home);
  const companyId = target.companyId.toLowerCase();
  let sent = 0;
  try {
    let size: number;
    try {
      size = statSync(paths.jevLog).size;
    } catch {
      return { ok: true, errorCode: null, sent };
    }
    const offsets = readOffsets(paths.jevCursor);
    let pos = offsets[companyId] ?? 0;
    if (pos > size) pos = 0;
    if (pos === size) {
      truncateIfDrained(ctx, paths, size, offsets);
      return { ok: true, errorCode: null, sent };
    }
    const { secret, machineId } = await targetSecret(ctx, target);
    const chunk = readFrom(paths.jevLog, pos, size);
    let at = 0;
    for (let batch = 0; batch < MAX_BATCHES && at < chunk.length; batch++) {
      const prefix = JSON.stringify({
        version: 1,
        companyId: target.companyId,
        machineId,
        sentAt: ctx.now().toISOString(),
      }).slice(0, -1);
      const lines: string[] = [];
      let bytes = Buffer.byteLength(`${prefix},"events":[]}`);
      let next = at;
      while (next < chunk.length) {
        const end = chunk.indexOf(0x0a, next);
        if (end < 0) break; // dòng đang ghi dở: để lượt sau
        const text = chunk.subarray(next, end).toString('utf8');
        if (lineFor(text, companyId)) {
          const extra = Buffer.byteLength(text) + (lines.length > 0 ? 1 : 0);
          if (lines.length >= EVENTS_MAX_LINES || bytes + extra > EVENTS_MAX_BYTES) break;
          lines.push(text);
          bytes += extra;
        }
        next = end + 1;
      }
      if (next === at) break;
      if (lines.length > 0) {
        const body = `${prefix},"events":[${lines.join(',')}]}`;
        await signedPost(ctx, target, secret, 'events', body, fetcher);
        sent += lines.length;
      }
      at = next;
      offsets[companyId] = pos + at;
      writeOffsets(paths.jevCursor, offsets);
    }
    if (pos + at === size) truncateIfDrained(ctx, paths, size, offsets);
    return { ok: true, errorCode: null, sent };
  } catch (error) {
    return { ok: false, errorCode: error instanceof SyncFailure ? error.code : 'local_io', sent };
  }
}

/** Cắt `gate.log` khi > 5 MiB và con trỏ của mọi đích đã tới cuối file (file không lớn thêm từ lúc đọc). */
function truncateIfDrained(
  ctx: MacContext,
  paths: ReturnType<typeof macPaths>,
  size: number,
  offsets: Offsets,
): void {
  if (size <= LOG_TRUNCATE_BYTES) return;
  const companies = listTargets(ctx).map((t) => t.companyId.toLowerCase());
  if (!companies.every((id) => (offsets[id] ?? 0) >= size)) return;
  if (statSync(paths.jevLog).size !== size) return;
  truncateSync(paths.jevLog, 0);
  writeOffsets(paths.jevCursor, {});
}

/** Số dòng của company còn nằm sau con trỏ (chưa đẩy lên server), cho `crew-mac jev status`. */
export function pendingJevEvents(ctx: MacContext, companyId: string): number {
  const paths = macPaths(ctx.home);
  const wanted = companyId.toLowerCase();
  let size: number;
  try {
    size = statSync(paths.jevLog).size;
  } catch {
    return 0;
  }
  let pos = readOffsets(paths.jevCursor)[wanted] ?? 0;
  if (pos > size) pos = 0;
  return readFrom(paths.jevLog, pos, size)
    .toString('utf8')
    .split('\n')
    .filter((line, i, all) => i < all.length - 1 && lineFor(line, wanted)).length;
}
