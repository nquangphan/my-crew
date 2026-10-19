import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { type MacContext, SetupError } from './context.js';
import { bootout, serviceState } from './launchctl.js';
import type { Manifest } from './manifest.js';
import { type MacPaths, SSHD_LABEL } from './paths.js';

/** Ai giữ sshd agent: LaunchAgent `com.2p.crew-mac-sshd` hay app 2P Crew (sshd là process con của app). */
export type SshdOwner = 'launchd' | 'app';

/** Bundle id của app 2P Crew: hộp thoại quyền macOS hỏi theo bundle này khi app là responsible process. */
export const APP_BUNDLE_ID = 'com.2p-solutions.crew.mac';

const APP_EXECUTABLE_RE = /\/2P Crew\.app\/Contents\/MacOS\/[^/]+$/;

export function currentSshdOwner(manifest: Manifest | null): SshdOwner {
  return manifest?.sshdOwner ?? 'launchd';
}

/** Không truyền chủ thì giữ chủ đang ghi trong manifest (cài mới: `launchd`), để không bao giờ có hai chủ một cổng. */
export function resolveSshdOwner(manifest: Manifest | null, requested: SshdOwner | undefined): SshdOwner {
  return requested ?? currentSshdOwner(manifest);
}

export function isAppExecutable(path: string): boolean {
  return APP_EXECUTABLE_RE.test(path);
}

/** OpenSSH tự đổi tiêu đề listener thành `sshd: /usr/sbin/sshd -D -f … [listener] 0 of 10-100 startups`. */
const RETITLE_PREFIX = 'sshd: ';

/**
 * argv (`ps -o command=`) là listener sshd của crew-mac: `/usr/sbin/sshd … -f <sshd_config của crew-mac> …`, dạng gốc
 * hay tiêu đề đã đổi (`sshd: ` đứng đầu). Không bao giờ nhận `sshd-session`.
 */
export function isCrewListener(command: string, sshdConfig: string): boolean {
  if (command.includes('sshd-session')) return false;
  const argv = command.startsWith(RETITLE_PREFIX) ? command.slice(RETITLE_PREFIX.length) : command;
  return argv.startsWith('/usr/sbin/sshd ') && ` ${argv} `.includes(` -f ${sshdConfig} `);
}

export function readSshdPid(path: string): number | null {
  if (!existsSync(path)) return null;
  const pid = Number(readFileSync(path, 'utf8').trim());
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

async function procOf(ctx: MacContext, pid: number): Promise<{ ppid: number; command: string } | null> {
  const result = await ctx.runner.run('/bin/ps', ['-o', 'pid=,ppid=,command=', '-p', String(pid)], {
    timeoutMs: 10_000,
  });
  const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/m.exec(result.stdout);
  if (result.code !== 0 || !match || Number(match[1]) !== pid) return null;
  return { ppid: Number(match[2]), command: (match[3] as string).trim() };
}

async function executableOf(ctx: MacContext, pid: number): Promise<string | null> {
  const result = await ctx.runner.run('/bin/ps', ['-o', 'comm=', '-p', String(pid)], { timeoutMs: 10_000 });
  const path = result.stdout.trim();
  return result.code === 0 && path !== '' ? path : null;
}

export type ListenerProbe =
  /** Không có pidfile, hoặc pid trong đó đã chết. */
  | { kind: 'none'; pid: number | null }
  /** pid còn sống nhưng không phải listener của crew-mac (pid bị dùng lại, hoặc là `sshd-session`). */
  | { kind: 'foreign'; pid: number; command: string }
  /** Listener của crew-mac; `parent` là đường dẫn file thực thi của process cha (null khi không đọc được). */
  | { kind: 'live'; pid: number; ppid: number; parent: string | null };

/** Đọc listener theo pidfile `~/.crew-mac/sshd/sshd.pid` (sshd tự ghi qua `PidFile`). */
export async function probeListener(ctx: MacContext, paths: MacPaths): Promise<ListenerProbe> {
  const pid = readSshdPid(paths.sshdPid);
  if (pid === null) return { kind: 'none', pid: null };
  const proc = await procOf(ctx, pid);
  if (proc === null) return { kind: 'none', pid };
  if (!isCrewListener(proc.command, paths.sshdConfig)) return { kind: 'foreign', pid, command: proc.command };
  return { kind: 'live', pid, ppid: proc.ppid, parent: await executableOf(ctx, proc.ppid) };
}

/** Chờ thêm sau một lần bootout báo thành công mà `launchctl print` vẫn thấy job (launchd gỡ chưa xong). */
const UNLOAD_WAIT_MS = 2_000;
const UNLOAD_POLL_MS = 200;

/**
 * Gỡ LaunchAgent sshd để app giữ cổng. Người gọi đã ghi manifest `app` TRƯỚC (chết giữa chừng thì lần chạy sau thấy
 * chủ `app` và gỡ nốt). Thứ tự: xóa plist (khởi động lại máy không nạp lại job) rồi bootout và kiểm job đã gỡ hẳn.
 * Job vẫn nạp (vẫn giữ cổng) thì trả plist về như cũ và ném `SetupError`: người gọi trả manifest về chủ cũ.
 * Trả true khi có bootout hoặc xóa plist.
 */
export async function handOffToApp(ctx: MacContext, paths: MacPaths): Promise<boolean> {
  const { loaded } = await serviceState(ctx.runner, ctx.uid, SSHD_LABEL);
  const plist = existsSync(paths.sshdPlist) ? readFileSync(paths.sshdPlist) : null;
  if (plist !== null) rmSync(paths.sshdPlist);
  if (!loaded) return plist !== null;
  const ok = await bootout(ctx.runner, ctx.uid, SSHD_LABEL);
  for (let waited = 0; ; waited += UNLOAD_POLL_MS) {
    if (!(await serviceState(ctx.runner, ctx.uid, SSHD_LABEL)).loaded) return true;
    if (!ok || waited >= UNLOAD_WAIT_MS) break;
    await sleep(UNLOAD_POLL_MS);
  }
  if (plist !== null) writeFileSync(paths.sshdPlist, plist, { mode: 0o644 });
  throw new SetupError(
    `launchctl bootout gui/${ctx.uid}/${SSHD_LABEL} không gỡ được LaunchAgent sshd (job vẫn nạp và giữ cổng). ` +
      `Chủ sshd vẫn là LaunchAgent, chưa chuyển sang app. Kiểm "launchctl print gui/${ctx.uid}/${SSHD_LABEL}" rồi chạy lại.`,
  );
}

/** pid đang LISTEN trên cổng TCP (`lsof -t`); null khi không đọc được. Chỉ thấy process của chính user này. */
async function portListeners(ctx: MacContext, port: number): Promise<number[] | null> {
  const result = await ctx.runner.run('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    timeoutMs: 10_000,
  });
  // lsof trả 1 cả khi không có kết quả lẫn khi lỗi; chỉ coi là "cổng trống" khi không in gì.
  if (result.code === 1 && result.stdout.trim() === '' && result.stderr.trim() === '') return [];
  if (result.code !== 0) return null;
  return result.stdout
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/**
 * Kiểm TRƯỚC khi ghi manifest `launchd`: cổng đang thuộc ai. Trả true khi pidfile trỏ listener của crew-mac (người
 * gọi ghi manifest rồi chờ nó thoát bằng `takeBackToLaunchd`), false khi không có gì để chờ. pidfile trỏ process lạ
 * thì không phải listener của mình: cổng trống thì đi tiếp nạp LaunchAgent, cổng bị giữ (hoặc không đọc được) thì
 * ném `SetupError` khi manifest còn nguyên chủ cũ — lần chạy lại không bao giờ ra cổng trống mà manifest nói có chủ.
 */
export async function prepareTakeBack(ctx: MacContext, paths: MacPaths, port: number): Promise<boolean> {
  const probe = await probeListener(ctx, paths);
  if (probe.kind === 'live') return true;
  if (probe.kind === 'none') return false;
  const holders = await portListeners(ctx, port);
  if (holders !== null && holders.length === 0) return false;
  const why =
    holders === null
      ? `không đọc được ai giữ cổng ${port} (lsof lỗi)`
      : `cổng ${port} đang bị pid ${holders.join(', ')} giữ`;
  throw new SetupError(
    `pid ${probe.pid} không phải listener của crew-mac (${probe.command}) và ${why}; không dừng process nào, ` +
      `chủ sshd vẫn là app. Kiểm "lsof -nP -iTCP:${port} -sTCP:LISTEN" rồi chạy lại.`,
  );
}

/**
 * Gọi sau khi manifest đã ghi `launchd` (app thấy và tự dừng listener của nó) và `prepareTakeBack` trả true. Chờ tối
 * đa `waitMs` cho pid trong pidfile thoát; còn sống và đúng là listener của crew-mac (mồ côi do app crash) thì TERM
 * rồi chờ nó nhả cổng. pid thành process lạ nghĩa là listener đã thoát và pid bị dùng lại: trả về, không gửi gì.
 * Không bao giờ gửi tín hiệu cho process khác (kể cả `sshd-session`: phiên của run đang chạy).
 */
export async function takeBackToLaunchd(
  ctx: MacContext,
  paths: MacPaths,
  opts: { waitMs: number; pollMs?: number },
): Promise<void> {
  const pid = readSshdPid(paths.sshdPid);
  if (pid === null) return;
  const pollMs = opts.pollMs ?? 250;
  for (let waited = 0; ; waited += pollMs) {
    const proc = await procOf(ctx, pid);
    if (proc === null || !isCrewListener(proc.command, paths.sshdConfig)) return;
    if (waited >= opts.waitMs) break;
    await sleep(pollMs);
  }
  await ctx.runner.run('/bin/kill', ['-TERM', String(pid)], { timeoutMs: 5_000 });
  for (let waited = 0; waited < 5_000; waited += pollMs) {
    if ((await procOf(ctx, pid)) === null) return;
    await sleep(pollMs);
  }
}
