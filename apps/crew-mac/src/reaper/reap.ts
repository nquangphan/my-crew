import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommandRunner } from '../system.js';
import { listProcesses } from './process-table.js';
import { type ReaperState, type ReapTarget, selectTargets } from './select.js';

export interface ReapDeps {
  runner: CommandRunner;
  /** pid âm là cả process group (như `kill -- -pgid`). */
  signal: (pid: number, sig: 'SIGTERM' | 'SIGKILL') => void;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  selfPid: number;
}

export interface ReapOptions {
  graceMs: number;
  termWaitMs: number;
  dryRun: boolean;
  statePath: string;
  logPath: string;
}

export function readReaperState(path: string): ReaperState {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ReaperState>;
    return {
      orphanSince: typeof raw.orphanSince === 'object' && raw.orphanSince !== null ? raw.orphanSince : {},
    };
  } catch {
    return { orphanSince: {} };
  }
}

export function vnTime(date: Date): string {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function send(deps: ReapDeps, pid: number, sig: 'SIGTERM' | 'SIGKILL'): void {
  try {
    deps.signal(pid, sig);
  } catch {
    // Process hoặc group đã thoát giữa chừng (ESRCH): bỏ qua.
  }
}

/** Những gì nhận TERM: cả group khi group chỉ gồm process của run, cộng các process con đã sang group khác. */
function termTargets(t: ReapTarget): number[] {
  return t.killGroup ? [-t.pgid, ...t.strays.map((s) => s.pid)] : t.pids;
}

export async function reapOnce(deps: ReapDeps, options: ReapOptions): Promise<ReapTarget[]> {
  const procs = await listProcesses(deps.runner);
  const { targets, nextState } = selectTargets(
    procs,
    readReaperState(options.statePath),
    deps.now(),
    options.graceMs,
    deps.selfPid,
  );
  const log: string[] = [];
  for (const t of targets) {
    log.push(
      `${vnTime(deps.now())} ${options.dryRun ? 'SẼ DỌN' : 'TERM'} run=${t.runId} pid=${t.pid} pgid=${t.pgid} ` +
        `pids=${t.pids.join(',')}${t.killGroup ? ' (cả group)' : ''} mồ côi từ ${vnTime(new Date(t.orphanSince))}`,
    );
  }
  if (!options.dryRun && targets.length > 0) {
    for (const t of targets) for (const pid of termTargets(t)) send(deps, pid, 'SIGTERM');
    await deps.sleep(options.termWaitMs);
    const alive = new Map((await listProcesses(deps.runner)).map((p) => [p.pid, p]));
    for (const t of targets) {
      // Chỉ KILL process còn đúng group đã ghi lúc chọn, tránh trúng pid đã bị tái dùng.
      const leftInGroup = t.pids.filter((pid) => alive.get(pid)?.pgid === t.pgid);
      const leftStrays = t.strays.filter((s) => alive.get(s.pid)?.pgid === s.pgid).map((s) => s.pid);
      if (t.killGroup) {
        if ([...alive.values()].some((p) => p.pgid === t.pgid)) send(deps, -t.pgid, 'SIGKILL');
        for (const pid of leftStrays) send(deps, pid, 'SIGKILL');
      } else {
        for (const pid of [...leftInGroup, ...leftStrays]) send(deps, pid, 'SIGKILL');
      }
      const left = [...leftInGroup, ...leftStrays];
      if (left.length > 0) log.push(`${vnTime(deps.now())} KILL run=${t.runId} pids=${left.join(',')}`);
      delete nextState.orphanSince[`${t.pid}:${t.runId}`];
    }
  }
  mkdirSync(dirname(options.statePath), { recursive: true, mode: 0o700 });
  writeFileSync(options.statePath, `${JSON.stringify(nextState, null, 2)}\n`, { mode: 0o600 });
  if (log.length > 0) appendFileSync(options.logPath, `${log.join('\n')}\n`);
  return targets;
}
