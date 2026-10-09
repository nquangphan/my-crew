import { isClaudePrint, type ProcInfo } from '@crew/mac';
import type { ActiveRun } from '../../shared/ipc-contract.js';

export interface ActiveRunsDeps {
  listProcesses: () => Promise<ProcInfo[]>;
  readCwds: (pids: number[]) => Promise<Map<number, string>>;
}

/**
 * Run đang chạy trên máy = `claude --print` có `PAPERCLIP_RUN_ID` trong env. Đọc bảng process, không hỏi listener,
 * nên vẫn đúng khi listener đã chết (phiên SSH được launchd nhận nuôi).
 */
export async function activeRuns(deps: ActiveRunsDeps): Promise<ActiveRun[]> {
  const procs = await deps.listProcesses();
  const runs = procs.filter((p) => p.runId !== null && isClaudePrint(p));
  if (runs.length === 0) return [];
  const cwd = await deps.readCwds(runs.map((p) => p.pid));
  return runs.map((p) => ({
    pid: p.pid,
    runId: p.runId as string,
    worktree: cwd.get(p.pid) ?? null,
    startedAt: p.startedAt,
    children: procs.filter((c) => c.ppid === p.pid).length,
  }));
}
