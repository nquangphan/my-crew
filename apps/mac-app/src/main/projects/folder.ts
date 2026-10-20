import { type ChildProcess, spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { BUNDLE_KEY, installedDocsBundle, isFile, RUNTIME_KEY, runtimeProblem } from './docs-runtime.js';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (
  args: string[],
  opts: { env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<GitResult>;

/** Chạy một lệnh (không qua shell): `cwd` tùy chọn, quá `timeoutMs` thì giết cả nhóm tiến trình. */
export type ProcessRunner = (
  file: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; timeoutMs: number; cwd?: string },
) => Promise<GitResult>;

/**
 * Chạy `file` ở nhóm tiến trình riêng, không bao giờ hỏi mật khẩu git trên terminal. Lỗi chỉ trả mã thoát và stderr
 * (không chạy được thì mã -1).
 */
export const runProcess: ProcessRunner = (file, args, opts) =>
  new Promise((resolve) => {
    // `spawn` (không phải `execFile`, vốn bỏ `detached`): tiến trình ở nhóm riêng để giết được cả con cháu.
    const child = spawn(file, args, {
      env: { ...opts.env, GIT_TERMINAL_PROMPT: '0' },
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeGit.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cap = (text: string, chunk: string) => (text.length < MAX_GIT_OUTPUT ? text + chunk : text);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout = cap(stdout, chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = cap(stderr, chunk);
    });
    const timer = setTimeout(() => killGroup(child), opts.timeoutMs);
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeGit.delete(child);
      resolve({ code, stdout, stderr });
    };
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code ?? -1));
  });

/** `git` của owner (`/usr/bin/git`), không bao giờ hỏi mật khẩu trên terminal. Lỗi chỉ trả mã thoát và stderr. */
export const runGit: GitRunner = (args, opts) => runProcess('/usr/bin/git', args, opts);

const MAX_GIT_OUTPUT = 16 * 1024 * 1024;

function killGroup(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

const activeGit = new Set<ChildProcess>();

/** Giết (SIGKILL) cả nhóm tiến trình của mọi lệnh đang chạy qua `runProcess` (`git`, `install-hooks`); dùng khi hủy việc quá giờ. */
export function killActiveGit(): void {
  for (const child of activeGit) killGroup(child);
  activeGit.clear();
}

const LOCAL_GIT_TIMEOUT_MS = 30_000;
const RUNTIME_EXCLUDE = '.paperclip-runtime/';

/** Nhánh mặc định: `origin/HEAD`, rồi `main`, `master` (bản ở origin trước, nhánh cục bộ sau). */
const DEFAULT_REFS = [
  'refs/remotes/origin/main',
  'refs/heads/main',
  'refs/remotes/origin/master',
  'refs/heads/master',
];

export interface FolderInfo {
  /** Gốc worktree chính, đường dẫn thật (`realpath`). */
  root: string;
  /** Thư mục `.git` chung (mọi worktree của repo trỏ về đây). */
  commonDir: string;
  origin: string;
  /** Ref nhánh mặc định để rẽ nhánh agent, ví dụ `refs/remotes/origin/main`. */
  baseRef: string;
}

interface GitDeps {
  home: string;
  env: NodeJS.ProcessEnv;
  git?: GitRunner;
}

const real = (path: string) => realpathSync.native(path);

/**
 * Lý do không dùng được `path` làm folder project, hoặc null. Chỉ chặn gốc ổ đĩa, HOME và thư mục cha của HOME
 * (agent sẽ quét cả HOME); KHÔNG chặn `/Volumes`: app có Full Disk Access và sshd agent là con của app.
 */
export function folderGuardReason(home: string, path: string): string | null {
  const p = path.replace(/\/+$/, '') || '/';
  const h = home.replace(/\/+$/, '');
  if (p === '/' || p === h || h.startsWith(`${p}/`)) {
    return 'Không dùng gốc ổ đĩa, HOME hay thư mục cha của HOME làm project: chọn đúng thư mục repo';
  }
  return null;
}

/**
 * Kiểm folder owner chọn: là repo git (gốc worktree chính, không phải repo bare, worktree phụ hay thư mục con), có
 * remote `origin`, xác định được nhánh mặc định. Chỉ đọc, không ghi gì. Ném `Error` tiếng Việt cho từng ca.
 */
export async function inspectFolder(folder: string, deps: GitDeps): Promise<FolderInfo> {
  if (typeof folder !== 'string' || !isAbsolute(folder)) {
    throw new Error('Folder phải là đường dẫn tuyệt đối');
  }
  if (!existsSync(folder)) throw new Error(`Không tìm thấy folder ${folder}`);
  if (!statSync(folder).isDirectory()) throw new Error(`${folder} không phải thư mục`);
  const path = real(folder);
  const guard = folderGuardReason(real(deps.home), path);
  if (guard) throw new Error(guard);

  const git = (args: string[]) =>
    (deps.git ?? runGit)(['-C', path, ...args], { env: deps.env, timeoutMs: LOCAL_GIT_TIMEOUT_MS });
  const out = async (args: string[]) => {
    const r = await git(args);
    return r.code === 0 ? r.stdout.trim() : null;
  };

  const bare = await out(['rev-parse', '--is-bare-repository']);
  if (bare === null) {
    throw new Error(`${path} không phải repo git: chọn thư mục gốc của repo (thư mục có .git)`);
  }
  if (bare === 'true') throw new Error(`${path} là repo bare (không có working tree): chọn bản clone thường`);

  const top = await out(['rev-parse', '--show-toplevel']);
  if (!top) throw new Error(`${path} không phải repo git: chọn thư mục gốc của repo (thư mục có .git)`);
  if (real(top) !== path)
    throw new Error(`${path} là thư mục con của repo ${real(top)}: chọn đúng thư mục gốc đó`);

  const gitDir = await out(['rev-parse', '--path-format=absolute', '--git-dir']);
  const commonDir = await out(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!gitDir || !commonDir) throw new Error(`Không đọc được thư mục .git của ${path}`);
  if (real(gitDir) !== real(commonDir)) {
    throw new Error(
      `${path} là worktree phụ của repo ${dirname(real(commonDir))}: chọn thư mục repo chính (worktree chính)`,
    );
  }

  const origin = await out(['remote', 'get-url', 'origin']);
  if (!origin) {
    throw new Error(
      `Repo ${path} chưa có remote origin: agent cần origin để lấy và đẩy code (git remote add origin <url>)`,
    );
  }

  const head = await out(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
  let baseRef: string | null = null;
  for (const ref of [head, ...DEFAULT_REFS]) {
    if (ref && (await out(['rev-parse', '--verify', '-q', `${ref}^{commit}`]))) {
      baseRef = ref;
      break;
    }
  }
  if (!baseRef) {
    throw new Error(
      `Không xác định được nhánh mặc định của ${path} (origin/HEAD, main, master): chạy git -C ${path} remote set-head origin --auto`,
    );
  }
  return { root: path, commonDir: real(commonDir), origin, baseRef };
}

/** Khóa gợi ý từ tên folder: chữ thường không dấu, số, gạch ngang, bắt đầu bằng chữ, tối đa 31 ký tự; '' nếu không ra. */
export function suggestKey(name: string): string {
  let key = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (key === '') return '';
  if (!/^[a-z]/.test(key)) key = `p-${key}`;
  key = key.slice(0, 31).replace(/-+$/, '');
  return key.length >= 2 ? key : '';
}

/** Nhánh riêng của agent trong repo của owner. */
export const agentBranch = (key: string, role: string) => `agent/${key}-${role}`;

/** `true` nếu `checkout` là gốc của một worktree thuộc repo có `.git` chung `commonDir`. */
export async function isWorktreeOf(checkout: string, commonDir: string, deps: GitDeps): Promise<boolean> {
  const git = deps.git ?? runGit;
  const opts = { env: deps.env, timeoutMs: LOCAL_GIT_TIMEOUT_MS };
  const common = await git(['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir'], opts);
  const top = await git(['-C', checkout, 'rev-parse', '--show-toplevel'], opts);
  if (common.code !== 0 || top.code !== 0) return false;
  try {
    return real(common.stdout.trim()) === commonDir && real(top.stdout.trim()) === real(checkout);
  } catch {
    return false;
  }
}

/**
 * Worktree của agent: `git worktree add` từ repo của owner vào `checkout`, nhánh `branch` (rẽ từ `baseRef` nếu chưa
 * có, có rồi thì dùng lại). Không checkout hay đổi nhánh trong folder của owner; hook của repo không chạy. Worktree đã
 * có đúng chỗ thì dùng lại; thư mục khác ở đó thì ném, không đè.
 */
export async function ensureWorktree(
  info: FolderInfo,
  checkout: string,
  branch: string,
  deps: GitDeps,
): Promise<void> {
  if (existsSync(checkout)) {
    if (await isWorktreeOf(checkout, info.commonDir, deps)) return;
    throw new Error(
      `${checkout} đã có nhưng không phải worktree của ${info.root}: tự dời thư mục đó rồi bấm Chạy tiếp`,
    );
  }
  const git = deps.git ?? runGit;
  const opts = { env: deps.env, timeoutMs: LOCAL_GIT_TIMEOUT_MS };
  const exists = await git(['-C', info.root, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`], opts);
  mkdirSync(dirname(checkout), { recursive: true, mode: 0o755 });
  const add = ['-C', info.root, '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--quiet'];
  const r = await git(
    exists.code === 0
      ? [...add, checkout, branch]
      : [...add, '--no-track', '-b', branch, checkout, info.baseRef],
    { ...opts, timeoutMs: 5 * 60_000 },
  );
  if (r.code !== 0) {
    const reason = r.stderr.trim().split('\n').at(-1) ?? '';
    throw new Error(
      `git worktree add vào ${checkout} (nhánh ${branch}) thất bại (mã ${r.code})${reason ? `: ${reason}` : ''}`,
    );
  }
}

/**
 * Thêm `.paperclip-runtime/` vào `info/exclude` của repo (file chung cho mọi worktree, nằm trong `.git`, không phải
 * working tree). Đã có thì thôi; chỉ nối thêm một dòng, không đổi dòng có sẵn.
 */
export async function ensureRuntimeExcluded(checkout: string, deps: GitDeps): Promise<void> {
  const r = await (deps.git ?? runGit)(
    ['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
    { env: deps.env, timeoutMs: LOCAL_GIT_TIMEOUT_MS },
  );
  if (r.code !== 0) throw new Error(`Không tìm được info/exclude của ${checkout}`);
  const file = r.stdout.trim();
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current.split('\n').some((line) => line.trim() === RUNTIME_EXCLUDE)) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${current === '' || current.endsWith('\n') ? '' : '\n'}${RUNTIME_EXCLUDE}\n`);
}

/** Ba hook crew-docs cài; mỗi hook có đúng một dòng kết thúc bằng `# crew-docs:<hook>`. */
const DOCS_HOOKS = ['pre-commit', 'commit-msg', 'pre-push'] as const;
const PLAIN_HOOKS_DIR = '.githooks';
const INSTALL_HOOKS_TIMEOUT_MS = 60_000;

/**
 * Cài crew-docs cho repo (luôn làm, kể cả repo chưa có `docs/flows.yaml`: flows có thể thêm sau, lúc đó integrator
 * cần sẵn bundle). Ba việc, chạy lại không đổi gì:
 * 1. Đặt `crew-docs.bundle` và `crew-docs.runtime` trong git config của repo (chung cho mọi worktree agent). Giá trị
 *    owner đã đặt mà còn dùng được thì giữ. Bundle lấy từ repo đã có trong bản tin (`statusRepoPaths`), không có thì
 *    `~/.crew/bin/crew-docs.cjs`. Runtime phải là node thật (`runtimeProblem`): lấy của repo khác, không có thì
 *    `nodePath()`.
 * 2. Hook chưa có dòng crew-docs thì chạy `crew-docs install-hooks` trong checkout gốc. Lệnh này tự nhận husky,
 *    lefthook hay `core.hooksPath` riêng của repo và nối vào đó.
 * 3. `core.hooksPath` là `.githooks` tương đối thì đổi thành đường dẫn tuyệt đối: `.githooks/` không được track nên
 *    worktree agent không có, hooksPath tương đối làm commit trong worktree bỏ qua hook.
 * Lỗi thì ném `Error` tiếng Việt.
 */
export async function configureDocsBundle(
  info: FolderInfo,
  deps: GitDeps & {
    statusRepoPaths: () => Promise<string[]>;
    nodePath: () => Promise<string | null>;
    execPath?: string;
    /** Chạy `install-hooks`; mặc định `runProcess`. */
    exec?: ProcessRunner;
  },
): Promise<void> {
  const run = (args: string[]) =>
    (deps.git ?? runGit)(args, { env: deps.env, timeoutMs: LOCAL_GIT_TIMEOUT_MS });
  const dir = info.root;
  const get = async (repo: string, name: string) =>
    (await run(['-C', repo, 'config', '--get', name])).stdout.trim();
  const set = async (name: string, value: string) => {
    const r = await run(['-C', dir, 'config', name, value]);
    if (r.code !== 0) throw new Error(`Không đặt được git config ${name} trong ${dir}`);
  };
  const usable = (path: string) => runtimeProblem(path, deps.execPath) === null;
  const ownBundle = await get(dir, BUNDLE_KEY);
  const ownRuntime = await get(dir, RUNTIME_KEY);
  let bundle: string | null = isFile(ownBundle) ? ownBundle : null;
  let runtime: string | null = usable(ownRuntime) ? ownRuntime : null;

  if (bundle === null || runtime === null) {
    const needBundle = bundle === null;
    const needRuntime = runtime === null;
    for (const repo of await deps.statusRepoPaths()) {
      if (repo === dir) continue;
      const other = await get(repo, BUNDLE_KEY);
      if (bundle === null && isFile(other)) bundle = other;
      const otherRuntime = await get(repo, RUNTIME_KEY);
      if (runtime === null && usable(otherRuntime)) runtime = otherRuntime;
      if (bundle !== null && runtime !== null) break;
    }
    if (needBundle) {
      const fallback = installedDocsBundle(deps.home);
      if (bundle === null && isFile(fallback)) bundle = fallback;
      if (bundle === null) {
        throw new Error(
          'Không tìm thấy bundle crew-docs (~/.crew/bin/crew-docs.cjs): mở lại app 2P Crew để app tự cài',
        );
      }
      await set(BUNDLE_KEY, bundle);
    }
    if (needRuntime) {
      runtime ??= await deps.nodePath();
      if (runtime === null || !usable(runtime)) {
        throw new Error(
          'Chưa có node dùng được cho crew-docs.runtime: mở lại app 2P Crew để app tự tải node, rồi chạy lại',
        );
      }
      await set(RUNTIME_KEY, runtime);
    }
  }
  if (bundle === null || runtime === null) throw new Error(`Không xác định được bundle crew-docs cho ${dir}`);

  if (!(await docsHooksInstalled(dir, run))) {
    const exec = deps.exec ?? runProcess;
    const r = await exec(runtime, [bundle, 'install-hooks', '--runtime', runtime, '--bundle', bundle], {
      cwd: dir,
      env: deps.env,
      timeoutMs: INSTALL_HOOKS_TIMEOUT_MS,
    });
    if (r.code !== 0) {
      const reason = (r.stderr.trim() || r.stdout.trim()).split('\n').at(-1) ?? '';
      throw new Error(
        `crew-docs install-hooks trong ${dir} thất bại (mã ${r.code})${reason ? `: ${reason}` : ''}`,
      );
    }
  }

  const hooksPath = (await run(['-C', dir, 'config', '--local', '--get', 'core.hooksPath'])).stdout.trim();
  const plain = join(dir, PLAIN_HOOKS_DIR);
  if (hooksPath !== '' && !isAbsolute(hooksPath) && resolve(dir, hooksPath) === plain) {
    await set('core.hooksPath', plain);
  }
}

/**
 * Thư mục hook git thật sự dùng (theo `core.hooksPath`) đã có đủ ba dòng crew-docs chưa. Husky chạy hook từ
 * `.husky/_` (file runner của husky), còn dòng crew-docs nằm trong `.husky/<hook>`.
 */
async function docsHooksInstalled(
  dir: string,
  run: (args: string[]) => Promise<GitResult>,
): Promise<boolean> {
  const r = await run(['-C', dir, 'rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
  if (r.code !== 0) return false;
  const active = r.stdout.trim().replace(/\/+$/, '');
  const hooks = active === join(dir, '.husky', '_') ? join(dir, '.husky') : active;
  return DOCS_HOOKS.every((hook) => {
    try {
      return readFileSync(join(hooks, hook), 'utf8')
        .split('\n')
        .some((line) => line.trimEnd().endsWith(`# crew-docs:${hook}`));
    } catch {
      return false;
    }
  });
}

/** Thư mục có gì bên trong chưa (thư mục rỗng còn lại sau khi owner gỡ hết worktree thì coi như chưa có). */
export function hasEntries(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return existsSync(dir);
  }
}

/** Quote cho `/bin/sh` khi cần (lệnh owner tự dán vào Terminal). */
export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./~+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
