import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CleanupRecord, JobRow, StateDb } from '../state-db.js';
import { type JobProcess, pathSize, type ResourceTracker } from './resource-tracker.js';

export interface CleanupDeps {
  state: StateDb;
  tracker: ResourceTracker;
  /** Short root (`/tmp/crew-<uid>/<home tag>`): per-job temp dirs live at `<tmpRoot>/<first 8 chars of job id>`. */
  tmpRoot: string;
  /** SIGTERM → SIGKILL grace (10 s by default). */
  graceMs?: number;
}

/** Name of a job's temp dir: the first 8 characters of its id (a UUID), kept short for Unix sockets. */
export const jobTmpTag = (jobId: string) => jobId.slice(0, 8);

export const jobTmpDir = (tmpRoot: string, jobId: string) => join(tmpRoot, jobTmpTag(jobId));

/** Where tools that create Unix sockets (Playwright via `PWTEST_SOCKETS_DIR`) put them for this job. */
export const jobSocketsDir = (tmpDir: string) => join(tmpDir, 'pw');

/**
 * Creates `dir` with mode 0700, or accepts an existing one only when it is a real directory (not a
 * symlink) owned by this user with no group/other access. The temp root lives under the world-writable
 * `/tmp`, so a directory another user planted there must never be used.
 */
function ensurePrivateDir(dir: string): void {
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = lstatSync(dir);
  const uid = process.getuid?.();
  if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o077) !== 0) {
    throw new Error(`thư mục tạm ${dir} không an toàn (phải là thư mục của user này, quyền 0700)`);
  }
}

/** Creates the temp root (and its per-user parent) safely. */
export function ensureTmpRoot(tmpRoot: string): void {
  ensurePrivateDir(dirname(tmpRoot));
  ensurePrivateDir(tmpRoot);
}

/** Creates a job's temp dir and its sockets dir; returns both paths. */
export function ensureJobTmpDir(tmpRoot: string, jobId: string): { tmpDir: string; socketsDir: string } {
  ensureTmpRoot(tmpRoot);
  const tmpDir = jobTmpDir(tmpRoot, jobId);
  ensurePrivateDir(tmpDir);
  const socketsDir = jobSocketsDir(tmpDir);
  ensurePrivateDir(socketsDir);
  return { tmpDir, socketsDir };
}

/** A temp dir under the root, with the job it belongs to (null when this state DB does not know it). */
export interface JobTmpEntry {
  path: string;
  tag: string;
  job: JobRow | null;
}

export function listJobTmpDirs(tmpRoot: string, state: StateDb): JobTmpEntry[] {
  if (!existsSync(tmpRoot)) return [];
  return readdirSync(tmpRoot).map((tag) => ({
    path: join(tmpRoot, tag),
    tag,
    job: state.getJobByIdPrefix(tag),
  }));
}

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
  const runningTags = new Set([...runningJobIds].map(jobTmpTag));
  const tmpDirs = listJobTmpDirs(deps.tmpRoot, deps.state)
    .filter((entry) => !runningTags.has(entry.tag))
    .map((entry) => entry.path);
  return { processes, tmpDirs };
}

/** Cleans the orphans `findOrphans` reports, the same way end-of-job cleanup does, one record per job. */
export async function sweepOrphans(
  deps: CleanupDeps,
  runningJobIds: ReadonlySet<string>,
): Promise<SweepResult> {
  const found = findOrphans(deps, runningJobIds);
  const jobIds = new Set(found.processes.map((proc) => proc.jobId));
  let cleaned = 0;
  for (const path of found.tmpDirs) {
    const job = deps.state.getJobByIdPrefix(path.slice(deps.tmpRoot.length + 1));
    if (job) {
      jobIds.add(job.id);
      cleaned += 1;
    } else {
      // A temp dir of a job this DB never knew: it is under this daemon's own temp root, so ours to delete.
      rmSync(path, { recursive: true, force: true });
      cleaned += 1;
    }
  }
  for (const jobId of jobIds) {
    const job = deps.state.getJob(jobId);
    if (job) cleaned += (await cleanupJob(deps, job)).pids.length;
  }
  return { ...found, cleaned };
}
