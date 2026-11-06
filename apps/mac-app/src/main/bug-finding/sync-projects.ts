import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute } from 'node:path';
import type { ProjectRow } from '../../shared/ipc-contract.js';
import type { JobOutcome, MachineJobKind } from '../jobs/types.js';
import type { PaperclipClient } from '../paperclip/types.js';

/**
 * Đồng bộ một chiều danh sách project Crew sang Bug Finding: 2P Crew ghi `crew/projects.json` trong thư mục dữ liệu
 * của Bug Finding (`bugFindingPaths().projectsFile`), Bug Finding đọc file đó rồi tạo/cập nhật project của mình
 * (`CrewBridge.swift` của repo `bug-finding`). Chỉ project có repo trên máy này mới vào danh sách.
 */

export const CREW_PROJECTS_SCHEMA = 'crew-projects/1';

export interface CrewProject {
  crewProjectId: string;
  key: string;
  name: string;
  repoPath: string;
}

export interface CrewProjectList {
  schema: typeof CREW_PROJECTS_SCHEMA;
  writtenAt: string;
  companyId: string;
  projects: CrewProject[];
}

export interface SyncResult {
  written: boolean;
  count: number;
}

/** Repo của project trên máy; `null` = chắc chắn không có. Ném `RepoUnknownError` khi chưa biết được (lỗi tạm thời). */
export type RepoResolver = (row: ProjectRow) => Promise<string | null>;

/** Không dò được repo lúc này (git quá hạn, ổ chưa mount...): giữ repo đã ghi lần trước cho project. */
export class RepoUnknownError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Chưa dò được repo của project lúc này', options);
    this.name = 'RepoUnknownError';
  }
}

/** Khóa project: tiến độ thêm project, không thì `<key>` của checkout `~/crew-agents/<key>/<vai>`, không thì tên. */
function projectKey(row: ProjectRow): string {
  if (row.progress?.key) return row.progress.key;
  for (const checkout of row.checkouts) {
    const projectDir = dirname(checkout.path);
    if (basename(dirname(projectDir)) === 'crew-agents') return basename(projectDir);
  }
  return row.name;
}

/** Số project dò repo cùng lúc (mỗi project có thể chờ git và một lời gọi server). */
export const RESOLVE_CONCURRENCY = 4;

/**
 * Danh sách project có repo trên máy, giữ thứ tự `rows`; dò tối đa `RESOLVE_CONCURRENCY` project cùng lúc. `previous`:
 * project của lần ghi trước (cùng company); project dò repo lỗi tạm thời (`RepoUnknownError`) thì giữ `repoPath` cũ
 * thay vì rớt khỏi danh sách (Bug Finding sẽ gắn "Crew đã gỡ"). `signal` bật thì không dò project mới và ném.
 */
export async function buildCrewProjectList(
  rows: ProjectRow[],
  resolveRepo: RepoResolver,
  companyId: string,
  now: () => Date = () => new Date(),
  previous: readonly CrewProject[] = [],
  signal?: AbortSignal,
): Promise<CrewProjectList> {
  // Tiến độ thêm dở chưa có project trên Paperclip: chưa có id Crew để Bug Finding gắn.
  const wanted = rows.filter((row) => row.projectId);
  const repos: Array<string | null> = wanted.map(() => null);
  const resolveOne = async (row: ProjectRow): Promise<string | null> => {
    try {
      return await resolveRepo(row);
    } catch (error) {
      if (!(error instanceof RepoUnknownError)) throw error;
      return previous.find((p) => p.crewProjectId === row.projectId)?.repoPath ?? null;
    }
  };
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < wanted.length) {
      const index = next++;
      const row = wanted[index];
      if (!row) return;
      signal?.throwIfAborted();
      try {
        repos[index] = await resolveOne(row);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(RESOLVE_CONCURRENCY, wanted.length) }, worker));
  signal?.throwIfAborted();
  const projects = wanted.flatMap((row, index): CrewProject[] => {
    const repoPath = repos[index];
    return repoPath ? [{ crewProjectId: row.projectId, key: projectKey(row), name: row.name, repoPath }] : [];
  });
  return { schema: CREW_PROJECTS_SCHEMA, writtenAt: now().toISOString(), companyId, projects };
}

export type GitCall = (args: string[]) => Promise<{ code: number; stdout: string; stderr?: string }>;

/** Repo chính của một thư mục (`git rev-parse --git-common-dir`, bỏ đuôi `.git`): `null` = chắc chắn không phải repo. */
type RepoProbe = { repo: string | null; unknown: boolean };

/**
 * `rootOnly`: thư mục phải là gốc repo hay gốc worktree (`--show-prefix` rỗng); thư mục con chưa phải repo nằm trong
 * một repo khác thì không nhận repo cha.
 */
async function probeRepo(git: GitCall, dir: string, rootOnly = false): Promise<RepoProbe> {
  const args = ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'];
  if (rootOnly) args.push('--show-prefix');
  const out = await git(args).catch(() => null);
  const [commonDir = '', prefix = ''] =
    out && out.code === 0 ? out.stdout.split('\n').map((s) => s.trim()) : [];
  if (commonDir && rootOnly && prefix) return { repo: null, unknown: false };
  if (commonDir)
    return { repo: basename(commonDir) === '.git' ? dirname(commonDir) : commonDir, unknown: false };
  return { repo: null, unknown: out?.code !== 128 || !/not a git repository/i.test(out?.stderr ?? '') };
}

/**
 * Đường dẫn chắc chắn không còn trên máy: không tồn tại, mà không nằm dưới `/Volumes/<ổ>` hay ổ đó đang mount (ổ chưa
 * mount thì chưa biết, giữ repo cũ).
 */
function pathGone(path: string, exists: (path: string) => boolean): boolean {
  if (exists(path)) return false;
  const volume = /^\/Volumes\/[^/]+/.exec(path)?.[0];
  return !volume || exists(volume);
}

/** Tra repo của project ở nguồn ngoài `app.json` (server). Ném khi chưa tra được (mất mạng, chưa đăng nhập, 5xx). */
export type ProjectRepoLookup = (row: ProjectRow) => Promise<string | null>;

/**
 * Repo của project trên máy: repo docs đã đăng ký (`docsRepo`), không thì thư mục gốc owner chọn lúc thêm project,
 * không thì repo chính của một checkout agent (`git rev-parse --git-common-dir`, bỏ đuôi `.git`), không thì `lookup`
 * (ba nguồn trên không cho repo: project không có tiến độ trong `app.json` như project dựng bằng `crew-mac` hay do
 * server dựng qua `ensure-project`, hoặc tiến độ thiếu thư mục): `repoPath` server ghi cho máy này
 * (`createMachineRepoLookup`), kiểm lại trên máy (đường dẫn tuyệt đối, phải là gốc repo hay worktree; đã xóa thì
 * chắc chắn không có). Checkout mà git báo rõ "not a git repository" thì bỏ qua; lỗi khác (quá hạn, thư mục chưa
 * mount, git không chạy được) hay `lookup` ném mà không nguồn nào có repo thì ném `RepoUnknownError`.
 */
export function createRepoResolver(
  git: GitCall,
  lookup?: ProjectRepoLookup,
  exists: (path: string) => boolean = existsSync,
): RepoResolver {
  return async (row) => {
    if (row.docsRepo) return row.docsRepo;
    if (row.progress?.folder) return row.progress.folder;
    let unknown = false;
    for (const checkout of row.checkouts) {
      const probe = await probeRepo(git, checkout.path);
      if (probe.repo) return probe.repo;
      unknown ||= probe.unknown;
    }
    if (lookup && row.projectId) {
      let path: string | null;
      try {
        path = await lookup(row);
      } catch (error) {
        throw new RepoUnknownError({ cause: error });
      }
      if (path && isAbsolute(path) && !pathGone(path, exists)) {
        const probe = await probeRepo(git, path, true);
        if (probe.repo) return probe.repo;
        unknown ||= probe.unknown;
      }
    }
    if (unknown) throw new RepoUnknownError();
    return null;
  };
}

export interface MachineRepoLookupDeps {
  client: Pick<PaperclipClient, 'machineRepoPath'>;
  companyId(): string | null;
  /** machineId của máy này (`jobTargets`); `null` khi máy chưa ghép. Gọi tối đa một lần cho mỗi lookup. */
  machineId(): Promise<string | null>;
  /** Ghi log (không có key): lỗi tra đầu tiên của lookup này. */
  log?(level: 'warn', event: string, fields: Record<string, unknown>): void;
}

/**
 * `repoPath` server ghi cho chính máy này của project (`project_machines`); chưa chọn company hay máy chưa ghép thì
 * `null`. Tạo mới cho mỗi lượt đồng bộ: `machineId` hỏi một lần cho cả lượt, lỗi tra chỉ ghi log một lần mỗi lượt.
 */
export function createMachineRepoLookup(deps: MachineRepoLookupDeps): ProjectRepoLookup {
  let machineId: Promise<string | null> | null = null;
  let logged = false;
  return async (row) => {
    try {
      const companyId = deps.companyId();
      machineId ??= deps.machineId();
      const machine = await machineId;
      if (!companyId || !machine) return null;
      return await deps.client.machineRepoPath(companyId, row.projectId, machine);
    } catch (error) {
      if (!logged) {
        logged = true;
        const e = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
        deps.log?.('warn', 'bug-finding-repo-lookup-failed', {
          projectId: row.projectId,
          ...(typeof e.status === 'number' ? { status: e.status } : {}),
          ...(typeof e.code === 'string' ? { code: e.code } : {}),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  };
}

export interface SyncProjectsDeps {
  /** `bugFindingPaths(home).projectsFile`. */
  file: string;
  companyId: string;
  /** `projects:list` của mac-app (project REST Paperclip ghép trạng thái Mac). */
  listRows(): Promise<ProjectRow[]>;
  resolveRepo: RepoResolver;
  now?: () => Date;
  /** Bật thì ngừng dò repo và ném (lượt review quá giờ), không ghi file. */
  signal?: AbortSignal;
}

async function readSavedList(file: string): Promise<Partial<CrewProjectList> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    return value && typeof value === 'object' ? (value as Partial<CrewProjectList>) : null;
  } catch {
    return null;
  }
}

/** Project hợp lệ của `projects.json` đã ghi (bỏ mục sai dạng). */
export function savedProjects(items: unknown[]): CrewProject[] {
  return items.flatMap((item) => {
    const p = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const { crewProjectId, key, name, repoPath } = p;
    const text = (v: unknown): v is string => typeof v === 'string' && v !== '';
    return text(crewProjectId) && text(key) && text(name) && text(repoPath)
      ? [{ crewProjectId, key, name, repoPath }]
      : [];
  });
}

/** `projects.json` hiện có ghi cho `companyId` và có project `projectId`: Bug Finding tra được project của lượt. */
export async function syncedProjectKnown(
  file: string,
  companyId: string,
  projectId: string,
): Promise<boolean> {
  const saved = await readSavedList(file);
  if (!saved || saved.companyId?.toLowerCase() !== companyId.toLowerCase()) return false;
  if (!Array.isArray(saved.projects)) return false;
  const id = projectId.toLowerCase();
  return savedProjects(saved.projects).some((p) => p.crewProjectId.toLowerCase() === id);
}

const sameContent = (a: Partial<CrewProjectList> | null, b: CrewProjectList) =>
  a !== null &&
  a.schema === b.schema &&
  a.companyId === b.companyId &&
  JSON.stringify(a.projects) === JSON.stringify(b.projects);

/** Ghi `projects.json` atomic (file tạm cùng thư mục rồi `rename`); nội dung không đổi (bỏ qua `writtenAt`) thì không ghi. */
export async function syncProjects(deps: SyncProjectsDeps): Promise<SyncResult> {
  const saved = await readSavedList(deps.file);
  const previous =
    saved?.companyId === deps.companyId && Array.isArray(saved.projects) ? savedProjects(saved.projects) : [];
  const list = await buildCrewProjectList(
    await deps.listRows(),
    deps.resolveRepo,
    deps.companyId,
    deps.now,
    previous,
    deps.signal,
  );
  const count = list.projects.length;
  if (sameContent(saved, list)) return { written: false, count };
  await mkdir(dirname(deps.file), { recursive: true });
  const tmp = `${deps.file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
    await rename(tmp, deps.file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  return { written: true, count };
}

const PROJECT_JOBS = new Set<MachineJobKind>([
  'prepare-checkouts',
  'agent-workspace',
  'ensure-project',
  'remove-checkouts',
]);

/** Việc máy vừa tạo hoặc gỡ checkout agent: danh sách project có repo trên máy có thể đã đổi. */
export function jobChangesProjects(kind: MachineJobKind, outcome: Pick<JobOutcome, 'status'>): boolean {
  return outcome.status === 'done' && PROJECT_JOBS.has(kind);
}

export interface SyncRunnerDeps {
  sync(signal?: AbortSignal): Promise<SyncResult>;
  log(level: 'info' | 'warn', event: string, fields?: Record<string, unknown>): void;
}

export interface SyncRunner {
  /** Nhờ đồng bộ (không chờ, không ném). Nhờ trong lúc đang đồng bộ thì chạy thêm đúng một lần sau lần đang chạy. */
  request(reason: string): void;
  /**
   * Đồng bộ ngay và trả kết quả (nút **Đồng bộ lại**); lỗi ném cho người gọi. `signal` bật thì ném ngay cho người gọi
   * (lần đồng bộ của lượt này dừng ở project kế tiếp).
   */
  runNow(reason: string, signal?: AbortSignal): Promise<SyncResult>;
  /** Chờ hết các lần đồng bộ đang chạy và đang chờ. */
  idle(): Promise<void>;
}

/** Chạy lần lượt (không hai lần ghi `projects.json` cùng lúc) và gộp các lần nhờ liền nhau. */
export function createSyncRunner(deps: SyncRunnerDeps): SyncRunner {
  let chain: Promise<unknown> = Promise.resolve();
  let pending: string[] | null = null;

  const once = async (reasons: string[], signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const result = await deps.sync(signal);
    if (result.written) deps.log('info', 'bug-finding-sync-written', { reasons, count: result.count });
    return result;
  };

  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = chain.then(run, run);
    chain = next.catch(() => undefined);
    return next;
  };

  return {
    request(reason) {
      if (pending) {
        pending.push(reason);
        return;
      }
      const reasons = [reason];
      pending = reasons;
      void enqueue(async () => {
        pending = null;
        try {
          await once(reasons);
        } catch (error) {
          deps.log('warn', 'bug-finding-sync-failed', {
            reasons,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
    runNow(reason, signal) {
      const run = enqueue(() => once([reason], signal));
      return signal ? untilAborted(run, signal) : run;
    },
    async idle() {
      while (true) {
        const current = chain;
        await current;
        if (current === chain) return;
      }
    },
  };
}

/** `promise`, hoặc ném `signal.reason` ngay khi `signal` bật (promise vẫn chạy tiếp, lỗi của nó không bị bỏ lơ). */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}
