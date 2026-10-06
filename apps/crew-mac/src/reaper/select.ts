import type { ProcInfo } from './process-table.js';

export interface ReaperState {
  orphanSince: Record<string, string>;
}

export interface ReapTarget {
  pid: number;
  runId: string;
  pgid: number;
  /** claude, mọi process con và process cùng group có cùng run id. */
  pids: number[];
  /** Được gửi signal cho cả process group (`-pgid`): group chỉ gồm process của đúng run này. */
  killGroup: boolean;
  /** Process con đã sang group khác: gửi signal riêng, kèm pgid lúc chọn để tránh pid bị tái dùng. */
  strays: { pid: number; pgid: number }[];
  orphanSince: string;
}

const SSHD_RE = /^(?:\/usr\/sbin\/sshd|\/usr\/libexec\/sshd-session|sshd-session|sshd)(?::|\s|$)/;

function isClaudeExe(p: ProcInfo): boolean {
  const exe = p.command.split(/\s+/)[0] ?? '';
  return exe === 'claude' || exe.endsWith('/claude') || /\/claude\/versions\/[^/]+$/.test(exe);
}

export function isClaudePrint(p: ProcInfo): boolean {
  if (p.runId === null || !isClaudeExe(p)) return false;
  const tokens = p.command.split(/\s+/);
  return tokens.includes('--print') || tokens.includes('-p');
}

/** Mồ côi khi chuỗi tổ tiên không còn sshd hay sshd-session: phiên SSH của run đã mất. */
export function isOrphaned(p: ProcInfo, byPid: ReadonlyMap<number, ProcInfo>): boolean {
  const seen = new Set<number>();
  let current = p.ppid;
  while (current > 1 && !seen.has(current)) {
    seen.add(current);
    const parent = byPid.get(current);
    if (!parent) return true;
    if (SSHD_RE.test(parent.comm)) return false;
    current = parent.ppid;
  }
  return true;
}

function descendants(rootPid: number, procs: readonly ProcInfo[]): number[] {
  const children = new Map<number, number[]>();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  const found: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (found.includes(pid)) continue;
    found.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return found;
}

/**
 * Group an toàn để gửi signal cả group: không phải group của reaper, không có sshd, không có phiên claude
 * không mang run id (phiên tương tác của owner) và không có process của run khác.
 */
export function groupIsRunOnly(
  pgid: number,
  runId: string,
  procs: readonly ProcInfo[],
  selfPgid: number | null,
): boolean {
  if (pgid <= 1 || pgid === selfPgid) return false;
  return procs
    .filter((q) => q.pgid === pgid)
    .every((q) => !SSHD_RE.test(q.comm) && (q.runId === runId || (q.runId === null && !isClaudeExe(q))));
}

export function selectTargets(
  procs: ProcInfo[],
  state: ReaperState,
  now: Date,
  graceMs: number,
  selfPid: number,
): { targets: ReapTarget[]; nextState: ReaperState } {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const selfPgid = byPid.get(selfPid)?.pgid ?? null;
  const nextState: ReaperState = { orphanSince: {} };
  const targets: ReapTarget[] = [];
  for (const p of procs) {
    if (!isClaudePrint(p) || !isOrphaned(p, byPid)) continue;
    const runId = p.runId as string;
    const key = `${p.pid}:${runId}`;
    const since = state.orphanSince[key] ?? now.toISOString();
    nextState.orphanSince[key] = since;
    if (now.getTime() - Date.parse(since) < graceMs) continue;
    const sameRunInGroup = procs.filter((q) => q.pgid === p.pgid && q.runId === runId).map((q) => q.pid);
    const pids = [...new Set([...descendants(p.pid, procs), ...sameRunInGroup])]
      .filter((pid) => pid > 1 && pid !== selfPid)
      .sort((a, b) => a - b);
    const strays = pids
      .map((pid) => byPid.get(pid))
      .filter((q): q is ProcInfo => q !== undefined && q.pgid !== p.pgid)
      .map((q) => ({ pid: q.pid, pgid: q.pgid }));
    const killGroup = groupIsRunOnly(p.pgid, runId, procs, selfPgid) && !pids.includes(selfPid);
    targets.push({ pid: p.pid, runId, pgid: p.pgid, pids, killGroup, strays, orphanSince: since });
  }
  return { targets, nextState };
}
