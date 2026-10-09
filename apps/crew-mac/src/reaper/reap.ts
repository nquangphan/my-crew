import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { rootGuardReason } from '../paths.js';
import type { CommandRunner } from '../system.js';
import { listProcesses, type ProcInfo, readBootTime, readCwds } from './process-table.js';
import { bridgeRoot, collectRunMembers, descendants, isClaudePrint, underRoot } from './run-members.js';
import { type BridgeSeen, type OrphanRun, type ReaperState, selectTargets } from './select.js';
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
  /** Thư mục worktree đã cài (`manifest.worktreeRoot`); null khi chưa cài: chỉ dọn con cháu của claude. */
  worktreeRoot: string | null;
  home: string;
}

export interface ReapTarget extends OrphanRun {
  /** Worktree của run = cwd của claude (đã resolve symlink); null khi không đọc được. */
  root: string | null;
  members: number[];
  /** Kết quả dừng; không có khi dry-run. */
  result?: StopResult;
}

/** Callback bridge không có run sống trong worktree quá thời hạn này thì bị dọn. */
export const BRIDGE_GRACE_MS = 120_000;

function isBridgeSeen(value: unknown): value is BridgeSeen {
  const v = value as Partial<BridgeSeen> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.since === 'string' &&
    Number.isFinite(Date.parse(v.since)) &&
    typeof v.startedAt === 'number' &&
    Number.isFinite(v.startedAt)
  );
}

export function readReaperState(path: string): ReaperState {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ReaperState>;
    const bridges = typeof raw.bridgeSince === 'object' && raw.bridgeSince !== null ? raw.bridgeSince : {};
    return {
      orphanSince: typeof raw.orphanSince === 'object' && raw.orphanSince !== null ? raw.orphanSince : {},
      bridgeSince: Object.fromEntries(Object.entries(bridges).filter(([, v]) => isBridgeSeen(v))),
    };
  } catch {
    return { orphanSince: {}, bridgeSince: {} };
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
  const state = readReaperState(options.statePath);
  const { targets: orphans, nextState } = selectTargets(
    procs,
    state,
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
  const bootTime = orphans.length > 0 ? await readBootTime(deps.runner) : null;
  const targets: ReapTarget[] = [];
  const log: string[] = [];
  for (const orphan of orphans) {
    const cwdRoot = realOrNull(claudeCwds.get(orphan.pid));
    // Chỉ quét theo cwd khi worktree nằm hẳn dưới thư mục worktree đã cài (không phải /, HOME hay cha của HOME).
    const root =
      cwdRoot !== null &&
      options.worktreeRoot !== null &&
      rootGuardReason(cwdRoot, options.home, options.worktreeRoot) === null
        ? cwdRoot
        : null;
    // Không đọc được worktree thì chỉ còn nhánh con cháu của claude.
    const members =
      root === null
        ? descendants(orphan.pid, procs).filter((pid) => pid !== deps.selfPid)
        : (await collectRunMembers(deps.runner, procs, { runId: orphan.runId, root }, deps.selfPid, bootTime))
            .members;
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
  nextState.bridgeSince = await sweepBridges(deps, options, procs, state.bridgeSince, log);
  mkdirSync(dirname(options.statePath), { recursive: true, mode: 0o700 });
  writeFileSync(options.statePath, `${JSON.stringify(nextState, null, 2)}\n`, { mode: 0o600 });
  if (log.length > 0) appendFileSync(options.logPath, `${log.join('\n')}\n`);
  return targets;
}

/**
 * Lượt quét callback bridge Paperclip sót lại. Adapter khởi bridge bằng `nohup … &` qua một lệnh SSH riêng (nên PPID
 * 1 là bình thường) và tắt nó bằng `stop()` khi run xong; `stop()` không tới được Mac thì bridge sống mãi. Bridge
 * được nhận theo đường dẫn file bridge trong argv, không theo giờ. Chỉ dọn khi worktree của nó (dưới thư mục worktree
 * đã cài) không còn claude `--print` nào có run id, liên tục quá `BRIDGE_GRACE_MS`. Không đọc được cwd của một claude
 * nào đó thì bỏ cả lượt, vì không chắc bridge đó không thuộc run đang chạy.
 */
async function sweepBridges(
  deps: ReapDeps,
  options: ReapOptions,
  procs: readonly ProcInfo[],
  seen: Readonly<Record<string, BridgeSeen>>,
  log: string[],
): Promise<Record<string, BridgeSeen>> {
  const next: Record<string, BridgeSeen> = {};
  const worktreeRoot = options.worktreeRoot;
  if (worktreeRoot === null) return next;
  const bridges = procs
    .filter((p) => p.ppid === 1 && p.tty === '??' && p.pid !== deps.selfPid && Number.isFinite(p.startedAt))
    .map((p) => ({ p, root: realOrNull(bridgeRoot(p) ?? undefined) }))
    .filter(
      (b): b is { p: ProcInfo; root: string } =>
        b.root !== null && rootGuardReason(b.root, options.home, worktreeRoot) === null,
    );
  if (bridges.length === 0) return next;
  const claudes = procs.filter((p) => isClaudePrint(p) && p.pid !== deps.selfPid);
  const claudeCwds =
    claudes.length > 0
      ? await readCwds(
          deps.runner,
          claudes.map((p) => p.pid),
        )
      : new Map();
  const liveCwds = claudes.map((p) => realOrNull(claudeCwds.get(p.pid)));
  if (liveCwds.some((cwd) => cwd === null)) return { ...seen };
  for (const { p, root } of bridges) {
    if (liveCwds.some((cwd) => underRoot(cwd as string, root))) continue;
    const key = String(p.pid);
    const prev = seen[key];
    // etime làm tròn xuống giây: lệch 1 giây vẫn là cùng bridge; lệch hơn là pid đã cấp lại.
    const entry =
      prev !== undefined && Math.abs(prev.startedAt - p.startedAt) <= 1
        ? prev
        : { since: deps.now().toISOString(), startedAt: p.startedAt };
    next[key] = entry;
    const since = entry.since;
    if (deps.now().getTime() - Date.parse(since) < BRIDGE_GRACE_MS) continue;
    log.push(
      `${vnTime(deps.now())} ${options.dryRun ? 'SẼ DỌN' : 'TERM'} bridge pid=${p.pid} root=${root} ` +
        `không có run sống từ ${vnTime(new Date(since))}`,
    );
    if (!options.dryRun) {
      const r = await stopMembers(deps, procs, [p.pid], options.termWaitMs);
      log.push(
        `${vnTime(deps.now())} XONG bridge pid=${p.pid} matched=${r.matched} killed=${r.killed} remaining=${r.remaining}`,
      );
      delete next[key];
    }
  }
  return next;
}
