import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandRunner } from '../system.js';
import { type ProcInfo, readCwds } from './process-table.js';

/**
 * Một run trên Mac. `started` là thời điểm SINH của process wrapper `crew-claude-run` (epoch giây), do wrapper ghi
 * vào `<root>/.paperclip-runtime/runs/<runId>/started`. `nextStarted` là `started` của run bắt đầu ngay sau run này
 * trong cùng worktree: process sinh từ mốc đó trở đi thuộc run sau.
 */
export interface RunSpec {
  runId: string;
  /** Worktree của run, đã resolve symlink (so sánh không phân biệt hoa thường). */
  root: string | null;
  started: number | null;
  nextStarted: number | null;
  /** Process group wrapper đã ghi (`pgid`); null khi không có. */
  pgid: number | null;
  /** Thời điểm máy khởi động (`kern.boottime`); sau `started` thì pid/pgid của run cũ không còn ý nghĩa. */
  bootTime: number | null;
}

/** `started` dùng được khi có và máy chưa khởi động lại sau đó; không thì bỏ nhánh (b') và (c). */
function usableStarted(spec: RunSpec): number | null {
  if (spec.started === null) return null;
  if (spec.bootTime !== null && spec.bootTime > spec.started) return null;
  return spec.started;
}

/** etime của ps làm tròn xuống giây nên so sánh thời điểm sinh có sai số 1 giây. */
const CLOCK_SLACK_SEC = 1;

export const SSHD_RE = /^(?:\/usr\/sbin\/sshd|\/usr\/libexec\/sshd-session|sshd-session|sshd)(?::|\s|$)/;

export function isClaudeExe(p: ProcInfo): boolean {
  const exe = p.command.split(/\s+/)[0] ?? '';
  return exe === 'claude' || exe.endsWith('/claude') || /\/claude\/versions\/[^/]+$/.test(exe);
}

export function isClaudePrint(p: ProcInfo): boolean {
  if (p.runId === null || !isClaudeExe(p)) return false;
  const tokens = p.command.split(/\s+/);
  return tokens.includes('--print') || tokens.includes('-p');
}

/** Basename của token đầu argv (argv[0] giữ nguyên đường symlink khi gọi, nên khớp theo basename). */
function exeBase(command: string): string {
  const exe = command.split(/\s+/)[0] ?? '';
  return exe.slice(exe.lastIndexOf('/') + 1);
}

/**
 * Subcommand = phần tử đầu tiên không bắt đầu bằng `-` sau binary. Adapter codex đặt `--search` TRƯỚC `exec` khi agent
 * bật search nên không thể đòi "ngay sau codex".
 */
function subcommand(command: string): string | undefined {
  return command
    .split(/\s+/)
    .slice(1)
    .find((t) => t !== '' && !t.startsWith('-'));
}

/** `codex exec` (alias `e`): run của adapter codex_local. */
const CODEX_EXEC = new Set(['exec', 'e']);
/**
 * GIẢ ĐỊNH A5 (chưa đo thật, chờ SP-O/FX-O): run OpenCode là `opencode run`, binary tên `opencode` hoặc `.opencode`
 * (shim Homebrew).
 */
const OPENCODE_BASENAMES = new Set(['opencode', '.opencode']);

/**
 * Process chính của một run agent (claude `--print`/`-p`, `codex exec`, `opencode run`) mang `PAPERCLIP_RUN_ID` trong
 * env. Không có run id thì là phiên của owner, không bao giờ nhận.
 */
export function isAgentPrint(p: ProcInfo): boolean {
  if (p.runId === null) return false;
  if (isClaudePrint(p)) return true;
  const base = exeBase(p.command);
  if (base === 'codex') return CODEX_EXEC.has(subcommand(p.command) ?? '');
  if (OPENCODE_BASENAMES.has(base)) return subcommand(p.command) === 'run';
  return false;
}

/**
 * Callback bridge Paperclip: adapter `claude_local` chạy `nohup node <worktree>/.paperclip-runtime/<adapter>/
 * paperclip-bridge/server/paperclip-bridge-server.mjs &` qua một lệnh SSH riêng nên bridge luôn có PPID 1.
 */
const BRIDGE_RE =
  /^(?:\S*\/)?node\s+(\/.+?)\/\.paperclip-runtime\/[^/\s]+\/paperclip-bridge\/server\/paperclip-bridge-server\.mjs$/;

/** Worktree của callback bridge, lấy từ đường dẫn file bridge trong argv (chưa resolve symlink); null nếu không phải bridge. */
export function bridgeRoot(p: ProcInfo): string | null {
  return BRIDGE_RE.exec(p.command)?.[1] ?? null;
}

export function descendants(rootPid: number, procs: readonly ProcInfo[]): number[] {
  const children = new Map<number, number[]>();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  const found: number[] = [];
  const seen = new Set<number>();
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    found.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return found;
}

function neverTouch(p: ProcInfo, selfPid: number): boolean {
  return p.pid <= 1 || p.pid === selfPid || SSHD_RE.test(p.comm);
}

function inWindow(p: ProcInfo, spec: RunSpec): boolean {
  const started = usableStarted(spec);
  if (started === null || !Number.isFinite(p.startedAt)) return false;
  if (p.startedAt < started - CLOCK_SLACK_SEC) return false;
  return spec.nextStarted === null || p.startedAt < spec.nextStarted - CLOCK_SLACK_SEC;
}

/** Nhánh (a): process chính của run (claude/codex/opencode) mang đúng run id trong env, cùng mọi con cháu theo cây PPID. */
function claudeBranch(procs: readonly ProcInfo[], spec: RunSpec): Set<number> {
  const found = new Set<number>();
  for (const p of procs) {
    if (isAgentPrint(p) && p.runId === spec.runId)
      for (const pid of descendants(p.pid, procs)) found.add(pid);
  }
  return found;
}

/**
 * Process cần hỏi cwd cho nhánh mồ côi (b'): không tty, sinh trong cửa sổ của run, chưa thuộc nhánh (a), không mang
 * run id của run khác. Lọc trước để chỉ gọi lsof cho đúng các pid này.
 */
export function orphanCandidates(procs: readonly ProcInfo[], spec: RunSpec, selfPid: number): number[] {
  if (spec.root === null || usableStarted(spec) === null) return [];
  const branch = claudeBranch(procs, spec);
  return procs
    .filter(
      (p) =>
        !neverTouch(p, selfPid) &&
        !branch.has(p.pid) &&
        bridgeRoot(p) === null &&
        p.tty === '??' &&
        inWindow(p, spec) &&
        (p.runId === null || p.runId === spec.runId),
    )
    .map((p) => p.pid)
    .sort((a, b) => a - b);
}

export function underRoot(cwd: string, root: string): boolean {
  const c = cwd.toLowerCase();
  const r = root.toLowerCase().replace(/\/+$/, '');
  return r === '' || c === r || c.startsWith(`${r}/`);
}

/**
 * Process của một run:
 * (a) claude của run và con cháu theo cây PPID, bất kể group hay session;
 * (b') process mồ côi: cwd dưới worktree, không tty, sinh trong cửa sổ của run, và chuỗi cha đi lên chỉ gặp launchd
 *      hoặc process cũng thỏa (b'); gặp process nào khác (Terminal, editor, app) thì loại;
 * (c) process trong group wrapper đã ghi, không tty, sinh trong cửa sổ của run.
 * Callback bridge Paperclip không bao giờ được chọn theo (b') hay (c): bridge sinh trước wrapper nên cửa sổ thời gian
 * không nhận diện được nó; lượt quét bridge của reaper xử lý riêng.
 * Không bao giờ chọn launchd, sshd/sshd-session hay chính process đang chạy.
 */
export function selectRunMembers(
  procs: readonly ProcInfo[],
  spec: RunSpec,
  selfPid: number,
  cwds: ReadonlyMap<number, string>,
): number[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const selected = claudeBranch(procs, spec);

  // (c) chỉ khi group đó vẫn là group của run: leader sinh đúng lúc run bắt đầu, hoặc group có con cháu của claude.
  // Không thì pgid có thể đã được cấp cho group khác (PID quay vòng).
  const started = usableStarted(spec);
  if (spec.pgid !== null && spec.pgid > 1 && started !== null) {
    const pgid = spec.pgid;
    const leader = byPid.get(pgid);
    const leaderIsRun =
      leader !== undefined &&
      Number.isFinite(leader.startedAt) &&
      Math.abs(leader.startedAt - started) <= CLOCK_SLACK_SEC;
    const hasClaudeBranch = procs.some((p) => p.pgid === pgid && selected.has(p.pid));
    if (leaderIsRun || hasClaudeBranch) {
      for (const p of procs)
        if (p.pgid === pgid && p.tty === '??' && bridgeRoot(p) === null && inWindow(p, spec))
          selected.add(p.pid);
    }
  }

  if (spec.root !== null) {
    const root = spec.root;
    const candidates = new Set(orphanCandidates(procs, spec, selfPid));
    const fits = (pid: number) => {
      const cwd = cwds.get(pid);
      return candidates.has(pid) && cwd !== undefined && underRoot(cwd, root);
    };
    for (const pid of candidates) {
      if (!fits(pid)) continue;
      let current = byPid.get(pid)?.ppid ?? 0;
      let ok = true;
      const seen = new Set<number>([pid]);
      while (current > 1) {
        if (seen.has(current) || !fits(current)) {
          ok = false;
          break;
        }
        seen.add(current);
        current = byPid.get(current)?.ppid ?? 0;
      }
      if (ok) selected.add(pid);
    }
  }

  return [...selected]
    .filter((pid) => {
      const p = byPid.get(pid);
      return p !== undefined && !neverTouch(p, selfPid);
    })
    .sort((a, b) => a - b);
}

/** `started` của mọi run trong `<root>/.paperclip-runtime/runs/`; bỏ qua mục không đọc được. */
export function readRunStarts(root: string): Map<string, number> {
  const dir = join(root, '.paperclip-runtime', 'runs');
  const starts = new Map<string, number>();
  if (!existsSync(dir)) return starts;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'started');
    try {
      if (!statSync(join(dir, name)).isDirectory()) continue;
      const value = Number(readFileSync(file, 'utf8').trim());
      if (Number.isInteger(value) && value > 0) starts.set(name, value);
    } catch {
      // Thiếu file started: bỏ qua run này.
    }
  }
  return starts;
}

/** Cửa sổ thời gian của một run: từ `started` của nó tới `started` của run bắt đầu ngay sau. */
export function runWindow(
  starts: ReadonlyMap<string, number>,
  runId: string,
): { started: number | null; nextStarted: number | null } {
  const started = starts.get(runId) ?? null;
  if (started === null) return { started: null, nextStarted: null };
  let nextStarted: number | null = null;
  for (const [id, value] of starts) {
    if (id !== runId && value > started && (nextStarted === null || value < nextStarted)) nextStarted = value;
  }
  return { started, nextStarted };
}

/** `pgid` wrapper đã ghi cho run; null khi thiếu hoặc hỏng. */
export function readRunPgid(root: string, runId: string): number | null {
  try {
    const value = Number(
      readFileSync(join(root, '.paperclip-runtime', 'runs', runId, 'pgid'), 'utf8').trim(),
    );
    return Number.isInteger(value) && value > 1 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Đủ bước cho một run: đọc `started`/`pgid` dưới worktree, lọc ứng viên mồ côi, hỏi cwd đúng các pid đó, rồi chọn.
 * `root` phải là đường dẫn đã resolve symlink.
 */
export async function collectRunMembers(
  runner: CommandRunner,
  procs: readonly ProcInfo[],
  run: { runId: string; root: string },
  selfPid: number,
  bootTime: number | null,
): Promise<{ spec: RunSpec; members: number[] }> {
  const window = runWindow(readRunStarts(run.root), run.runId);
  const spec: RunSpec = {
    runId: run.runId,
    root: run.root,
    started: window.started,
    nextStarted: window.nextStarted,
    pgid: readRunPgid(run.root, run.runId),
    bootTime,
  };
  const cwds = await readCwds(runner, orphanCandidates(procs, spec, selfPid));
  return { spec, members: selectRunMembers(procs, spec, selfPid, cwds) };
}
