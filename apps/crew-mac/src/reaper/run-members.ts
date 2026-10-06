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
  if (spec.started === null) return false;
  if (p.startedAt < spec.started - CLOCK_SLACK_SEC) return false;
  return spec.nextStarted === null || p.startedAt < spec.nextStarted - CLOCK_SLACK_SEC;
}

/** Nhánh (a): claude `--print` mang đúng run id trong env, cùng mọi con cháu theo cây PPID. */
function claudeBranch(procs: readonly ProcInfo[], spec: RunSpec): Set<number> {
  const found = new Set<number>();
  for (const p of procs) {
    if (isClaudePrint(p) && p.runId === spec.runId)
      for (const pid of descendants(p.pid, procs)) found.add(pid);
  }
  return found;
}

/**
 * Process cần hỏi cwd cho nhánh mồ côi (b'): không tty, sinh trong cửa sổ của run, chưa thuộc nhánh (a), không mang
 * run id của run khác. Lọc trước để chỉ gọi lsof cho đúng các pid này.
 */
export function orphanCandidates(procs: readonly ProcInfo[], spec: RunSpec, selfPid: number): number[] {
  if (spec.root === null || spec.started === null) return [];
  const branch = claudeBranch(procs, spec);
  return procs
    .filter(
      (p) =>
        !neverTouch(p, selfPid) &&
        !branch.has(p.pid) &&
        p.tty === '??' &&
        inWindow(p, spec) &&
        (p.runId === null || p.runId === spec.runId),
    )
    .map((p) => p.pid)
    .sort((a, b) => a - b);
}

function underRoot(cwd: string, root: string): boolean {
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

  if (spec.pgid !== null && spec.pgid > 1) {
    for (const p of procs)
      if (p.pgid === spec.pgid && p.tty === '??' && inWindow(p, spec)) selected.add(p.pid);
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
): Promise<{ spec: RunSpec; members: number[] }> {
  const window = runWindow(readRunStarts(run.root), run.runId);
  const spec: RunSpec = {
    runId: run.runId,
    root: run.root,
    started: window.started,
    nextStarted: window.nextStarted,
    pgid: readRunPgid(run.root, run.runId),
  };
  const cwds = await readCwds(runner, orphanCandidates(procs, spec, selfPid));
  return { spec, members: selectRunMembers(procs, spec, selfPid, cwds) };
}
