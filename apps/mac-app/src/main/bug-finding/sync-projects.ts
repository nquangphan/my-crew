import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { ProjectRow } from '../../shared/ipc-contract.js';
import type { JobOutcome, MachineJobKind } from '../jobs/types.js';

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

export type RepoResolver = (row: ProjectRow) => Promise<string | null>;

/** Khóa project: tiến độ thêm project, không thì `<key>` của checkout `~/crew-agents/<key>/<vai>`, không thì tên. */
function projectKey(row: ProjectRow): string {
  if (row.progress?.key) return row.progress.key;
  for (const checkout of row.checkouts) {
    const projectDir = dirname(checkout.path);
    if (basename(dirname(projectDir)) === 'crew-agents') return basename(projectDir);
  }
  return row.name;
}

export async function buildCrewProjectList(
  rows: ProjectRow[],
  resolveRepo: RepoResolver,
  companyId: string,
  now: () => Date = () => new Date(),
): Promise<CrewProjectList> {
  const projects: CrewProject[] = [];
  for (const row of rows) {
    // Tiến độ thêm dở chưa có project trên Paperclip: chưa có id Crew để Bug Finding gắn.
    if (!row.projectId) continue;
    const repoPath = await resolveRepo(row);
    if (!repoPath) continue;
    projects.push({ crewProjectId: row.projectId, key: projectKey(row), name: row.name, repoPath });
  }
  return { schema: CREW_PROJECTS_SCHEMA, writtenAt: now().toISOString(), companyId, projects };
}

export type GitCall = (args: string[]) => Promise<{ code: number; stdout: string }>;

/**
 * Repo của project trên máy: repo docs đã đăng ký (`docsRepo`), không thì thư mục gốc owner chọn lúc thêm project,
 * không thì repo chính của một checkout agent (`git rev-parse --git-common-dir`, bỏ đuôi `.git`).
 */
export function createRepoResolver(git: GitCall): RepoResolver {
  return async (row) => {
    if (row.docsRepo) return row.docsRepo;
    if (row.progress?.folder) return row.progress.folder;
    for (const checkout of row.checkouts) {
      const out = await git([
        '-C',
        checkout.path,
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ]).catch(() => null);
      const commonDir = out && out.code === 0 ? out.stdout.trim() : '';
      if (!commonDir) continue;
      return basename(commonDir) === '.git' ? dirname(commonDir) : commonDir;
    }
    return null;
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

const sameContent = (a: Partial<CrewProjectList> | null, b: CrewProjectList) =>
  a !== null &&
  a.schema === b.schema &&
  a.companyId === b.companyId &&
  JSON.stringify(a.projects) === JSON.stringify(b.projects);

/** Ghi `projects.json` atomic (file tạm cùng thư mục rồi `rename`); nội dung không đổi (bỏ qua `writtenAt`) thì không ghi. */
export async function syncProjects(deps: SyncProjectsDeps): Promise<SyncResult> {
  const list = await buildCrewProjectList(await deps.listRows(), deps.resolveRepo, deps.companyId, deps.now);
  const count = list.projects.length;
  if (sameContent(await readSavedList(deps.file), list)) return { written: false, count };
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
