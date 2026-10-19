import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { rootGuardReason } from '../paths.js';
import { listProcesses, readBootTime } from '../reaper/process-table.js';
import { collectRunMembers } from '../reaper/run-members.js';
import { type StopDeps, type StopResult, stopMembers } from '../reaper/stop.js';

export const RUN_ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Đầu vào sai: CLI thoát 2. */
export class StopRunInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StopRunInputError';
  }
}

export interface StopRunOptions {
  runId: string;
  /** Worktree của run, đường dẫn tuyệt đối. */
  root: string;
  termWaitMs: number;
  /** Thư mục worktree đã cài (`manifest.worktreeRoot`): `root` phải nằm hẳn dưới nó. */
  allowedRoot: string;
  home: string;
}

export interface StopRunResult extends StopResult {
  members: number[];
}

/** Dòng kết quả duy nhất mà phía server (H3) đọc. */
export function formatStopLine(result: StopResult): string {
  return `crew-stop matched=${result.matched} killed=${result.killed} remaining=${result.remaining}`;
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Dừng mọi process của một run: con cháu của claude, group wrapper đã ghi và tool mồ côi trong worktree (xem
 * `selectRunMembers`). Không còn process nào thì xóa `<root>/.paperclip-runtime/runs/<runId>`, trừ khi đường dẫn đi
 * qua symlink.
 */
export async function stopRun(deps: StopDeps, options: StopRunOptions): Promise<StopRunResult> {
  if (!RUN_ID_UUID.test(options.runId)) throw new StopRunInputError('runId phải là UUID');
  if (!isAbsolute(options.root)) throw new StopRunInputError('root phải là đường dẫn tuyệt đối');
  const reason = rootGuardReason(options.root, options.home, options.allowedRoot);
  if (reason !== null) throw new StopRunInputError(reason);

  const root = existsSync(options.root) ? realpathSync(options.root) : resolve(options.root);
  const procs = await listProcesses(deps.runner, deps.now());
  const bootTime = await readBootTime(deps.runner);
  const { members } = await collectRunMembers(
    deps.runner,
    procs,
    { runId: options.runId, root },
    deps.selfPid,
    bootTime,
  );
  const result = await stopMembers(deps, procs, members, options.termWaitMs);
  const runtime = join(root, '.paperclip-runtime');
  const runs = join(runtime, 'runs');
  if (result.remaining === 0 && !isSymlink(runtime) && !isSymlink(runs)) {
    rmSync(join(runs, options.runId), { recursive: true, force: true });
  }
  return { ...result, members };
}
