import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  type Stats,
  symlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { type FolderInfo, type GitRunner, inspectFolder, runGit } from '../projects/folder.js';
import { stripUrlCredentials } from './sanitize.js';
import { JobError, type JobPayload, type JobResult } from './types.js';
import { checkoutPath } from './validate.js';

export type EnsureProjectPayload = Extract<JobPayload, { kind: 'ensure-project' }>;
type EnsureProjectResult = Extract<JobResult, { kind: 'ensure-project' }>;

/** Clone repo lớn có thể lâu, nhưng phải xong trong hạn 15 phút của việc máy. */
export const CLONE_TIMEOUT_MS = 10 * 60_000;
const LOCAL_TIMEOUT_MS = 30_000;
/** Lệnh hỏi remote nhanh (`remote set-head -a`): không cần hạn của clone. */
const REMOTE_QUERY_TIMEOUT_MS = 60_000;
/** stderr khi máy không tới được remote (mất mạng, DNS): không phải lỗi key, dù git vẫn in thêm "Could not read from remote". */
const NETWORK_FAILURE =
  /Could not resolve hostname|Could not resolve host|Connection timed out|Operation timed out|Network is unreachable|Connection refused|No route to host/i;
/** `git rev-parse HEAD` lỗi vì HEAD trỏ tới nhánh chưa có commit (clone bị ngắt giữa chừng), không vì lý do khác. */
const UNBORN_HEAD = /unknown revision|ambiguous argument 'HEAD'|bad revision 'HEAD'/i;
/** stderr của git/ssh khi máy không có quyền đọc repo (key SSH chưa thêm vào GitHub, cần nhập mật khẩu...). */
const AUTH_FAILURE =
  /Permission denied \(publickey|Host key verification failed|Could not read from remote repository|Authentication failed|could not read Username|terminal prompts disabled/i;

export interface EnsureProjectDeps {
  home: string;
  env: NodeJS.ProcessEnv;
  git?: GitRunner;
  /** Repo trong bản tin docs của máy (`listStatusRepos`). */
  statusRepoPaths(): Promise<string[]>;
  /** Thư mục project quen thuộc; mỗi thư mục con cấp một là một ứng viên. */
  projectRoots(): string[];
  configureDocs(info: FolderInfo): Promise<void>;
  ensureCheckout(
    info: FolderInfo,
    projectKey: string,
    role: string,
    branch: string,
  ): Promise<{ role: string; path: string; head: string }>;
}

const strip = (path: string) => path.replace(/\/+$/, '').replace(/\.git$/, '');

/**
 * Khóa so origin: bỏ credential, `.git` và `/` cuối; `git@host:a/b`, `ssh://git@host/a/b` và `https://host/a/b` cùng khóa
 * `host/a/b`; host không phân biệt hoa thường. `file://` và đường tuyệt đối thành đường dẫn.
 */
export function originKey(url: string): string | null {
  const raw = url.trim();
  if (raw === '') return null;
  if (raw.startsWith('/')) return strip(raw) || null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    if (parsed.protocol === 'file:') return strip(decodeURIComponent(parsed.pathname)) || null;
    const path = strip(parsed.pathname.replace(/^\/+/, ''));
    return parsed.hostname && path ? `${parsed.hostname.toLowerCase()}/${path}` : null;
  }
  const scp = /^(?:[^@\s]+@)?([^:\s/]+):(.+)$/.exec(raw);
  const [, host, rest] = scp ?? [];
  if (!host || !rest) return null;
  const path = strip(rest.replace(/^\/+/, ''));
  return path ? `${host.toLowerCase()}/${path}` : null;
}

/** `~/Documents/projects`, `~/Projects` và `/Volumes/<ổ>/Projects` (những thư mục có thật). */
export function defaultProjectRoots(home: string): string[] {
  const roots = [join(home, 'Documents', 'projects'), join(home, 'Projects')];
  try {
    for (const volume of readdirSync('/Volumes')) roots.push(join('/Volumes', volume, 'Projects'));
  } catch {
    // Không đọc được /Volumes: chỉ tìm trong HOME.
  }
  return roots.filter((root) => existsSync(root));
}

const gitEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  GIT_SSH_COMMAND: env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
});
const git = (deps: EnsureProjectDeps, args: string[], timeoutMs = LOCAL_TIMEOUT_MS) =>
  (deps.git ?? runGit)(args, { env: gitEnv(deps.env), timeoutMs });
const lastLine = (text: string) => text.trim().split('\n').pop()?.slice(0, 200) ?? '';
const shown = (url: string) => stripUrlCredentials(url);

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

async function inspectOrNull(dir: string, deps: EnsureProjectDeps): Promise<FolderInfo | null> {
  try {
    return await inspectFolder(dir, { home: deps.home, env: gitEnv(deps.env), git: deps.git });
  } catch {
    return null;
  }
}

function childDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

/** Repo chính (kho git chung) của mọi worktree và symlink trong `~/crew-agents/*` (mọi project đã dựng trên máy). */
async function crewAgentRepos(deps: EnsureProjectDeps): Promise<string[]> {
  const out: string[] = [];
  for (const keyDir of childDirs(join(deps.home, 'crew-agents'))) {
    for (const dir of childDirs(keyDir)) {
      const r = await git(deps, ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
      const common = r.code === 0 ? r.stdout.trim() : '';
      if (common.endsWith('/.git')) out.push(dirname(common));
    }
  }
  return out;
}

/** Bản đầu tiên có cùng origin, theo thứ tự: bản tin docs, `~/crew-agents/*`, thư mục project quen thuộc. */
export async function findRepo(originUrl: string, deps: EnsureProjectDeps): Promise<FolderInfo | null> {
  const want = originKey(originUrl);
  if (!want) return null;
  const candidates = [
    ...(await deps.statusRepoPaths()),
    ...(await crewAgentRepos(deps)),
    ...deps.projectRoots().flatMap(childDirs),
  ];
  const seen = new Set<string>();
  for (const dir of candidates) {
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    const info = await inspectOrNull(real, deps);
    if (info && originKey(info.origin) === want) return info;
  }
  return null;
}

/**
 * Lý do `dest` (có `.git`, `rev-parse HEAD` lỗi với kết quả `head`) KHÔNG chắc là bản clone dở, hoặc null khi chắc. Chỉ
 * chắc khi: HEAD lỗi vì chưa có commit (không phải quá giờ, `safe.directory`, khóa...), `.git` là của chính `dest`, không
 * có nhánh local nào và không có worktree nào khác. Repo chính của các worktree agent không bao giờ qua được.
 */
async function halfCloneProblem(
  dest: string,
  head: { code: number; stderr: string },
  deps: EnsureProjectDeps,
): Promise<string | null> {
  if (!UNBORN_HEAD.test(head.stderr))
    return `lỗi không phải "chưa có commit" (mã ${head.code}: ${lastLine(head.stderr)})`;
  const gitDir = await git(deps, ['-C', dest, 'rev-parse', '--path-format=absolute', '--git-dir']);
  if (gitDir.code !== 0 || realOrNull(gitDir.stdout.trim()) !== realOrNull(join(dest, '.git'))) {
    return 'không đọc được thư mục .git của chính nó';
  }
  const branches = await git(deps, [
    '-C',
    dest,
    'for-each-ref',
    '--count=1',
    '--format=%(refname)',
    'refs/heads',
  ]);
  if (branches.code !== 0) return 'không liệt kê được nhánh';
  if (branches.stdout.trim() !== '') return 'repo đã có nhánh local';
  const worktrees = await git(deps, ['-C', dest, 'worktree', 'list', '--porcelain']);
  if (worktrees.code !== 0) return 'không liệt kê được worktree';
  if (worktrees.stdout.split('\n').filter((line) => line.startsWith('worktree ')).length !== 1) {
    return 'repo đang có worktree khác';
  }
  return null;
}

/**
 * Clone `originUrl` vào `dest` rồi đặt `origin/HEAD` theo remote. `dest` đã là repo đọc được thì không làm gì (trả
 * `false`, bên gọi so origin). Bản clone dở (có `.git`, HEAD chưa có commit, không nhánh, không worktree khác:
 * `halfCloneProblem`) bị xóa rồi clone lại; `.git` đọc HEAD lỗi kiểu khác thì `git_failed`, không xóa; thư mục không
 * có `.git` chỉ bị xóa khi `reclaimPlain` (chỗ `repo` để dành cho bản clone) hoặc khi rỗng. Symlink, file hay thư mục lạ
 * khác thì báo `checkout_exists`, không đè.
 */
async function cloneRepo(
  originUrl: string,
  dest: string,
  deps: EnsureProjectDeps,
  reclaimPlain: boolean,
): Promise<boolean> {
  const stat = lstatOrNull(dest);
  if (stat) {
    if (!stat.isDirectory()) {
      throw new JobError(
        'checkout_exists',
        `${dest} đã có thứ khác (không phải thư mục clone): tự dời đi rồi chạy lại, app không đè`,
      );
    }
    if (existsSync(join(dest, '.git'))) {
      const head = await git(deps, ['-C', dest, 'rev-parse', 'HEAD']);
      if (head.code === 0) return false;
      const why = await halfCloneProblem(dest, head, deps);
      if (why) {
        throw new JobError(
          'git_failed',
          `${dest} có .git nhưng đọc HEAD lỗi và ${why}: app không xóa, tự kiểm repo đó rồi chạy lại`,
        );
      }
    } else if (!reclaimPlain && readdirSync(dest).length > 0) {
      throw new JobError(
        'checkout_exists',
        `${dest} đã có thư mục không phải repo git: tự dời đi rồi chạy lại, app không đè`,
      );
    }
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dirname(dest), { recursive: true });
  const r = await git(deps, ['clone', '--', originUrl, dest], CLONE_TIMEOUT_MS);
  if (r.code !== 0) {
    rmSync(dest, { recursive: true, force: true });
    if (!NETWORK_FAILURE.test(r.stderr) && AUTH_FAILURE.test(r.stderr)) {
      throw new JobError(
        'clone_auth_failed',
        `Máy không clone được ${shown(originUrl)}: GitHub từ chối key SSH của máy. Thêm key (~/.ssh/*.pub) vào GitHub → ` +
          'Settings → SSH and GPG keys, kiểm bằng ssh -T git@github.com, rồi bấm Thêm máy lại ở trang project.',
      );
    }
    throw new JobError(
      'git_failed',
      `git clone ${shown(originUrl)} thất bại (mã ${r.code}): ${lastLine(r.stderr)}`,
    );
  }
  const head = await git(deps, ['-C', dest, 'remote', 'set-head', 'origin', '-a'], REMOTE_QUERY_TIMEOUT_MS);
  if (head.code !== 0)
    throw new JobError('git_failed', `Không đặt được origin/HEAD của ${dest}: ${lastLine(head.stderr)}`);
  return true;
}

/** `origin/HEAD` trỏ về nhánh của project (nhánh đích của integrator phải giống nhau trên mọi máy); chỉ đổi ref local. */
async function alignOriginHead(root: string, branch: string, deps: EnsureProjectDeps): Promise<void> {
  const exists = await git(deps, [
    '-C',
    root,
    'rev-parse',
    '--verify',
    '-q',
    `refs/remotes/origin/${branch}`,
  ]);
  if (exists.code !== 0) return;
  const head = await git(deps, ['-C', root, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
  if (head.code === 0 && head.stdout.trim() === `refs/remotes/origin/${branch}`) return;
  const set = await git(deps, ['-C', root, 'remote', 'set-head', 'origin', branch]);
  if (set.code !== 0) throw new JobError('git_failed', `Không đặt được origin/HEAD của ${root} về ${branch}`);
}

const realOrNull = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/** Repo đi kèm: tìm như repo chính (không có thì clone thẳng vào chỗ của nó), rồi symlink `~/crew-agents/<key>/<tên>`. */
async function ensureCompanion(
  projectKey: string,
  companion: { name: string; originUrl: string },
  deps: EnsureProjectDeps,
): Promise<{ name: string; path: string }> {
  const link = checkoutPath(deps.home, projectKey, companion.name);
  let repo = await findRepo(companion.originUrl, deps);
  if (!repo) {
    await cloneRepo(companion.originUrl, link, deps, false);
    repo = await inspectOrNull(link, deps);
    if (!repo || originKey(repo.origin) !== originKey(companion.originUrl)) {
      throw new JobError(
        'checkout_exists',
        `${link} đã có nhưng không phải repo ${shown(companion.originUrl)}: tự dời đi rồi chạy lại`,
      );
    }
  }
  if (realOrNull(link) === repo.root) return { name: companion.name, path: link };
  if (lstatOrNull(link)) {
    throw new JobError(
      'checkout_exists',
      `${link} đã có thứ khác (không trỏ tới ${repo.root}): tự dời đi rồi chạy lại, app không đè`,
    );
  }
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(repo.root, link);
  return { name: companion.name, path: link };
}

/**
 * Dựng project trên máy: tìm repo có sẵn (không bao giờ clone thêm khi đã có một bản) hoặc clone
 * về `~/crew-agents/<key>/repo`, đặt `origin/HEAD`, cài crew-docs, worktree cho từng vai trò, rồi repo đi kèm. Chạy lại
 * bao nhiêu lần cũng cho cùng kết quả.
 */
export async function ensureProject(
  payload: EnsureProjectPayload,
  deps: EnsureProjectDeps,
): Promise<EnsureProjectResult> {
  let info = await findRepo(payload.originUrl, deps);
  let cloned = false;
  if (!info) {
    const dest = checkoutPath(deps.home, payload.projectKey, 'repo');
    cloned = await cloneRepo(payload.originUrl, dest, deps, true);
    info = await inspectOrNull(dest, deps);
    if (!info || originKey(info.origin) !== originKey(payload.originUrl)) {
      throw new JobError(
        'checkout_exists',
        `${dest} đã có nhưng không phải repo ${shown(payload.originUrl)}: tự dời đi rồi chạy lại`,
      );
    }
  }
  await alignOriginHead(info.root, payload.branch, deps);
  info = (await inspectOrNull(info.root, deps)) ?? info;
  await deps.configureDocs(info);
  const checkouts: EnsureProjectResult['checkouts'] = [];
  for (const { role, branch } of payload.roles) {
    checkouts.push(await deps.ensureCheckout(info, payload.projectKey, role, branch));
  }
  const companions: EnsureProjectResult['companions'] = [];
  for (const companion of payload.companions)
    companions.push(await ensureCompanion(payload.projectKey, companion, deps));
  return { kind: 'ensure-project', repoPath: info.root, cloned, checkouts, companions };
}
