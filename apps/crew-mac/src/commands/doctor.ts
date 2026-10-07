import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { MacContext } from '../context.js';
import { readText } from '../fs-util.js';
import { serviceState } from '../launchctl.js';
import { parseLauncher, renderLauncher } from '../launcher.js';
import { type Manifest, readManifest } from '../manifest.js';
import { forbiddenRootReason, type MacPaths, macPaths, REAPER_LABEL, SSHD_LABEL } from '../paths.js';
import { shQuote } from '../system.js';
import { tailscaleIpv4 } from '../tailscale.js';
import { missingExecutables, readInstalledPlugins } from '../workflows/install.js';
import { discoverSources, GIT_TIMEOUT } from '../workflows/inventory.js';
import { SUPERPOWERS_PLUGIN_KEY, superpowersPinDir } from '../workflows/pin.js';
import { treeChecksum } from '../workflows/tree-checksum.js';
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
  /** `identifier=` của TCCDProcess trong cùng dòng log; null khi dòng không có. */
  identifier: string | null;
}

export const TCC_PREDICATE =
  'process == "tccd" AND (eventMessage CONTAINS "AUTHREQ_PROMPTING" OR eventMessage CONTAINS "AUTHREQ_RESULT")';

const PROMPT_RE =
  /^(\S+ \S+) .*AUTHREQ_PROMPTING: msgID=([\d.]+), service=(\w+), subject=Sub:\{([^}]*)\}(?:.*?TCCDProcess: identifier=([^,}\s]+))?/;
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
        identifier: prompt[5] ?? null,
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

async function checkReaper(ctx: MacContext): Promise<CheckResult> {
  const state = await serviceState(ctx.runner, ctx.uid, REAPER_LABEL);
  const base = { id: 'reaper', title: 'Bộ dọn process mồ côi' };
  if (!state.loaded)
    return {
      ...base,
      status: 'fail',
      detail: `${REAPER_LABEL} chưa nạp`,
      hint: 'Chạy lại "crew-mac setup".',
    };
  if (state.lastExitCode !== null && state.lastExitCode !== 0) {
    return {
      ...base,
      status: 'fail',
      detail: `lần chạy gần nhất thoát mã ${state.lastExitCode}`,
      hint: 'Xem ~/.crew-mac/reaper/reaper.log. Nếu đã chuyển repo Crew hay nâng Node, chạy lại "crew-mac setup".',
    };
  }
  return { ...base, status: 'ok', detail: `${REAPER_LABEL} chạy mỗi 60 giây` };
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

function checkLauncher(ctx: MacContext, paths: MacPaths): CheckResult {
  const base = { id: 'launcher', title: 'Lệnh crew-mac cho phía server' };
  const reinstall = 'Chạy lại "crew-mac setup".';
  if (!existsSync(paths.launcher))
    return { ...base, status: 'fail', detail: `thiếu ${paths.launcher}`, hint: reinstall };
  if ((statSync(paths.launcher).mode & 0o111) === 0) {
    return { ...base, status: 'fail', detail: `${paths.launcher} không có quyền chạy`, hint: reinstall };
  }
  const text = readFileSync(paths.launcher, 'utf8');
  const target = parseLauncher(text);
  if (target === null || !existsSync(target.nodePath) || !existsSync(target.cliPath)) {
    return {
      ...base,
      status: 'fail',
      detail: `${paths.launcher} trỏ tới node hoặc cli.js không còn (${target ? `${target.nodePath}, ${target.cliPath}` : 'không đọc được'})`,
      hint: 'Đã chuyển repo Crew hoặc nâng Node: chạy lại "crew-mac setup" từ bản build hiện tại.',
    };
  }
  if (text !== renderLauncher(ctx.nodePath, ctx.cliPath)) {
    return {
      ...base,
      status: 'warn',
      detail: `${paths.launcher} trỏ tới bản crew-mac khác bản đang chạy`,
      hint: reinstall,
    };
  }
  return { ...base, status: 'ok', detail: `${paths.launcher} → ${target.cliPath}` };
}

/** Bản Superpowers ghim mà agent nạp qua `--plugin-dir`: có thư mục và đúng checksum (wrapper cũng kiểm lúc chạy). */
function checkSuperpowersPin(ctx: MacContext): CheckResult {
  const pin = ctx.superpowersPin;
  const base = { id: 'superpowers-pin', title: `Superpowers ${pin.version} đã ghim` };
  const dir = superpowersPinDir(ctx.home, pin);
  const reinstall = `Xóa ${dir} (nếu có) rồi chạy "crew-mac setup".`;
  let present = true;
  try {
    lstatSync(dir);
  } catch {
    present = false;
  }
  if (!present) return { ...base, status: 'fail', detail: `chưa có ${dir}`, hint: 'Chạy "crew-mac setup".' };
  try {
    const sum = treeChecksum(dir);
    if (sum.checksum !== pin.checksum) {
      return { ...base, status: 'fail', detail: `${dir} lệch checksum bản ghim`, hint: reinstall };
    }
    const missing = missingExecutables(dir, pin);
    if (missing.length > 0) {
      return {
        ...base,
        status: 'fail',
        detail: `${dir} thiếu bit thực thi: ${missing.join(', ')} (hook Superpowers sẽ không chạy)`,
        hint: 'Chạy lại "crew-mac setup" để đặt lại bit thực thi.',
      };
    }
    const owner = readInstalledPlugins(ctx.home, SUPERPOWERS_PLUGIN_KEY).map((e) => e.version);
    const detail = `${dir} (${sum.files} file); bản owner đang cài: ${owner.join(', ') || 'không có'}`;
    if (!owner.includes(pin.version)) {
      return {
        ...base,
        status: 'warn',
        detail: `${detail} (khác bản ghim ${pin.version}; agent vẫn chỉ nạp bản ghim)`,
        hint:
          'Muốn agent dùng bản owner đang cài: nâng SUPERPOWERS_PIN, chạy lại "crew-mac setup" và cập nhật ' +
          'adapterConfig.extraArgs. Không thì bỏ qua cảnh báo này.',
      };
    }
    return { ...base, status: 'ok', detail };
  } catch (err) {
    return {
      ...base,
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      hint: reinstall,
    };
  }
}

/**
 * Chạy phần quét nguồn của `workflow-check` (`discoverSources`) cho từng worktree cấp 1 dưới thư mục worktree:
 * worktree nào sẽ làm run thoát 78 thì `fail` kèm lệnh xử lý, chỉ có cảnh báo thì `warn`. Phần bản ghim do
 * `superpowers-pin` kiểm.
 */
const WORKTREE_WORKFLOWS_BUDGET_MS = 60_000;

async function checkWorktreeWorkflows(ctx: MacContext, manifest: Manifest): Promise<CheckResult> {
  const base = { id: 'worktree-workflows', title: 'Nguồn skill trong các worktree agent' };
  const root = manifest.worktreeRoot;
  if (!existsSync(root)) return { ...base, status: 'ok', detail: `chưa có ${root}` };
  let names: string[];
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .filter((e) => {
        try {
          return statSync(join(root, e.name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((e) => e.name)
      .sort();
  } catch (err) {
    return { ...base, status: 'warn', detail: `không đọc được ${root}: ${(err as Error).message}` };
  }
  const blocked: string[] = [];
  const warned: string[] = [];
  const fixes: string[] = [];
  const startedAt = Date.now();
  for (const [i, name] of names.entries()) {
    if (Date.now() - startedAt > WORKTREE_WORKFLOWS_BUDGET_MS) {
      warned.push(
        `quá ${WORKTREE_WORKFLOWS_BUDGET_MS / 1000} giây, dừng kiểm các worktree còn lại (${names.slice(i).join(', ')})`,
      );
      break;
    }
    const sources = await discoverSources(ctx, join(root, name));
    for (const s of sources) {
      if (s.origin === 'blocked') blocked.push(`${name}: ${s.path} (${s.reason})`);
      else if (s.warning) warned.push(`${name}: ${s.path} (${s.warning})`);
      else continue;
      if (s.fix) fixes.push(`${s.path}: ${s.fix}`);
    }
    // git treo (thường do hộp thoại quyền TCC) thì các worktree sau cũng treo: dừng như checkCrewDocs.
    if (sources.some((s) => s.reason?.includes(GIT_TIMEOUT))) {
      const rest = names.slice(i + 1);
      if (rest.length > 0)
        blocked.push(`git quá hạn ở ${name}, dừng kiểm các worktree còn lại (${rest.join(', ')})`);
      break;
    }
  }
  if (blocked.length > 0) {
    return {
      ...base,
      status: 'fail',
      detail: `run trong worktree sẽ thoát 78: ${blocked.join('; ')}`,
      hint: fixes.join('\n'),
    };
  }
  if (warned.length > 0) {
    return {
      ...base,
      status: 'warn',
      detail: `nguồn sửa dở (run vẫn chạy): ${warned.join('; ')}`,
      hint: fixes.join('\n'),
    };
  }
  return { ...base, status: 'ok', detail: `${names.length} worktree, không có nguồn bị chặn` };
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

const CLAUDE_CODE_IDENTIFIER = 'com.anthropic.claude-code';

/** Hộp thoại quyền của chính agent (claude theo version hoặc node chạy crew-mac/claude) thì chặn agent; app khác thì không. */
export function isAgentTccSubject(subject: string, identifier: string | null = null): boolean {
  if (identifier === CLAUDE_CODE_IDENTIFIER) return true;
  const name = basename(subject);
  return name === 'claude' || name === 'node' || /\/claude\/versions\/[^/]+$/.test(subject);
}

/** Vùng TCC bảo vệ: process của agent (qua sshd) chạm vào đây thì treo im lặng chờ hộp thoại. */
export function tccProtectedReason(home: string, path: string): string | null {
  for (const dir of ['Documents', 'Desktop', 'Downloads']) {
    const root = `${home}/${dir}`;
    if (path === root || path.startsWith(`${root}/`)) return `~/${dir}`;
  }
  return path === '/Volumes' || path.startsWith('/Volumes/') ? '/Volumes' : null;
}

const CREW_DOCS_CONFIG_TIMEOUT_MS = 30_000;
const CREW_DOCS_RUN_TIMEOUT_MS = 20_000;
/** Trần tổng thời gian của cả check, kể cả khi mỗi worktree dùng một bundle khác nhau. */
const CREW_DOCS_TOTAL_BUDGET_MS = 60_000;

function crewDocsConfigScript(dir: string): string {
  return [
    `cd ${shQuote(dir)} || exit 90`,
    'echo "BUNDLE=$(git config --get crew-docs.bundle)"',
    'echo "RUNTIME=$(git config --get crew-docs.runtime)"',
    'echo "GITDIR=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"',
  ].join('; ');
}

/** Chạy bundle bằng đúng thứ hook dùng: `node` theo PATH của agent, hoặc runtime Electron với ELECTRON_RUN_AS_NODE. */
function crewDocsVersionScript(bundle: string, runtime: string | null): string {
  const run =
    runtime === null
      ? `node ${shQuote(bundle)} --version`
      : `ELECTRON_RUN_AS_NODE=1 ${shQuote(runtime)} ${shQuote(bundle)} --version`;
  const check =
    runtime === null
      ? `[ -f ${shQuote(bundle)} ]`
      : `[ -f ${shQuote(bundle)} ] && [ -x ${shQuote(runtime)} ]`;
  return `${check} || { echo CREW_MISSING; exit 92; }; ${run}`;
}

/**
 * Hợp đồng cho integrator: trong worktree có `docs/flows.yaml`, `node "$(git config --get crew-docs.bundle)" check
 * --range <base>..<head>` phải chạy được, và hook pre-commit (runtime + bundle từ git config) cũng vậy. Kiểm bằng
 * chính sshd agent như `checkWrapper`, để bắt treo TCC mà process của doctor (đã có quyền) không thấy.
 */
async function checkCrewDocs(ctx: MacContext, paths: MacPaths, manifest: Manifest): Promise<CheckResult> {
  const base = { id: 'crew-docs', title: 'crew-docs cho integrator' };
  if (!existsSync(manifest.worktreeRoot))
    return { ...base, status: 'warn', detail: 'chưa có thư mục worktree' };
  let repos: string[];
  try {
    repos = readdirSync(manifest.worktreeRoot)
      .filter((name) => !name.startsWith('.'))
      .map((name) => join(manifest.worktreeRoot, name))
      .filter((dir) => {
        try {
          // statSync theo symlink: worktree dạng link tới thư mục vẫn được kiểm.
          return statSync(dir).isDirectory() && existsSync(join(dir, 'docs', 'flows.yaml'));
        } catch {
          return false;
        }
      });
  } catch (err) {
    return {
      ...base,
      status: 'warn',
      detail: `không đọc được ${manifest.worktreeRoot}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (repos.length === 0) return { ...base, status: 'ok', detail: 'không có worktree nào dùng crew-docs' };

  const problems = new Set<string>();
  const timeoutNote = (what: string, sec: number) =>
    `${what} quá ${sec} giây (có thể do hộp thoại quyền đang chờ, xem check tcc-pending)`;
  const ssh = (command: string, timeoutMs: number) =>
    ctx.runner.run('ssh', sshArgs(paths, manifest, ctx.user, command), { timeoutMs });
  const startedAt = Date.now();
  let hung = false;
  const cache = new Map<string, Promise<string | null>>();
  const versionProblem = (bundle: string, runtime: string | null): Promise<string | null> => {
    const key = `${runtime ?? ''}\0${bundle}`;
    let cached = cache.get(key);
    if (!cached) {
      const label = runtime === null ? `node ${bundle}` : `${runtime} ${bundle}`;
      cached = ssh(crewDocsVersionScript(bundle, runtime), CREW_DOCS_RUN_TIMEOUT_MS).then((r) => {
        if (r.timedOut) {
          hung = true;
          return timeoutNote(label, CREW_DOCS_RUN_TIMEOUT_MS / 1000);
        }
        if (r.stdout.includes('CREW_MISSING')) return `${label}: file không tồn tại hoặc không chạy được`;
        return r.code === 0 ? null : `${label} --version mã ${r.code}`;
      });
      cache.set(key, cached);
    }
    return cached;
  };

  for (const dir of repos) {
    if (Date.now() - startedAt > CREW_DOCS_TOTAL_BUDGET_MS) {
      hung = true;
      problems.add(`quá ${CREW_DOCS_TOTAL_BUDGET_MS / 1000} giây cho cả check crew-docs`);
      break;
    }
    const cfg = await ssh(crewDocsConfigScript(dir), CREW_DOCS_CONFIG_TIMEOUT_MS);
    if (cfg.timedOut) {
      problems.add(`${dir}: ${timeoutNote('đọc git config', CREW_DOCS_CONFIG_TIMEOUT_MS / 1000)}`);
      hung = true;
      break;
    }
    if (cfg.code !== 0) {
      problems.add(
        `${dir}: không vào được qua sshd agent (mã ${cfg.code}): ${(cfg.stderr || cfg.stdout).trim().slice(0, 150)}`,
      );
      continue;
    }
    const field = (name: string) => new RegExp(`^${name}=(.*)$`, 'm').exec(cfg.stdout)?.[1]?.trim() ?? '';
    const [bundle, runtime, gitDir] = [field('BUNDLE'), field('RUNTIME'), field('GITDIR')];
    if (bundle === '') {
      problems.add(`${dir}: chưa có git config crew-docs.bundle`);
      continue;
    }
    if (runtime === '') problems.add(`${dir}: chưa có git config crew-docs.runtime (hook pre-commit cần)`);
    for (const [what, path] of [
      ['bundle', bundle],
      ['runtime', runtime],
      ['git dir', gitDir],
    ] as const) {
      const zone = path === '' ? null : tccProtectedReason(ctx.home, path);
      if (zone)
        problems.add(
          `${dir}: ${what} ${path} nằm dưới ${zone} (vùng TCC bảo vệ, agent qua sshd sẽ treo chờ hộp thoại)`,
        );
    }
    const nodeProblem = await versionProblem(bundle, null);
    if (nodeProblem) problems.add(`${dir}: ${nodeProblem}`);
    if (!hung && runtime !== '') {
      const runtimeProblem = await versionProblem(bundle, runtime);
      if (runtimeProblem) problems.add(`${dir}: ${runtimeProblem}`);
    }
    if (hung) break;
  }
  if (problems.size > 0) {
    return {
      ...base,
      status: 'fail',
      detail: [...problems].join('; ') + (hung ? '; dừng kiểm các worktree còn lại' : ''),
      hint:
        'Dời bundle/runtime và checkout gốc ra ngoài ~/Documents, ~/Desktop, ~/Downloads, /Volumes (ví dụ ~/crew-tools), ' +
        'rồi trong checkout gốc chạy "node <đường dẫn crew-docs.cjs> install-hooks" để đặt crew-docs.bundle và ' +
        'crew-docs.runtime (worktree dùng chung git config).',
    };
  }
  return {
    ...base,
    status: 'ok',
    detail: `${repos.length} worktree, bundle và runtime chạy được qua sshd agent`,
  };
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
  const agent = pending.filter((p) => isAgentTccSubject(p.subject, p.identifier));
  const other = pending.filter((p) => !isAgentTccSubject(p.subject, p.identifier));
  const describe = (list: PendingPrompt[]) =>
    list.map((p) => `${p.at} ${p.service} cho ${p.subject}`).join('; ');
  if (agent.length > 0) {
    return {
      ...base,
      status: 'fail',
      detail: [describe(agent), other.length > 0 ? `app khác: ${describe(other)}` : '', unreadable]
        .filter(Boolean)
        .join('; '),
      hint: agent.map(tccHint).join('\n'),
    };
  }
  if (other.length > 0) {
    return {
      ...base,
      status: 'warn',
      detail: [`không phải agent: ${describe(other)}`, unreadable].filter(Boolean).join('; '),
      hint: other.map(tccHint).join('\n'),
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
    ctx.runner.run('/usr/sbin/sysctl', ['-n', 'vm.loadavg'], { timeoutMs: 10_000 }),
    ctx.runner.run('/usr/sbin/sysctl', ['-n', 'hw.ncpu'], { timeoutMs: 10_000 }),
    ctx.runner.run('/usr/bin/memory_pressure', ['-Q'], { timeoutMs: 10_000 }),
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
  results.push(await checkReaper(ctx));
  results.push(await checkSshdPort(ctx, manifest));
  results.push(checkZshenv(paths));
  results.push(await checkWrapper(ctx, paths, manifest));
  results.push(checkLauncher(ctx, paths));
  results.push(checkSuperpowersPin(ctx));
  results.push(checkWorktreeRoot(ctx, manifest));
  results.push(await checkWorktreeWorkflows(ctx, manifest));
  results.push(await checkCrewDocs(ctx, paths, manifest));
  results.push(await checkClaudeAuth(ctx, paths, manifest));
  if (options.probe) results.push(await checkClaudePrint(ctx, paths, manifest, options.probeTimeoutSec));
  results.push(await checkTccPending(ctx, options.tccWindow));
  results.push(await checkLoad(ctx));
  return results;
}
