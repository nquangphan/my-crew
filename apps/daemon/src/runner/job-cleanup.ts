import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CleanupRecord, JobRow, StateDb } from '../state-db.js';
import { type JobProcess, pathSize, type ResourceTracker } from './resource-tracker.js';

export interface CleanupDeps {
  state: StateDb;
  tracker: ResourceTracker;
  /** `~/.crew/tmp`: per-job temp dirs live at `<tmpRoot>/<job id>`. */
  tmpRoot: string;
  /** SIGTERM → SIGKILL grace (10 s by default). */
  graceMs?: number;
}

export const jobTmpDir = (tmpRoot: string, jobId: string) => join(tmpRoot, jobId);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** A process group we may signal: never 0/1, never our own. */
function safeGroup(pgid: number | null): pgid is number {
  return pgid !== null && pgid > 1 && pgid !== process.pid;
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // already gone
  }
}

/**
 * Stops the processes of one job (SIGTERM to its process group and every tagged process, SIGKILL after
 * the grace period), deletes its temp dir and records what was cleaned in `job_cleanup`. Containers
 * started during the job are recorded but never stopped automatically.
 */
export async function cleanupJob(deps: CleanupDeps, job: JobRow): Promise<CleanupRecord> {
  const groups = new Map<number, string>();
  if (safeGroup(job.pgid)) groups.set(job.pgid, job.id);
  const procs = deps.tracker.jobProcesses(groups).filter((proc) => proc.jobId === job.id);
  const pids = procs.map((proc) => proc.pid);
  const ports = [...new Set(procs.flatMap((proc) => proc.ports))].sort((a, b) => a - b);

  if (safeGroup(job.pgid)) signal(-job.pgid, 'SIGTERM');
  for (const pid of pids) signal(pid, 'SIGTERM');
  const deadline = Date.now() + (deps.graceMs ?? 10_000);
  while (Date.now() < deadline && (pids.some(alive) || (safeGroup(job.pgid) && alive(-job.pgid)))) {
    await sleep(100);
  }
  if (safeGroup(job.pgid) && alive(-job.pgid)) signal(-job.pgid, 'SIGKILL');
  for (const pid of pids.filter(alive)) signal(pid, 'SIGKILL');

  const tmpDir = jobTmpDir(deps.tmpRoot, job.id);
  const bytesFreed = pathSize(tmpDir);
  rmSync(tmpDir, { recursive: true, force: true });

  const containers = job.startedAt
    ? deps.tracker
        .containersCreatedBetween(new Date(job.startedAt), job.endedAt ? new Date(job.endedAt) : new Date())
        .map((container) => `${container.name} (${container.id.slice(0, 12)})`)
    : [];
  return deps.state.recordCleanup({ jobId: job.id, pids, ports, bytesFreed, containers });
}

export interface SweepResult {
  processes: JobProcess[];
  tmpDirs: string[];
  cleaned: number;
}

/**
 * Finds what finished jobs left behind: tagged processes whose job is known here and not running, and
 * temp dirs of jobs that are not running. `runningJobIds` are the jobs this daemon process runs now.
 * Processes tagged with a job id this state DB does not know are left alone (another daemon's).
 */
export function findOrphans(
  deps: CleanupDeps,
  runningJobIds: ReadonlySet<string>,
): Omit<SweepResult, 'cleaned'> {
  const known = (jobId: string) => deps.state.getJob(jobId) !== null;
  const processes = deps.tracker
    .jobProcesses()
    .filter((proc) => !runningJobIds.has(proc.jobId) && known(proc.jobId));
  const tmpDirs = existsSync(deps.tmpRoot)
    ? readdirSync(deps.tmpRoot)
        .filter((name) => !runningJobIds.has(name))
        .map((name) => join(deps.tmpRoot, name))
    : [];
  return { processes, tmpDirs };
}

/** Cleans the orphans `findOrphans` reports, the same way end-of-job cleanup does, one record per job. */
export async function sweepOrphans(
  deps: CleanupDeps,
  runningJobIds: ReadonlySet<string>,
): Promise<SweepResult> {
  const found = findOrphans(deps, runningJobIds);
  const jobIds = new Set([
    ...found.processes.map((proc) => proc.jobId),
    ...found.tmpDirs.map((dir) => dir.slice(deps.tmpRoot.length + 1)),
  ]);
  let cleaned = 0;
  for (const jobId of jobIds) {
    const job = deps.state.getJob(jobId);
    if (job) {
      const record = await cleanupJob(deps, job);
      cleaned += record.pids.length + (found.tmpDirs.includes(jobTmpDir(deps.tmpRoot, jobId)) ? 1 : 0);
    } else {
      // A temp dir of a job this DB never knew: it is still under our own home, so it is ours to delete.
      rmSync(jobTmpDir(deps.tmpRoot, jobId), { recursive: true, force: true });
      cleaned += 1;
    }
  }
  return { ...found, cleaned };
}
