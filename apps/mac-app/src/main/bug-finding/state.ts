import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BugFindingPaths } from './paths.js';
import type { BugFindingRelayView } from './results.js';
import { type CrewProject, savedProjects } from './sync-projects.js';

/**
 * Trạng thái app Bug Finding cho màn hình Bug Finding, chỉ đọc file cầu nối (`heartbeat.json`, `requests/`,
 * `responses/`, `projects.json`) và hỏi tiến trình đang chạy; không ghi gì.
 */

/** Heartbeat cũ hơn ngưỡng này (Bug Finding ghi mỗi 15 giây) thì coi như app không chạy. */
export const HEARTBEAT_STALE_SEC = 60;
/** Số lượt Crew xếp hiện trên màn hình. */
const MAX_REQUESTS = 50;
/**
 * Mỗi thư mục `requests/`, `responses/` chỉ parse chừng này file mới nhất (theo mtime): hai thư mục lớn dần theo lịch
 * sử review, đọc hết mỗi lần làm Main chậm dần.
 */
const MAX_FILES_PER_DIR = MAX_REQUESTS * 2;

export type BugFindingRequestState = 'pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface BugFindingRequestRow {
  requestId: string;
  identifier: string | null;
  prNumber: number | null;
  run: number | null;
  /** `pending`: Crew đã ghi yêu cầu, Bug Finding chưa phản hồi. */
  state: BugFindingRequestState;
  lanesDone: number | null;
  lanesTotal: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  verdict: string | null;
  error: string | null;
}

export interface BugFindingView {
  installed: boolean;
  version: string | null;
  running: boolean;
  pid: number | null;
  /** Tuổi heartbeat (giây); `null` khi chưa có heartbeat. */
  heartbeatAgeSec: number | null;
  runningReviews: number;
  waitingReviews: number;
  /** Bản cài riêng cũ ở `/Applications`, `null` khi không còn. */
  standaloneApp: { path: string; running: boolean } | null;
  /** Bundle của các bản Bug Finding khác bản nhúng đang chạy (chặn mở bản nhúng). */
  otherRunning: string[];
  /** Kết quả review đang bị giữ hay đã bỏ khi gửi về server. */
  relay: BugFindingRelayView;
  /** Mới nhất lên đầu. */
  requests: BugFindingRequestRow[];
  /** Danh sách project 2P Crew đã ghi sang Bug Finding (`crew/projects.json`). */
  sync: BugFindingSyncView;
}

export interface BugFindingSyncView {
  /** Lần đồng bộ thành công cuối (ISO 8601), kể cả lần không phải ghi lại vì không đổi; `null` khi chưa có. */
  lastSyncAt: string | null;
  projects: CrewProject[];
}

export interface BugFindingStateDeps {
  paths: BugFindingPaths;
  /** App Bug Finding mà 2P Crew dùng (`resolveAppPath`). */
  appPath: string | null;
  standalonePath: string;
  /** `CFBundleShortVersionString` của app; `null` khi không đọc được. */
  readVersion(appPath: string): Promise<string | null>;
  runningAppPaths(): Promise<string[]>;
  now(): number;
  /** Giờ lần đồng bộ thành công cuối của phiên app này; không có thì lấy `writtenAt` của `projects.json`. */
  lastSyncAt?: () => string | null;
  /** Kết quả relay đang giữ/đã bỏ (`relayView` trên `app.json`). */
  relay?: () => BugFindingRelayView;
}

const RESPONSE_STATES = new Set<BugFindingRequestState>([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

function readJson(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function readJsonAsync(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const time = (v: string | null): number => (v ? Date.parse(v) || 0 : 0);

/** `at` của heartbeat: ISO 8601 (Bug Finding mã hóa `Date` bằng `.iso8601`); số thì là giây hoặc mili giây Unix. */
function heartbeatTime(at: unknown): number | null {
  if (typeof at === 'string') {
    const t = Date.parse(at);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof at === 'number' && Number.isFinite(at)) return at < 1e12 ? at * 1000 : at;
  return null;
}

/**
 * Số lượt review Bug Finding đang chạy theo `heartbeat.json` (`running`); `null` khi không có heartbeat hay heartbeat
 * cũ hơn 60 giây (app không ghi nữa). Ném khi file có mà không đọc được, hỏng hay thiếu `at`/`running`: người gọi coi
 * là chưa rõ (đang review), không được coi là rảnh.
 */
export function bugFindingRunningReviews(heartbeatFile: string, now: number): number | null {
  let text: string;
  try {
    text = readFileSync(heartbeatFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const heartbeat: unknown = JSON.parse(text);
  if (!heartbeat || typeof heartbeat !== 'object') throw new Error('heartbeat.json không phải object');
  const fields = heartbeat as Record<string, unknown>;
  const at = heartbeatTime(fields.at);
  if (at === null) throw new Error('heartbeat.json thiếu at');
  if ((now - at) / 1000 > HEARTBEAT_STALE_SEC) return null;
  const running = num(fields.running);
  if (running === null) throw new Error('heartbeat.json thiếu running');
  return running;
}

/** `MAX_FILES_PER_DIR` file mới nhất (theo mtime) có đuôi `suffixes` trong `dir`, kèm mtime; thư mục lỗi thì rỗng. */
async function newestFiles(dir: string, suffixes: string[]): Promise<Array<{ file: string; mtime: number }>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = await Promise.all(
    names
      .filter((name) => suffixes.some((suffix) => name.endsWith(suffix)))
      .map(async (name) => {
        const file = join(dir, name);
        const mtime = await stat(file).then(
          (info) => info.mtimeMs,
          () => 0,
        );
        return { file, mtime };
      }),
  );
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES_PER_DIR);
}

async function readRequests(paths: BugFindingPaths): Promise<BugFindingRequestRow[]> {
  const rows = new Map<string, { row: BugFindingRequestRow; sortAt: number }>();
  const rowFor = (requestId: string) => {
    let entry = rows.get(requestId);
    if (!entry) {
      entry = {
        row: {
          requestId,
          identifier: null,
          prNumber: null,
          run: null,
          state: 'pending',
          lanesDone: null,
          lanesTotal: null,
          startedAt: null,
          finishedAt: null,
          verdict: null,
          error: null,
        },
        sortAt: 0,
      };
      rows.set(requestId, entry);
    }
    return entry;
  };

  // Yêu cầu Crew ghi; Bug Finding đổi tên `<id>.json` thành `<id>.json.done` khi đã nhận.
  for (const { file, mtime } of await newestFiles(paths.requestsDir, ['.json', '.json.done'])) {
    const body = await readJsonAsync(file);
    const requestId = str(body?.requestId);
    if (!body || !requestId) continue;
    const entry = rowFor(requestId);
    entry.row.identifier = str(body.identifier);
    entry.row.prNumber = num(body.prNumber);
    entry.row.run = num(body.run);
    entry.sortAt = Math.max(entry.sortAt, mtime);
  }

  for (const { file, mtime } of await newestFiles(paths.responsesDir, ['.json'])) {
    const body = await readJsonAsync(file);
    const requestId = str(body?.requestId);
    const state = str(body?.state) as BugFindingRequestState | null;
    if (!body || !requestId || !state || !RESPONSE_STATES.has(state)) continue;
    const entry = rowFor(requestId);
    const row = entry.row;
    row.state = state;
    row.lanesDone = num(body.lanesDone);
    row.lanesTotal = num(body.lanesTotal);
    row.startedAt = str(body.startedAt);
    row.finishedAt = str(body.finishedAt);
    row.verdict = str(body.verdict);
    row.error = str(body.error);
    entry.sortAt = Math.max(entry.sortAt, mtime, time(row.startedAt), time(row.finishedAt));
  }

  return [...rows.values()]
    .sort((a, b) => b.sortAt - a.sortAt)
    .slice(0, MAX_REQUESTS)
    .map((entry) => entry.row);
}

function readSync(deps: BugFindingStateDeps): BugFindingSyncView {
  const saved = readJson(deps.paths.projectsFile);
  const projects = Array.isArray(saved?.projects) ? savedProjects(saved.projects) : [];
  return { lastSyncAt: deps.lastSyncAt?.() ?? str(saved?.writtenAt), projects };
}

export async function readBugFindingState(deps: BugFindingStateDeps): Promise<BugFindingView> {
  const installed = deps.appPath !== null && existsSync(deps.appPath);
  const [runningPaths, appVersion, requests] = await Promise.all([
    deps.runningAppPaths().catch(() => [] as string[]),
    installed && deps.appPath ? deps.readVersion(deps.appPath).catch(() => null) : Promise.resolve(null),
    readRequests(deps.paths),
  ]);

  const heartbeat = readJson(deps.paths.heartbeatFile);
  const at = heartbeatTime(heartbeat?.at);
  const heartbeatAgeSec = at === null ? null : Math.max(0, Math.round((deps.now() - at) / 1000));
  const running = heartbeatAgeSec !== null && heartbeatAgeSec <= HEARTBEAT_STALE_SEC;

  const standaloneApp = existsSync(deps.standalonePath)
    ? { path: deps.standalonePath, running: runningPaths.includes(deps.standalonePath) }
    : null;

  return {
    installed,
    version: appVersion,
    running,
    pid: running ? num(heartbeat?.pid) : null,
    heartbeatAgeSec,
    runningReviews: running ? (num(heartbeat?.running) ?? 0) : 0,
    waitingReviews: running ? (num(heartbeat?.waiting) ?? 0) : 0,
    standaloneApp,
    otherRunning: runningPaths.filter((path) => path !== deps.appPath),
    relay: deps.relay?.() ?? { held: [], gaveUp: [] },
    requests,
    sync: readSync(deps),
  };
}
