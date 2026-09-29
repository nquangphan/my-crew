import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { type BmadInstall, readBmadInstall } from '@crew/daemon';
import type { BmadInstallPlan, BmadLocalInstall, BmadProfile, ProjectBmadView } from '@crew/shared';
import { type HostContext, HostError } from './host-context.js';

/**
 * "Cài BMAD" (Settings → Projects): runs the `bmad-method` installer of the project's BMAD profile in this
 * machine's folder, non-interactively. It never downgrades, never copies `_bmad/custom` or `_bmad/memory`
 * (the profile holds neither) and never commits: files the installer adds stay untracked for the owner.
 */

/** Below the 10-minute limit of a forwarded app request, leaving time for the inventory re-probe. */
export const BMAD_INSTALL_TIMEOUT_MS = 7 * 60_000;
/** How long the result waits for the inventory re-probe before telling the owner to refresh later. */
const REPROBE_WAIT_MS = 90_000;
/** Output lines written to app.log per install (the UI gets every line). */
const MAX_LOGGED_LINES = 400;
const TAIL_LINES = 20;

/**
 * Repo paths crew-docs rule R6 protects (docs-kit `PROTECTED_PATTERNS`): an agent may not commit them without
 * the owner's approval, so files the installer adds there are only reported.
 */
const R6_PROTECTED = [
  '.claude/',
  '.githooks/',
  'CLAUDE.md',
  '.husky/',
  'lefthook.yml',
  'lefthook.yaml',
  '.lefthook.yml',
  '.lefthook.yaml',
  '.github/workflows/crew-docs.yml',
  '.github/crew-docs/',
];

const isProtected = (path: string) =>
  R6_PROTECTED.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));

export interface BmadRunInput {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  onLine: (line: string) => void;
}

export interface BmadRunOutcome {
  code: number | null;
  timedOut: boolean;
}

/** Runs `npx <args>`; rejects with an `ENOENT` error when npx is not installed. */
export type BmadRunner = (input: BmadRunInput) => Promise<BmadRunOutcome>;

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences start with ESC
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

/** Splits a stream into clean lines (ANSI colours and spinner redraws removed). */
function lineReader(onLine: (line: string) => void): { push: (chunk: string) => void; end: () => void } {
  let buffer = '';
  const emit = (raw: string) => {
    const line = (raw.split('\r').at(-1) ?? '').replace(ANSI, '').trimEnd();
    if (line.trim() !== '') onLine(line);
  };
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) emit(line);
    },
    end() {
      if (buffer) emit(buffer);
      buffer = '';
    },
  };
}

/** The real runner: `npx` in its own process group, so a timeout stops the installer and every child. */
export const npxRunner: BmadRunner = ({ args, cwd, env, timeoutMs, onLine }) =>
  new Promise((resolve, reject) => {
    const child = spawn('npx', args, {
      cwd,
      env: { ...env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const out = lineReader(onLine);
    const err = lineReader(onLine);
    child.stdout.setEncoding('utf8').on('data', out.push);
    child.stderr.setEncoding('utf8').on('data', err.push);
    let timedOut = false;
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        // already gone
      }
    };
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => signalGroup('SIGKILL'), 5_000);
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      out.end();
      err.end();
      resolve({ code, timedOut });
    });
  });

/** Orders `6.10.0` after `6.9.0`, and a release after its pre-releases (`6.0.0-Beta.2` < `6.0.0`). */
export function compareBmadVersions(a: string, b: string): number {
  const split = (version: string) => {
    const [core = '', pre = ''] = version.replace(/^v/, '').split('-', 2);
    return { parts: core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre };
  };
  const left = split(a);
  const right = split(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre.localeCompare(right.pre, 'en', { numeric: true }) < 0 ? -1 : 1;
}

export function bmadInstallPlan(
  profile: BmadProfile | null,
  local: BmadLocalInstall | null,
): BmadInstallPlan {
  if (!profile) return 'no_profile';
  if (!local) return 'install';
  const order = compareBmadVersions(local.version, profile.version);
  if (order > 0) return 'newer';
  if (order === 0 && profile.modules.every((module) => local.modules.includes(module))) return 'skip';
  return 'update';
}

const union = (...lists: readonly (readonly string[])[]) => [...new Set(lists.flat())];

/**
 * `npx` arguments of the non-interactive install. An update keeps the modules and tools already installed
 * here (the installer removes unselected ones); `core` is always installed, so it is not listed.
 */
export function bmadInstallerArgs(
  profile: BmadProfile,
  repoPath: string,
  local: Pick<BmadInstall, 'modules' | 'tools'> | null,
): string[] {
  const modules = union(profile.modules, local?.modules ?? []).filter((module) => module !== 'core');
  // A fresh `--yes` install requires tools; crew agents run Claude Code.
  const tools = union(profile.tools, local?.tools ?? []);
  const args = ['-y', `bmad-method@${profile.version}`, 'install', '--yes', '--directory', repoPath];
  if (modules.length > 0) args.push('--modules', modules.join(','));
  args.push('--tools', (tools.length > 0 ? tools : ['claude-code']).join(','));
  if (profile.communicationLanguage) args.push('--communication-language', profile.communicationLanguage);
  if (profile.documentOutputLanguage) args.push('--document-output-language', profile.documentOutputLanguage);
  if (profile.outputFolder) args.push('--output-folder', profile.outputFolder);
  for (const setting of profile.settings)
    args.push('--set', `${setting.module}.${setting.key}=${setting.value}`);
  if (local) args.push('--action', 'update');
  return args;
}

/** The install in `repoPath`, or null when there is none (or the manifest cannot be read). */
export function localBmadInstall(repoPath: string | null): BmadInstall | null {
  if (!repoPath || !existsSync(repoPath)) return null;
  try {
    return readBmadInstall(repoPath);
  } catch {
    return null;
  }
}

export function bmadView(profile: BmadProfile | null, repoPath: string | null): ProjectBmadView {
  const install = localBmadInstall(repoPath);
  const local = install ? { version: install.version, modules: install.modules } : null;
  return { profile, local, plan: bmadInstallPlan(profile, local) };
}

const NETWORK =
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|getaddrinfo|fetch failed|network|socket hang up|Could not resolve host|unable to access 'https/i;

function failureText(version: string, code: number | null, tail: readonly string[]): string {
  const last = tail.slice(-3).join(' · ');
  if (tail.some((line) => NETWORK.test(line))) {
    return `Lỗi mạng khi tải bmad-method@${version} hoặc module của nó: kiểm tra kết nối Internet rồi thử lại. (${last})`;
  }
  return `Trình cài BMAD thất bại (mã thoát ${code ?? 'không rõ'})${last ? `: ${last}` : '.'}`;
}

/** `git status` entries (status letters and path) of the folder; empty when git cannot answer. */
function gitStatus(repoPath: string): Set<string> {
  const run = spawnSync('git', ['-C', repoPath, 'status', '--porcelain', '--untracked-files=all', '-z'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (run.status !== 0) return new Set();
  return new Set(run.stdout.split('\0').filter((entry) => entry.length > 3));
}

/** Paths the install added or changed without committing them, and those R6 protects. */
function leftUncommitted(before: ReadonlySet<string>, repoPath: string) {
  const all = [...gitStatus(repoPath)].filter((entry) => !before.has(entry)).map((entry) => entry.slice(3));
  return { all, protectedPaths: all.filter(isProtected) };
}

export interface BmadInstallDeps {
  runner: BmadRunner;
  /** Re-probes the project's inventory; resolves with the skill count, or null when the daemon is not running. */
  reprobe: () => Promise<number | null>;
  timeoutMs?: number;
}

export interface BmadInstallOutcome {
  status: 'skipped' | 'installed' | 'updated';
  message: string;
}

/**
 * Installs the project's BMAD profile into `repoPath`. Skips when this version with every profile module is
 * already there; refuses to downgrade; afterwards checks the manifest and re-probes the inventory.
 */
export async function installBmad(
  ctx: HostContext,
  key: string,
  profile: BmadProfile | null,
  repoPath: string,
  deps: BmadInstallDeps,
): Promise<BmadInstallOutcome> {
  if (!profile) throw new HostError('Chưa có cấu hình BMAD (máy đang giữ project chưa có BMAD).');
  if (!existsSync(repoPath)) throw new HostError(`Không thấy thư mục ${repoPath} của ${key} trên máy này.`);
  await ctx.folderAccess(repoPath);
  const before = localBmadInstall(repoPath);
  const plan = bmadInstallPlan(profile, before);
  if (plan === 'skip') {
    return { status: 'skipped', message: `Đã có BMAD ${profile.version} với đủ module.` };
  }
  if (plan === 'newer') {
    throw new HostError(
      `Máy này đã có BMAD ${before?.version} mới hơn cấu hình (${profile.version}); app không hạ cấp BMAD.`,
    );
  }

  const args = bmadInstallerArgs(profile, repoPath, before);
  const statusBefore = gitStatus(repoPath);
  const timeoutMs = deps.timeoutMs ?? BMAD_INSTALL_TIMEOUT_MS;
  const tail: string[] = [];
  let logged = 0;
  const started = Date.now();
  ctx.log('info', 'bmad-install-started', { project: key, version: profile.version, plan, args });
  let outcome: BmadRunOutcome;
  try {
    outcome = await deps.runner({
      args,
      cwd: repoPath,
      env: ctx.deps.env,
      timeoutMs,
      onLine: (line) => {
        tail.push(line);
        if (tail.length > TAIL_LINES) tail.shift();
        ctx.deps.emit('bmad.progress', { key, line });
        if (logged < MAX_LOGGED_LINES) {
          logged += 1;
          ctx.log('info', 'bmad-install-output', { project: key, line });
        }
      },
    });
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    ctx.log('warn', 'bmad-install-failed', { project: key, error: (error as Error).message });
    throw new HostError(
      missing
        ? 'Không tìm thấy npx trên máy: cài Node.js (có kèm npx) rồi thử lại.'
        : `Không chạy được trình cài BMAD: ${(error as Error).message}`,
    );
  }
  const ms = Date.now() - started;
  if (outcome.timedOut) {
    ctx.log('warn', 'bmad-install-failed', { project: key, ms, reason: 'timeout', tail });
    throw new HostError(
      `Cài BMAD quá ${Math.round(timeoutMs / 60_000)} phút nên đã dừng: kiểm tra mạng rồi thử lại.`,
    );
  }
  if (outcome.code !== 0) {
    ctx.log('warn', 'bmad-install-failed', { project: key, ms, code: outcome.code, tail });
    throw new HostError(failureText(profile.version, outcome.code, tail));
  }

  const after = localBmadInstall(repoPath);
  const missingModules = profile.modules.filter((module) => !after?.modules.includes(module));
  if (!after || compareBmadVersions(after.version, profile.version) !== 0 || missingModules.length > 0) {
    const found = after ? `BMAD ${after.version} (module: ${after.modules.join(', ')})` : 'không có _bmad';
    ctx.log('warn', 'bmad-install-failed', { project: key, ms, reason: 'mismatch', found });
    throw new HostError(
      `Trình cài BMAD chạy xong nhưng thư mục chưa khớp cấu hình ${profile.version}: đang có ${found}.`,
    );
  }

  const status = before ? 'updated' : 'installed';
  const parts = [
    `${before ? `Đã cập nhật BMAD ${before.version} lên` : 'Đã cài BMAD'} ${profile.version} (module: ${after.modules.join(', ')}).`,
  ];
  const files = leftUncommitted(statusBefore, repoPath);
  if (files.all.length > 0) {
    parts.push(`Không commit gì: ${files.all.length} file mới hoặc đã đổi đang chờ trong thư mục project.`);
  }
  if (files.protectedPaths.length > 0) {
    const sample = files.protectedPaths.slice(0, 3).join(', ');
    parts.push(
      `${files.protectedPaths.length} file nằm trong vùng luật R6 bảo vệ (${sample}${files.protectedPaths.length > 3 ? ', …' : ''}) nên để nguyên, chưa commit; chỉ commit khi chủ dự án cho phép.`,
    );
  }
  let lateTimer: NodeJS.Timeout | undefined;
  const skills = await Promise.race([
    deps.reprobe().catch(() => undefined),
    new Promise<'late'>((resolve) => {
      lateTimer = setTimeout(() => resolve('late'), REPROBE_WAIT_MS);
    }),
  ]).finally(() => clearTimeout(lateTimer));
  if (typeof skills === 'number') parts.push(`Đã dò lại kho skill: ${skills} skill.`);
  else if (skills === null) parts.push('Daemon chưa chạy nên kho skill được dò lại khi daemon chạy.');
  else if (skills === 'late') {
    parts.push('Kho skill đang được dò lại; bấm "Làm mới" sau ít phút để xem skill BMAD.');
  } else parts.push('Chưa dò lại được kho skill; bấm "Làm mới" để thử lại.');
  ctx.log('info', 'bmad-install-finished', {
    project: key,
    ms,
    status,
    version: profile.version,
    uncommitted: files.all.length,
    protectedUncommitted: files.protectedPaths.length,
  });
  return { status, message: parts.join(' ') };
}
