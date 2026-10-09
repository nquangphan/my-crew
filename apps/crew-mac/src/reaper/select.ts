import type { ProcInfo } from './process-table.js';
import { isClaudePrint, SSHD_RE } from './run-members.js';

export { isClaudePrint };

/** Callback bridge Paperclip đang được đếm giờ: thấy lần đầu lúc `since`, thời điểm sinh `startedAt` (epoch giây). */
export interface BridgeSeen {
  since: string;
  startedAt: number;
}

export interface ReaperState {
  orphanSince: Record<string, string>;
  /** Theo pid của bridge PPID 1 mà worktree không còn run sống. */
  bridgeSince: Record<string, BridgeSeen>;
}

/** claude `--print` của một run đã mồ côi quá thời hạn. */
export interface OrphanRun {
  pid: number;
  runId: string;
  orphanSince: string;
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

export function selectTargets(
  procs: ProcInfo[],
  state: Pick<ReaperState, 'orphanSince'>,
  now: Date,
  graceMs: number,
  selfPid: number,
): { targets: OrphanRun[]; nextState: ReaperState } {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const nextState: ReaperState = { orphanSince: {}, bridgeSince: {} };
  const targets: OrphanRun[] = [];
  for (const p of procs) {
    if (p.pid === selfPid || !isClaudePrint(p) || !isOrphaned(p, byPid)) continue;
    const runId = p.runId as string;
    const key = `${p.pid}:${runId}`;
    const since = state.orphanSince[key] ?? now.toISOString();
    nextState.orphanSince[key] = since;
    if (now.getTime() - Date.parse(since) < graceMs) continue;
    targets.push({ pid: p.pid, runId, orphanSince: since });
  }
  return { targets, nextState };
}
