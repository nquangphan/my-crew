import { existsSync } from 'node:fs';
import type { CommandRunner } from '@crew/mac';
import { BUG_FINDING_PROCESS_SUFFIX } from './paths.js';

/**
 * Mở app Bug Finding và gỡ bản cài riêng cũ. Bản nhúng và bản cài riêng `/Applications/Bug Finding.app` cùng bundle
 * id và cùng thư mục dữ liệu (`state.json`), nên không bao giờ để hai bản chạy cùng lúc: bản khác đang chạy thì không
 * mở bản nhúng, owner thoát bản đó trước.
 */

/** Hạn của `ps` và `PlistBuddy`: lệnh treo không được giữ IPC hay việc review. */
export const PROBE_TIMEOUT_MS = 10_000;
/** Hạn của `open`: LaunchServices có thể chờ hộp thoại (Gatekeeper...). */
export const OPEN_TIMEOUT_MS = 30_000;

export interface LaunchDeps {
  /** Đường dẫn app nhúng (`resolveAppPath`); `null` ở bản dev không đặt `CREW_BUG_FINDING_APP`. */
  embedded: string | null;
  exists(path: string): boolean;
  /** Đường dẫn bundle của mọi tiến trình Bug Finding đang chạy (`runningBugFindingApps`). Ném khi không biết. */
  runningAppPaths(): Promise<string[]>;
  /** Chạy `open`; `timedOut` = quá `OPEN_TIMEOUT_MS`. */
  run(argv: string[]): Promise<{ code: number; timedOut?: boolean }>;
}

/**
 * `standalone_running`: bản Bug Finding khác bản nhúng đang chạy (`paths` là bundle của chúng). `updating`: 2P Crew
 * đang chờ cài bản mới (cổng mở Bug Finding đóng).
 */
export type LaunchResult =
  | { ok: true }
  | { ok: false; reason: 'standalone_running'; paths: string[] }
  | { ok: false; reason: 'missing' | 'updating' };

/** Kiểm mở được bản nhúng không (có app, không có bản khác đang chạy) mà chưa mở gì. */
export async function checkLaunch(deps: Omit<LaunchDeps, 'run'>): Promise<LaunchResult> {
  const app = deps.embedded;
  if (!app || !deps.exists(app)) return { ok: false, reason: 'missing' };
  const others = (await deps.runningAppPaths()).filter((path) => path !== app);
  if (others.length > 0) return { ok: false, reason: 'standalone_running', paths: others };
  return { ok: true };
}

export async function launchBugFinding(
  deps: LaunchDeps,
  opts: { background: boolean },
): Promise<LaunchResult> {
  const checked = await checkLaunch(deps);
  if (!checked.ok) return checked;
  const app = deps.embedded as string;
  const argv = opts.background ? ['/usr/bin/open', '-g', app] : ['/usr/bin/open', app];
  const out = await deps.run(argv);
  if (out.timedOut) throw new Error(`Không mở được Bug Finding (open quá ${OPEN_TIMEOUT_MS / 1000} giây)`);
  if (out.code !== 0) throw new Error(`Không mở được Bug Finding (open mã ${out.code})`);
  return { ok: true };
}

/** `LaunchDeps` thật: `existsSync`, `ps` và `open` qua `runner`, mọi lệnh có hạn. */
export function createLaunchDeps(runner: CommandRunner, embedded: string | null): LaunchDeps {
  return {
    embedded,
    exists: existsSync,
    runningAppPaths: () => runningBugFindingApps(runner),
    run: (argv) => runner.run(argv[0] as string, argv.slice(1), { timeoutMs: OPEN_TIMEOUT_MS }),
  };
}

/**
 * Dòng `<pid> <đường dẫn binary>` của `ps -axo pid=,comm=` mà binary là `MRReviewQueue` trong một `.app`. `comm` là
 * đường dẫn chương trình (không có tham số), nên lệnh khác nhận đường dẫn Bug Finding làm tham số (`codesign`,
 * `lldb`...) không bị tính.
 */
const PROCESS_LINE = new RegExp(
  `^\\s*\\d+\\s+(\\/.+\\.app)${BUG_FINDING_PROCESS_SUFFIX.replace(/\//g, '\\/')}\\s*$`,
);

/** Đầu ra `ps -axo pid=,comm=` → đường dẫn bundle `.app` của từng tiến trình Bug Finding. */
export function parseRunningAppPaths(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split('\n')) {
    const path = PROCESS_LINE.exec(line)?.[1];
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

/**
 * Mọi bản Bug Finding đang chạy (nhúng hay cài riêng), theo `ps`. `ps` lỗi hay quá hạn thì ném (không biết, không được
 * coi là "không chạy").
 */
export async function runningBugFindingApps(runner: CommandRunner): Promise<string[]> {
  const out = await runner.run('/bin/ps', ['-axo', 'pid=,comm='], { timeoutMs: PROBE_TIMEOUT_MS });
  if (out.timedOut) throw new Error(`ps quá ${PROBE_TIMEOUT_MS / 1000} giây`);
  if (out.code !== 0) throw new Error(`ps lỗi (mã ${out.code})`);
  return parseRunningAppPaths(out.stdout);
}

/**
 * Cổng mở Bug Finding nhúng: việc review và nút **Mở Bug Finding** chạy trong cổng. Bước chờ cài bản mới đóng cổng
 * (chờ các lần mở đang chạy xong) để không gì mở lại Bug Finding sau khi drain đã thoát nó, tới khi cài xong hay hủy.
 */
export interface LaunchGate {
  /** Cổng mở: chạy `work`; cổng đóng: trả `onClosed()`, không chạy `work`. */
  run<T>(work: () => Promise<T>, onClosed: () => T): Promise<T>;
  /** Đóng cổng rồi chờ hết các `work` đang chạy. */
  close(): Promise<void>;
  open(): void;
  isOpen(): boolean;
}

export function createLaunchGate(): LaunchGate {
  let closed = false;
  const inflight = new Set<Promise<unknown>>();
  return {
    async run(work, onClosed) {
      if (closed) return onClosed();
      const running = Promise.resolve().then(work);
      const settled = running.catch(() => undefined);
      inflight.add(settled);
      void settled.finally(() => inflight.delete(settled));
      return running;
    },
    async close() {
      closed = true;
      while (inflight.size > 0) await Promise.all([...inflight]);
    },
    open() {
      closed = false;
    },
    isOpen: () => !closed,
  };
}

export interface TrashDeps {
  standalonePath: string;
  exists(path: string): boolean;
  runningAppPaths(): Promise<string[]>;
  /** `shell.trashItem`: Thùng rác, khôi phục được. */
  trashItem(path: string): Promise<void>;
}

export const STANDALONE_RUNNING_MESSAGE = 'Thoát Bug Finding (bản cài riêng) rồi thử lại';

/** Chuyển bản cài riêng cũ vào Thùng rác; từ chối khi nó đang chạy. Dữ liệu của Bug Finding không bị đụng. */
export async function trashStandalone(deps: TrashDeps): Promise<{ ok: boolean; message: string }> {
  if (!deps.exists(deps.standalonePath)) return { ok: true, message: 'Không còn bản cài riêng' };
  const running = await deps.runningAppPaths();
  if (running.includes(deps.standalonePath)) return { ok: false, message: STANDALONE_RUNNING_MESSAGE };
  await deps.trashItem(deps.standalonePath);
  return { ok: true, message: 'Đã chuyển bản cài riêng vào Thùng rác (khôi phục được)' };
}
