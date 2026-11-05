import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
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
  constructor() {
    super('Chưa dò được repo của project lúc này');
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

/**
 * Danh sách project có repo trên máy. `previous`: project của lần ghi trước (cùng company); project dò repo lỗi tạm thời
 * (`RepoUnknownError`) thì giữ `repoPath` cũ thay vì rớt khỏi danh sách (Bug Finding sẽ gắn "Crew đã gỡ").
 */
export async function buildCrewProjectList(
  rows: ProjectRow[],
  resolveRepo: RepoResolver,
  companyId: string,
  now: () => Date = () => new Date(),
  previous: readonly CrewProject[] = [],
): Promise<CrewProjectList> {
  const projects: CrewProject[] = [];
  for (const row of rows) {
    // Tiến độ thêm dở chưa có project trên Paperclip: chưa có id Crew để Bug Finding gắn.
    if (!row.projectId) continue;
    let repoPath: string | null;
    try {
      repoPath = await resolveRepo(row);
    } catch (error) {
      if (!(error instanceof RepoUnknownError)) throw error;
      repoPath = previous.find((p) => p.crewProjectId === row.projectId)?.repoPath ?? null;
    }
    if (!repoPath) continue;
    projects.push({ crewProjectId: row.projectId, key: projectKey(row), name: row.name, repoPath });
  }
  return { schema: CREW_PROJECTS_SCHEMA, writtenAt: now().toISOString(), companyId, projects };
}

export type GitCall = (args: string[]) => Promise<{ code: number; stdout: string; stderr?: string }>;

/** Repo chính của một thư mục (`git rev-parse --git-common-dir`, bỏ đuôi `.git`): `null` = chắc chắn không phải repo. */
type RepoProbe = { repo: string | null; unknown: boolean };

async function probeRepo(git: GitCall, dir: string): Promise<RepoProbe> {
  const out = await git(['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir']).catch(
    () => null,
  );
  const commonDir = out && out.code === 0 ? out.stdout.trim() : '';
  if (commonDir)
    return { repo: basename(commonDir) === '.git' ? dirname(commonDir) : commonDir, unknown: false };
  return { repo: null, unknown: out?.code !== 128 || !/not a git repository/i.test(out?.stderr ?? '') };
}

/** Tra repo của project ở nguồn ngoài `app.json` (server). Ném khi chưa tra được (mất mạng, chưa đăng nhập, 5xx). */
export type ProjectRepoLookup = (row: ProjectRow) => Promise<string | null>;

/**
 * Repo của project trên máy: repo docs đã đăng ký (`docsRepo`), không thì thư mục gốc owner chọn lúc thêm project,
 * không thì repo chính của một checkout agent (`git rev-parse --git-common-dir`, bỏ đuôi `.git`), không thì (project
 * không có tiến độ trong `app.json`: dựng bằng `crew-mac` hay do server dựng qua `ensure-project`) `lookup`: `repoPath`
 * server ghi cho máy này (`createMachineRepoLookup`), kiểm lại bằng git trên máy. Checkout mà git báo rõ "not a git
 * repository" thì bỏ qua; lỗi khác (quá hạn, thư mục chưa mount, git không chạy được) hay `lookup` ném mà không nguồn
 * nào có repo thì ném `RepoUnknownError`.
 */
export function createRepoResolver(git: GitCall, lookup?: ProjectRepoLookup): RepoResolver {
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
      } catch {
        throw new RepoUnknownError();
      }
      if (path) {
        const probe = await probeRepo(git, path);
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
  /** machineId của máy này (`jobTargets`); `null` khi máy chưa ghép. */
  machineId(): Promise<string | null>;
}

/** `repoPath` server ghi cho chính máy này của project (`project_machines`); chưa chọn company hay máy chưa ghép thì `null`. */
export function createMachineRepoLookup(deps: MachineRepoLookupDeps): ProjectRepoLookup {
  return async (row) => {
    const companyId = deps.companyId();
    const machineId = await deps.machineId();
    if (!companyId || !machineId) return null;
    return deps.client.machineRepoPath(companyId, row.projectId, machineId);
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
  sync(): Promise<SyncResult>;
  log(level: 'info' | 'warn', event: string, fields?: Record<string, unknown>): void;
}

export interface SyncRunner {
  /** Nhờ đồng bộ (không chờ, không ném). Nhờ trong lúc đang đồng bộ thì chạy thêm đúng một lần sau lần đang chạy. */
  request(reason: string): void;
  /** Đồng bộ ngay và trả kết quả (nút **Đồng bộ lại**); lỗi ném cho người gọi. */
  runNow(reason: string): Promise<SyncResult>;
  /** Chờ hết các lần đồng bộ đang chạy và đang chờ. */
  idle(): Promise<void>;
}

/** Chạy lần lượt (không hai lần ghi `projects.json` cùng lúc) và gộp các lần nhờ liền nhau. */
export function createSyncRunner(deps: SyncRunnerDeps): SyncRunner {
  let chain: Promise<unknown> = Promise.resolve();
  let pending: string[] | null = null;

  const once = async (reasons: string[]) => {
    const result = await deps.sync();
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
    runNow(reason) {
      return enqueue(() => once([reason]));
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
