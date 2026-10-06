import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { MacContext } from '../context.js';
import { readText } from '../fs-util.js';
import { serviceState } from '../launchctl.js';
import { type Manifest, readManifest } from '../manifest.js';
import { forbiddenRootReason, type MacPaths, macPaths, SSHD_LABEL } from '../paths.js';
import { tailscaleIpv4 } from '../tailscale.js';
import { WRAPPER_SOURCE } from '../wrapper.js';
import { hasPathBlock } from '../zshenv.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

export interface DoctorOptions {
  probe: boolean;
  tccWindow: string;
  probeTimeoutSec: number;
}

export interface PendingPrompt {
  msgId: string;
  at: string;
  service: string;
  subject: string;
}

export const TCC_PREDICATE =
  'process == "tccd" AND (eventMessage CONTAINS "AUTHREQ_PROMPTING" OR eventMessage CONTAINS "AUTHREQ_RESULT")';

const PROMPT_RE = /^(\S+ \S+) .*AUTHREQ_PROMPTING: msgID=([\d.]+), service=(\w+), subject=Sub:\{([^}]*)\}/;
const RESULT_RE = /AUTHREQ_RESULT: msgID=([\d.]+),/;

/**
 * Hộp thoại đã hiện mà chưa có kết quả. Dòng có AUTHREQ_PROMPTING mà không khớp định dạng (macOS đổi định
 * dạng, subject bị che thành <private>) được đếm vào `unparsed`, để doctor không báo đạt khi không đọc được.
 */
export function parsePendingTccPrompts(logText: string): { pending: PendingPrompt[]; unparsed: number } {
  const prompts = new Map<string, PendingPrompt>();
  const answered = new Set<string>();
  let unparsed = 0;
  for (const line of logText.split('\n')) {
    const prompt = PROMPT_RE.exec(line);
    if (!prompt && line.includes('AUTHREQ_PROMPTING')) {
      unparsed++;
      continue;
    }
    if (prompt) {
      const msgId = prompt[2] as string;
      prompts.set(msgId, {
        msgId,
        at: prompt[1] as string,
        service: prompt[3] as string,
        subject: prompt[4] as string,
      });
      continue;
    }
    const result = RESULT_RE.exec(line);
    if (result) answered.add(result[1] as string);
  }
  return { pending: [...prompts.values()].filter((p) => !answered.has(p.msgId)), unparsed };
}

const SERVICE_VI: Record<string, { what: string; section: string }> = {
  kTCCServiceSystemPolicyRemovableVolumes: { what: 'tệp trên ổ đĩa di động', section: 'Files and Folders' },
  kTCCServiceSystemPolicyNetworkVolumes: { what: 'tệp trên ổ mạng', section: 'Files and Folders' },
  kTCCServiceSystemPolicyDesktopFolder: { what: 'thư mục Desktop', section: 'Files and Folders' },
  kTCCServiceSystemPolicyDownloadsFolder: { what: 'thư mục Downloads', section: 'Files and Folders' },
  kTCCServiceSystemPolicyDocumentsFolder: { what: 'thư mục Documents', section: 'Files and Folders' },
  kTCCServiceSystemPolicyAllFiles: { what: 'toàn bộ ổ đĩa', section: 'Full Disk Access' },
};

export function tccHint(prompt: PendingPrompt): string {
  const known = SERVICE_VI[prompt.service] ?? { what: prompt.service, section: 'Files and Folders' };
  return (
    `Mở màn hình Mac (trực tiếp hoặc qua Chrome Remote Desktop), tìm hộp thoại "${basename(prompt.subject)}" ` +
    `muốn truy cập ${known.what}, bấm "Allow". Nếu không thấy hộp thoại: System Settings → Privacy & Security → ` +
    `${known.section}, bật quyền cho ${prompt.subject}. Claude Code cập nhật bản mới thì đường dẫn đổi và macOS hỏi lại.`
  );
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Script chạy phía Mac: tự SIGKILL claude khi quá hạn để không để lại process treo (claude bỏ qua SIGTERM). */
export function printProbeScript(worktreeRoot: string, timeoutSec: number): string {
  return [
    `d=$(mktemp -d ${shQuote(`${worktreeRoot}/.crew-mac-doctor-XXXXXX`)}) || exit 90`,
    'git -C "$d" init -q || { rm -rf "$d"; exit 91; }',
    `trap 'cd /; rm -rf "$d" "$d.out"' EXIT`,
    'cd "$d" || exit 92',
    // macOS không có setsid: perl setpgrp đưa claude vào process group riêng để giết được cả con của nó.
    `perl -e 'setpgrp(0, 0); exec @ARGV or die' claude -p 'Trả lời đúng một từ: ok' --model haiku --setting-sources project,local </dev/null >"$d.out" 2>&1 &`,
    'p=$!',
    'i=0',
    `while kill -0 "$p" 2>/dev/null && [ "$i" -lt ${timeoutSec} ]; do sleep 1; i=$((i+1)); done`,
    'if kill -0 "$p" 2>/dev/null; then kill -9 -- -"$p"; wait "$p" 2>/dev/null; echo CREW_MAC_TIMEOUT; rc=124; else wait "$p"; rc=$?; kill -9 -- -"$p" 2>/dev/null; fi',
    'cat "$d.out"',
    'exit $rc',
  ].join('\n');
}

export function sshArgs(paths: MacPaths, manifest: Manifest, user: string, remoteCommand: string): string[] {
  return [
    // Bỏ qua ~/.ssh/config của owner: chỉ dùng đúng các tùy chọn bên dưới.
    '-F',
    '/dev/null',
    '-p',
    String(manifest.port),
    '-i',
    paths.doctorKey,
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    `UserKnownHostsFile=${paths.knownHosts}`,
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ConnectTimeout=5',
    `${user}@${manifest.listenAddress}`,
    remoteCommand,
  ];
}

export function parseLoad(loadavg: string, ncpu: string, memoryPressure: string) {
  const load1 = Number(/\{\s*([\d.]+)/.exec(loadavg)?.[1] ?? Number.NaN);
  const freePct = Number(/free percentage:\s*(\d+)%/.exec(memoryPressure)?.[1] ?? Number.NaN);
  return { load1, ncpu: Number(ncpu.trim()), freePct };
}

async function checkTailscale(ctx: MacContext, manifest: Manifest): Promise<CheckResult> {
  const ip = await tailscaleIpv4(ctx.runner);
  const base = { id: 'tailscale', title: 'Tailscale' };
  if (!ip)
    return { ...base, status: 'fail', detail: 'không lấy được IP', hint: 'Mở app Tailscale và đăng nhập.' };
  if (ip !== manifest.listenAddress) {
    return {
      ...base,
      status: 'fail',
      detail: `IP hiện tại ${ip}, sshd đang nghe ${manifest.listenAddress}`,
      hint: 'Chạy lại "crew-mac setup" để sshd nghe IP mới, rồi sửa environment trong Paperclip.',
    };
  }
  return { ...base, status: 'ok', detail: ip };
}

async function checkSshdService(ctx: MacContext): Promise<CheckResult> {
  const state = await serviceState(ctx.runner, ctx.uid, SSHD_LABEL);
  const base = { id: 'sshd-agent', title: 'sshd agent (phiên desktop)' };
  if (state.running) return { ...base, status: 'ok', detail: `${SSHD_LABEL} pid ${state.pid}` };
  return {
    ...base,
    status: 'fail',
    detail: state.loaded
      ? `${SSHD_LABEL} đã nạp nhưng không chạy (mã thoát ${state.lastExitCode})`
      : `${SSHD_LABEL} chưa nạp`,
    hint: 'Đăng nhập màn hình Mac (LaunchAgent chỉ chạy trong phiên desktop), rồi chạy lại "crew-mac setup". Lỗi chi tiết ở ~/.crew-mac/sshd/sshd.log.',
  };
}

async function checkSshdPort(ctx: MacContext, manifest: Manifest): Promise<CheckResult> {
  const result = await ctx.runner.run(
    '/usr/bin/nc',
    ['-z', '-G', '3', manifest.listenAddress, String(manifest.port)],
    {
      timeoutMs: 10_000,
    },
  );
  const where = `${manifest.listenAddress}:${manifest.port}`;
  return result.code === 0
    ? { id: 'sshd-port', title: 'Cổng sshd', status: 'ok', detail: where }
    : {
        id: 'sshd-port',
        title: 'Cổng sshd',
        status: 'fail',
        detail: `không kết nối được ${where}`,
        hint: 'Xem ~/.crew-mac/sshd/sshd.log.',
      };
}

function checkZshenv(paths: MacPaths): CheckResult {
  return hasPathBlock(readText(paths.zshenv))
    ? { id: 'zshenv-path', title: 'PATH cho claude', status: 'ok', detail: paths.zshenv }
    : {
        id: 'zshenv-path',
        title: 'PATH cho claude',
        status: 'fail',
        detail: `thiếu khối crew-mac trong ${paths.zshenv}`,
        hint: 'Chạy lại "crew-mac setup".',
      };
}

async function checkWrapper(ctx: MacContext, paths: MacPaths, manifest: Manifest): Promise<CheckResult> {
  const base = { id: 'wrapper', title: 'Wrapper crew-claude-run' };
  const reinstall = 'Chạy lại "crew-mac setup".';
  if (!existsSync(paths.wrapper))
    return { ...base, status: 'fail', detail: `thiếu ${paths.wrapper}`, hint: reinstall };
  if ((statSync(paths.wrapper).mode & 0o111) === 0) {
    return { ...base, status: 'fail', detail: `${paths.wrapper} không có quyền chạy`, hint: reinstall };
  }
  const result = await ctx.runner.run(
    'ssh',
    sshArgs(paths, manifest, ctx.user, '"$HOME/.crew/bin/crew-claude-run" --version'),
    { timeoutMs: 30_000 },
  );
  if (result.code !== 0 || !/Claude Code/.test(result.stdout)) {
    return {
      ...base,
      status: 'fail',
      detail: `chạy qua sshd agent lỗi (mã ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 200)}`,
      hint: 'Kiểm check zshenv-path và claude có trong ~/.local/bin.',
    };
  }
  if (readFileSync(paths.wrapper, 'utf8') !== readFileSync(WRAPPER_SOURCE, 'utf8')) {
    return { ...base, status: 'warn', detail: `${paths.wrapper} khác bản trong repo Crew`, hint: reinstall };
  }
  return {
    ...base,
    status: 'ok',
    detail: `${paths.wrapper} → ${result.stdout.trim()}; agent đặt adapterConfig.command bằng đường dẫn này`,
  };
}

function checkWorktreeRoot(ctx: MacContext, manifest: Manifest): CheckResult {
  const base = { id: 'worktree-root', title: 'Thư mục worktree' };
  const reason = forbiddenRootReason(ctx.home, manifest.worktreeRoot);
  if (reason) return { ...base, status: 'fail', detail: `${manifest.worktreeRoot}: ${reason}` };
  if (!existsSync(manifest.worktreeRoot)) {
    return {
      ...base,
      status: 'fail',
      detail: `${manifest.worktreeRoot} không tồn tại`,
      hint: 'Chạy lại "crew-mac setup".',
    };
  }
  return { ...base, status: 'ok', detail: manifest.worktreeRoot };
}

async function checkClaudeAuth(ctx: MacContext, paths: MacPaths, manifest: Manifest): Promise<CheckResult> {
  const base = { id: 'claude-auth', title: 'Claude đăng nhập (qua sshd agent)' };
  const result = await ctx.runner.run('ssh', sshArgs(paths, manifest, ctx.user, 'claude auth status'), {
    timeoutMs: 30_000,
  });
  if (result.code === 255 || result.timedOut) {
    return { ...base, status: 'fail', detail: `không SSH được vào sshd agent: ${result.stderr.trim()}` };
  }
  try {
    const status = JSON.parse(result.stdout) as {
      loggedIn?: boolean;
      authMethod?: string;
      subscriptionType?: string;
    };
    if (status.loggedIn === true) {
      return {
        ...base,
        status: 'ok',
        detail: `${status.authMethod ?? '?'}, gói ${status.subscriptionType ?? '?'}`,
      };
    }
  } catch {
    // Không phải JSON: rơi xuống báo lỗi chung bên dưới.
  }
  return {
    ...base,
    status: 'fail',
    detail: `claude auth status: ${result.stdout.trim().slice(0, 200) || result.stderr.trim().slice(0, 200)}`,
    hint: 'Trên màn hình Mac, mở Terminal, chạy "claude" rồi /login. Nếu đã đăng nhập mà vẫn lỗi thì Keychain đang khóa: khóa rồi mở lại màn hình Mac.',
  };
}

async function checkClaudePrint(
  ctx: MacContext,
  paths: MacPaths,
  manifest: Manifest,
  timeoutSec: number,
): Promise<CheckResult> {
  const base = { id: 'claude-print-git', title: 'claude -p trong git repo' };
  const script = printProbeScript(manifest.worktreeRoot, timeoutSec);
  const result = await ctx.runner.run('ssh', sshArgs(paths, manifest, ctx.user, script), {
    timeoutMs: (timeoutSec + 30) * 1000,
  });
  if (result.timedOut || result.stdout.includes('CREW_MAC_TIMEOUT')) {
    return {
      ...base,
      status: 'fail',
      detail: `claude không trả lời sau ${timeoutSec} giây`,
      hint: 'Thường do hộp thoại quyền macOS đang chờ: xem check tcc-pending ngay bên dưới.',
    };
  }
  if (result.code === 0 && /\bok\b/i.test(result.stdout))
    return { ...base, status: 'ok', detail: 'trả lời ok' };
  return { ...base, status: 'fail', detail: `mã ${result.code}: ${result.stdout.trim().slice(-300)}` };
}

async function checkTccPending(ctx: MacContext, window: string): Promise<CheckResult> {
  const base = { id: 'tcc-pending', title: 'Hộp thoại quyền macOS đang chờ' };
  const result = await ctx.runner.run(
    '/usr/bin/log',
    ['show', '--last', window, '--style', 'compact', '--predicate', TCC_PREDICATE],
    { timeoutMs: 240_000 },
  );
  if (result.code !== 0)
    return { ...base, status: 'warn', detail: `không đọc được log hệ thống: ${result.stderr.trim()}` };
  const { pending, unparsed } = parsePendingTccPrompts(result.stdout);
  const unreadable =
    unparsed > 0 ? `${unparsed} dòng AUTHREQ_PROMPTING không đọc được (định dạng log khác dự kiến)` : '';
  if (pending.length > 0) {
    return {
      ...base,
      status: 'fail',
      detail: [pending.map((p) => `${p.at} ${p.service} cho ${p.subject}`).join('; '), unreadable]
        .filter(Boolean)
        .join('; '),
      hint: pending.map(tccHint).join('\n'),
    };
  }
  if (unparsed > 0) {
    return {
      ...base,
      status: 'warn',
      detail: unreadable,
      hint: 'Mở màn hình Mac, xem có hộp thoại xin quyền đang chờ không và bấm "Allow" nếu là claude.',
    };
  }
  return { ...base, status: 'ok', detail: `không có trong ${window} gần nhất` };
}

async function checkLoad(ctx: MacContext): Promise<CheckResult> {
  const [loadavg, ncpu, pressure] = await Promise.all([
    ctx.runner.run('sysctl', ['-n', 'vm.loadavg'], { timeoutMs: 10_000 }),
    ctx.runner.run('sysctl', ['-n', 'hw.ncpu'], { timeoutMs: 10_000 }),
    ctx.runner.run('memory_pressure', ['-Q'], { timeoutMs: 10_000 }),
  ]);
  const load = parseLoad(loadavg.stdout, ncpu.stdout, pressure.stdout);
  const detail = `load 1 phút ${load.load1} / ${load.ncpu} CPU, RAM trống ${load.freePct}%`;
  if (![load.load1, load.ncpu, load.freePct].every(Number.isFinite) || load.ncpu <= 0) {
    return { id: 'load', title: 'Tải máy', status: 'warn', detail: `không đọc được số liệu tải (${detail})` };
  }
  const busy = load.load1 / load.ncpu > 1.5 || load.freePct < 10;
  return busy
    ? {
        id: 'load',
        title: 'Tải máy',
        status: 'warn',
        detail,
        hint: 'Máy đang bận; Paperclip sẽ cho run mới chờ tới khi tải giảm.',
      }
    : { id: 'load', title: 'Tải máy', status: 'ok', detail };
}

export async function doctor(ctx: MacContext, options: DoctorOptions): Promise<CheckResult[]> {
  const paths = macPaths(ctx.home);
  const manifest = readManifest(paths.manifest);
  if (!manifest) {
    return [
      {
        id: 'install',
        title: 'Cài đặt',
        status: 'fail',
        detail: `chưa có ${paths.manifest}`,
        hint: 'Chạy "crew-mac setup --paperclip-key <file .pub>" trong Terminal trên màn hình Mac.',
      },
    ];
  }
  const results: CheckResult[] = [];
  results.push(await checkTailscale(ctx, manifest));
  results.push(await checkSshdService(ctx));
  results.push(await checkSshdPort(ctx, manifest));
  results.push(checkZshenv(paths));
  results.push(await checkWrapper(ctx, paths, manifest));
  results.push(checkWorktreeRoot(ctx, manifest));
  results.push(await checkClaudeAuth(ctx, paths, manifest));
  if (options.probe) results.push(await checkClaudePrint(ctx, paths, manifest, options.probeTimeoutSec));
  results.push(await checkTccPending(ctx, options.tccWindow));
  results.push(await checkLoad(ctx));
  return results;
}
