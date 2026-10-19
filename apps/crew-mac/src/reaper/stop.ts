import type { CommandRunner } from '../system.js';
import { listProcesses, type ProcInfo } from './process-table.js';

export interface StopDeps {
  runner: CommandRunner;
  /** pid âm là cả process group (như `kill -- -pgid`). */
  signal: (pid: number, sig: 'SIGTERM' | 'SIGKILL') => void;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  selfPid: number;
}

export interface StopResult {
  /** Số process được chọn để dừng. */
  matched: number;
  /** Số process còn sống sau thời gian chờ TERM, phải gửi KILL. */
  killed: number;
  /** Số process vẫn còn sau KILL. */
  remaining: number;
}

/** Chờ ngắn sau KILL trước khi đếm phần còn lại. */
const AFTER_KILL_MS = 200;

function send(deps: StopDeps, pid: number, sig: 'SIGTERM' | 'SIGKILL'): void {
  try {
    deps.signal(pid, sig);
  } catch {
    // Process hoặc group đã thoát giữa chừng (ESRCH): bỏ qua.
  }
}

/**
 * Cùng một process để gửi KILL: cùng pid và cùng thời điểm sinh (sai số 1 giây do etime làm tròn). Không xét pgid,
 * vì process có thể đổi group sau TERM. Thời điểm sinh không đọc được thì không KILL (có thể là pid đã cấp lại).
 */
function sameForKill(a: ProcInfo, b: ProcInfo): boolean {
  return (
    a.pid === b.pid &&
    Number.isFinite(a.startedAt) &&
    Number.isFinite(b.startedAt) &&
    Math.abs(a.startedAt - b.startedAt) <= 1
  );
}

/** Đếm phần còn lại thì thận trọng ngược lại: thời điểm sinh không đọc được vẫn tính là còn. */
function sameForCount(a: ProcInfo, b: ProcInfo): boolean {
  if (a.pid !== b.pid) return false;
  if (!Number.isFinite(a.startedAt) || !Number.isFinite(b.startedAt)) return true;
  return Math.abs(a.startedAt - b.startedAt) <= 1;
}

/**
 * Chia đích signal: group nào chỉ gồm process đã chọn (và không phải group của chính mình) thì gửi cả group,
 * còn lại gửi từng pid. `allowedGroups` giới hạn thêm: lúc KILL chỉ gửi theo group cho group đã nhận TERM theo group.
 */
function plan(
  procs: readonly ProcInfo[],
  chosen: readonly ProcInfo[],
  selfPid: number,
  allowedGroups?: ReadonlySet<number>,
): number[] {
  const chosenPids = new Set(chosen.map((p) => p.pid));
  const selfPgid = procs.find((p) => p.pid === selfPid)?.pgid ?? null;
  const groups = new Set<number>();
  for (const pgid of new Set(chosen.map((p) => p.pgid))) {
    if (pgid <= 1 || pgid === selfPgid || (allowedGroups !== undefined && !allowedGroups.has(pgid))) continue;
    if (procs.filter((q) => q.pgid === pgid).every((q) => chosenPids.has(q.pid))) groups.add(pgid);
  }
  const singles = chosen.filter((p) => !groups.has(p.pgid)).map((p) => p.pid);
  return [...[...groups].map((pgid) => -pgid), ...singles];
}

/** TERM, chờ `termWaitMs`, quét lại, KILL phần còn sống (chỉ đúng process đã chọn), rồi đếm phần còn lại. */
export async function stopMembers(
  deps: StopDeps,
  procs: readonly ProcInfo[],
  members: readonly number[],
  termWaitMs: number,
): Promise<StopResult> {
  const wanted = new Set(members.filter((pid) => pid > 1 && pid !== deps.selfPid));
  const chosen = procs.filter((p) => wanted.has(p.pid));
  if (chosen.length === 0) return { matched: 0, killed: 0, remaining: 0 };

  const termTargets = plan(procs, chosen, deps.selfPid);
  const termGroups = new Set(termTargets.filter((t) => t < 0).map((t) => -t));
  for (const target of termTargets) send(deps, target, 'SIGTERM');
  await deps.sleep(termWaitMs);

  const afterTerm = await listProcesses(deps.runner, deps.now());
  const survivors = afterTerm.filter((p) => chosen.some((c) => sameForKill(c, p)));
  // Process trùng pid mà thời điểm sinh không đọc được: không KILL (có thể là pid đã cấp lại) nhưng vẫn tính là còn.
  const unknown = afterTerm.filter(
    (p) => chosen.some((c) => sameForCount(c, p)) && !chosen.some((c) => sameForKill(c, p)),
  ).length;
  if (survivors.length === 0) return { matched: chosen.length, killed: 0, remaining: unknown };

  for (const target of plan(afterTerm, survivors, deps.selfPid, termGroups)) send(deps, target, 'SIGKILL');
  await deps.sleep(AFTER_KILL_MS);
  const afterKill = await listProcesses(deps.runner, deps.now());
  const remaining = afterKill.filter((p) => chosen.some((c) => sameForCount(c, p))).length;
  return { matched: chosen.length, killed: survivors.length, remaining };
}
