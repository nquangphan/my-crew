import { rmSync } from 'node:fs';
import type { ResourceSnapshot } from '../scheduler/resource-monitor.js';
import type { CleanupRecord, JobRow, StateDb } from '../state-db.js';
import { jobTmpDir, jobTmpTag, listJobTmpDirs } from './job-cleanup.js';
import { pathSize, type ResourceTracker } from './resource-tracker.js';

export interface WorktreeEntry {
  projectKey: string;
  repo: string;
  key: string;
  path: string;
  /** Status of the ticket the worktree belongs to, null when unknown. */
  ticketStatus: string | null;
}

export interface ResourceReport {
  generatedAt: string;
  machine: ResourceSnapshot & { freeSlots: number };
  runningJobs: { jobId: string; ticketId: string; role: string; kind: string; startedAt: string | null }[];
  processes: {
    id: string;
    pid: number;
    jobId: string;
    ticketId: string | null;
    jobStatus: string | null;
    command: string;
    ports: number[];
    rssMb: number;
    startedAt: string | null;
    cleanable: boolean;
  }[];
  tmpDirs: {
    id: string;
    jobId: string;
    path: string;
    bytes: number;
    jobStatus: string | null;
    cleanable: boolean;
  }[];
  worktrees: (WorktreeEntry & { id: string; cleanable: boolean })[];
  /** Containers created while a job ran. Only stopped when the PM asks for one by id. */
  containers: {
    id: string;
    containerId: string;
    name: string;
    createdAt: string;
    jobId: string;
    status: string;
  }[];
  recentCleanups: CleanupRecord[];
}

export interface ResourceReportDeps {
  state: StateDb;
  tracker: ResourceTracker;
  tmpRoot: string;
  snapshot: () => ResourceSnapshot;
  freeSlots: () => number;
  /** Jobs this daemon process is running right now. */
  runningJobIds: () => ReadonlySet<string>;
  worktrees: () => Promise<WorktreeEntry[]>;
  removeWorktree: (entry: WorktreeEntry) => void;
  /** SIGTERM → SIGKILL grace for a stopped process. */
  graceMs?: number;
}

const CLOSED = new Set(['done', 'cancelled']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function buildResourceReport(deps: ResourceReportDeps): Promise<ResourceReport> {
  const running = deps.runningJobIds();
  const jobOf = (id: string): JobRow | null => deps.state.getJob(id);
  const runningJobs = deps.state
    .listJobs(['running'])
    .filter((job) => running.has(job.id))
    .map((job) => ({
      jobId: job.id,
      ticketId: job.ticketId,
      role: job.role,
      kind: job.kind,
      startedAt: job.startedAt,
    }));

  const groups = new Map<number, string>();
  for (const job of deps.state.listJobs(['running']))
    if (job.pgid && job.pgid > 1) groups.set(job.pgid, job.id);
  const processes = deps.tracker
    .jobProcesses(groups)
    .filter((proc) => jobOf(proc.jobId) !== null)
    .map((proc) => {
      const job = jobOf(proc.jobId);
      return {
        id: `process:${proc.pid}`,
        pid: proc.pid,
        jobId: proc.jobId,
        ticketId: job?.ticketId ?? null,
        jobStatus: job?.status ?? null,
        command: proc.command.length > 300 ? `${proc.command.slice(0, 300)}…` : proc.command,
        ports: proc.ports,
        rssMb: Math.round(proc.rssKb / 1024),
        startedAt: proc.startedAt,
        cleanable: !running.has(proc.jobId),
      };
    });

  const runningTags = new Set([...running].map(jobTmpTag));
  const tmpDirs = listJobTmpDirs(deps.tmpRoot, deps.state).map((entry) => {
    // A dir of a job this DB does not know keeps its short name as the job id.
    const jobId = entry.job?.id ?? entry.tag;
    return {
      id: `tmp:${jobId}`,
      jobId,
      path: entry.path,
      bytes: pathSize(entry.path),
      jobStatus: entry.job?.status ?? null,
      cleanable: !runningTags.has(entry.tag),
    };
  });

  const worktrees = (await deps.worktrees()).map((entry) => ({
    ...entry,
    id: `worktree:${entry.projectKey}/${entry.key}`,
    cleanable: entry.ticketStatus !== null && CLOSED.has(entry.ticketStatus),
  }));

  const containers: ResourceReport['containers'] = [];
  const seen = new Set<string>();
  const allContainers = deps.tracker.listContainers();
  for (const job of allContainers.length === 0 ? [] : deps.state.listJobs()) {
    if (!job.startedAt) continue;
    const found = deps.tracker.containersCreatedBetween(
      new Date(job.startedAt),
      job.endedAt ? new Date(job.endedAt) : null,
      allContainers,
    );
    for (const container of found) {
      if (seen.has(container.id)) continue;
      seen.add(container.id);
      containers.push({
        id: `container:${container.id}`,
        containerId: container.id,
        name: container.name,
        createdAt: container.createdAt,
        jobId: job.id,
        status: container.status,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    machine: { ...deps.snapshot(), freeSlots: deps.freeSlots() },
    runningJobs,
    processes,
    tmpDirs,
    worktrees,
    containers,
    recentCleanups: deps.state.cleanups({ limit: 20 }),
  };
}

/**
 * The PM's `resource_report` / `cleanup_resources` pair. Cleanup acts only on item ids the latest report
 * of this pair listed (and marked cleanable, or a container), so the agent cannot name arbitrary
 * processes or paths.
 */
export class ResourceOps {
  private last: ResourceReport | null = null;

  constructor(private readonly deps: ResourceReportDeps) {}

  async report(): Promise<ResourceReport> {
    this.last = await buildResourceReport(this.deps);
    return this.last;
  }

  async cleanup(
    items: string[],
  ): Promise<{ cleaned: string[]; refused: { item: string; reason: string }[] }> {
    const cleaned: string[] = [];
    const refused: { item: string; reason: string }[] = [];
    const report = this.last;
    if (!report) {
      return { cleaned, refused: items.map((item) => ({ item, reason: 'gọi resource_report trước' })) };
    }
    const perJob = new Map<
      string,
      { pids: number[]; ports: number[]; bytes: number; containers: string[] }
    >();
    const record = (jobId: string) => {
      const entry = perJob.get(jobId) ?? { pids: [], ports: [], bytes: 0, containers: [] };
      perJob.set(jobId, entry);
      return entry;
    };
    for (const item of [...new Set(items)]) {
      const proc = report.processes.find((p) => p.id === item);
      const tmp = report.tmpDirs.find((t) => t.id === item);
      const worktree = report.worktrees.find((w) => w.id === item);
      const container = report.containers.find((c) => c.id === item);
      try {
        if (proc) {
          if (!proc.cleanable) throw new Error('job của tiến trình này vẫn đang chạy');
          await this.stop(proc.pid);
          const entry = record(proc.jobId);
          entry.pids.push(proc.pid);
          entry.ports.push(...proc.ports);
        } else if (tmp) {
          if (!tmp.cleanable) throw new Error('job của thư mục này vẫn đang chạy');
          record(tmp.jobId).bytes += pathSize(tmp.path);
          rmSync(jobTmpDir(this.deps.tmpRoot, tmp.jobId), { recursive: true, force: true });
        } else if (worktree) {
          if (!worktree.cleanable) throw new Error('ticket của worktree này chưa đóng');
          this.deps.removeWorktree(worktree);
        } else if (container) {
          this.deps.tracker.stopContainer(container.containerId);
          record(container.jobId).containers.push(
            `${container.name} (${container.containerId.slice(0, 12)})`,
          );
        } else {
          throw new Error('mục này không có trong resource_report gần nhất');
        }
        cleaned.push(item);
      } catch (error) {
        refused.push({ item, reason: (error as Error).message });
      }
    }
    for (const [jobId, entry] of perJob) {
      this.deps.state.recordCleanup({
        jobId,
        pids: entry.pids,
        ports: [...new Set(entry.ports)],
        bytesFreed: entry.bytes,
        containers: entry.containers,
      });
    }
    return { cleaned, refused };
  }

  private async stop(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
    const deadline = Date.now() + (this.deps.graceMs ?? 10_000);
    while (Date.now() < deadline && alive(pid)) await sleep(100);
    if (alive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
  }
}
