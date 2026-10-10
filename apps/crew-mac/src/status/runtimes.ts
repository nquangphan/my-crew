import { closeSync, type Dirent, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
const COMMAND_TIMEOUT_MS = 10_000;
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

/**
 * Không bao giờ ném: mỗi lệnh lỗi, hết giờ hoặc thiếu CLI cho null/[] ở đúng trường của nó. OpenCode chưa có key vẫn
 * trả `keyPresent: false`; `opencode stats` lỗi chỉ làm ba số chi phí null.
 */
export async function buildRuntimesReport(ctx: MacContext): Promise<RuntimesReport> {
  const [codexVersion, opencodeVersion, keyPresent] = await Promise.all([
    safe(cliVersion(ctx, 'codex', COMMAND_TIMEOUT_MS), null),
    safe(cliVersion(ctx, 'opencode', COMMAND_TIMEOUT_MS), null),
    safe(keychainKeyState(ctx), null),
  ]);
  const dataDirs = opencodeVersion === null ? [] : opencodeAgentDataDirs(ctx.home);
  const [loggedIn, costDay, costWeek, costMonth, modelsOut] = await Promise.all([
    codexVersion === null ? null : safe(codexLoggedIn(ctx, COMMAND_TIMEOUT_MS), null),
    opencodeVersion === null ? null : opencodeCost(ctx, 1, dataDirs),
    opencodeVersion === null ? null : opencodeCost(ctx, 7, dataDirs),
    opencodeVersion === null ? null : opencodeCost(ctx, 30, dataDirs),
    opencodeVersion === null ? null : shell(ctx, 'opencode models opencode-go'),
  ]);
  const quota = readCodexQuota(ctx.home, ctx.now());
  return {
    codex: {
      version: codexVersion?.slice(0, MAX_VERSION) ?? null,
      loggedIn,
      ...quota,
    },
    opencode: {
      version: opencodeVersion?.slice(0, MAX_VERSION) ?? null,
      keyPresent,
      costDay,
      costWeek,
      costMonth,
      models: modelsOut && modelsOut.code === 0 ? parseOpencodeModels(modelsOut.stdout) : [],
    },
  };
}
