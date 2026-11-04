import type { CommandRunner } from '@crew/mac';
import { BUG_FINDING_APP_NAME, BUG_FINDING_PROCESS_SUFFIX } from './paths.js';

/**
 * Mở app Bug Finding và gỡ bản cài riêng cũ. Bản nhúng và bản cài riêng `/Applications/Bug Finding.app` cùng bundle
 * id và cùng thư mục dữ liệu (`state.json`), nên không bao giờ để hai bản chạy cùng lúc: bản khác đang chạy thì không
 * mở bản nhúng, owner thoát bản đó trước.
 */

export interface LaunchDeps {
  /** Đường dẫn app nhúng (`resolveAppPath`); `null` ở bản dev không đặt `CREW_BUG_FINDING_APP`. */
  embedded: string | null;
  exists(path: string): boolean;
  /** Đường dẫn bundle của mọi tiến trình Bug Finding đang chạy (`runningBugFindingApps`). */
  runningAppPaths(): Promise<string[]>;
  run(argv: string[]): Promise<{ code: number }>;
}

export type LaunchResult = { ok: true } | { ok: false; reason: 'standalone_running' | 'missing' };

export async function launchBugFinding(
  deps: LaunchDeps,
  opts: { background: boolean },
): Promise<LaunchResult> {
  const app = deps.embedded;
  if (!app || !deps.exists(app)) return { ok: false, reason: 'missing' };
  const running = await deps.runningAppPaths();
  if (running.some((path) => path !== app)) return { ok: false, reason: 'standalone_running' };
  const argv = opts.background ? ['/usr/bin/open', '-g', app] : ['/usr/bin/open', app];
  const out = await deps.run(argv);
  if (out.code !== 0) throw new Error(`Không mở được Bug Finding (open mã ${out.code})`);
  return { ok: true };
}

/**
 * Đầu ra `pgrep -fl '<...>Bug Finding.app/Contents/MacOS/MRReviewQueue'` (mỗi dòng `<pid> <dòng lệnh>`) → đường dẫn
 * bundle `.app` của từng tiến trình.
 */
export function parseRunningAppPaths(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*\d+\s+(.*)$/.exec(line);
    const command = match?.[1];
    if (!command) continue;
    const end = command.indexOf(BUG_FINDING_PROCESS_SUFFIX);
    if (end <= 0) continue;
    const path = command.slice(0, end);
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}

/** Mọi bản Bug Finding đang chạy (nhúng hay cài riêng), theo `pgrep -fl`. pgrep mã 1 là không có tiến trình nào. */
export async function runningBugFindingApps(runner: CommandRunner): Promise<string[]> {
  const out = await runner.run('/usr/bin/pgrep', [
    '-fl',
    `${BUG_FINDING_APP_NAME}${BUG_FINDING_PROCESS_SUFFIX}`,
  ]);
  return out.code === 0 ? parseRunningAppPaths(out.stdout) : [];
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
