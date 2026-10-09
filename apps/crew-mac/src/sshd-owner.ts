import { existsSync, readFileSync, rmSync } from 'node:fs';
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

/** Gỡ LaunchAgent sshd (chỉ bootout khi đang nạp) để app giữ cổng. Trả true khi có bootout hoặc xóa plist. */
export async function handOffToApp(ctx: MacContext, paths: MacPaths): Promise<boolean> {
  const { loaded } = await serviceState(ctx.runner, ctx.uid, SSHD_LABEL);
  const booted = loaded && (await bootout(ctx.runner, ctx.uid, SSHD_LABEL));
  const hadPlist = existsSync(paths.sshdPlist);
  if (hadPlist) rmSync(paths.sshdPlist);
  return booted || hadPlist;
}

/**
 * Gọi sau khi manifest đã ghi `launchd` (app thấy và tự dừng listener của nó). Chờ tối đa `waitMs` cho pid trong
 * pidfile thoát; còn sống và đúng là listener của crew-mac (mồ côi do app crash) thì TERM rồi chờ nó nhả cổng.
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
    if (proc === null) return;
    if (!isCrewListener(proc.command, paths.sshdConfig)) {
      // Lần đầu đã lạ: pidfile trỏ process khác, để owner kiểm. Về sau mới lạ: listener đã thoát, pid bị dùng lại.
      if (waited > 0) return;
      throw new SetupError(
        `pid ${pid} không phải listener của crew-mac (${proc.command}); không dừng. Kiểm "lsof -nP -iTCP -sTCP:LISTEN" rồi chạy lại.`,
      );
    }
    if (waited >= opts.waitMs) break;
    await sleep(pollMs);
  }
  await ctx.runner.run('/bin/kill', ['-TERM', String(pid)], { timeoutMs: 5_000 });
  for (let waited = 0; waited < 5_000; waited += pollMs) {
    if ((await procOf(ctx, pid)) === null) return;
    await sleep(pollMs);
  }
}
