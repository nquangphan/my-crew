import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { type RuntimesStatus, treeChecksum } from '@crew/mac';
import type { LaunchGate, LaunchResult } from '../bug-finding/launch.js';
import { isFile } from '../projects/docs-runtime.js';
import {
  configureDocsBundle,
  ensureRuntimeExcluded,
  ensureWorktree,
  type FolderInfo,
  type GitRunner,
  inspectFolder,
  isWorktreeOf,
  type ProcessRunner,
  runGit,
} from '../projects/folder.js';
import { defaultProjectRoots, ensureProject } from './ensure-project.js';
import { type LsofRunner, removeCheckouts, removeSkill } from './remove.js';
import { sanitizeJobError, stripUrlCredentials } from './sanitize.js';
import {
  type BugFindingReviewPayload,
  type CheckItem,
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
  /** Chạy `crew-docs install-hooks`; mặc định `runProcess`. */
  exec?: ProcessRunner;
  /** `lsof` kiểm process đang dùng checkout trước khi gỡ; mặc định `/usr/sbin/lsof`. */
  lsof?: LsofRunner;
  addStatusRepo(projectId: string, path: string, companyId: string): Promise<void>;
  /** Đường dẫn các repo đã có trong bản tin docs (nguồn bundle crew-docs). */
  statusRepoPaths(): Promise<string[]>;
  /** Thư mục project quen thuộc cho `ensure-project`; thiếu thì `~/Documents/projects`, `~/Projects`, `/Volumes/<ổ>/Projects`. */
  projectRoots?(): string[];
  /** Node thật cho `crew-docs.runtime` (dò, không có thì tải); null khi không có. */
  docsNodePath(): Promise<string | null>;
  /** Bỏ repo docs của project khỏi bản tin máy (gỡ project). */
  removeStatusRepo(projectId: string): Promise<void>;
  /** `crew-mac doctor` không probe. */
  doctor(): Promise<DoctorItem[]>;
  /** `crew-mac workflow-check` cho một checkout với bản Superpowers đã ghim. */
  workflowCheck(root: string): Promise<{ ok: boolean; lines: string[] }>;
  /** `setup` cài/cập nhật wrapper runtime rồi `runtimes status --json`. */
  runtimesSetup(): Promise<RuntimesStatus>;
}

const failed = (errorCode: JobErrorCode, text: string, result?: JobResult): JobOutcome => ({
  status: 'failed',
  errorCode,
  errorText: sanitizeJobError(text),
  ...(result ? { result } : {}),
});

/**
 * Làm một việc của hàng đợi máy. Kiểm lại payload (như plugin) và đường dẫn trước khi đụng tới máy. Không ném: mọi lỗi
 * thành `failed` với mã cố định và câu đã làm sạch. Chỉ 10 loại việc (`bug-finding-review` chạy ở Main qua `runBugFindingReview`); không chạy lệnh nào khác.
 */
export async function runJob(
  job: Pick<MachineJob, 'companyId' | 'kind' | 'payload'>,
  extras: JobExtras,
  deps: ExecutorDeps,
): Promise<JobOutcome> {
  return guarded(job, deps.home, (payload, companyId) => execute(payload, companyId, extras, deps));
}

/** Kiểm payload, company và đường dẫn như plugin rồi mới làm; mọi lỗi thành `failed` với mã cố định. */
async function guarded(
  job: Pick<MachineJob, 'companyId' | 'kind' | 'payload'>,
  home: string,
  work: (payload: JobPayload, companyId: string) => Promise<JobOutcome>,
): Promise<JobOutcome> {
  const payload = validateJobPayload(job.kind, job.payload);
  if (typeof payload === 'string') return failed('app_error', `Việc không hợp lệ: ${payload}`);
  if (typeof job.companyId !== 'string' || !UUID_RE.test(job.companyId)) {
    return failed('app_error', 'Việc không hợp lệ: companyId phải là uuid');
  }
  const guard = machineGuardReason(home, payload);
  if (guard) return failed('folder_forbidden', guard);
  try {
    return await work(payload, job.companyId.toLowerCase());
  } catch (error) {
    if (error instanceof JobError) return failed(error.code, error.message);
    return failed('app_error', error instanceof Error ? error.message : String(error));
  }
}

/** Schema file yêu cầu review mà app Bug Finding đọc (`CrewReviewRequest` của repo `bug-finding`). */
export const CREW_REVIEW_REQUEST_SCHEMA = 'crew-review-request/1';

/**
 * Lượt Bug Finding 2P Crew đã nhận: relay kết quả cần company, máy và origin Paperclip đã giao việc để chỉ gửi về
 * đúng nơi đó.
 */
export interface BugFindingRequestRef {
  requestId: string;
  companyId: string;
  machineId: string;
  /** Origin board đã giao việc (đích hỏi việc của poller). */
  origin: string;
}

/** Những gì `bug-finding-review` cần; chạy trong Main (mở app, đồng bộ project, ghi sổ lượt vào `app.json`). */
export interface BugFindingReviewDeps {
  home: string;
  /** `bugFindingPaths(home).requestsDir`. */
  requestsDir: string;
  repoExists(path: string): boolean;
  /** Ghi lại `crew/projects.json` để Bug Finding thấy project của lượt; lỗi không chặn ngay, xem `projectKnown`. */
  syncProjects(): Promise<void>;
  /** `crew/projects.json` hiện có ghi cho `companyId` và có project `projectId` (Bug Finding tra được project). */
  projectKnown(companyId: string, projectId: string): Promise<boolean>;
  /** `checkLaunch` với app nhúng: kiểm trước khi ghi yêu cầu, không mở gì. */
  checkLaunch(): Promise<LaunchResult>;
  /** `launchBugFinding` với app nhúng. */
  launch(opts: { background: boolean }): Promise<LaunchResult>;
  recordRequest(ref: BugFindingRequestRef): Promise<void>;
  /** Cổng mở Bug Finding: đóng trong lúc 2P Crew chờ cài bản mới. */
  gate: Pick<LaunchGate, 'run'>;
}

/** Thân file `requests/<requestId>.json`: đúng trường của `CrewReviewRequest`. */
export function crewReviewRequest(payload: BugFindingReviewPayload) {
  return {
    schema: CREW_REVIEW_REQUEST_SCHEMA,
    requestId: payload.requestId,
    crewProjectId: payload.projectId,
    identifier: payload.identifier,
    run: payload.run,
    prNumber: payload.prNumber,
    headSha: payload.headSha,
    baseBranch: payload.baseBranch,
    ...(payload.reviewerInputText !== undefined ? { reviewerInputText: payload.reviewerInputText } : {}),
  };
}

export const BUG_FINDING_UPDATING_TEXT =
  '2P Crew đang chờ cài bản mới nên chưa nhận lượt Bug Finding; xếp lại sau khi máy cài xong';
const ABORTED_TEXT = 'Việc đã bị hủy vì quá thời gian';

function launchError(result: Extract<LaunchResult, { ok: false }>): JobError {
  switch (result.reason) {
    case 'standalone_running':
      return new JobError(
        'standalone_running',
        `Bug Finding khác bản đi kèm 2P Crew đang chạy (${result.paths.join(', ')}): thoát bản đó (hoặc gỡ bản cài riêng ở mục Bug Finding của 2P Crew) rồi chạy lại`,
      );
    case 'updating':
      return new JobError('app_error', BUG_FINDING_UPDATING_TEXT);
    default:
      return new JobError(
        'bug_finding_missing',
        'Không tìm thấy app Bug Finding đi kèm 2P Crew trên máy này',
      );
  }
}

/**
 * Việc `bug-finding-review`: kiểm Bug Finding tra được project của lượt (sau khi đồng bộ `projects.json`) và mở được
 * bản nhúng, rồi mới ghi yêu cầu vào hàng đợi file của app và mở app nền, trả `accepted` ngay (không giữ việc suốt lượt
 * review; tiến độ và kết quả đi qua relay `bug-finding/results.ts`, chỉ về `origin` đã giao việc). Cùng `requestId`
 * không ghi lần hai (Bug Finding đổi tên file đã xử lý thành `.json.done`). Không mở được app, việc bị hủy vì quá giờ
 * (`signal`) hay 2P Crew đang chờ cài bản mới thì không để lại file yêu cầu nào Bug Finding chưa nhận.
 */
export async function runBugFindingReview(
  job: Pick<MachineJob, 'companyId' | 'machineId' | 'kind' | 'payload'>,
  deps: BugFindingReviewDeps,
  opts: { origin: string; signal?: AbortSignal },
): Promise<JobOutcome> {
  const stopIfAborted = () => {
    if (opts.signal?.aborted) throw new JobError('app_error', ABORTED_TEXT);
  };
  return guarded(job, deps.home, async (payload, companyId) => {
    if (payload.kind !== 'bug-finding-review') throw new Error('Việc không phải bug-finding-review');
    if (!deps.repoExists(payload.repoPath)) {
      throw new JobError(
        'project_missing',
        `Máy này không có repo của project ${payload.projectKey} (${payload.repoPath})`,
      );
    }
    await deps.syncProjects().catch(() => undefined);
    stopIfAborted();
    if (!(await deps.projectKnown(companyId, payload.projectId).catch(() => false))) {
      throw new JobError(
        'project_missing',
        `Bug Finding trên máy này chưa có project ${payload.projectKey} của company này (danh sách project đồng bộ sang Bug Finding không có project đó)`,
      );
    }
    return deps.gate.run(
      async (): Promise<JobOutcome> => {
        stopIfAborted();
        const checked = await deps.checkLaunch();
        if (!checked.ok) throw launchError(checked);
        stopIfAborted();
        await deps.recordRequest({
          requestId: payload.requestId,
          companyId,
          machineId: String(job.machineId).toLowerCase(),
          origin: opts.origin,
        });
        const file = join(deps.requestsDir, `${payload.requestId}.json`);
        // Bug Finding đổi tên file đã nhận thành `.json.done`: file còn tên cũ là chưa được nhận, gỡ được.
        const dropUnclaimed = () => rmSync(file, { force: true });
        if (!existsSync(file) && !existsSync(`${file}.done`)) {
          mkdirSync(deps.requestsDir, { recursive: true, mode: 0o700 });
          const tmp = `${file}.tmp-${randomUUID()}`;
          writeFileSync(tmp, `${JSON.stringify(crewReviewRequest(payload), null, 2)}\n`, { mode: 0o600 });
          renameSync(tmp, file);
        }
        let launched: LaunchResult;
        try {
          stopIfAborted();
          launched = await deps.launch({ background: true });
        } catch (error) {
          dropUnclaimed();
          throw error;
        }
        if (!launched.ok) {
          dropUnclaimed();
          throw launchError(launched);
        }
        if (opts.signal?.aborted) {
          dropUnclaimed();
          throw new JobError('app_error', ABORTED_TEXT);
        }
        return { status: 'done', result: { kind: 'bug-finding-review', accepted: true } };
      },
      () => {
        throw launchError({ ok: false, reason: 'updating' });
      },
    );
  });
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
    case 'remove-checkouts':
      return { status: 'done', result: await removeCheckouts(payload, deps) };
    case 'runtimes-setup':
      return { status: 'done', result: runtimesResult(await deps.runtimesSetup()) };
    case 'ensure-project':
      return {
        status: 'done',
        result: await ensureProject(payload, {
          home: deps.home,
          env: deps.env,
          git: deps.git,
          statusRepoPaths: () => deps.statusRepoPaths(),
          projectRoots: deps.projectRoots ?? (() => defaultProjectRoots(deps.home)),
          configureDocs: (info) => configureDocs(info, deps),
          ensureCheckout: (info, projectKey, role, branch) =>
            ensureCheckout(info, projectKey, role, branch, deps),
        }),
      };
    case 'skill-remove':
      return { status: 'done', result: removeSkill(deps.home, companyId, payload.slug) };
    case 'bug-finding-review':
      // Cần app nhúng, `app.json` và đồng bộ project của Main: `registerJobs` chuyển việc này cho `runBugFindingReview`.
      throw new Error('Việc bug-finding-review chỉ chạy ở tiến trình chính của app');
  }
}

/** Chỉ chép trường của hợp đồng: kết quả hiện trên web, không được mang key, token hay đường dẫn auth. */
function runtimesResult({ wrappers, codex, opencode }: RuntimesStatus): JobResult {
  return {
    kind: 'runtimes-setup',
    wrappers: { codex: wrappers.codex, opencode: wrappers.opencode },
    codex: { version: codex.version, loggedIn: codex.loggedIn },
    opencode: { version: opencode.version, keyPresent: opencode.keyPresent },
  };
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

/** Cài crew-docs cho repo (bundle, runtime, hook); lỗi thành `git_failed` kèm câu tiếng Việt. */
async function configureDocs(info: FolderInfo, deps: ExecutorDeps): Promise<void> {
  try {
    await configureDocsBundle(info, {
      home: deps.home,
      env: deps.env,
      git: deps.git,
      exec: deps.exec,
      statusRepoPaths: () => deps.statusRepoPaths(),
      nodePath: () => deps.docsNodePath(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JobError('git_failed', `Không cài được crew-docs cho ${info.root}: ${message}`);
  }
}

async function ensureCheckout<R extends string>(
  info: FolderInfo,
  projectKey: string,
  role: R,
  branch: string,
  deps: ExecutorDeps,
): Promise<{ role: R; path: string; head: string }> {
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

/**
 * Mục doctor làm `check` thất bại: thiếu chúng thì mọi run đều không khởi động được. `worktree-workflows` quét cả
 * `~/crew-agents` (project khác lỗi cũng đỏ) nên chỉ cảnh báo; workflow từng ô đã có mục `workflow:<ô>` kiểm riêng.
 */
const PROJECT_DOCTOR_IDS = new Set(['wrapper', 'worktree-root']);

/** Lý do worktree `checkout` chưa chạy được `node "$(git config --get crew-docs.bundle)"`, hoặc null. */
async function docsBundleProblem(checkout: string, deps: ExecutorDeps): Promise<string | null> {
  const r = await git(deps, ['-C', checkout, 'config', '--get', 'crew-docs.bundle']);
  const bundle = r.code === 0 ? r.stdout.trim() : '';
  if (bundle === '') return 'chưa có git config crew-docs.bundle';
  return isFile(bundle) ? null : `bundle ${bundle} không tồn tại`;
}

/** Checkout gốc của repo chứa worktree `checkout`: dòng `worktree` đầu tiên của `git worktree list --porcelain`. */
async function mainCheckoutOf(checkout: string, deps: ExecutorDeps): Promise<string> {
  const r = await git(deps, ['-C', checkout, 'worktree', 'list', '--porcelain']);
  const main = r.code === 0 ? /^worktree (.+)$/m.exec(r.stdout)?.[1]?.trim() : undefined;
  if (!main) throw new Error(`không tìm được checkout gốc của ${checkout} (git worktree list mã ${r.code})`);
  return main;
}

/**
 * Hợp đồng của integrator: trong worktree integrator, `git config --get crew-docs.bundle` trỏ tới file có thật. Thiếu
 * thì tự cài lại crew-docs trong checkout gốc rồi kiểm lại, nên run cũ (bước checkouts xong từ bản app chưa cài
 * crew-docs) sửa được bằng "Chạy tiếp". Vẫn thiếu thì là lỗi của project.
 */
async function projectDocsItem(projectKey: string, deps: ExecutorDeps): Promise<CheckItem> {
  const id = 'crew-docs-project';
  const title = `crew-docs của ${projectKey}`;
  const checkout = checkoutPath(deps.home, projectKey, 'integrator');
  if (!existsSync(checkout)) {
    return { id, status: 'error', title: cut(`${title}: chưa có worktree integrator ${checkout}`) };
  }
  let problem = await docsBundleProblem(checkout, deps);
  if (problem) {
    try {
      await configureDocs(await inspect(await mainCheckoutOf(checkout, deps), deps), deps);
      problem = await docsBundleProblem(checkout, deps);
    } catch (error) {
      problem = `${problem}; tự cài lại không được: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (problem) return { id, status: 'error', title: cut(`${title}: ${checkout}: ${problem}`) };
  return { id, status: 'ok', title: cut(`${title}: worktree integrator chạy được crew-docs`) };
}

function isMainClone(dir: string): boolean {
  try {
    return statSync(join(dir, '.git')).isDirectory();
  } catch {
    return false;
  }
}

async function checkJob(projectKey: string, deps: ExecutorDeps): Promise<JobOutcome> {
  const root = join(deps.home, 'crew-agents', projectKey);
  let roles: string[] = [];
  try {
    roles = readdirSync(root, { withFileTypes: true })
      // Bản clone chính (`repo`, repo đi kèm clone thẳng) có `.git` là thư mục; chỉ worktree agent mới kiểm workflow.
      .filter((entry) => entry.isDirectory() && !isMainClone(join(root, entry.name)))
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
    status: item.status === 'fail' ? (PROJECT_DOCTOR_IDS.has(item.id) ? 'error' : 'warn') : item.status,
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
  items.push(await projectDocsItem(projectKey, deps));
  const result: JobResult = { kind: 'check', items };
  const errors = items.filter((item) => item.status === 'error');
  if (errors.length === 0) return { status: 'done', result };
  return failed('check_failed', errors.map((item) => item.title).join('; '), result);
}
