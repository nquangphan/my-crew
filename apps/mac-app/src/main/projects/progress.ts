import { join } from 'node:path';
import type { AppState, AppStateStore, ProjectProgress } from '../app-state.js';
import type { OpsBridge } from '../ops-bridge.js';
import type { PaperclipClient } from '../paperclip/types.js';
import { shellQuote } from './folder.js';
import type { RoleTemplate } from './instructions.js';

export type ProgressStep = ProjectProgress['done'][number];

/** Những gì thêm/gỡ project cần; Main truyền bản thật, test truyền Paperclip giả, ops giả, HOME giả. */
export interface ProjectDeps {
  /** HOME của owner: worktree agent ở `<home>/crew-agents/<key>/<vai>`. */
  home: string;
  /** Môi trường chạy `git` (đăng nhập git của owner). */
  env: NodeJS.ProcessEnv;
  client: PaperclipClient;
  ops: OpsBridge;
  /** `projects[key]` là tiến độ; `setup.companyId` là company đang chọn. */
  store: AppStateStore;
  log?: (event: string, fields: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Chờ owner duyệt agent trên web (company bật `requireBoardApprovalForNewAgents`): mặc định 10 giây/30 phút. */
  approvalPollMs?: number;
  approvalTimeoutMs?: number;
}

export const KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;

/** Executor trước để Trợ Lý nhận được danh sách id executor khi tải `AGENTS.md`. */
export function roleNames(executors: 1 | 2): string[] {
  const list = executors === 2 ? ['executor-1', 'executor-2'] : ['executor-1'];
  return [...list, 'assistant', 'reviewer', 'integrator'];
}

export function templateOf(role: string): RoleTemplate {
  return role.startsWith('executor-') ? 'executor' : (role as RoleTemplate);
}

export function projectPaths(home: string, key: string) {
  const agentsRoot = join(home, 'crew-agents', key);
  return {
    agentsRoot,
    checkout: (role: string) => join(agentsRoot, role),
  };
}

/** Tên agent và environment của một vai trò; dùng để tìm lại bản ghi đã tạo khi response bị mất. */
export const recordName = (key: string, role: string) => `${key}-${role}`;

/** Tiến độ của bản cũ (thêm bằng URL git, clone vào `~/crew-projects`): không có `folder`. */
export function isLegacyProgress(progress: ProjectProgress): boolean {
  return typeof progress.folder !== 'string';
}

/**
 * Lệnh owner tự chạy để bỏ thư mục trên máy sau khi gỡ: `git -C <folder> worktree remove <checkout>` cho từng worktree
 * agent (theo thứ tự vai trò, nối bằng `&&`); git từ chối nếu worktree còn thay đổi chưa commit. Không đụng folder
 * gốc. Tiến độ bản cũ (clone) thì xóa thư mục clone như trước. Không có checkout nào thì rỗng.
 */
export function manualRemoveCommand(progress: ProjectProgress): string {
  if (isLegacyProgress(progress)) {
    return `rm -rf ~/crew-agents/${progress.key} ~/crew-projects/${progress.key}`;
  }
  const order = roleNames(2);
  const rank = (role: string) => (order.includes(role) ? order.indexOf(role) : order.length);
  return Object.entries(progress.agents)
    .filter(([, agent]) => agent.checkout !== '')
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(
      ([, agent]) =>
        `git -C ${shellQuote(progress.folder as string)} worktree remove ${shellQuote(agent.checkout)}`,
    )
    .join(' && ');
}

export function findByProjectId(state: AppState, projectId: string): ProjectProgress | undefined {
  return Object.values(state.projects).find((p) => p.projectId === projectId);
}

/** Đọc/ghi `projects[key]` qua `AppStateStore` (ghi nối tiếp, atomic). Mỗi id tạo ra được ghi ngay. */
export class ProgressRecorder {
  constructor(
    private readonly store: AppStateStore,
    readonly key: string,
  ) {}

  get(): ProjectProgress {
    const current = this.store.get().projects[this.key];
    if (!current) throw new Error(`Không có tiến độ của project ${this.key}`);
    return current;
  }

  async save(fn: (progress: ProjectProgress) => ProjectProgress): Promise<ProjectProgress> {
    const state = await this.store.update((s) => {
      const current = s.projects[this.key];
      if (!current) throw new Error(`Không có tiến độ của project ${this.key}`);
      return { ...s, projects: { ...s.projects, [this.key]: fn(current) } };
    });
    return state.projects[this.key] as ProjectProgress;
  }

  markDone(step: ProgressStep): Promise<ProjectProgress> {
    return this.save((p) => (p.done.includes(step) ? p : { ...p, done: [...p.done, step] }));
  }

  setAgent(role: string, patch: Partial<ProjectProgress['agents'][string]>): Promise<ProjectProgress> {
    return this.save((p) => {
      const prev = p.agents[role] ?? { agentId: null, environmentId: null, checkout: '' };
      return { ...p, agents: { ...p.agents, [role]: { ...prev, ...patch } } };
    });
  }

  setError(error: string | null): Promise<ProjectProgress> {
    return this.save((p) => ({ ...p, error }));
  }
}
