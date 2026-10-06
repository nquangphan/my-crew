import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommandRunner } from '../system.js';
import { listProcesses, readCwds } from './process-table.js';
import { collectRunMembers, descendants } from './run-members.js';
import { type OrphanRun, type ReaperState, selectTargets } from './select.js';
import { type StopResult, stopMembers } from './stop.js';

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

export interface ReapTarget extends OrphanRun {
  /** Worktree của run = cwd của claude (đã resolve symlink); null khi không đọc được. */
  root: string | null;
  members: number[];
  /** Kết quả dừng; không có khi dry-run. */
  result?: StopResult;
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

function realOrNull(path: string | undefined): string | null {
  if (path === undefined) return null;
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

export async function reapOnce(deps: ReapDeps, options: ReapOptions): Promise<ReapTarget[]> {
  const procs = await listProcesses(deps.runner, deps.now());
  const { targets: orphans, nextState } = selectTargets(
    procs,
    readReaperState(options.statePath),
    deps.now(),
    options.graceMs,
    deps.selfPid,
  );
  const claudeCwds =
    orphans.length > 0
      ? await readCwds(
          deps.runner,
          orphans.map((o) => o.pid),
        )
      : new Map();
  const targets: ReapTarget[] = [];
  const log: string[] = [];
  for (const orphan of orphans) {
    const root = realOrNull(claudeCwds.get(orphan.pid));
    // Không đọc được worktree thì chỉ còn nhánh con cháu của claude.
    const members =
      root === null
        ? descendants(orphan.pid, procs).filter((pid) => pid !== deps.selfPid)
        : (await collectRunMembers(deps.runner, procs, { runId: orphan.runId, root }, deps.selfPid)).members;
    const target: ReapTarget = { ...orphan, root, members };
    log.push(
      `${vnTime(deps.now())} ${options.dryRun ? 'SẼ DỌN' : 'TERM'} run=${orphan.runId} pid=${orphan.pid} ` +
        `root=${root ?? '?'} pids=${members.join(',')} mồ côi từ ${vnTime(new Date(orphan.orphanSince))}`,
    );
    if (!options.dryRun) {
      target.result = await stopMembers(deps, procs, members, options.termWaitMs);
      const r = target.result;
      log.push(
        `${vnTime(deps.now())} XONG run=${orphan.runId} matched=${r.matched} killed=${r.killed} remaining=${r.remaining}`,
      );
      delete nextState.orphanSince[`${orphan.pid}:${orphan.runId}`];
    }
    targets.push(target);
  }
  mkdirSync(dirname(options.statePath), { recursive: true, mode: 0o700 });
  writeFileSync(options.statePath, `${JSON.stringify(nextState, null, 2)}\n`, { mode: 0o600 });
  if (log.length > 0) appendFileSync(options.logPath, `${log.join('\n')}\n`);
  return targets;
}
