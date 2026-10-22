import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MacContext } from '../context.js';

/** Cấu hình Jev của một company, đúng như lần kéo gần nhất từ server. Không bao giờ chứa key. */
export interface JevCompanyConfig {
  version: number;
  enabled: boolean;
  gateMode: 'shadow' | 'enforce';
  model: string;
  threshold: number;
  timeoutMs: number;
  /** 12 hex đầu sha256 của key đang nằm trong Keychain; null khi chưa có key. */
  keyFingerprint: string | null;
  /** Lần kéo thành công gần nhất (ISO); doctor cảnh báo khi cũ hơn 10 phút. */
  pulledAt: string;
}

export interface JevConfig {
  companies: Record<string, JevCompanyConfig>;
}

export const COMPANY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MODEL_PATTERN = /^typesafe\/jev-[A-Za-z0-9._-]{1,64}$/;
export const FINGERPRINT_PATTERN = /^[0-9a-f]{12}$/;
export const THRESHOLD_RANGE = [0.3, 0.95] as const;
export const TIMEOUT_RANGE = [500, 3000] as const;
const SECURITY_BIN = '/usr/bin/security';

function inRange(value: unknown, [min, max]: readonly [number, number]): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Kiểm một mục cấu hình (từ file hay từ server); sai dạng thì null để gate coi như tắt. */
export function parseCompanyConfig(value: unknown): JevCompanyConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!Number.isInteger(v.version) || (v.version as number) < 0) return null;
  if (typeof v.enabled !== 'boolean') return null;
  if (v.gateMode !== 'shadow' && v.gateMode !== 'enforce') return null;
  if (typeof v.model !== 'string' || !MODEL_PATTERN.test(v.model)) return null;
  if (!inRange(v.threshold, THRESHOLD_RANGE)) return null;
  if (!inRange(v.timeoutMs, TIMEOUT_RANGE) || !Number.isInteger(v.timeoutMs)) return null;
  if (
    !(
      v.keyFingerprint === null ||
      (typeof v.keyFingerprint === 'string' && FINGERPRINT_PATTERN.test(v.keyFingerprint))
    )
  )
    return null;
  if (typeof v.pulledAt !== 'string' || Number.isNaN(Date.parse(v.pulledAt))) return null;
  return {
    version: v.version as number,
    enabled: v.enabled,
    gateMode: v.gateMode,
    model: v.model,
    threshold: v.threshold,
    timeoutMs: v.timeoutMs,
    keyFingerprint: v.keyFingerprint as string | null,
    pulledAt: v.pulledAt,
  };
}

/** Đọc `config.json`; không có file hay hỏng thì null. Mục company sai dạng bị bỏ. */
export function readJevConfig(path: string): JevConfig | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  const companies = (raw as { companies?: unknown } | null)?.companies;
  if (typeof companies !== 'object' || companies === null) return null;
  const result: JevConfig = { companies: {} };
  for (const [companyId, entry] of Object.entries(companies)) {
    const parsed = COMPANY_ID.test(companyId) ? parseCompanyConfig(entry) : null;
    if (parsed) result.companies[companyId.toLowerCase()] = parsed;
  }
  return result;
}

/** Ghi atomic, 0600 (thư mục 0700). */
export function writeJevConfig(path: string, config: JevConfig): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * Company của run: `PAPERCLIP_COMPANY_ID` nếu có trong cấu hình; không có biến thì lấy company duy nhất. Biến có mà
 * không khớp, hoặc nhiều company mà không có biến, thì null (gate không làm gì).
 */
export function selectCompany(
  config: JevConfig | null,
  env: NodeJS.ProcessEnv,
): { companyId: string; entry: JevCompanyConfig } | null {
  if (!config) return null;
  const wanted = env.PAPERCLIP_COMPANY_ID?.trim().toLowerCase();
  if (wanted) {
    const entry = config.companies[wanted];
    return entry ? { companyId: wanted, entry } : null;
  }
  const ids = Object.keys(config.companies);
  if (ids.length !== 1) return null;
  const companyId = ids[0] as string;
  return { companyId, entry: config.companies[companyId] as JevCompanyConfig };
}

export function jevKeychainService(companyId: string): string {
  return `crew.jev.${companyId.toLowerCase()}`;
}

export function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/** Key OpenRouter của company trong Keychain, hoặc null (không có, Keychain khóa, quá hạn). Không bao giờ ném. */
export async function readJevKey(
  ctx: MacContext,
  companyId: string,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const result = await ctx.runner.run(
      SECURITY_BIN,
      ['find-generic-password', '-s', jevKeychainService(companyId), '-w'],
      { timeoutMs },
    );
    const key = result.stdout.replace(/\r?\n$/, '');
    return result.code === 0 && key !== '' && !key.includes('\n') ? key : null;
  } catch {
    return null;
  }
}

/** Có mục Keychain của company không (không đọc key): true/false, null khi Keychain báo lỗi khác. */
export async function jevKeyPresent(ctx: MacContext, companyId: string): Promise<boolean | null> {
  const result = await ctx.runner.run(
    SECURITY_BIN,
    ['find-generic-password', '-s', jevKeychainService(companyId)],
    {
      timeoutMs: 10_000,
    },
  );
  if (result.code === 0) return true;
  if (result.code === 44) return false;
  return null;
}

/** Xóa key của company khỏi Keychain; không có mục (44) cũng coi là xong. */
export async function deleteJevKey(ctx: MacContext, companyId: string): Promise<void> {
  const result = await ctx.runner.run(
    SECURITY_BIN,
    ['delete-generic-password', '-s', jevKeychainService(companyId)],
    { timeoutMs: 10_000 },
  );
  if (result.code !== 0 && result.code !== 44) throw new Error('Không xóa được key Jev khỏi Keychain');
}

/** Biến của run mà `gate-bg` cần; chúng đi qua stdin, không qua env của tiến trình nền. */
export const RUN_ENV_KEYS = ['PAPERCLIP_COMPANY_ID', 'PAPERCLIP_RUN_ID', 'PAPERCLIP_AGENT_ID'] as const;

/**
 * Stdin của `jev gate-bg`: sự kiện hook nguyên văn cùng ba biến của run. Tiến trình nền chạy với env tối thiểu và cwd
 * `~/.crew/jev`, nên không mang dấu hiệu nào của run (`PAPERCLIP_RUN_ID`, cwd trong worktree) mà bộ kiểm process mồ
 * côi dựa vào.
 */
export function encodeBackgroundInput(eventJson: string, env: NodeJS.ProcessEnv): string {
  const runEnv: Record<string, string> = {};
  for (const key of RUN_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string') runEnv[key] = value;
  }
  return JSON.stringify({ v: 1, event: eventJson, env: runEnv });
}

/** Đọc lại stdin của `gate-bg`; sai dạng thì null (tiến trình nền thoát, không làm gì). */
export function decodeBackgroundInput(input: string): { eventJson: string; env: NodeJS.ProcessEnv } | null {
  try {
    const value = JSON.parse(input) as { v?: unknown; event?: unknown; env?: unknown };
    if (value.v !== 1 || typeof value.event !== 'string') return null;
    const env: NodeJS.ProcessEnv = {};
    if (typeof value.env === 'object' && value.env !== null)
      for (const key of RUN_ENV_KEYS) {
        const v = (value.env as Record<string, unknown>)[key];
        if (typeof v === 'string') env[key] = v;
      }
    return { eventJson: value.event, env };
  } catch {
    return null;
  }
}

/** Env tối thiểu của `gate-bg`: đủ để chạy `security`, `git` và gọi mạng; không có biến nào của run hay secret. */
export function backgroundEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of [
    'HOME',
    'PATH',
    'USER',
    'LOGNAME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS',
  ])
    if (typeof env[key] === 'string') out[key] = env[key];
  return out;
}

/**
 * Khóa liên tiến trình bằng `mkdir` (atomic). Chờ tối đa `waitMs`; khóa cũ hơn `staleMs` (tiến trình giữ khóa đã chết)
 * thì gỡ. Trả false khi không lấy được (người gọi tự quyết bỏ qua hay làm tiếp không khóa).
 */
export function acquireLock(path: string, waitMs: number, staleMs: number): boolean {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(path, { mode: 0o700 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return false;
    }
    try {
      if (Date.now() - statSync(path).mtimeMs > staleMs) {
        rmSync(path, { recursive: true, force: true });
        continue;
      }
    } catch {
      continue;
    }
    if (Date.now() >= deadline) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}

export function releaseLock(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/** Khóa ghi `gate.log`: người ghi giữ trong một lần append; bước nén log giữ trong lúc chép và đổi file. */
export const logLockPath = (logPath: string) => `${logPath}.lock`;
/** Người ghi chờ khóa tối đa chừng này rồi ghi luôn (không bao giờ bỏ dòng). */
export const LOG_LOCK_WAIT_MS = 300;
export const LOG_LOCK_STALE_MS = 5000;
