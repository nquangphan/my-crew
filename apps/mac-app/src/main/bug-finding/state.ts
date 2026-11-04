import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BugFindingPaths } from './paths.js';
import type { CrewProject } from './sync-projects.js';

/**
 * Trạng thái app Bug Finding cho màn hình Bug Finding, chỉ đọc file cầu nối (`heartbeat.json`, `requests/`,
 * `responses/`, `projects.json`) và hỏi tiến trình đang chạy; không ghi gì.
 */

/** Heartbeat cũ hơn ngưỡng này (Bug Finding ghi mỗi 15 giây) thì coi như app không chạy. */
export const HEARTBEAT_STALE_SEC = 60;
/** Số lượt Crew xếp hiện trên màn hình. */
const MAX_REQUESTS = 50;

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

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const mtime = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};
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

function listJson(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readRequests(paths: BugFindingPaths): BugFindingRequestRow[] {
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
  for (const name of listJson(paths.requestsDir)) {
    if (!name.endsWith('.json') && !name.endsWith('.json.done')) continue;
    const file = join(paths.requestsDir, name);
    const body = readJson(file);
    const requestId = str(body?.requestId);
    if (!body || !requestId) continue;
    const entry = rowFor(requestId);
    entry.row.identifier = str(body.identifier);
    entry.row.prNumber = num(body.prNumber);
    entry.row.run = num(body.run);
    entry.sortAt = Math.max(entry.sortAt, mtime(file));
  }

  for (const name of listJson(paths.responsesDir)) {
    if (!name.endsWith('.json')) continue;
    const file = join(paths.responsesDir, name);
    const body = readJson(file);
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
    entry.sortAt = Math.max(entry.sortAt, mtime(file), time(row.startedAt), time(row.finishedAt));
  }

  return [...rows.values()]
    .sort((a, b) => b.sortAt - a.sortAt)
    .slice(0, MAX_REQUESTS)
    .map((entry) => entry.row);
}

function readSync(deps: BugFindingStateDeps): BugFindingSyncView {
  const saved = readJson(deps.paths.projectsFile);
  const projects = Array.isArray(saved?.projects)
    ? (saved.projects as unknown[]).flatMap((item) => {
        const p = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const crewProjectId = str(p.crewProjectId);
        const key = str(p.key);
        const name = str(p.name);
        const repoPath = str(p.repoPath);
        return crewProjectId && key && name && repoPath ? [{ crewProjectId, key, name, repoPath }] : [];
      })
    : [];
  return { lastSyncAt: deps.lastSyncAt?.() ?? str(saved?.writtenAt), projects };
}

export async function readBugFindingState(deps: BugFindingStateDeps): Promise<BugFindingView> {
  const installed = deps.appPath !== null && existsSync(deps.appPath);
  const [runningPaths, appVersion] = await Promise.all([
    deps.runningAppPaths().catch(() => [] as string[]),
    installed && deps.appPath ? deps.readVersion(deps.appPath).catch(() => null) : Promise.resolve(null),
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
    requests: readRequests(deps.paths),
    sync: readSync(deps),
  };
}
