import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { treeChecksum } from '@crew/mac';
import {
  configureDocsBundle,
  ensureRuntimeExcluded,
  ensureWorktree,
  type FolderInfo,
  type GitRunner,
  inspectFolder,
  isWorktreeOf,
  runGit,
} from '../projects/folder.js';
import { sanitizeJobError, stripUrlCredentials } from './sanitize.js';
import {
  type CheckItem,
  type CrewRoleSlot,
  JobError,
  type JobErrorCode,
  type JobExtras,
  type JobOutcome,
  type JobPayload,
  type JobResult,
  type MachineJob,
  type SkillFile,
  UUID_RE,
} from './types.js';
import { checkoutPath, machineGuardReason, validateJobPayload } from './validate.js';

const GIT_TIMEOUT_MS = 30_000;
const MAX_SKILL_FILES = 500;
const MAX_SKILL_BYTES = 20 * 1024 * 1024;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ký tự điều khiển trong tên file bị từ chối
const CONTROL = /[\x00-\x1f\x7f]/;

/** Mục kiểm của `crew-mac doctor` (đủ phần dùng ở đây). */
export interface DoctorItem {
  id: string;
  title: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

/** Những gì executor cần; utility truyền bản thật (`@crew/mac` với HOME của owner), test truyền bản giả. */
export interface ExecutorDeps {
  home: string;
  env: NodeJS.ProcessEnv;
  git?: GitRunner;
  addStatusRepo(projectId: string, path: string, companyId: string): Promise<void>;
  /** Đường dẫn các repo đã có trong bản tin docs (nguồn bundle crew-docs). */
  statusRepoPaths(): Promise<string[]>;
  /** `crew-mac doctor` không probe. */
  doctor(): Promise<DoctorItem[]>;
  /** `crew-mac workflow-check` cho một checkout với bản Superpowers đã ghim. */
  workflowCheck(root: string): Promise<{ ok: boolean; lines: string[] }>;
}

const failed = (errorCode: JobErrorCode, text: string, result?: JobResult): JobOutcome => ({
  status: 'failed',
  errorCode,
  errorText: sanitizeJobError(text),
  ...(result ? { result } : {}),
});

/**
 * Làm một việc của hàng đợi máy. Kiểm lại payload (như plugin) và đường dẫn trước khi đụng tới máy. Không ném: mọi lỗi
 * thành `failed` với mã cố định và câu đã làm sạch. Chỉ 5 loại việc; không chạy lệnh nào khác.
 */
export async function runJob(
  job: Pick<MachineJob, 'companyId' | 'kind' | 'payload'>,
  extras: JobExtras,
  deps: ExecutorDeps,
): Promise<JobOutcome> {
  const payload = validateJobPayload(job.kind, job.payload);
  if (typeof payload === 'string') return failed('app_error', `Việc không hợp lệ: ${payload}`);
  if (typeof job.companyId !== 'string' || !UUID_RE.test(job.companyId)) {
    return failed('app_error', 'Việc không hợp lệ: companyId phải là uuid');
  }
  const guard = machineGuardReason(deps.home, payload);
  if (guard) return failed('folder_forbidden', guard);
  try {
    return await execute(payload, job.companyId.toLowerCase(), extras, deps);
  } catch (error) {
    if (error instanceof JobError) return failed(error.code, error.message);
    return failed('app_error', error instanceof Error ? error.message : String(error));
  }
}

async function execute(
  payload: JobPayload,
  companyId: string,
  extras: JobExtras,
  deps: ExecutorDeps,
): Promise<JobOutcome> {
  switch (payload.kind) {
    case 'inspect-folder':
      return { status: 'done', result: await inspectJob(payload.folder, deps) };
    case 'prepare-checkouts': {
      const info = await inspect(payload.folder, deps);
      await configureDocs(info, deps);
      const checkouts = [];
      for (const { role, branch } of payload.roles) {
        checkouts.push(await ensureCheckout(info, payload.projectKey, role, branch, deps));
      }
      if (extras.projectId) await deps.addStatusRepo(extras.projectId, info.root, companyId);
      return { status: 'done', result: { kind: 'prepare-checkouts', checkouts } };
    }
    case 'agent-workspace': {
      const info = await inspect(payload.folder, deps);
      await configureDocs(info, deps);
      const checkout = await ensureCheckout(info, payload.projectKey, payload.role, payload.branch, deps);
      return { status: 'done', result: { kind: 'agent-workspace', ...checkout } };
    }
    case 'skill-sync':
      return { status: 'done', result: writeSkill(deps.home, companyId, payload.slug, extras.skillFiles) };
    case 'check':
      return checkJob(payload.projectKey, deps);
  }
}

function git(deps: ExecutorDeps, args: string[]) {
  return (deps.git ?? runGit)(args, { env: deps.env, timeoutMs: GIT_TIMEOUT_MS });
}

/** `inspectFolder` của thêm project, lỗi chuyển thành mã của hàng đợi. */
async function inspect(folder: string, deps: ExecutorDeps): Promise<FolderInfo> {
  if (!existsSync(folder)) throw new JobError('folder_missing', `Không tìm thấy folder ${folder}`);
  try {
    return await inspectFolder(folder, { home: deps.home, env: deps.env, git: deps.git });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Folder đi qua symlink tới HOME hay gốc ổ đĩa: chỉ nhận ra sau realpath trong inspectFolder.
    if (message.startsWith('Không dùng gốc ổ đĩa')) throw new JobError('folder_forbidden', message);
    throw new JobError('folder_not_git', message);
  }
}

async function inspectJob(folder: string, deps: ExecutorDeps): Promise<JobResult> {
  const info = await inspect(folder, deps);
  const out = async (args: string[]) => {
    const r = await git(deps, ['-C', info.root, ...args]);
    return r.code === 0 ? r.stdout.trim() : null;
  };
  const status = await git(deps, ['-C', info.root, 'status', '--porcelain']);
  if (status.code !== 0)
    throw new JobError('git_failed', `git status trong ${info.root} thất bại (mã ${status.code})`);
  return {
    kind: 'inspect-folder',
    root: info.root,
    branch: (await out(['symbolic-ref', '--short', '-q', 'HEAD'])) || null,
    remote: stripUrlCredentials(info.origin),
    docsBundle: (await out(['config', '--get', 'crew-docs.bundle'])) || null,
    clean: status.stdout.trim() === '',
  };
}

async function configureDocs(info: FolderInfo, deps: ExecutorDeps): Promise<void> {
  await configureDocsBundle(info, {
    home: deps.home,
    env: deps.env,
    git: deps.git,
    statusRepoPaths: () => deps.statusRepoPaths(),
  });
}

async function ensureCheckout(
  info: FolderInfo,
  projectKey: string,
  role: CrewRoleSlot,
  branch: string,
  deps: ExecutorDeps,
): Promise<{ role: CrewRoleSlot; path: string; head: string }> {
  const path = checkoutPath(deps.home, projectKey, role);
  const gitDeps = { home: deps.home, env: deps.env, git: deps.git };
  if (existsSync(path) && !(await isWorktreeOf(path, info.commonDir, gitDeps))) {
    throw new JobError(
      'checkout_exists',
      `${path} đã có nhưng không phải worktree của ${info.root}: tự dời thư mục đó rồi chạy lại`,
    );
  }
  try {
    await ensureWorktree(info, path, branch, gitDeps);
    await ensureRuntimeExcluded(path, gitDeps);
  } catch (error) {
    throw new JobError('git_failed', error instanceof Error ? error.message : String(error));
  }
  const head = await git(deps, ['-C', path, 'rev-parse', 'HEAD']);
  const sha = head.stdout.trim();
  if (head.code !== 0 || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new JobError('git_failed', `Không đọc được HEAD của ${path}`);
  }
  return { role, path, head: sha };
}

function skillFileError(files: SkillFile[] | undefined): string | null {
  if (!Array.isArray(files) || files.length === 0) return 'Không lấy được file nào của skill';
  if (files.length > MAX_SKILL_FILES) return `Skill có quá ${MAX_SKILL_FILES} file`;
  const seen = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    const parts = typeof file.path === 'string' ? file.path.split('/') : [];
    const safe =
      parts.length > 0 &&
      file.path.length <= 512 &&
      !CONTROL.test(file.path) &&
      parts.every((part) => part !== '' && part !== '.' && part !== '..');
    if (!safe) return `Đường dẫn file skill không hợp lệ: ${JSON.stringify(file.path)}`;
    if (seen.has(file.path)) return `File skill bị trùng: ${file.path}`;
    seen.add(file.path);
    if (typeof file.content !== 'string') return `Nội dung file skill không hợp lệ: ${file.path}`;
    bytes += file.content.length;
  }
  return bytes > MAX_SKILL_BYTES ? 'Skill quá lớn (trên 20 MB)' : null;
}

/**
 * Ghi skill vào `~/.crew/skills/<company>/<slug>/` (thư mục 0700): dựng ở thư mục tạm cạnh đó rồi đổi tên, nên thư mục
 * cũ được thay trọn (file không còn trong skill thì mất). Băm cây bằng `treeChecksum` của crew-mac.
 */
function writeSkill(
  home: string,
  companyId: string,
  slug: string,
  files: SkillFile[] | undefined,
): JobResult {
  const error = skillFileError(files);
  if (error || !files) throw new JobError('skill_fetch_failed', error ?? 'Không lấy được file nào của skill');
  const base = join(home, '.crew', 'skills', companyId);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  chmodSync(base, 0o700);
  const staging = join(base, `.${slug}.tmp-${randomUUID()}`);
  mkdirSync(staging, { mode: 0o700 });
  try {
    for (const file of files) {
      const target = join(staging, file.path);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      const data = Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
      writeFileSync(target, data, { mode: file.executable ? 0o700 : 0o600 });
    }
    chmodSync(staging, 0o700);
    const final = join(base, slug);
    const old = join(base, `.${slug}.old-${randomUUID()}`);
    if (existsSync(final)) renameSync(final, old);
    renameSync(staging, final);
    rmSync(old, { recursive: true, force: true });
    const tree = treeChecksum(final);
    return { kind: 'skill-sync', sha256: tree.checksum, files: tree.files };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const cut = (text: string) => sanitizeJobError(text);

async function checkJob(projectKey: string, deps: ExecutorDeps): Promise<JobOutcome> {
  const root = join(deps.home, 'crew-agents', projectKey);
  let roles: string[] = [];
  try {
    roles = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    roles = [];
  }
  if (roles.length === 0) {
    throw new JobError('check_failed', `Project ${projectKey} chưa có checkout nào trên máy (${root})`);
  }
  const items: CheckItem[] = (await deps.doctor()).map((item) => ({
    id: item.id,
    status: item.status === 'fail' ? 'error' : item.status,
    title: cut(item.detail ? `${item.title}: ${item.detail}` : item.title),
  }));
  for (const role of roles) {
    const report = await deps.workflowCheck(join(root, role));
    items.push({
      id: `workflow:${role}`,
      status: report.ok ? 'ok' : 'error',
      title: cut(
        report.ok
          ? `Workflow của ${role} sạch`
          : `Workflow của ${role} chưa sạch: ${report.lines.join('; ')}`,
      ),
    });
  }
  const result: JobResult = { kind: 'check', items };
  const errors = items.filter((item) => item.status === 'error');
  if (errors.length === 0) return { status: 'done', result };
  return failed('check_failed', errors.map((item) => item.title).join('; '), result);
}
