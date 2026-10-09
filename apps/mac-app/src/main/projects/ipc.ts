import type { AddProjectInput, ProjectRow } from '../../shared/ipc-contract.js';
import type { ProjectProgress } from '../app-state.js';
import { addProject, runGit } from './add-project.js';
import { type ProjectDeps, roleNames } from './progress.js';
import { removeProject } from './remove-project.js';

export interface ProjectsIpcOptions {
  /** Dựng deps mới cho mỗi lời gọi (client Paperclip đọc lại origin và key). Ném khi chưa đăng nhập. */
  deps: () => ProjectDeps;
  /** Commit rút gọn của HEAD trong một checkout; `null` khi thư mục không phải repo. Mặc định dùng `git`. */
  headOf?: (path: string, env: NodeJS.ProcessEnv) => Promise<string | null>;
}

const ROLE_ORDER = roleNames(2);

async function gitHead(path: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const r = await runGit(['-C', path, 'rev-parse', '--short', 'HEAD'], { env, timeoutMs: 10_000 });
  return r.code === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null;
}

function byRole(a: string, b: string): number {
  const rank = (role: string) => {
    const i = ROLE_ORDER.indexOf(role);
    return i === -1 ? ROLE_ORDER.length : i;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

/**
 * Ba kênh `projects:*`. `list` ghép project từ REST Paperclip với trạng thái Mac: tiến độ và checkout trong
 * `app.json`, repo ảnh chụp docs (`listStatusRepos`, kèm commit đã gửi cuối). Tiến độ thêm dở mà Paperclip chưa có
 * project vẫn hiện (projectId rỗng) để owner bấm "Chạy tiếp".
 */
export function createProjectsIpc(options: ProjectsIpcOptions) {
  const headOf = options.headOf ?? gitHead;

  return {
    async list(): Promise<ProjectRow[]> {
      const deps = options.deps();
      const companyId = deps.store.get().setup.companyId;
      if (!companyId) throw new Error('Chưa chọn company Paperclip (mục Cài đặt)');
      const [projects, repos] = await Promise.all([
        deps.client.projects(companyId),
        deps.ops.call('listStatusRepos'),
      ]);
      const progresses = Object.values(deps.store.get().projects);

      const rowOf = async (
        projectId: string,
        name: string,
        progress: ProjectProgress | null,
      ): Promise<ProjectRow> => {
        const repo = projectId ? repos.find((r) => r.projectId === projectId) : undefined;
        const checkouts = await Promise.all(
          Object.entries(progress?.agents ?? {})
            .filter(([, agent]) => agent.checkout !== '')
            .sort(([a], [b]) => byRole(a, b))
            .map(async ([role, agent]) => ({
              role,
              path: agent.checkout,
              head: await headOf(agent.checkout, deps.env),
            })),
        );
        return {
          projectId,
          name,
          onMac: Boolean(repo) || checkouts.length > 0,
          checkouts,
          docsRepo: repo?.path ?? null,
          lastSentCommit: repo?.lastCommit ?? null,
          progress,
        };
      };

      const rows = await Promise.all(
        projects.map((p) =>
          rowOf(p.id, p.name, progresses.find((progress) => progress.projectId === p.id) ?? null),
        ),
      );
      const known = new Set(projects.map((p) => p.id));
      const orphans = progresses.filter((p) => !p.projectId || !known.has(p.projectId));
      rows.push(...(await Promise.all(orphans.map((p) => rowOf('', p.key, p)))));
      return rows;
    },

    add(input: AddProjectInput): Promise<ProjectProgress> {
      return addProject(options.deps(), input);
    },

    remove(projectId: string): Promise<{ removed: string[]; manualCommand: string }> {
      return removeProject(options.deps(), projectId);
    },
  };
}
