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
  writeFileSync,
  writeSync,
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
  acquireLock,
  COMPANY_ID,
  deleteJevKey,
  FINGERPRINT_PATTERN,
  type JevCompanyConfig,
  jevKeychainService,
  keyFingerprint,
  LOG_LOCK_STALE_MS,
  LOG_LOCK_WAIT_MS,
  logLockPath,
  parseCompanyConfig,
  readJevConfig,
  readJevKey,
  releaseLock,
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
  /** Số dòng server báo đã loại (`rejected` trong response). */
  rejected: number;
}

export const EVENTS_MAX_LINES = 500;
export const EVENTS_MAX_BYTES = 256 * 1024;
/** Đã đẩy hết mà file lớn hơn mức này thì cắt về 0. */
export const LOG_TRUNCATE_BYTES = 5 * 1024 * 1024;
/** Mỗi lượt `status send` đẩy tối đa chừng này lô cho một đích; phần còn lại đợi lượt sau. */
const MAX_BATCHES = 64;
/** Trần cứng của `gate.log`: vượt thì giữ `LOG_KEEP_BYTES` cuối, bỏ dòng cũ nhất chưa đẩy của đích lỗi lâu. */
export const LOG_MAX_BYTES = 20 * 1024 * 1024;
export const LOG_KEEP_BYTES = 10 * 1024 * 1024;
/** Đọc log theo cửa sổ này, không nạp cả file. */
const READ_WINDOW_BYTES = 1024 * 1024;
/** Khóa đồng bộ cũ hơn mức này coi như của `status send` đã chết (một lượt tối đa vài chục lô × 10 giây). */
const SYNC_LOCK_STALE_MS = 15 * 60 * 1000;
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
    let response: Response;
    try {
      response = await signedPost(ctx, target, secret, 'pull', body, fetcher);
    } catch (error) {
      // 403 (máy bị gỡ) hay 404 (server chưa có route Jev, hoặc đã rollback): tắt Jev của company và xóa key.
      if (error instanceof SyncFailure && (error.code === 'http_403' || error.code === 'http_404'))
        await disableJevCompany(ctx, companyId);
      throw error;
    }
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

/** Đọc dòng hoàn chỉnh (kết thúc bằng `\n`) trong `[start, end)` theo cửa sổ 1 MiB, không nạp cả file vào RAM. */
function* logLines(path: string, start: number, end: number): Generator<{ text: string; next: number }> {
  const fd = openSync(path, 'r');
  try {
    let pos = start;
    let carry = Buffer.alloc(0);
    let carryStart = start;
    while (pos < end) {
      const length = Math.min(READ_WINDOW_BYTES, end - pos);
      const window = Buffer.alloc(length);
      const n = readSync(fd, window, 0, length, pos);
      if (n === 0) break;
      pos += n;
      const chunk = carry.length > 0 ? Buffer.concat([carry, window.subarray(0, n)]) : window.subarray(0, n);
      let at = 0;
      for (;;) {
        const nl = chunk.indexOf(0x0a, at);
        if (nl < 0) break;
        yield { text: chunk.subarray(at, nl).toString('utf8'), next: carryStart + nl + 1 };
        at = nl + 1;
      }
      carryStart += at;
      carry = Buffer.from(chunk.subarray(at));
    }
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

/** Số dòng server báo đã loại (sai schema), nếu response có trường `rejected`. */
async function rejectedCount(response: Response): Promise<number> {
  try {
    const value = (await response.json()) as { rejected?: unknown };
    return typeof value.rejected === 'number' && Number.isInteger(value.rejected) && value.rejected > 0
      ? value.rejected
      : 0;
  } catch {
    return 0;
  }
}

/**
 * Đẩy `gate.log` của company đích lên `/jev/machine/events`, từ con trỏ riêng của company trong `gate.cursor`. Mỗi lô
 * ≤ 500 dòng và body ≤ 256 KiB; chỉ tiến con trỏ khi server trả 2xx. Cả lượt giữ khóa đồng bộ (hai `status send`
 * chồng nhau thì lượt sau bỏ qua). Cuối lượt nén log (`compactGateLog`). Không bao giờ ném.
 */
export async function pushJevEvents(
  ctx: MacContext,
  target: StatusTarget,
  fetcher: typeof fetch = fetch,
): Promise<JevPushResult> {
  const paths = macPaths(ctx.home);
  const companyId = target.companyId.toLowerCase();
  let sent = 0;
  let rejected = 0;
  let size: number;
  try {
    size = statSync(paths.jevLog).size;
  } catch {
    return { ok: true, errorCode: null, sent, rejected };
  }
  const syncLock = `${paths.jevLog}.sync.lock`;
  if (!acquireLock(syncLock, 0, SYNC_LOCK_STALE_MS)) return { ok: true, errorCode: null, sent, rejected };
  try {
    const offsets = readOffsets(paths.jevCursor);
    let pos = offsets[companyId] ?? 0;
    if (pos > size) pos = 0;
    if (pos < size) {
      const { secret, machineId } = await targetSecret(ctx, target);
      const lines = logLines(paths.jevLog, pos, size);
      let pending = lines.next();
      for (let batch = 0; batch < MAX_BATCHES && !pending.done; batch++) {
        const prefix = JSON.stringify({
          version: 1,
          companyId: target.companyId,
          machineId,
          sentAt: ctx.now().toISOString(),
        }).slice(0, -1);
        const events: string[] = [];
        let bytes = Buffer.byteLength(`${prefix},"events":[]}`);
        let next = pos;
        while (!pending.done) {
          const { text, next: after } = pending.value;
          if (lineFor(text, companyId)) {
            const extra = Buffer.byteLength(text) + (events.length > 0 ? 1 : 0);
            if (events.length >= EVENTS_MAX_LINES || bytes + extra > EVENTS_MAX_BYTES) break;
            events.push(text);
            bytes += extra;
          }
          next = after;
          pending = lines.next();
        }
        if (events.length > 0) {
          const body = `${prefix},"events":[${events.join(',')}]}`;
          rejected += await rejectedCount(await signedPost(ctx, target, secret, 'events', body, fetcher));
          sent += events.length;
        }
        pos = next;
        offsets[companyId] = pos;
        writeOffsets(paths.jevCursor, offsets);
      }
      lines.return(undefined);
    }
    compactGateLog(ctx, paths, offsets);
    return { ok: true, errorCode: null, sent, rejected };
  } catch (error) {
    return {
      ok: false,
      errorCode: error instanceof SyncFailure ? error.code : 'local_io',
      sent,
      rejected,
    };
  } finally {
    releaseLock(syncLock);
  }
}

/** Dòng tổng kết khi bỏ dòng chưa đẩy của một company (cùng định dạng JSONL v1 của gate). */
function droppedLine(
  ctx: MacContext,
  companyId: string,
  count: number,
  mode: JevCompanyConfig['gateMode'],
): string {
  return JSON.stringify({
    v: 1,
    eventId: randomUUID(),
    ts: ctx.now().toISOString(),
    companyId,
    runId: null,
    agentId: null,
    cwd: null,
    mode,
    category: null,
    blocking: false,
    verdict: 'error',
    applied: 'allow',
    confidence: null,
    reason: `dropped:${count}`,
    errorCode: 'dropped',
    latencyMs: null,
    model: null,
    command: '',
  });
}

/**
 * Nén `gate.log`, trong khóa ghi của log (người ghi chờ, không ghi vào file cũ):
 * - con trỏ của mọi company có cấu hình Jev đã tới cuối và file > 5 MiB: cắt về 0;
 * - file > 20 MiB (một đích lỗi lâu): giữ 10 MiB cuối (hoặc từ con trỏ chậm nhất nếu gần hơn); company nào mất dòng
 *   chưa đẩy thì thêm một dòng `error/dropped` có `reason` = `dropped:<số dòng>`.
 * Phần giữ lại được chép sang file mới rồi `rename` đè; con trỏ trừ đi phần đã bỏ.
 */
export function compactGateLog(ctx: MacContext, paths: ReturnType<typeof macPaths>, offsets: Offsets): void {
  const jevCompanies = readJevConfig(paths.jevConfig)?.companies ?? {};
  const companies = Object.keys(jevCompanies);
  if (companies.length === 0) {
    for (const target of listTargets(ctx)) companies.push(target.companyId.toLowerCase());
  }
  let size: number;
  try {
    size = statSync(paths.jevLog).size;
  } catch {
    return;
  }
  if (size <= LOG_TRUNCATE_BYTES) return;
  const lock = logLockPath(paths.jevLog);
  if (!acquireLock(lock, LOG_LOCK_WAIT_MS, LOG_LOCK_STALE_MS)) return;
  const temp = `${paths.jevLog}.${randomUUID()}.tmp`;
  try {
    size = statSync(paths.jevLog).size;
    const slowest = Math.min(size, ...companies.map((id) => Math.min(offsets[id] ?? 0, size)));
    let cut: number;
    if (slowest >= size) cut = size;
    else if (size > LOG_MAX_BYTES) {
      cut = Math.max(slowest, size - LOG_KEEP_BYTES);
      if (cut > slowest) {
        // Cắt ở đầu dòng: bỏ tới hết dòng đang dở tại `cut`.
        const first = logLines(paths.jevLog, cut - 1, size).next();
        cut = first.done ? size : first.value.next;
      }
    } else return;
    const dropped: string[] = [];
    for (const id of companies) {
      const from = Math.min(offsets[id] ?? 0, size);
      if (from >= cut) continue;
      let count = 0;
      for (const { text } of logLines(paths.jevLog, from, cut)) if (lineFor(text, id)) count++;
      if (count > 0) dropped.push(droppedLine(ctx, id, count, jevCompanies[id]?.gateMode ?? 'shadow'));
    }
    const fd = openSync(temp, 'w', 0o600);
    try {
      const read = openSync(paths.jevLog, 'r');
      try {
        const buffer = Buffer.alloc(READ_WINDOW_BYTES);
        for (let pos = cut; pos < size; ) {
          const n = readSync(read, buffer, 0, Math.min(buffer.length, size - pos), pos);
          if (n === 0) break;
          writeSync(fd, buffer, 0, n);
          pos += n;
        }
      } finally {
        closeSync(read);
      }
      if (dropped.length > 0) writeSync(fd, `${dropped.join('\n')}\n`);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, paths.jevLog);
    const next: Offsets = {};
    for (const [id, value] of Object.entries(offsets)) next[id] = Math.max(0, Math.min(value, size) - cut);
    for (const key of Object.keys(offsets)) delete offsets[key];
    Object.assign(offsets, next);
    writeOffsets(paths.jevCursor, offsets);
  } finally {
    rmSync(temp, { force: true });
    releaseLock(lock);
  }
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
  let count = 0;
  for (const { text } of logLines(paths.jevLog, pos, size)) if (lineFor(text, wanted)) count++;
  return count;
}

/**
 * Nén `gate.log` một lần mỗi lượt `status send`, kể cả khi mọi đích đều lỗi (máy mất mạng lâu), để log không phình quá
 * trần. Lấy khóa đồng bộ; đang có lượt khác giữ thì bỏ qua. Không bao giờ ném.
 */
export function maintainGateLog(ctx: MacContext): void {
  const paths = macPaths(ctx.home);
  const syncLock = `${paths.jevLog}.sync.lock`;
  try {
    statSync(paths.jevLog);
  } catch {
    return;
  }
  if (!acquireLock(syncLock, 0, SYNC_LOCK_STALE_MS)) return;
  try {
    compactGateLog(ctx, paths, readOffsets(paths.jevCursor));
  } catch {
    // Lượt sau thử lại.
  } finally {
    releaseLock(syncLock);
  }
}

/**
 * Tắt Jev của company trên máy: `enabled:false` trong `config.json` (giữ các trường khác) và xóa key Keychain
 * `crew.jev.<cid>`. Dùng khi server báo máy bị gỡ (403) hay không có route Jev (404). Không bao giờ ném.
 */
export async function disableJevCompany(ctx: MacContext, companyId: string): Promise<void> {
  const paths = macPaths(ctx.home);
  const id = companyId.toLowerCase();
  try {
    const config = readJevConfig(paths.jevConfig);
    const entry = config?.companies[id];
    // Đã tắt và đã xóa key ở lượt trước thì thôi, không gọi `security` mỗi phút.
    if (!config || !entry || (!entry.enabled && entry.keyFingerprint === null)) return;
    config.companies[id] = { ...entry, enabled: false };
    writeJevConfig(paths.jevConfig, config);
    await deleteJevKey(ctx, id);
    config.companies[id] = { ...entry, enabled: false, keyFingerprint: null };
    writeJevConfig(paths.jevConfig, config);
  } catch {
    // Keychain hay file lỗi: lượt sau thử lại; cấu hình cũ vẫn bị trần 30 phút chặn.
  }
}

/**
 * Dọn company không còn là đích bản tin của máy (đích đã bị gỡ khỏi `status.json`): xóa mục trong `config.json` và key
 * Keychain của nó. Trả các company đã dọn. Không bao giờ ném.
 */
export async function pruneJevCompanies(
  ctx: MacContext,
  targets: readonly StatusTarget[],
): Promise<string[]> {
  const paths = macPaths(ctx.home);
  const keep = new Set(targets.map((t) => t.companyId.toLowerCase()));
  const config = readJevConfig(paths.jevConfig);
  if (!config) return [];
  const removed = Object.keys(config.companies).filter((id) => !keep.has(id));
  if (removed.length === 0) return [];
  for (const id of removed) {
    delete config.companies[id];
    try {
      await deleteJevKey(ctx, id);
    } catch {
      // Keychain lỗi: mục config đã gỡ nên gate không dùng key này nữa; uninstall vẫn dọn được.
    }
  }
  try {
    writeJevConfig(paths.jevConfig, config);
  } catch {
    return [];
  }
  return removed;
}
