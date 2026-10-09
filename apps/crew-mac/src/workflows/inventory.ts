import { createHash } from 'node:crypto';
import {
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { MacContext } from '../context.js';
import { comparablePath } from '../paths.js';
import { shQuote } from '../system.js';
import { WORKFLOW_LABEL, type WorkflowPin, pinDir as workflowPinDir } from './pin.js';
import { certifiedWorkflows } from './registry.js';

export type Origin = 'pinned' | 'paperclip' | 'project' | 'blocked';

export interface DiscoveredSource {
  path: string;
  kind: 'skill' | 'agent' | 'command' | 'hook' | 'plugin' | 'settings' | 'mcp' | 'bmad';
  origin: Origin;
  /** Lý do chặn (`origin === 'blocked'`). */
  reason?: string;
  /** Cảnh báo không chặn (skill, agent, command đã track mà sửa dở). */
  warning?: string;
  /** Lệnh xem và gỡ vấn đề, cho dòng `crew-workflow blocked|warn` và doctor. */
  fix?: string;
}

/** Đoạn có trong lý do khi git quá hạn (doctor dừng quét các worktree còn lại khi gặp). */
export const GIT_TIMEOUT = 'git quá hạn';
export const UNTRACKED_REASON = 'không được git track trong worktree agent';
export const IGNORED_REASON = 'bị git ignore trong worktree agent';
export const DIRTY_REASON = 'đã sửa so với commit (chưa commit) trong worktree agent';
/** Đuôi lý do khi repo bật plugin của workflow khác; câu đầy đủ: `bật workflow <id> khác với workflow của run (nạp chéo)`. */
export const CROSS_WORKFLOW_REASON = 'khác với workflow của run (nạp chéo)';
/**
 * Đuôi lý do khi repo bật plugin cùng workflow nhưng khác tên plugin ghim (ví dụ `bmad-method@bmad` trong run BMAD):
 * `--plugin-dir` chỉ thay plugin trùng tên, nên plugin này nạp song song với bản ghim. Câu đầy đủ:
 * `bật plugin <tên> ngoài bản ghim, nạp song song với workflow của run`.
 */
export const PARALLEL_PLUGIN_REASON = 'ngoài bản ghim, nạp song song với workflow của run';
/** `setup-project` bỏ qua khi đã có `_bmad/scripts/resolve_config.py`, nên phải xóa `_bmad/scripts` trước khi chạy. */
export const BMAD_SCRIPT_MISMATCH_REASON =
  'khác bản ghim BMAD; khôi phục từ commit, hoặc xóa _bmad/scripts rồi chạy crew-mac bmad setup-project';
export const BMAD_PERSONAL_REASON = 'lớp cá nhân của BMAD chưa commit';
/** Cảnh báo (không chặn) khi `_bmad/config.toml` chưa commit nhưng đúng bản `setup-project` vừa ghi cho worktree này. */
export const BMAD_SETUP_UNCOMMITTED_WARNING =
  'do crew-mac bmad setup-project dựng, chưa commit (run trước bị ngắt trước khi commit)';

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/**
 * Dấu `setup-project` của một worktree: `~/.crew/state/bmad-setup/<32 hex đầu của sha256 đường dẫn so sánh của root>`,
 * nội dung là sha256 của `_bmad/config.toml` mà lần dựng đó ghi ra. Nằm ngoài worktree nên không lọt vào commit.
 */
export function bmadSetupStampPath(home: string, root: string): string {
  return join(home, '.crew', 'state', 'bmad-setup', sha256(comparablePath(root)).slice(0, 32));
}

/** Ghi dấu sau khi `setup-project` dựng xong `_bmad/` (không có `config.toml` thì không ghi). */
export function recordBmadSetup(home: string, root: string): void {
  let data: Buffer;
  try {
    data = readFileSync(join(root, '_bmad', 'config.toml'));
  } catch {
    return;
  }
  const stamp = bmadSetupStampPath(home, root);
  mkdirSync(join(stamp, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(stamp, `${sha256(data)}\n`, { mode: 0o600 });
}

/** `config` (file thường, không symlink) có đúng từng byte bản `setup-project` đã ghi cho `root` không. */
function matchesBmadSetup(home: string, root: string, config: string): boolean {
  try {
    if (!lstatSync(config).isFile()) return false;
    const recorded = readFileSync(bmadSetupStampPath(home, root), 'utf8').trim();
    return recorded.length === 64 && recorded === sha256(readFileSync(config));
  } catch {
    return false;
  }
}

function contained(parent: string, child: string): boolean {
  const rel = relative(comparablePath(parent), comparablePath(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Nguồn ở `path` thuộc loại nào, theo vị trí so với thư mục ghim và worktree, và việc nó có được git track. */
export function classifyOrigin(input: {
  path: string;
  root: string;
  pinDir: string;
  tracked: boolean;
}): Origin {
  if (contained(input.pinDir, input.path)) return 'pinned';
  if (contained(join(input.root, '.paperclip-runtime'), input.path)) return 'paperclip';
  if (contained(input.root, input.path) && input.tracked) return 'project';
  return 'blocked';
}

/** `<đường dẫn> (<lý do>). <cách xử lý>` cho dòng `crew-workflow blocked|warn` và doctor. */
export function describeSource(s: DiscoveredSource): string {
  const why = s.reason ?? s.warning ?? 'nguồn ngoài danh sách cho phép';
  return `${s.path} (${why})${s.fix ? `. ${s.fix}` : ''}`;
}

/**
 * Bytecode Python. Do chính run tạo (chưa track) thì là rác; đã commit dưới `_bmad/scripts` thì là mã khác bản ghim,
 * vì Python nạp `.pyc` dạng unchecked-hash (PEP 552) mà không đối chiếu file nguồn.
 */
export function isPythonBytecode(name: string): boolean {
  return name === '__pycache__' || name.endsWith('.pyc');
}

/** Rác của hệ điều hành và công cụ, không bao giờ là nguồn claude nạp. */
function isJunk(name: string): boolean {
  return name === '.DS_Store' || name.startsWith('._') || name === 'Icon\r' || isPythonBytecode(name);
}

interface GitView {
  /** Đường dẫn của `root` tính từ gốc repo (`''` khi `root` là gốc), dấu `/`. */
  prefix: string;
  /** Đường dẫn (tính từ gốc repo, dấu `/`) → mode git (`120000` là symlink). */
  tracked: Map<string, string>;
  /** Đường dẫn → mã `XY` của `git status --porcelain`; `!!` là bị ignore, thư mục bị ignore kết thúc bằng `/`. */
  status: Map<string, string>;
  /** Lý do không đọc được git (lỗi, quá hạn), null khi đọc được. */
  error: string | null;
}

const toPosix = (path: string) => path.split(sep).join('/');

/**
 * Ba lệnh git cho cả `.claude/`, `.mcp.json` (và `_bmad/` khi run là BMAD) của worktree: vị trí của `root` trong repo (`rev-parse --show-prefix`,
 * để `root` là thư mục con vẫn đúng), danh sách file đã track (kèm mode, `--full-name`) và trạng thái (chưa track, bị
 * ignore, đã sửa; porcelain luôn tính từ gốc repo). Không giữ lock của index để không tranh với git của chính run.
 */
async function readGit(ctx: MacContext, root: string, bmad: boolean): Promise<GitView> {
  const opts = { timeoutMs: 10_000 };
  const fail = (r: { code: number; stderr: string; timedOut: boolean }): GitView => ({
    prefix: '',
    tracked: new Map(),
    status: new Map(),
    error: r.timedOut ? `${GIT_TIMEOUT} 10 giây` : r.stderr.trim().split('\n')[0] || `git thoát mã ${r.code}`,
  });
  const git = (args: string[]) => ctx.runner.run('/usr/bin/git', ['--no-optional-locks', ...args], opts);
  // `--show-prefix` thay vì tự tính từ `--show-toplevel`: APFS không phân biệt hoa thường nên đường dẫn git trả
  // (`…/Projects/crew`) và đường dẫn của run (`…/projects/crew`) có thể khác chữ dù cùng thư mục.
  const top = await git(['-C', root, 'rev-parse', '--show-prefix']);
  if (top.code !== 0 || top.timedOut) return fail(top);
  const prefix = top.stdout.trim().replace(/\/$/, '');
  const paths = ['--', '.claude', '.mcp.json', ...(bmad ? ['_bmad'] : [])];
  const files = await git(['-C', root, 'ls-files', '--full-name', '-s', '-z', ...paths]);
  if (files.code !== 0 || files.timedOut) return fail(files);
  const st = await git([
    '-C',
    root,
    'status',
    '--porcelain=v1',
    '-z',
    '--no-renames',
    '--ignored=matching',
    '--untracked-files=all',
    ...paths,
  ]);
  if (st.code !== 0 || st.timedOut) return fail(st);
  const tracked = new Map<string, string>();
  for (const entry of files.stdout.split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab > 0) tracked.set(entry.slice(tab + 1), entry.split(' ')[0] as string);
  }
  const status = new Map<string, string>();
  for (const entry of st.stdout.split('\0')) {
    if (entry.length > 3) status.set(entry.slice(3), entry.slice(0, 2));
  }
  return { prefix, tracked, status, error: null };
}

interface FileIssue {
  reason: string;
  /** Lệnh xử lý cụ thể, chạy được nguyên văn (đường dẫn tính từ `root`). */
  fix: string;
  /** Đã track mà sửa dở: chỉ chặn khi file là đường thực thi (settings, hook, `.mcp.json`). */
  dirty: boolean;
}

/** Vấn đề của một file nguồn nạp trong worktree, null khi nó đã commit, sạch và không trỏ ra ngoài. */
function fileIssue(git: GitView, root: string, abs: string): FileIssue | null {
  if (git.error) {
    return {
      reason: `không kiểm được git: ${git.error}`,
      fix: `Xử lý: kiểm /usr/bin/git (Command Line Tools) và quyền đọc ${root}, rồi chạy lại.`,
      dirty: false,
    };
  }
  const rel = toPosix(relative(root, abs));
  const r = shQuote(root);
  const f = shQuote(rel);
  const key = git.prefix ? `${git.prefix}/${rel}` : rel;
  const mode = git.tracked.get(key);
  if (mode === undefined) {
    const ignored =
      git.status.get(key) === '!!' ||
      [...git.status].some(([path, code]) => code === '!!' && path.endsWith('/') && key.startsWith(path));
    return {
      reason: ignored ? IGNORED_REASON : UNTRACKED_REASON,
      fix: `Xử lý: commit (git -C ${r} add ${ignored ? '-f ' : ''}-- ${f} rồi commit) hoặc xóa file đó.`,
      dirty: false,
    };
  }
  if (mode === '120000') {
    let target = '';
    try {
      target = realpathSync(abs);
    } catch {}
    if (!target || !contained(root, target)) {
      return {
        reason: target ? `symlink trỏ ra ngoài worktree: ${target}` : 'symlink hỏng trong worktree agent',
        fix: `Xử lý: thay symlink ${rel} bằng nội dung trong repo rồi commit.`,
        dirty: false,
      };
    }
  }
  const code = git.status.get(key);
  if (code === undefined || code === '!!') return null;
  const fix = code.startsWith('A')
    ? `Xem: git -C ${r} diff --cached -- ${f}; bỏ: git -C ${r} rm --cached -- ${f} rồi xóa file, hoặc commit.`
    : `Xem: git -C ${r} diff HEAD -- ${f}; bỏ: git -C ${r} checkout HEAD -- ${f}, hoặc commit.`;
  return { reason: DIRTY_REASON, fix, dirty: true };
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** File dưới `dir` (đệ quy, không theo symlink thư mục, bỏ rác và thư mục chấm) thỏa `keep(path)`. */
function walkFiles(dir: string, keep: (path: string) => boolean, depth = 0): string[] {
  if (depth > 8) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => !isJunk(e.name) && !(e.isDirectory() && e.name.startsWith('.')))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return walkFiles(path, keep, depth + 1);
      return keep(path) ? [path] : [];
    });
}

const isMarkdown = (name: string) => name.endsWith('.md');
const SCRIPT_RE = /\.(?:sh|bash|zsh|js|cjs|mjs|ts|cts|mts|py|rb|pl|cmd)$/;

/**
 * File hook mà claude chạy: script theo đuôi hoặc có bit thực thi, không phải file/thư mục chấm. Hook của repo ghi log
 * và trạng thái chạy (ví dụ `.claude/hooks/.logs/`, bị ignore) ngay trong `hooks/`; tính chúng thì mọi run sau lần
 * đầu đều bị chặn.
 */
function isHookScript(path: string): boolean {
  const name = path.slice(path.lastIndexOf(sep) + 1);
  if (name.startsWith('.')) return false;
  if (SCRIPT_RE.test(name)) return true;
  try {
    return (lstatSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * File claude nạp trong một entry cấp 1 của `.claude/<sub>`: skill chỉ `SKILL.md`; agent, command là `*.md`; hook là
 * script (`isHookScript`). File khác (script, output tạm, `__pycache__`) không phải nguồn nạp nên không xét.
 */
function loadFiles(kind: 'skill' | 'agent' | 'command' | 'hook', path: string): string[] {
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch {
    return [];
  }
  if (st.isSymbolicLink()) return [path];
  if (kind === 'skill')
    return st.isDirectory() && existsSync(join(path, 'SKILL.md')) ? [join(path, 'SKILL.md')] : [];
  const keep = kind === 'hook' ? isHookScript : isMarkdown;
  if (st.isFile()) return keep(path) ? [path] : [];
  if (st.isDirectory() && kind === 'hook' && path.slice(path.lastIndexOf(sep) + 1).startsWith('.')) return [];
  return st.isDirectory() ? walkFiles(path, keep) : [];
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function enabledPluginKeys(json: Record<string, unknown> | null): string[] {
  const plugins = json?.enabledPlugins;
  if (plugins === null || typeof plugins !== 'object') return [];
  return Object.entries(plugins as Record<string, unknown>)
    .filter(([, on]) => on === true)
    .map(([key]) => key);
}

/**
 * Mọi nguồn claude nạp từ worktree dưới `--setting-sources project,local` (skill, agent, command, hook, settings,
 * `.mcp.json`, plugin bật trong settings), kèm loại nguồn. Chỉ file claude thật sự nạp mới bị xét: rác hệ điều hành và
 * file phụ trong thư mục skill bỏ qua. Nguồn ngoài worktree (`~/.claude`) không quét ở đây: đã đo trên Mac mini rằng
 * `--setting-sources project,local` không nạp skill, plugin hay hook user-scope của owner.
 */
export async function discoverSources(
  ctx: MacContext,
  root: string,
  pin: WorkflowPin = ctx.superpowersPin,
): Promise<DiscoveredSource[]> {
  const pinDir = workflowPinDir(ctx.home, pin);
  const bmad = pin.workflow === 'bmad';
  const claudeDir = join(root, '.claude');
  if (isSymlink(claudeDir)) {
    let target = '';
    try {
      target = realpathSync(claudeDir);
    } catch {}
    if (!target || !contained(root, target)) {
      return [
        {
          path: claudeDir,
          kind: 'settings',
          origin: 'blocked',
          reason: `symlink trỏ ra ngoài worktree: ${target || 'hỏng'}`,
        },
      ];
    }
  }
  const hasSources =
    existsSync(claudeDir) ||
    existsSync(join(root, '.mcp.json')) ||
    isSymlink(join(root, '.mcp.json')) ||
    (bmad && (existsSync(join(root, '_bmad')) || isSymlink(join(root, '_bmad'))));
  if (!hasSources) return [];
  const git = await readGit(ctx, root, bmad);
  const found: DiscoveredSource[] = [];
  /** Skill, agent, command sửa dở chỉ cảnh báo (agent làm việc trên chính skill của repo); còn lại chặn. */
  const judge = (path: string, kind: DiscoveredSource['kind'], files: string[]) => {
    const issues = files.map((f) => fileIssue(git, root, f)).filter((i): i is FileIssue => i !== null);
    const warnOnly = kind === 'skill' || kind === 'agent' || kind === 'command';
    const blocking = issues.find((i) => !(i.dirty && warnOnly));
    if (blocking) {
      found.push({ path, kind, origin: 'blocked', reason: blocking.reason, fix: blocking.fix });
      return;
    }
    const origin = classifyOrigin({ path, root, pinDir, tracked: true });
    const warning = issues[0];
    found.push({ path, kind, origin, ...(warning ? { warning: warning.reason, fix: warning.fix } : {}) });
  };
  for (const [kind, sub] of [
    ['skill', 'skills'],
    ['agent', 'agents'],
    ['command', 'commands'],
    ['hook', 'hooks'],
  ] as const) {
    const dir = join(claudeDir, sub);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)
      .filter((e) => !isJunk(e))
      .sort()) {
      const path = join(dir, entry);
      const files = loadFiles(kind, path);
      if (files.length > 0) judge(path, kind, files);
    }
  }
  const local = join(claudeDir, 'settings.local.json');
  if (existsSync(local)) {
    // settings.local.json vốn không commit: chỉ chặn khi nó bật plugin/hook (hoặc không đọc được).
    const json = readJson(local);
    if (json === null || json.enabledPlugins || json.hooks) {
      found.push({
        path: local,
        kind: 'settings',
        origin: 'blocked',
        reason:
          json === null
            ? 'settings.local.json không đọc được trong worktree agent'
            : 'settings.local.json bật plugin hoặc hook trong worktree agent',
      });
    }
  }
  const shared = join(claudeDir, 'settings.json');
  if (existsSync(shared)) {
    const issue = fileIssue(git, root, shared);
    if (issue)
      found.push({ path: shared, kind: 'settings', origin: 'blocked', reason: issue.reason, fix: issue.fix });
    const workflows = certifiedWorkflows(ctx);
    for (const key of enabledPluginKeys(readJson(shared))) {
      const path = `${shared}#${key}`;
      const owner = workflows.find((w) => w.pluginKeys.some((re) => re.test(key)));
      if (owner && owner.id !== pin.workflow) {
        found.push({
          path,
          kind: 'plugin',
          origin: 'blocked',
          reason: `bật workflow ${owner.id} ${CROSS_WORKFLOW_REASON}`,
          fix: `Bỏ "${key}" khỏi enabledPlugins của .claude/settings.json (commit), hoặc giao issue cho agent của workflow ${owner.id}.`,
        });
      } else if (owner && !key.startsWith(`${pin.workflow}@`)) {
        const name = key.slice(0, key.indexOf('@'));
        found.push({
          path,
          kind: 'plugin',
          origin: 'blocked',
          reason: `bật plugin ${name} ${PARALLEL_PLUGIN_REASON}`,
          fix: `Bỏ "${key}" khỏi enabledPlugins của .claude/settings.json (commit); run ${WORKFLOW_LABEL[pin.workflow]} chỉ nạp bản ghim.`,
        });
      } else if (owner) {
        // Đo trên Mac mini: có `--plugin-dir` thì claude chỉ nạp bản ghim (`@inline`), kể cả khi khác version với
        // bản repo bật; `run-init-check` vẫn bắt nếu có lúc nạp đôi.
        found.push({ path, kind: 'plugin', origin: 'pinned' });
      } else {
        found.push({
          path,
          kind: 'plugin',
          origin: issue ? 'blocked' : 'project',
          ...(issue ? { reason: issue.reason, fix: issue.fix } : {}),
        });
      }
    }
  }
  const mcp = join(root, '.mcp.json');
  if (existsSync(mcp) || isSymlink(mcp)) judge(mcp, 'mcp', [mcp]);
  if (bmad) judgeBmad(ctx.home, root, git, pinDir, found, judge);
  return found;
}

/**
 * Đọc mọi file dưới `dir` (đệ quy, bỏ rác) thành bảng đường dẫn tương đối (dấu `/`) → nội dung. Null khi có symlink
 * hay entry không phải file thường (không so được byte), hoặc không đọc được.
 */
function readScriptTree(dir: string): Map<string, Buffer> | null {
  const files = new Map<string, Buffer>();
  const walk = (abs: string, rel: string, depth: number): boolean => {
    if (depth > 8) return false;
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (isJunk(e.name)) continue;
      const path = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!walk(join(abs, e.name), path, depth + 1)) return false;
      } else if (e.isFile()) {
        files.set(path, readFileSync(join(abs, e.name)));
      } else {
        return false;
      }
    }
    return true;
  };
  return walk(dir, '', 0) ? files : null;
}

/**
 * `files` (đường dẫn tương đối dưới `_bmad/scripts`, dấu `/`) có đúng tập file và từng byte của
 * `<pinDir>/skills/bmad/scripts` không. Rỗng hoặc bản ghim không đọc được là không khớp.
 */
export function compareBmadScripts(files: Map<string, Buffer>, pinDir: string): boolean {
  const pinned = readScriptTree(join(pinDir, 'skills', 'bmad', 'scripts'));
  if (!pinned || pinned.size === 0 || pinned.size !== files.size) return false;
  for (const [path, content] of pinned) {
    const other = files.get(path);
    if (!other?.equals(content)) return false;
  }
  return true;
}

/** File `*.toml` dưới `dir` (đệ quy, bỏ rác, thư mục chấm và các thư mục con tên trong `skip`). */
function tomlFiles(dir: string, skip: readonly string[] = []): string[] {
  return walkFiles(dir, (path) => path.endsWith('.toml')).filter(
    (path) => !skip.some((sub) => contained(join(dir, sub), path)),
  );
}

/**
 * Nguồn BMAD của worktree (chỉ run BMAD): `_bmad/scripts` phải giống từng byte bản ghim (chưa commit mà giống thì
 * vẫn cho qua: run trước bị ngắt ngay sau `setup-project`); `config.toml` và mọi file `custom/**` chặn như settings, trừ
 * `config.toml` chưa track mà đúng bản `setup-project` vừa ghi cho worktree này (cho qua kèm cảnh báo, cùng lý do);
 * lớp cá nhân `*.user.toml` phải commit sạch. `_bmad/memory/**` và `_bmad-output/**` là dữ liệu skill ghi ra, không
 * phải nguồn nạp.
 */
function judgeBmad(
  home: string,
  root: string,
  git: GitView,
  pinDir: string,
  found: DiscoveredSource[],
  judge: (path: string, kind: DiscoveredSource['kind'], files: string[]) => void,
): void {
  const base = join(root, '_bmad');
  if (isSymlink(base)) {
    // `setup.py` của BMAD cũng từ chối `_bmad` là symlink; nội dung ngoài worktree còn có thể đổi sau lúc kiểm.
    let target = '';
    try {
      target = realpathSync(base);
    } catch {}
    found.push({
      path: base,
      kind: 'bmad',
      origin: 'blocked',
      reason: !target
        ? 'symlink hỏng trong worktree agent'
        : contained(root, target)
          ? '_bmad là symlink (BMAD chỉ chạy với thư mục thật)'
          : `symlink trỏ ra ngoài worktree: ${target}`,
      fix: 'Xử lý: thay symlink _bmad bằng thư mục thật trong repo (xóa link rồi chạy crew-mac bmad setup-project), rồi commit.',
    });
    return;
  }
  const scripts = join(base, 'scripts');
  if (existsSync(scripts) || isSymlink(scripts)) {
    const files = isSymlink(scripts) ? null : readScriptTree(scripts);
    const scriptsKey = `${git.prefix ? `${git.prefix}/` : ''}_bmad/scripts/`;
    const trackedBytecode = [...git.tracked.keys()].some(
      (key) => key.startsWith(scriptsKey) && key.slice(scriptsKey.length).split('/').some(isPythonBytecode),
    );
    if (!files || !compareBmadScripts(files, pinDir) || trackedBytecode) {
      const r = shQuote(root);
      found.push({
        path: scripts,
        kind: 'bmad',
        origin: 'blocked',
        reason: BMAD_SCRIPT_MISMATCH_REASON,
        fix:
          `Xem: git -C ${r} status -- _bmad/scripts; khôi phục: git -C ${r} checkout HEAD -- _bmad/scripts, ` +
          'hoặc xóa _bmad/scripts rồi chạy crew-mac bmad setup-project.',
      });
    } else if (git.error) {
      const issue = fileIssue(git, root, scripts) as FileIssue;
      found.push({ path: scripts, kind: 'bmad', origin: 'blocked', reason: issue.reason, fix: issue.fix });
    } else {
      const clean = [...files.keys()].every((rel) => fileIssue(git, root, join(scripts, rel)) === null);
      found.push({ path: scripts, kind: 'bmad', origin: clean ? 'project' : 'pinned' });
    }
  }
  const config = join(base, 'config.toml');
  if (existsSync(config) || isSymlink(config)) {
    const issue = fileIssue(git, root, config);
    const fresh =
      issue !== null &&
      (issue.reason === UNTRACKED_REASON || issue.reason === IGNORED_REASON) &&
      matchesBmadSetup(home, root, config);
    if (fresh) {
      const add = issue.reason === IGNORED_REASON ? 'add -f' : 'add';
      found.push({
        path: config,
        kind: 'bmad',
        origin: 'pinned',
        warning: BMAD_SETUP_UNCOMMITTED_WARNING,
        fix: `Xử lý: git -C ${shQuote(root)} ${add} -- _bmad rồi commit (chore(bmad): dựng BMAD cho dự án).`,
      });
    } else {
      judge(config, 'bmad', [config]);
    }
  }
  // Mọi file dưới `custom/` (không chỉ `*.toml`): toml tùy biến trỏ tới nội dung như `custom/packs/<x>.md`.
  for (const file of walkFiles(join(base, 'custom'), (f) => !f.endsWith('.user.toml')))
    judge(file, 'bmad', [file]);
  for (const file of tomlFiles(base, ['scripts', 'memory']).filter((f) => f.endsWith('.user.toml'))) {
    const issue = fileIssue(git, root, file);
    if (!issue) {
      found.push({ path: file, kind: 'bmad', origin: 'project' });
      continue;
    }
    const personal = [UNTRACKED_REASON, IGNORED_REASON, DIRTY_REASON].includes(issue.reason);
    const rel = toPosix(relative(root, file));
    found.push({
      path: file,
      kind: 'bmad',
      origin: 'blocked',
      reason: personal ? BMAD_PERSONAL_REASON : issue.reason,
      fix: personal
        ? `Xử lý: xóa ${rel} (lớp cá nhân không dùng trong run agent), hoặc commit nếu cố ý dùng cho cả nhóm.`
        : issue.fix,
    });
  }
}
