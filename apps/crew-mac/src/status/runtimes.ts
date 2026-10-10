import {
  closeSync,
  type Dirent,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { MacContext } from '../context.js';
import { agentShell, cliVersion, codexLoggedIn } from '../runtimes/command.js';
import { keychainKeyState } from '../runtimes/keychain.js';
import { runtimePaths } from '../runtimes/paths.js';

/** Khối `runtimes` của bản tin máy; null nghĩa là không đọc được (plugin coi như dùng được). */
export interface RuntimesReport {
  codex: {
    version: string | null;
    loggedIn: boolean | null;
    primaryUsedPct: number | null;
    resetsAt: string | null;
  };
  opencode: {
    version: string | null;
    keyPresent: boolean | null;
    costDay: number | null;
    costWeek: number | null;
    costMonth: number | null;
    models: string[];
  };
}

export const MAX_RUNTIME_MODELS = 60;
/** Mỗi lệnh phải chết trước hạn tổng của khối để không còn process mồ côi sau khi bản tin đã đi. */
const COMMAND_TIMEOUT_MS = 7_000;
/** Hạn tổng dựng khối `runtimes`: quá hạn thì trường chưa đo xong dùng giá trị cache, bản tin không bị trễ. */
export const RUNTIMES_BUDGET_MS = 8_000;
/** Số lệnh shell chạy cùng lúc; máy bận không bị 27 tiến trình opencode đè lên nhau. */
const MAX_CONCURRENT_COMMANDS = 4;
/** Giá trị đo gần nhất còn dùng được bao lâu khi lần đo mới không ra số. */
export const RUNTIMES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_VERSION = 50;
const MAX_MODEL_ID = 120;
const MAX_COST = 100_000;
/** Mỗi gốc session chỉ xét vài file mới nhất (thư mục `năm/tháng/ngày` sắp giảm dần), mỗi file chỉ đọc đuôi. */
const FILES_PER_ROOT = 30;
const FILES_READ = 10;
const TAIL_BYTES = 512 * 1024;
const MODEL_ID = /^opencode-go\/[a-z0-9._-]+$/;
/** Số thư mục dữ liệu agent OpenCode tối đa mà bản tin đọc thống kê (mỗi thư mục 3 lệnh, mỗi lệnh 10 giây). */
const MAX_OPENCODE_DATA_DIRS = 8;

async function shell(ctx: MacContext, command: string) {
  try {
    const result = await agentShell(ctx, command, COMMAND_TIMEOUT_MS);
    return result.timedOut ? { ...result, code: 124 } : result;
  } catch {
    return { code: 127, stdout: '', stderr: '', timedOut: false };
  }
}

async function safe<T>(value: Promise<T>, fallback: T): Promise<T> {
  try {
    return await value;
  } catch {
    return fallback;
  }
}

/**
 * Tổng `Cost` của mọi model `opencode-go/*` trong bảng `opencode stats --models`. Dòng `Cost` chỉ tính khi đứng sau
 * dòng tên model (phần tổng quan có `Total Cost` không thuộc model nào); model của provider khác bị bỏ.
 */
export function parseOpencodeCost(output: string): number | null {
  let provider: string | null = null;
  let total = 0;
  let seen = false;
  for (const raw of output.split('\n')) {
    const line = raw.replace(/[│┃|]/g, ' ').trim();
    const model = /^([a-z0-9._-]+)\/[A-Za-z0-9._/-]+$/.exec(line);
    if (model) {
      provider = model[1] ?? null;
      continue;
    }
    const cost = /^Cost\s+\$(\d+(?:\.\d+)?)$/.exec(line);
    if (cost && provider === 'opencode-go') {
      total += Number(cost[1]);
      seen = true;
    }
  }
  return seen && total >= 0 && total <= MAX_COST ? total : null;
}

/** Nhãn thư mục agent mà wrapper tạo (`PAPERCLIP_AGENT_ID` dạng uuid hoặc `shared`); tên khác bị bỏ qua. */
const OPENCODE_SLOT = /^[A-Za-z0-9._-]+$/;

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Thư mục `XDG_DATA_HOME` mà `crew-opencode-run` cấp cho từng agent (`~/.crew/runtimes/opencode/<agent>/data`). Chỉ lấy
 * thư mục đã có dữ liệu OpenCode, mới dùng gần nhất trước, tối đa `MAX_OPENCODE_DATA_DIRS` để số lệnh có giới hạn.
 */
export function opencodeAgentDataDirs(home: string): string[] {
  const root = join(runtimePaths(home).runtimesRoot, 'opencode');
  const found: { dir: string; mtime: number }[] = [];
  for (const entry of readDirs(root)) {
    if (!entry.isDirectory() || !OPENCODE_SLOT.test(entry.name)) continue;
    const dir = join(root, entry.name, 'data');
    try {
      found.push({ dir, mtime: statSync(join(dir, 'opencode')).mtimeMs });
    } catch {
      /* agent chưa chạy OpenCode lần nào */
    }
  }
  return found
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_OPENCODE_DATA_DIRS)
    .map((f) => f.dir);
}

/**
 * Tổng chi phí OpenCode Go trong `days` ngày: thư mục dữ liệu mặc định của owner cộng thư mục riêng của từng agent
 * (wrapper đặt `XDG_DATA_HOME` riêng nên `opencode stats` mặc định không thấy run của agent). Nơi nào lỗi hoặc chưa có
 * số thì bỏ qua; null khi không nơi nào có số.
 */
async function opencodeCost(ctx: MacContext, days: number, dataDirs: string[]): Promise<number | null> {
  const command = `opencode stats --days ${days} --models`;
  const results = await Promise.all([
    shell(ctx, command),
    ...dataDirs.map((dir) => shell(ctx, `XDG_DATA_HOME=${shQuote(dir)} ${command}`)),
  ]);
  const costs = results
    .map((r) => (r.code === 0 ? parseOpencodeCost(r.stdout) : null))
    .filter((c): c is number => c !== null);
  if (costs.length === 0) return null;
  const total = costs.reduce((a, b) => a + b, 0);
  return total <= MAX_COST ? total : null;
}

export function parseOpencodeModels(output: string): string[] {
  const seen = new Set<string>();
  for (const raw of output.split('\n')) {
    const id = raw.trim();
    if (id.length <= MAX_MODEL_ID && MODEL_ID.test(id)) seen.add(id);
    if (seen.size >= MAX_RUNTIME_MODELS) break;
  }
  return [...seen];
}

function readDirs(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Duyệt `sessions` theo tên giảm dần (năm/tháng/ngày/rollout-<giờ>) và dừng khi đủ `limit` file `.jsonl`. */
function recentJsonl(dir: string, limit: number, out: string[] = []): string[] {
  const entries = readDirs(dir).sort((a, b) => (a.name < b.name ? 1 : -1));
  for (const entry of entries) {
    if (out.length >= limit) break;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) recentJsonl(path, limit, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(path);
  }
  return out;
}

function tail(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

interface QuotaSample {
  at: number;
  usedPct: number;
  resetsAtSec: number;
}

/** Sự kiện `token_count` cuối của file có `rate_limits.primary` hợp lệ. */
function lastQuota(path: string): QuotaSample | null {
  let best: QuotaSample | null = null;
  for (const line of tail(path).split('\n')) {
    if (!line.includes('token_count')) continue;
    try {
      const event = JSON.parse(line) as {
        timestamp?: unknown;
        type?: unknown;
        payload?: {
          type?: unknown;
          rate_limits?: { primary?: { used_percent?: unknown; resets_at?: unknown } };
        };
      };
      const primary = event.payload?.rate_limits?.primary;
      if (event.type !== 'event_msg' || event.payload?.type !== 'token_count' || !primary) continue;
      const at = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : Number.NaN;
      const { used_percent: used, resets_at: resets } = primary;
      if (!Number.isFinite(at) || typeof used !== 'number' || typeof resets !== 'number') continue;
      if (!best || at >= best.at) best = { at, usedPct: used, resetsAtSec: resets };
    } catch {
      /* dòng cắt dở ở đầu đoạn đọc hoặc không phải JSON */
    }
  }
  return best;
}

/**
 * Quota Codex từ session của run qua wrapper (`~/.crew/runtimes/codex/<agent>/sessions`) và của owner
 * (`~/.codex/sessions`); lấy sự kiện mới nhất theo `timestamp`. Chỉ mở file session, không bao giờ mở `auth.json`.
 * Cửa sổ đã qua hạn thì số cũ không còn đúng nên trả null (chờ run kế ghi số mới).
 */
export function readCodexQuota(
  home: string,
  now: Date,
): { primaryUsedPct: number | null; resetsAt: string | null } {
  const none = { primaryUsedPct: null, resetsAt: null };
  try {
    const p = runtimePaths(home);
    const roots = [
      join(home, '.codex', 'sessions'),
      ...readDirs(join(p.runtimesRoot, 'codex'))
        .filter((d) => d.isDirectory())
        .map((d) => join(p.runtimesRoot, 'codex', d.name, 'sessions')),
    ];
    const files = roots
      .flatMap((root) => recentJsonl(root, FILES_PER_ROOT))
      .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, FILES_READ);
    let latest: QuotaSample | null = null;
    for (const file of files) {
      const sample = lastQuota(file.path);
      if (sample && (!latest || sample.at > latest.at)) latest = sample;
    }
    if (!latest) return none;
    const resetsMs = latest.resetsAtSec * 1000;
    if (!(latest.usedPct >= 0 && latest.usedPct <= 100) || !Number.isFinite(resetsMs)) return none;
    if (resetsMs <= now.getTime()) return none;
    return { primaryUsedPct: latest.usedPct, resetsAt: new Date(resetsMs).toISOString() };
  } catch {
    return none;
  }
}

type CacheKey =
  | 'codexVersion'
  | 'codexLoggedIn'
  | 'opencodeVersion'
  | 'keyPresent'
  | 'costDay'
  | 'costWeek'
  | 'costMonth'
  | 'models';
type CacheEntry = { v: unknown; at: number };
type StatusCache = Partial<Record<CacheKey, CacheEntry>>;

const CACHE_KEYS: CacheKey[] = [
  'codexVersion',
  'codexLoggedIn',
  'opencodeVersion',
  'keyPresent',
  'costDay',
  'costWeek',
  'costMonth',
  'models',
];

/** `~/.crew/runtimes/status-cache.json`: chỉ số đã đo (phiên bản, cờ, chi phí, id model), không chứa secret. */
export function runtimesCachePath(home: string): string {
  return join(runtimePaths(home).runtimesRoot, 'status-cache.json');
}

function validCached(key: CacheKey, v: unknown): boolean {
  switch (key) {
    case 'codexVersion':
    case 'opencodeVersion':
      return typeof v === 'string' && v.length <= MAX_VERSION;
    case 'codexLoggedIn':
    case 'keyPresent':
      return typeof v === 'boolean';
    case 'models':
      return (
        Array.isArray(v) &&
        v.length > 0 &&
        v.length <= MAX_RUNTIME_MODELS &&
        v.every((m) => typeof m === 'string' && MODEL_ID.test(m) && m.length <= MAX_MODEL_ID)
      );
    default:
      return typeof v === 'number' && v >= 0 && v <= MAX_COST;
  }
}

function readCache(home: string, nowMs: number): StatusCache {
  const out: StatusCache = {};
  try {
    const raw = JSON.parse(readFileSync(runtimesCachePath(home), 'utf8')) as Record<string, unknown>;
    for (const key of CACHE_KEYS) {
      const entry = raw[key] as CacheEntry | undefined;
      if (
        entry &&
        typeof entry.at === 'number' &&
        nowMs - entry.at >= 0 &&
        nowMs - entry.at <= RUNTIMES_CACHE_TTL_MS &&
        validCached(key, entry.v)
      )
        out[key] = { v: entry.v, at: entry.at };
    }
  } catch {
    /* chưa có cache hoặc hỏng: coi như rỗng */
  }
  return out;
}

function writeCache(home: string, cache: StatusCache): void {
  try {
    const path = runtimesCachePath(home);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    /* cache chỉ là tối ưu, ghi lỗi không được làm hỏng bản tin */
  }
}

/** Giới hạn số lệnh chạy cùng lúc; lệnh chưa bắt đầu khi quá hạn bị bỏ qua (coi như hết giờ). */
function gatedContext(ctx: MacContext, isExpired: () => boolean): MacContext {
  let running = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    running--;
    waiting.shift()?.();
  };
  return {
    ...ctx,
    runner: {
      async run(command, args, options) {
        if (running >= MAX_CONCURRENT_COMMANDS) await new Promise<void>((resolve) => waiting.push(resolve));
        running++;
        try {
          if (isExpired()) return { code: 124, stdout: '', stderr: '', timedOut: true };
          return await ctx.runner.run(command, args, options);
        } finally {
          release();
        }
      },
    },
  };
}

/**
 * Không bao giờ ném: mỗi lệnh lỗi, hết giờ hoặc thiếu CLI cho null/[] ở đúng trường của nó, và trường đó lấy giá trị
 * đo gần nhất trong cache (còn hạn). Lệnh chạy song song có giới hạn, cả khối có hạn tổng `budgetMs` nên không làm trễ
 * bản tin. OpenCode chưa có key vẫn trả `keyPresent: false`; `opencode stats` lỗi chỉ làm ba số chi phí null.
 */
export async function buildRuntimesReport(
  mac: MacContext,
  options: { budgetMs?: number } = {},
): Promise<RuntimesReport> {
  const budgetMs = options.budgetMs ?? RUNTIMES_BUDGET_MS;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve();
    }, budgetMs);
  });
  const within = <T>(value: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([safe(value, fallback), deadline.then(() => fallback)]);
  const ctx = gatedContext(mac, () => expired);
  try {
    const nowMs = mac.now().getTime();
    const cache = readCache(mac.home, nowMs);
    const [codexVersion, opencodeVersion, keyPresent] = await Promise.all([
      within(cliVersion(ctx, 'codex', COMMAND_TIMEOUT_MS), null),
      within(cliVersion(ctx, 'opencode', COMMAND_TIMEOUT_MS), null),
      within(keychainKeyState(ctx), null),
    ]);
    const codexKnown = codexVersion !== null || cache.codexVersion !== undefined;
    const opencodeKnown = opencodeVersion !== null || cache.opencodeVersion !== undefined;
    const dataDirs = opencodeKnown ? opencodeAgentDataDirs(mac.home) : [];
    const [loggedIn, costDay, costWeek, costMonth, modelsOut] = await Promise.all([
      codexKnown ? within(codexLoggedIn(ctx, COMMAND_TIMEOUT_MS), null) : null,
      opencodeKnown ? within(opencodeCost(ctx, 1, dataDirs), null) : null,
      opencodeKnown ? within(opencodeCost(ctx, 7, dataDirs), null) : null,
      opencodeKnown ? within(opencodeCost(ctx, 30, dataDirs), null) : null,
      opencodeKnown ? within(shell(ctx, 'opencode models opencode-go'), null) : null,
    ]);
    const measured: Record<CacheKey, unknown> = {
      codexVersion: codexVersion?.slice(0, MAX_VERSION) ?? null,
      codexLoggedIn: loggedIn,
      opencodeVersion: opencodeVersion?.slice(0, MAX_VERSION) ?? null,
      keyPresent,
      costDay,
      costWeek,
      costMonth,
      models: modelsOut && modelsOut.code === 0 ? parseOpencodeModels(modelsOut.stdout) : [],
    };
    const next: StatusCache = { ...cache };
    const pick = <T>(key: CacheKey, empty: T): T => {
      const value = measured[key];
      const isEmpty = value === null || (Array.isArray(value) && value.length === 0);
      if (!isEmpty) {
        next[key] = { v: value, at: nowMs };
        return value as T;
      }
      return (cache[key]?.v as T | undefined) ?? empty;
    };
    const report: RuntimesReport = {
      codex: {
        version: pick<string | null>('codexVersion', null),
        loggedIn: pick<boolean | null>('codexLoggedIn', null),
        ...readCodexQuota(mac.home, mac.now()),
      },
      opencode: {
        version: pick<string | null>('opencodeVersion', null),
        keyPresent: pick<boolean | null>('keyPresent', null),
        costDay: pick<number | null>('costDay', null),
        costWeek: pick<number | null>('costWeek', null),
        costMonth: pick<number | null>('costMonth', null),
        models: pick<string[]>('models', []),
      },
    };
    writeCache(mac.home, next);
    return report;
  } finally {
    clearTimeout(timer);
  }
}
