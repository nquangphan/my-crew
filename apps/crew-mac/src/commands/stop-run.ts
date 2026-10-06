import { existsSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listProcesses } from '../reaper/process-table.js';
import { collectRunMembers } from '../reaper/run-members.js';
import { type StopDeps, type StopResult, stopMembers } from '../reaper/stop.js';

export const RUN_ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StopRunOptions {
  runId: string;
  /** Worktree của run, đường dẫn tuyệt đối. */
  root: string;
  termWaitMs: number;
}

export interface StopRunResult extends StopResult {
  members: number[];
}

/** Dòng kết quả duy nhất mà phía server (H3) đọc. */
export function formatStopLine(result: StopResult): string {
  return `crew-stop matched=${result.matched} killed=${result.killed} remaining=${result.remaining}`;
}

/**
 * Dừng mọi process của một run: con cháu của claude, group wrapper đã ghi và tool mồ côi trong worktree (xem
 * `selectRunMembers`). Không còn process nào thì xóa `<root>/.paperclip-runtime/runs/<runId>`.
 */
export async function stopRun(deps: StopDeps, options: StopRunOptions): Promise<StopRunResult> {
  const root = existsSync(options.root) ? realpathSync(options.root) : resolve(options.root);
  const procs = await listProcesses(deps.runner, deps.now());
  const { members } = await collectRunMembers(
    deps.runner,
    procs,
    { runId: options.runId, root },
    deps.selfPid,
  );
  const result = await stopMembers(deps, procs, members, options.termWaitMs);
  if (result.remaining === 0) {
    rmSync(join(root, '.paperclip-runtime', 'runs', options.runId), { recursive: true, force: true });
  }
  return { ...result, members };
}
