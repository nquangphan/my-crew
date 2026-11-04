import { type FSWatcher, mkdirSync, watch } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BugFindingOutboxItem, BugFindingRequestEntry } from '../app-state.js';
import { UUID_RE } from '../jobs/types.js';
import { PaperclipAuthError, PaperclipHttpError } from '../paperclip/client.js';

/**
 * Chuyển tiến độ và kết quả Bug Finding về server: app Bug Finding ghi `crew/responses/<requestId>.json`
 * (`CrewReviewResponse` của repo `bug-finding`), 2P Crew đọc rồi gửi `POST /bug-finding/results` của plugin `crew.core`
 * bằng board key. Kết quả `succeeded` kèm finding rút gọn (12 trường) và báo cáo `.md` (tối đa 2 MB). Gửi lỗi mạng thì
 * giữ trong hàng đợi `bugFindingOutbox` của `app.json` và gửi lại lượt sau.
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

/** Lần gửi gần nhất của từng lượt (trong bộ nhớ): bỏ bản tin trùng, giãn `running`. */
export interface RelayMemory {
  last: Map<string, { state: BugFindingResultState; sig: string; at: number }>;
}

export const createRelayMemory = (): RelayMemory => ({ last: new Map() });

export interface ResultsDeps {
  /** Nội dung đã parse của mọi `responses/*.json`. */
  listResponses(): Promise<unknown[]>;
  /** Ném khi không đọc được. */
  readFile(path: string): Promise<string>;
  load(): RelayState;
  save(next: RelayState): Promise<void>;
  /** Ném `PaperclipHttpError`/`PaperclipAuthError` hay lỗi mạng. */
  post(body: BugFindingResultBody): Promise<void>;
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
    ...(absolute(raw.reportPath) ? { reportPath: raw.reportPath } : {}),
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

/** Mục hàng đợi cho một response; `succeeded` đọc `review-result.json`, đọc không được thì báo `failed` kèm lý do. */
async function buildItem(
  r: CrewReviewResponse,
  ref: BugFindingRequestEntry,
  deps: ResultsDeps,
): Promise<BugFindingOutboxItem> {
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
  if (r.state !== 'succeeded') return { requestId: r.requestId, body, queuedAt };
  const failedItem = (error: string): BugFindingOutboxItem => {
    const { verdict: _verdict, ...rest } = body;
    return { requestId: r.requestId, body: { ...rest, state: 'failed', error }, queuedAt };
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
    return failedItem(
      `Không đọc được review-result.json của Bug Finding: ${errText(error)}`.slice(0, ERROR_MAX),
    );
  }
  return {
    requestId: r.requestId,
    body: { ...body, findings },
    ...(r.reportPath ? { reportPath: r.reportPath } : {}),
    queuedAt,
  };
}

/** Lỗi gửi đáng thử lại: mạng, timeout, server 5xx/429, chưa đăng nhập. Lỗi 4xx khác là server từ chối hẳn. */
function retryable(error: unknown): boolean {
  if (error instanceof PaperclipAuthError) return true;
  if (error instanceof PaperclipHttpError) {
    return error.status === 0 || error.status === 429 || error.status >= 500;
  }
  return true;
}

const isFinal = (state: BugFindingResultState) => FINAL_STATES.includes(state);

/**
 * Một lượt chuyển: đọc mọi response, xếp bản tin mới vào hàng đợi (mỗi lượt Bug Finding giữ một mục, bản mới thay bản
 * cũ), rồi gửi lần lượt. Bỏ response của lượt không có trong sổ (không do 2P Crew xếp) hay đã gửi xong kết quả cuối.
 * `running` gửi tối đa 1 lần/phút mỗi lượt. Lỗi mạng: dừng gửi, giữ phần còn lại cho lượt sau. Không ném.
 */
export async function relayResponses(deps: ResultsDeps): Promise<{ sent: number; pending: number }> {
  const state = deps.load();
  let outbox = [...state.outbox];
  const requests = { ...state.requests };
  let changed = false;
  const now = deps.now();

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
    if (!ref || ref.delivered) continue;
    const queued = outbox.find((item) => item.requestId === r.requestId);
    if (queued && isFinal(queued.body.state)) continue;
    const sig = progressSig(r);
    const last = deps.memory.last.get(r.requestId);
    if (last?.sig === sig) continue;
    if (r.state === 'running' && last?.state === 'running' && now - last.at < RUNNING_EVERY_MS) continue;
    const item = await buildItem(r, ref, deps);
    outbox = [...outbox.filter((entry) => entry.requestId !== r.requestId), item];
    deps.memory.last.set(r.requestId, { state: r.state, sig, at: now });
    changed = true;
  }
  if (outbox.length > OUTBOX_MAX) {
    outbox = outbox.slice(outbox.length - OUTBOX_MAX);
    changed = true;
  }

  let sent = 0;
  const pending: BugFindingOutboxItem[] = [];
  let offline = false;
  for (const item of outbox) {
    if (offline) {
      pending.push(item);
      continue;
    }
    const final = isFinal(item.body.state);
    try {
      await deps.post(await withReport(item, deps));
      sent += 1;
    } catch (error) {
      if (retryable(error)) {
        offline = true;
        pending.push(item);
        deps.log('warn', 'bug-finding-relay-post-failed', {
          requestId: item.requestId,
          error: errText(error),
        });
        continue;
      }
      deps.log('warn', 'bug-finding-relay-rejected', {
        requestId: item.requestId,
        state: item.body.state,
        error: errText(error),
      });
    }
    changed = true;
    const ref = requests[item.requestId];
    if (final && ref) requests[item.requestId] = { ...ref, delivered: true };
  }
  if (changed) {
    try {
      await deps.save({ outbox: pending, requests });
    } catch (error) {
      deps.log('warn', 'bug-finding-relay-save-failed', { error: errText(error) });
    }
  }
  return { sent, pending: pending.length };
}

/** Body gửi đi: kèm báo cáo đọc lại từ `reportPath` (cắt nếu quá 2 MB); đọc không được thì gửi không có báo cáo. */
async function withReport(item: BugFindingOutboxItem, deps: ResultsDeps): Promise<BugFindingResultBody> {
  if (!item.reportPath) return item.body;
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
  ref: { requestId: string; companyId: string; machineId: string },
  at: string,
): Record<string, BugFindingRequestEntry> {
  const current = requests ?? {};
  if (current[ref.requestId]) return current;
  const entries = Object.entries({
    ...current,
    [ref.requestId]: { companyId: ref.companyId, machineId: ref.machineId, at },
  });
  entries.sort((a, b) => a[1].at.localeCompare(b[1].at));
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - REQUESTS_MAX)));
}

/** Gộp cờ `delivered` relay vừa đặt vào sổ hiện có (sổ có thể vừa thêm lượt mới trong lúc relay chạy). */
export function mergeDelivered(
  current: Record<string, BugFindingRequestEntry> | undefined,
  next: Record<string, BugFindingRequestEntry>,
): Record<string, BugFindingRequestEntry> {
  const out: Record<string, BugFindingRequestEntry> = {};
  for (const [id, entry] of Object.entries(current ?? {})) {
    out[id] = next[id]?.delivered ? { ...entry, delivered: true } : entry;
  }
  return out;
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
