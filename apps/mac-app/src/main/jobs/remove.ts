import { execFile } from 'node:child_process';
import { lstatSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AppStateStore } from '../app-state.js';
import { type GitRunner, runGit } from '../projects/folder.js';
import { sanitizeJobError } from './sanitize.js';
import {
  type CrewRoleSlot,
  JobError,
  type JobOutcome,
  type JobPayload,
  type JobResult,
  type KeptCheckout,
  type MachineJob,
} from './types.js';
import { checkoutPath, validateJobPayload } from './validate.js';

const GIT_TIMEOUT_MS = 30_000;
const LSOF_TIMEOUT_MS = 60_000;

/** Kết quả một lệnh chạy không qua shell. `code` -1: không chạy được hoặc quá giờ. */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** `lsof` của macOS với đúng tham số cho sẵn; test thay bằng bản giả. */
export type LsofRunner = (args: string[]) => Promise<CommandResult>;

export const runLsof: LsofRunner = (args) =>
  new Promise((resolve) => {
    execFile(
      '/usr/sbin/lsof',
      args,
      { timeout: LSOF_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });

export interface RemoveDeps {
  home: string;
  env: NodeJS.ProcessEnv;
  git?: GitRunner;
  lsof?: LsofRunner;
  /** `crew-mac status remove-repo`: bỏ repo docs của project khỏi bản tin máy. */
  removeStatusRepo(projectId: string): Promise<void>;
}

const real = (path: string) => realpathSync.native(path);

function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

const lastLine = (text: string) => text.trim().split('\n').at(-1) ?? '';

type RoleOutcome =
  | { removed: { role: CrewRoleSlot; path: string } }
  | { kept: KeptCheckout }
  | { absent: CrewRoleSlot };

/**
 * Gỡ checkout của các vai trò ở `~/crew-agents/<khóa>/<vai>`. Chỉ gỡ khi đường thật (`realpath`) đúng chỗ đó, là
 * worktree phụ (git-dir khác git-common-dir), không process nào đang dùng (`lsof +D`), không có tệp chưa commit hay
 * commit không thuộc nhánh nào; gỡ bằng `git worktree remove` KHÔNG `--force` (git tự kiểm lại lần nữa). Thiếu điều
 * kiện thì giữ nguyên và ghi lý do. Không xóa nhánh, không đụng folder gốc của owner, không `worktree prune` (prune
 * chạm cả worktree khác của owner, ví dụ trên ổ ngoài đang tháo).
 */
export async function removeCheckouts(
  payload: Extract<JobPayload, { kind: 'remove-checkouts' }>,
  deps: RemoveDeps,
): Promise<JobResult> {
  const realHome = real(deps.home);
  const result: Extract<JobResult, { kind: 'remove-checkouts' }> = {
    kind: 'remove-checkouts',
    removed: [],
    kept: [],
    absent: [],
  };
  for (const role of payload.roles) {
    const outcome = await removeOne(payload.projectKey, role, realHome, deps);
    if ('removed' in outcome) result.removed.push(outcome.removed);
    else if ('kept' in outcome) result.kept.push(outcome.kept);
    else result.absent.push(outcome.absent);
  }
  removeEmptyProjectDir(deps.home, realHome, payload.projectKey);
  if (payload.removeStatusRepo) await deps.removeStatusRepo(payload.projectId);
  return result;
}

async function removeOne(
  projectKey: string,
  role: CrewRoleSlot,
  realHome: string,
  deps: RemoveDeps,
): Promise<RoleOutcome> {
  const path = checkoutPath(deps.home, projectKey, role);
  const keep = (reason: KeptCheckout['reason'], detail: string): RoleOutcome => ({
    kept: { role, path, reason, detail: sanitizeJobError(detail) },
  });
  const stat = lstatOrNull(path);
  if (!stat) return { absent: role };

  const expected = checkoutPath(realHome, projectKey, role);
  let target: string;
  try {
    target = real(path);
  } catch {
    return keep('not_worktree', `${path} là symlink hỏng`);
  }
  if (stat.isSymbolicLink() || target !== expected || !lstatSync(target).isDirectory()) {
    return keep(
      'not_worktree',
      `${path} không phải thư mục thật nằm đúng ở ~/crew-agents/${projectKey}/${role}`,
    );
  }

  const git = (args: string[]) => (deps.git ?? runGit)(args, { env: deps.env, timeoutMs: GIT_TIMEOUT_MS });
  const rev = await git([
    '-C',
    target,
    'rev-parse',
    '--path-format=absolute',
    '--show-toplevel',
    '--git-dir',
    '--git-common-dir',
  ]);
  const [top, gitDir, commonDir] = rev.stdout.trim().split('\n');
  if (rev.code !== 0 || !top || !gitDir || !commonDir) {
    return keep('not_worktree', `${path} không phải worktree git`);
  }
  let common: string;
  try {
    if (real(top) !== target) return keep('not_worktree', `${path} là thư mục con của repo ${top}`);
    common = real(commonDir);
    if (real(gitDir) === common) {
      return keep('not_worktree', `${path} là repo/worktree chính, không phải worktree của agent`);
    }
  } catch {
    return keep('not_worktree', `Không đọc được thư mục .git của ${path}`);
  }

  const lsof = await (deps.lsof ?? runLsof)(['-t', '+D', target]);
  const pids = lsof.stdout.split('\n').filter((line) => /^\d+$/.test(line.trim()));
  if (pids.length > 0) return keep('busy', `Process ${pids.join(', ')} đang dùng ${path}`);
  // lsof của macOS thoát mã 1 cả khi không tìm thấy gì; mã khác (hay không chạy được) là không biết: giữ lại.
  if (lsof.code !== 0 && lsof.code !== 1) {
    return keep('busy', `Không kiểm được process đang dùng ${path} (lsof mã ${lsof.code})`);
  }

  const status = await git(['-C', target, '-c', 'core.fsmonitor=false', 'status', '--porcelain']);
  if (status.code !== 0)
    return keep('git_failed', `git status trong ${path} thất bại: ${lastLine(status.stderr)}`);
  const changes = status.stdout.split('\n').filter((line) => line.trim() !== '').length;
  if (changes > 0) return keep('dirty', `${path} có ${changes} tệp chưa commit`);

  // HEAD tách rời có commit chưa thuộc nhánh nào: gỡ worktree là mất reflog duy nhất trỏ tới chúng.
  const branch = await git(['-C', target, 'symbolic-ref', '-q', 'HEAD']);
  if (branch.code !== 0) {
    const holders = await git([
      '-C',
      target,
      'for-each-ref',
      '--count=1',
      '--contains',
      'HEAD',
      'refs/heads',
      'refs/remotes',
    ]);
    if (holders.code !== 0 || holders.stdout.trim() === '') {
      return keep('dirty', `${path} đang ở HEAD tách rời có commit không thuộc nhánh nào`);
    }
  }

  const removed = await git(['--git-dir', common, 'worktree', 'remove', target]);
  if (removed.code !== 0) {
    return keep('git_failed', `git worktree remove ${path} thất bại: ${lastLine(removed.stderr)}`);
  }
  return { removed: { role, path } };
}

/** `rmdir ~/crew-agents/<khóa>` khi đã rỗng (thư mục thật đúng chỗ, không phải symlink). Không rỗng thì để nguyên. */
function removeEmptyProjectDir(home: string, realHome: string, projectKey: string): void {
  const dir = join(home, 'crew-agents', projectKey);
  const stat = lstatOrNull(dir);
  if (!stat?.isDirectory() || real(dir) !== join(realHome, 'crew-agents', projectKey)) return;
  try {
    rmdirSync(dir);
  } catch {
    // còn checkout giữ lại hay tệp khác: để nguyên
  }
}

/**
 * Xóa bản chép skill `~/.crew/skills/<company>/<slug>`. Đường thật phải đúng chỗ đó (không symlink ở thư mục skill
 * hay thư mục company), nên không bao giờ chạm `~/.crew/workflows` (Superpowers ghim). `rmSync` không đi theo symlink
 * bên trong skill. Không có thì `removed: false`.
 */
export function removeSkill(home: string, companyId: string, slug: string): JobResult {
  const path = join(home, '.crew', 'skills', companyId, slug);
  const stat = lstatOrNull(path);
  if (!stat) return { kind: 'skill-remove', removed: false };
  const expected = join(real(home), '.crew', 'skills', companyId, slug);
  if (stat.isSymbolicLink() || real(path) !== expected) {
    throw new JobError(
      'folder_forbidden',
      `${path} không nằm thật trong ~/.crew/skills/${companyId}/ (symlink): không xóa`,
    );
  }
  rmSync(path, { recursive: true });
  return { kind: 'skill-remove', removed: true };
}

/**
 * Sau khi việc gỡ project (`remove-checkouts` có `removeStatusRepo`) xong: xóa tiến độ của project đó trong `app.json`
 * (Main giữ `app.json`, utility không ghi). Việc khác, gỡ agent hay việc thất bại thì không làm gì.
 */
export async function forgetRemovedProject(
  store: AppStateStore,
  job: Pick<MachineJob, 'kind' | 'payload'>,
  outcome: JobOutcome,
): Promise<void> {
  if (outcome.status !== 'done' || job.kind !== 'remove-checkouts') return;
  const payload = validateJobPayload(job.kind, job.payload);
  if (typeof payload === 'string' || payload.kind !== 'remove-checkouts' || !payload.removeStatusRepo) return;
  const { projectId } = payload;
  if (!Object.values(store.get().projects).some((p) => p.projectId === projectId)) return;
  await store.update((s) => ({
    ...s,
    projects: Object.fromEntries(Object.entries(s.projects).filter(([, p]) => p.projectId !== projectId)),
  }));
}
