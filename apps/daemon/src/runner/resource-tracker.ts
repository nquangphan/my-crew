import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Env var every agent run (and so every child process) carries: the id of its job. */
export const JOB_TAG = 'CREW_JOB_ID';

export interface ProcessEntry {
  pid: number;
  ppid: number;
  pgid: number;
  rssKb: number;
  startedAt: string | null;
  command: string;
  /** Value of `CREW_JOB_ID` in the process env, when readable. */
  jobTag: string | null;
}

export interface JobProcess extends ProcessEntry {
  jobId: string;
  ports: number[];
}

export interface DockerContainer {
  id: string;
  name: string;
  createdAt: string;
  status: string;
}

export interface ResourceTrackerOptions {
  platform?: NodeJS.Platform;
  /** `docker` binary; null disables container reporting. */
  dockerBin?: string | null;
  uid?: number;
}

const TAG_RE = new RegExp(`(?:^|\\s)${JOB_TAG}=([A-Za-z0-9-]{8,64})(?=\\s|$)`);
const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024 * 1024, stdio: 'pipe' });

/** Parses `ps -o pid=,ppid=,pgid=,rss=,lstart=,command=` lines (lstart is five words). */
export function parsePsLines(out: string): Omit<ProcessEntry, 'jobTag'>[] {
  const entries: Omit<ProcessEntry, 'jobTag'>[] = [];
  for (const line of out.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const started = Date.parse(match[5] as string);
    entries.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      rssKb: Number(match[4]),
      startedAt: Number.isNaN(started) ? null : new Date(started).toISOString(),
      command: (match[6] as string).trim(),
    });
  }
  return entries;
}

/** Parses `lsof -nP -iTCP -sTCP:LISTEN -Fpn` into pid → listening ports. */
export function parseLsof(out: string): Map<number, number[]> {
  const ports = new Map<number, number[]>();
  let pid: number | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null) {
      const port = Number(line.slice(line.lastIndexOf(':') + 1));
      if (Number.isInteger(port) && port > 0) {
        const list = ports.get(pid) ?? [];
        if (!list.includes(port)) list.push(port);
        ports.set(pid, list);
      }
    }
  }
  return ports;
}

/** Parses docker's `2026-09-29 00:35:17 +0700 +07` (the trailing zone abbreviation is dropped). */
export function parseDockerTime(value: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)? ([+-])(\d{2}):?(\d{2})/.exec(
    value.trim(),
  );
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}T${match[2]}${match[3]}${match[4]}:${match[5]}`);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/** Bytes under a path (files and links counted by their own size); 0 when it does not exist. */
export function pathSize(path: string): number {
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(path);
  } catch {
    return 0;
  }
  if (!stats.isDirectory()) return stats.size;
  let total = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(path);
  } catch {
    return 0;
  }
  for (const entry of entries) total += pathSize(join(path, entry));
  return total;
}

/**
 * Finds the processes, ports and containers a job left behind. Only processes of this OS user are read,
 * and a process belongs to a job only when its env carries that job's `CREW_JOB_ID`, when it sits in the
 * job's process group, or when it descends from such a process (macOS hides the env of system binaries
 * such as `/bin/sleep`, so the tree and the group cover those).
 */
export class ResourceTracker {
  private readonly platform: NodeJS.Platform;
  private readonly dockerBin: string | null;
  private readonly uid: number;

  constructor(options: ResourceTrackerOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.dockerBin = options.dockerBin === undefined ? 'docker' : options.dockerBin;
    this.uid = options.uid ?? process.getuid?.() ?? 0;
  }

  listProcesses(): ProcessEntry[] {
    const format = 'pid=,ppid=,pgid=,rss=,lstart=,command=';
    let plain: Omit<ProcessEntry, 'jobTag'>[];
    try {
      plain = parsePsLines(run('ps', ['-ww', '-U', String(this.uid), '-o', format]));
    } catch {
      return [];
    }
    const tags = this.platform === 'linux' ? this.linuxTags(plain) : this.darwinTags();
    return plain.map((entry) => ({ ...entry, jobTag: tags.get(entry.pid) ?? null }));
  }

  /** macOS: `ps -E` appends the environment to the command column (not shown for system binaries). */
  private darwinTags(): Map<number, string> {
    const tags = new Map<number, string>();
    try {
      const out = run('ps', ['-Eww', '-U', String(this.uid), '-o', 'pid=,command=']);
      for (const line of out.split('\n')) {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        const tag = match ? TAG_RE.exec(match[2] as string) : null;
        if (match && tag) tags.set(Number(match[1]), tag[1] as string);
      }
    } catch {
      // no env visibility: only groups and descendants count
    }
    return tags;
  }

  /** Linux: `/proc/<pid>/environ` (readable for this user's own processes). */
  private linuxTags(entries: readonly Omit<ProcessEntry, 'jobTag'>[]): Map<number, string> {
    const tags = new Map<number, string>();
    for (const { pid } of entries) {
      try {
        const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
        const line = env.find((item) => item.startsWith(`${JOB_TAG}=`));
        if (line) tags.set(pid, line.slice(JOB_TAG.length + 1));
      } catch {
        // gone or not ours
      }
    }
    return tags;
  }

  listeningPorts(): Map<number, number[]> {
    try {
      return parseLsof(run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']));
    } catch (error) {
      // lsof exits 1 when nothing matches.
      const stdout = (error as { stdout?: string }).stdout;
      return typeof stdout === 'string' ? parseLsof(stdout) : new Map();
    }
  }

  /**
   * Every live process attributed to a job: by its tag, by the job's process group, or as a descendant.
   * `groups` maps a job's process group id to the job id.
   */
  jobProcesses(groups: ReadonlyMap<number, string> = new Map()): JobProcess[] {
    const entries = this.listProcesses();
    const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
    const self = new Set([process.pid, process.ppid]);
    const owner = new Map<number, string>();
    const resolveOwner = (entry: ProcessEntry, seen = new Set<number>()): string | null => {
      const known = owner.get(entry.pid);
      if (known !== undefined) return known;
      if (entry.jobTag) return entry.jobTag;
      const group = groups.get(entry.pgid);
      if (group) return group;
      if (seen.has(entry.pid)) return null;
      seen.add(entry.pid);
      const parent = byPid.get(entry.ppid);
      return parent && entry.ppid > 1 ? resolveOwner(parent, seen) : null;
    };
    for (const entry of entries) {
      if (self.has(entry.pid)) continue;
      const jobId = resolveOwner(entry);
      if (jobId) owner.set(entry.pid, jobId);
    }
    if (owner.size === 0) return [];
    const ports = this.listeningPorts();
    return entries
      .filter((entry) => owner.has(entry.pid))
      .map((entry) => ({
        ...entry,
        jobId: owner.get(entry.pid) as string,
        ports: ports.get(entry.pid) ?? [],
      }));
  }

  /** Every container docker lists (running or not), with its creation time. */
  listContainers(): DockerContainer[] {
    if (!this.dockerBin) return [];
    let out: string;
    try {
      out = run(this.dockerBin, [
        'ps',
        '-a',
        '--no-trunc',
        '--format',
        '{{.ID}}\t{{.Names}}\t{{.CreatedAt}}\t{{.Status}}',
      ]);
    } catch {
      return [];
    }
    const containers: DockerContainer[] = [];
    for (const line of out.split('\n')) {
      const [id, name, created, status] = line.split('\t');
      if (!id || !name || !created) continue;
      const parsed = parseDockerTime(created);
      if (parsed === null) continue;
      containers.push({ id, name, createdAt: parsed.toISOString(), status: status ?? '' });
    }
    return containers;
  }

  /** Containers created inside a job's time window (report only: containers are never stopped automatically). */
  containersCreatedBetween(from: Date, to: Date | null, all = this.listContainers()): DockerContainer[] {
    return all.filter((container) => {
      const created = Date.parse(container.createdAt);
      return created >= from.getTime() && (to === null || created <= to.getTime());
    });
  }

  stopContainer(id: string): void {
    if (!this.dockerBin) throw new Error('docker is not available');
    run(this.dockerBin, ['stop', id]);
  }
}
