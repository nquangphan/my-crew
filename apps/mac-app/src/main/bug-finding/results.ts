import { type FSWatcher, mkdirSync, watch } from 'node:fs';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { BugFindingOutboxItem, BugFindingRequestEntry } from '../app-state.js';
import { UUID_RE } from '../jobs/types.js';
import { PaperclipAuthError, PaperclipHttpError } from '../paperclip/client.js';

/**
 * Chuyển tiến độ và kết quả Bug Finding về server: app Bug Finding ghi `crew/responses/<requestId>.json`
 * (`CrewReviewResponse` của repo `bug-finding`), 2P Crew đọc rồi gửi `POST /bug-finding/results` của plugin `crew.core`
 * bằng board key, chỉ tới origin đã giao việc. Kết quả `succeeded` kèm finding rút gọn (12 trường) và báo cáo `.md`
 * (tối đa 2 MB, chỉ đọc trong thư mục dữ liệu Bug Finding). Gửi lỗi thì giữ trong hàng đợi `bugFindingOutbox` của
 * `app.json`: mỗi mục lùi thời gian riêng, quá số lần thì bỏ kèm cảnh báo.
 */

export const CREW_REVIEW_RESPONSE_SCHEMA = 'crew-review-response/1';
/** Báo cáo `.md` tối đa 2 MB (giới hạn của route kết quả). */
export const REPORT_MAX_BYTES = 2 * 1024 * 1024;
export const REPORT_CUT_NOTE = '(báo cáo bị cắt, xem đầy đủ trong Bug Finding)';
/** Hàng đợi gửi và sổ lượt trong `app.json` giữ tối đa chừng này mục, bỏ mục cũ nhất. */
export const OUTBOX_MAX = 200;
export const REQUESTS_MAX = 200;
/** `running` gửi tối đa một lần mỗi chừng này cho mỗi lượt. */
export const RUNNING_EVERY_MS = 60_000;
/** Quét lại thư mục responses định kỳ (ngoài `fs.watch`). */
export const RELAY_INTERVAL_MS = 30_000;
/** Mục gửi lỗi tạm thời (5xx, 408, 429, quá hạn) thử lại sau 30 giây, gấp đôi mỗi lần, tối đa 30 phút. */
export const RETRY_BASE_MS = 30_000;
export const RETRY_MAX_MS = 30 * 60_000;
/** 403 (tài khoản không thuộc company): giữ mục, hỏi lại sau chừng này. */
export const FORBIDDEN_RETRY_MS = 5 * 60_000;
/** Quá chừng này lần lỗi tạm thời thì bỏ mục, ghi cảnh báo (khoảng 3,5 giờ, dưới hạn 8 giờ của server). */
export const MAX_ATTEMPTS = 10;
/** `review-result.json` chưa đọc được (Bug Finding đang ghi dở...) thì chờ chừng này rồi mới báo `failed`. */
export const RESULT_READ_GRACE_MS = 5 * 60_000;
/** Route nhận tối đa chừng này finding. */
const MAX_FINDINGS = 500;
const ERROR_MAX = 1000;

export type BugFindingResultState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
const STATES: readonly BugFindingResultState[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
const FINAL_STATES: readonly BugFindingResultState[] = ['succeeded', 'failed', 'cancelled'];
export const VERDICTS = ['APPROVE', 'APPROVE WITH CONDITIONS', 'BLOCK'] as const;
export type BugFindingVerdict = (typeof VERDICTS)[number];
const HEAD = /^[0-9a-f]{40}$/;

/** Finding rút gọn: đúng 12 trường server lưu. */
export interface BugFindingFinding {
  id: string;
  rule: string | null;
  title: string;
  severity: string;
  certainty: string | null;
  status: string;
  action: string | null;
  mr_relation: string | null;
  location: string | null;
  fix: string | null;
  accept: string | null;
  question: string | null;
}

/** Body `POST /api/plugins/crew.core/api/bug-finding/results`. */
export interface BugFindingResultBody {
  companyId: string;
  machineId: string;
  requestId: string;
  state: BugFindingResultState;
  round?: number;
  headSha: string;
  lanesDone?: number;
  lanesTotal?: number;
  verdict?: BugFindingVerdict;
  costUsd?: number;
  error?: string;
  findings?: BugFindingFinding[];
  reportMarkdown?: string;
}

/** Phần của `app.json` mà relay đọc và ghi. */
export interface RelayState {
  outbox: BugFindingOutboxItem[];
  requests: Record<string, BugFindingRequestEntry>;
}

/** Trong bộ nhớ: bản tin đã xếp của từng lượt (bỏ trùng, giãn `running`), lần đầu chưa đọc được kết quả, mục đã báo giữ. */
export interface RelayMemory {
  last: Map<string, { state: BugFindingResultState; sig: string; at: number }>;
  unreadableSince: Map<string, number>;
  heldLogged: Set<string>;
}

export const createRelayMemory = (): RelayMemory => ({
  last: new Map(),
  unreadableSince: new Map(),
  heldLogged: new Set(),
});

export interface ResultsDeps {
  /** Nội dung đã parse của mọi `responses/*.json`. */
  listResponses(): Promise<unknown[]>;
  /** Ném khi không đọc được (gồm file ngoài thư mục dữ liệu Bug Finding, xem `createBridgeFileReader`). */
  readFile(path: string): Promise<string>;
  load(): RelayState;
  save(next: RelayState): Promise<void>;
  /** Origin board đang đăng nhập; `null` khi chưa đăng nhập. Mục của origin khác chỉ được giữ, không gửi. */
  currentOrigin(): string | null;
  /** Gửi tới `origin` (luôn là origin đang đăng nhập). Ném `PaperclipHttpError`/`PaperclipAuthError` hay lỗi mạng. */
  post(origin: string, body: BugFindingResultBody): Promise<void>;
  now(): number;
  memory: RelayMemory;
  log(level: 'info' | 'warn', event: string, fields?: Record<string, unknown>): void;
}

interface CrewReviewResponse {
  requestId: string;
  state: BugFindingResultState;
  headSha: string;
  round?: number;
  lanesDone?: number;
  lanesTotal?: number;
  verdict?: BugFindingVerdict;
  costUsd?: number;
  error?: string;
  resultDir?: string;
  reportPath?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10_000;
const absolute = (value: unknown): value is string => typeof value === 'string' && value.startsWith('/');
const errText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Response hợp lệ của Bug Finding, chỉ giữ trường relay dùng; sai dạng thì null. Trường phụ sai thì bỏ riêng trường đó. */
function parseResponse(raw: unknown): CrewReviewResponse | null {
  if (!isObject(raw) || raw.schema !== CREW_REVIEW_RESPONSE_SCHEMA) return null;
  const { requestId, state, headSha } = raw;
  if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) return null;
  if (!STATES.includes(state as BugFindingResultState)) return null;
  if (typeof headSha !== 'string' || !HEAD.test(headSha)) return null;
  return {
    requestId: requestId.toLowerCase(),
    state: state as BugFindingResultState,
    headSha,
    ...(count(raw.round) ? { round: raw.round } : {}),
    ...(count(raw.lanesDone) ? { lanesDone: raw.lanesDone } : {}),
    ...(count(raw.lanesTotal) ? { lanesTotal: raw.lanesTotal } : {}),
    ...(VERDICTS.includes(raw.verdict as BugFindingVerdict)
      ? { verdict: raw.verdict as BugFindingVerdict }
      : {}),
    ...(typeof raw.costUsd === 'number' &&
    Number.isFinite(raw.costUsd) &&
    raw.costUsd >= 0 &&
    raw.costUsd < 1e6
      ? { costUsd: raw.costUsd }
      : {}),
    ...(typeof raw.error === 'string' && raw.error !== '' ? { error: raw.error.slice(0, ERROR_MAX) } : {}),
    ...(absolute(raw.resultDir) ? { resultDir: raw.resultDir } : {}),
    ...(absolute(raw.reportPath) && raw.reportPath.endsWith('.md') ? { reportPath: raw.reportPath } : {}),
  };
}

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** `location` của skill là `{file, line?, symbol?}`; server lưu chuỗi: `file:line (symbol)`. */
function locationText(value: unknown): string | null {
  if (typeof value === 'string') return str(value);
  if (!isObject(value) || typeof value.file !== 'string' || value.file === '') return null;
  const line = Number.isInteger(value.line) ? `:${value.line}` : '';
  const symbol = typeof value.symbol === 'string' && value.symbol !== '' ? ` (${value.symbol})` : '';
  return `${value.file}${line}${symbol}`;
}

/**
 * Rút gọn một finding của `review-result.json` về đúng 12 trường. Server bắt buộc `title`, `severity`, `status` là chuỗi
 * mà schema skill không bắt buộc `title`, `status`: thiếu thì lấy `rule` (hay `id`) làm tiêu đề, `OPEN` làm trạng thái.
 */
export function summarizeFinding(value: unknown): BugFindingFinding | null {
  if (!isObject(value)) return null;
  const id = str(value.id);
  if (!id) return null;
  return {
    id,
    rule: str(value.rule),
    title: str(value.title) ?? str(value.rule) ?? id,
    severity: str(value.severity) ?? 'INFO',
    certainty: str(value.certainty),
    status: str(value.status) ?? 'OPEN',
    action: str(value.action),
    mr_relation: str(value.mr_relation),
    location: locationText(value.location),
    fix: str(value.fix),
    accept: str(value.accept),
    question: str(value.question),
  };
}

/** Báo cáo quá 2 MB: cắt ở ranh giới ký tự UTF-8 rồi thêm dòng ghi chú, tổng không quá 2 MB. */
export function cutReport(text: string, max = REPORT_MAX_BYTES): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= max) return text;
  const note = `\n\n${REPORT_CUT_NOTE}\n`;
  let end = Math.max(0, max - Buffer.byteLength(note));
  // Byte ở `end` là byte tiếp nối (10xxxxxx) thì lùi về đầu ký tự, để không cắt đôi ký tự nhiều byte.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString('utf8')}${note}`;
}

const progressSig = (r: CrewReviewResponse) =>
  JSON.stringify([r.state, r.round, r.lanesDone, r.lanesTotal, r.verdict, r.error]);

/**
 * Mục hàng đợi cho một response; `succeeded` đọc `review-result.json`. Chưa đọc được thì `null` (đọc lại lượt sau);
 * quá `RESULT_READ_GRACE_MS` vẫn không đọc được thì báo `failed` kèm lý do.
 */
async function buildItem(
  r: CrewReviewResponse,
  ref: BugFindingRequestEntry,
  deps: ResultsDeps,
): Promise<BugFindingOutboxItem | null> {
  const body: BugFindingResultBody = {
    companyId: ref.companyId,
    machineId: ref.machineId,
    requestId: r.requestId,
    state: r.state,
    headSha: r.headSha,
    ...(r.round !== undefined ? { round: r.round } : {}),
    ...(r.lanesDone !== undefined ? { lanesDone: r.lanesDone } : {}),
    ...(r.lanesTotal !== undefined ? { lanesTotal: r.lanesTotal } : {}),
    ...(r.verdict !== undefined ? { verdict: r.verdict } : {}),
    ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}),
    ...(r.error !== undefined ? { error: r.error } : {}),
  };
  const queuedAt = new Date(deps.now()).toISOString();
  const base = { requestId: r.requestId, origin: ref.origin, queuedAt };
  if (r.state !== 'succeeded') return { ...base, body };
  const failedItem = (error: string): BugFindingOutboxItem => {
    const { verdict: _verdict, ...rest } = body;
    return { ...base, body: { ...rest, state: 'failed', error } };
  };
  if (!r.verdict) return failedItem('Bug Finding báo xong nhưng không có verdict');
  if (!r.resultDir)
    return failedItem('Bug Finding báo xong nhưng không có thư mục kết quả (review-result.json)');
  let findings: BugFindingFinding[];
  try {
    const result = JSON.parse(await deps.readFile(join(r.resultDir, 'review-result.json'))) as unknown;
    if (!isObject(result) || !Array.isArray(result.findings)) throw new Error('thiếu mảng findings');
    findings = result.findings
      .map(summarizeFinding)
      .filter((item): item is BugFindingFinding => item !== null)
      .slice(0, MAX_FINDINGS);
  } catch (error) {
    const since = deps.memory.unreadableSince.get(r.requestId) ?? deps.now();
    deps.memory.unreadableSince.set(r.requestId, since);
    if (deps.now() - since < RESULT_READ_GRACE_MS) {
      deps.log('warn', 'bug-finding-relay-result-unreadable', {
        requestId: r.requestId,
        error: errText(error),
      });
      return null;
    }
    deps.memory.unreadableSince.delete(r.requestId);
    return failedItem(
      `Không đọc được review-result.json của Bug Finding: ${errText(error)}`.slice(0, ERROR_MAX),
    );
  }
  deps.memory.unreadableSince.delete(r.requestId);
  return { ...base, body: { ...body, findings }, ...(r.reportPath ? { reportPath: r.reportPath } : {}) };
}

const isFinal = (state: BugFindingResultState) => FINAL_STATES.includes(state);

/**
 * Phân loại lỗi gửi. `offline`: không tới được server hay chưa đăng nhập (401), dừng gửi tới origin đó lượt này, không
 * đếm lần thử. `hold`: 403 (tài khoản đang đăng nhập không thuộc company), giữ mục, không đếm. `retry`: lỗi tạm thời
 * của riêng mục (quá hạn, 408, 413, 429, 5xx), đếm lần thử và lùi thời gian. `reject`: server từ chối hẳn (4xx khác).
 */
function classify(error: unknown): 'offline' | 'hold' | 'retry' | 'reject' {
  if (error instanceof PaperclipAuthError) return 'offline';
  if (!(error instanceof PaperclipHttpError)) return 'offline';
  if (error.status === 0) return error.code === 'timeout' ? 'retry' : 'offline';
  if (error.status === 403) return 'hold';
  if ([408, 413, 429].includes(error.status) || error.status >= 500) return 'retry';
  return 'reject';
}

const tooLarge = (error: unknown) => error instanceof PaperclipHttpError && error.status === 413;

/**
 * Một lượt chuyển: đọc mọi response, xếp bản tin mới vào hàng đợi (mỗi lượt Bug Finding giữ một mục, bản mới thay bản
 * cũ), rồi gửi từng mục tới origin đã giao việc. Bỏ response của lượt không có trong sổ (không do 2P Crew xếp) hay đã
 * gửi xong kết quả cuối. `running` gửi tối đa 1 lần/phút mỗi lượt. Mục của origin khác origin đang đăng nhập chỉ giữ
 * (không gửi, không đánh dấu đã gửi). Body quá lớn (413) thì gửi lại ngay một lần không kèm báo cáo. Một mục lỗi không
 * chặn mục khác: mỗi mục lùi thời gian riêng, quá `MAX_ATTEMPTS` lần thì bỏ và ghi `gaveUp` vào sổ. Không ném.
 */
export async function relayResponses(deps: ResultsDeps): Promise<{ sent: number; pending: number }> {
  const state = deps.load();
  let outbox = [...state.outbox];
  const requests = { ...state.requests };
  let changed = false;
  const now = deps.now();
  /** Chỉ ghi vào `memory.last` khi `app.json` đã lưu: lưu lỗi thì lượt sau xếp lại bản tin. */
  const queuedNow = new Map<string, { state: BugFindingResultState; sig: string; at: number }>();

  let responses: unknown[] = [];
  try {
    responses = await deps.listResponses();
  } catch (error) {
    deps.log('warn', 'bug-finding-relay-list-failed', { error: errText(error) });
  }
  for (const raw of responses) {
    const r = parseResponse(raw);
    if (!r) continue;
    const ref = requests[r.requestId];
    if (!ref || ref.delivered || !ref.origin) continue;
    const queued = outbox.find((item) => item.requestId === r.requestId);
    if (queued && isFinal(queued.body.state)) continue;
    const sig = progressSig(r);
    const last = deps.memory.last.get(r.requestId);
    if (last?.sig === sig) continue;
    if (r.state === 'running' && last?.state === 'running' && now - last.at < RUNNING_EVERY_MS) continue;
    const item = await buildItem(r, ref, deps);
    if (!item) continue;
    outbox = [...outbox.filter((entry) => entry.requestId !== r.requestId), item];
    queuedNow.set(r.requestId, { state: r.state, sig, at: now });
    changed = true;
  }
  if (outbox.length > OUTBOX_MAX) {
    outbox = outbox.slice(outbox.length - OUTBOX_MAX);
    changed = true;
  }

  const current = deps.currentOrigin();
  const offline = new Set<string>();
  let sent = 0;
  const pending: BugFindingOutboxItem[] = [];
  const done = (item: BugFindingOutboxItem, gaveUp?: string) => {
    changed = true;
    const ref = requests[item.requestId];
    if (!ref || !isFinal(item.body.state)) return;
    requests[item.requestId] = { ...ref, delivered: true, ...(gaveUp ? { gaveUp } : {}) };
  };
  for (const original of outbox) {
    let item = original;
    if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > now) {
      pending.push(item);
      continue;
    }
    if (!item.origin || item.origin !== current) {
      pending.push(item);
      if (!deps.memory.heldLogged.has(item.requestId)) {
        deps.memory.heldLogged.add(item.requestId);
        deps.log('warn', 'bug-finding-relay-held', {
          requestId: item.requestId,
          origin: item.origin ?? null,
          currentOrigin: current,
        });
      }
      continue;
    }
    deps.memory.heldLogged.delete(item.requestId);
    if (offline.has(item.origin)) {
      pending.push(item);
      continue;
    }
    let error: unknown = null;
    try {
      await deps.post(item.origin, await withReport(item, deps));
    } catch (first) {
      error = first;
    }
    if (error !== null && tooLarge(error) && item.reportPath && !item.withoutReport) {
      // Proxy hay route chặn body lớn: gửi lại ngay bản không có báo cáo (vẫn đủ finding rút gọn).
      deps.log('warn', 'bug-finding-relay-too-large', { requestId: item.requestId });
      item = { ...item, withoutReport: true };
      changed = true;
      error = null;
      try {
        await deps.post(item.origin, item.body);
      } catch (second) {
        error = second;
      }
    }
    if (error === null) {
      sent += 1;
      done(item);
      continue;
    }
    const fields = { requestId: item.requestId, state: item.body.state, error: errText(error) };
    switch (classify(error)) {
      case 'offline':
        offline.add(item.origin);
        pending.push(item);
        deps.log('warn', 'bug-finding-relay-post-failed', fields);
        break;
      case 'hold':
        // Không đếm lần thử: đăng nhập lại đúng tài khoản thì gửi được; chỉ giãn lần hỏi lại.
        pending.push({ ...item, nextAttemptAt: new Date(now + FORBIDDEN_RETRY_MS).toISOString() });
        changed = true;
        deps.log('warn', 'bug-finding-relay-forbidden', fields);
        break;
      case 'retry': {
        const attempts = (item.attempts ?? 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          deps.log('warn', 'bug-finding-relay-gave-up', { ...fields, attempts });
          done(item, `Gửi lỗi ${attempts} lần: ${errText(error)}`.slice(0, ERROR_MAX));
          break;
        }
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempts - 1));
        pending.push({ ...item, attempts, nextAttemptAt: new Date(now + delay).toISOString() });
        changed = true;
        deps.log('warn', 'bug-finding-relay-post-failed', { ...fields, attempts });
        break;
      }
      case 'reject':
        deps.log('warn', 'bug-finding-relay-rejected', fields);
        done(item);
        break;
    }
  }
  if (changed) {
    try {
      await deps.save({ outbox: pending, requests });
    } catch (error) {
      deps.log('warn', 'bug-finding-relay-save-failed', { error: errText(error) });
      return { sent, pending: pending.length };
    }
  }
  for (const [id, entry] of queuedNow) deps.memory.last.set(id, entry);
  return { sent, pending: pending.length };
}

/**
 * Body gửi đi: kèm báo cáo đọc lại từ `reportPath` (cắt nếu quá 2 MB); đọc không được hay đã bị 413 thì gửi không có
 * báo cáo.
 */
async function withReport(item: BugFindingOutboxItem, deps: ResultsDeps): Promise<BugFindingResultBody> {
  if (!item.reportPath || item.withoutReport) return item.body;
  try {
    return { ...item.body, reportMarkdown: cutReport(await deps.readFile(item.reportPath)) };
  } catch (error) {
    deps.log('warn', 'bug-finding-relay-report-unreadable', {
      requestId: item.requestId,
      error: errText(error),
    });
    return item.body;
  }
}

/** Ghi lượt mới vào sổ (giữ tối đa `REQUESTS_MAX` lượt mới nhất). Lượt đã có thì giữ nguyên. */
export function rememberRequest(
  requests: Record<string, BugFindingRequestEntry> | undefined,
  ref: { requestId: string; companyId: string; machineId: string; origin: string },
  at: string,
): Record<string, BugFindingRequestEntry> {
  const current = requests ?? {};
  if (current[ref.requestId]) return current;
  const entries = Object.entries({
    ...current,
    [ref.requestId]: { companyId: ref.companyId, machineId: ref.machineId, origin: ref.origin, at },
  });
  entries.sort((a, b) => a[1].at.localeCompare(b[1].at));
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - REQUESTS_MAX)));
}

/** Gộp cờ `delivered`/`gaveUp` relay vừa đặt vào sổ hiện có (sổ có thể vừa thêm lượt mới trong lúc relay chạy). */
export function mergeDelivered(
  current: Record<string, BugFindingRequestEntry> | undefined,
  next: Record<string, BugFindingRequestEntry>,
): Record<string, BugFindingRequestEntry> {
  const out: Record<string, BugFindingRequestEntry> = {};
  for (const [id, entry] of Object.entries(current ?? {})) {
    const marked = next[id];
    out[id] = marked?.delivered
      ? { ...entry, delivered: true, ...(marked.gaveUp ? { gaveUp: marked.gaveUp } : {}) }
      : entry;
  }
  return out;
}

/**
 * `readFile` của relay: chỉ đọc file nằm trong `root` (thư mục dữ liệu Bug Finding) sau khi giải symlink, để response
 * không trỏ relay tới file bất kỳ trên máy rồi gửi lên server.
 */
export function createBridgeFileReader(root: string): (path: string) => Promise<string> {
  return async (path) => {
    const [real, realRoot] = await Promise.all([realpath(path), realpath(root)]);
    if (!real.startsWith(`${realRoot}${sep}`)) {
      throw new Error('File nằm ngoài thư mục dữ liệu Bug Finding');
    }
    return readFile(real, 'utf8');
  };
}

/** Đọc mọi `*.json` trong thư mục responses (bỏ file tạm và file hỏng). */
export async function readResponsesDir(dir: string): Promise<unknown[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: unknown[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(await readFile(join(dir, name), 'utf8')));
    } catch {
      // Bug Finding đang ghi dở hay file hỏng: lượt sau đọc lại.
    }
  }
  return out;
}

export interface RelayRunner {
  /** Nhờ chạy một lượt (gộp: đang chạy thì chạy thêm đúng một lần sau đó). */
  request(): void;
  stop(): void;
}

/**
 * Chạy `relay` trong Main: khi thư mục responses đổi (`fs.watch`, gộp 1 giây) và mỗi 30 giây. Không bao giờ chạy hai
 * lượt cùng lúc. `fs.watch` lỗi (thư mục bị xóa...) thì vẫn còn lượt định kỳ.
 */
export function startResultsRelay(opts: {
  responsesDir: string;
  relay: () => Promise<unknown>;
  log: (level: 'info' | 'warn', event: string, fields?: Record<string, unknown>) => void;
  intervalMs?: number;
}): RelayRunner {
  let running = false;
  let again = false;
  let stopped = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const run = async () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await opts
          .relay()
          .catch((error) => opts.log('warn', 'bug-finding-relay-failed', { error: errText(error) }));
      } while (again && !stopped);
    } finally {
      running = false;
    }
  };
  let watcher: FSWatcher | null = null;
  try {
    mkdirSync(opts.responsesDir, { recursive: true });
    watcher = watch(opts.responsesDir, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void run();
      }, 1_000);
    });
    watcher.on('error', (error) =>
      opts.log('warn', 'bug-finding-relay-watch-failed', { error: errText(error) }),
    );
  } catch (error) {
    opts.log('warn', 'bug-finding-relay-watch-failed', { error: errText(error) });
  }
  const timer = setInterval(() => void run(), opts.intervalMs ?? RELAY_INTERVAL_MS);
  timer.unref?.();
  void run();
  return {
    request: () => void run(),
    stop() {
      stopped = true;
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      watcher?.close();
    },
  };
}

/** Phần relay hiện ở mục Bug Finding: kết quả đang bị giữ và kết quả đã bỏ. */
export interface BugFindingRelayView {
  /** Kết quả chờ gửi về origin đã giao việc nhưng app đang đăng nhập origin khác (hay chưa đăng nhập). */
  held: Array<{ origin: string; count: number }>;
  /** Kết quả cuối đã bỏ vì gửi lỗi quá số lần (mới nhất trước, tối đa 10). */
  gaveUp: Array<{ requestId: string; at: string; error: string }>;
}

export function relayView(
  outbox: readonly BugFindingOutboxItem[],
  requests: Record<string, BugFindingRequestEntry>,
  currentOrigin: string | null,
): BugFindingRelayView {
  const held = new Map<string, number>();
  for (const item of outbox) {
    if (item.origin === currentOrigin) continue;
    const origin = item.origin ?? '(không rõ)';
    held.set(origin, (held.get(origin) ?? 0) + 1);
  }
  const gaveUp = Object.entries(requests)
    .flatMap(([requestId, entry]) => (entry.gaveUp ? [{ requestId, at: entry.at, error: entry.gaveUp }] : []))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);
  return { held: [...held].map(([origin, count]) => ({ origin, count })), gaveUp };
}
