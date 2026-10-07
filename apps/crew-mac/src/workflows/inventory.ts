import {
  type Dirent,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { MacContext } from '../context.js';
import { comparablePath } from '../paths.js';
import { shQuote } from '../system.js';
import { superpowersPinDir, type WorkflowPin } from './pin.js';

export type Origin = 'pinned' | 'paperclip' | 'project' | 'blocked';

export interface DiscoveredSource {
  path: string;
  kind: 'skill' | 'agent' | 'command' | 'hook' | 'plugin' | 'settings' | 'mcp';
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

/** Rác của hệ điều hành và công cụ, không bao giờ là nguồn claude nạp. */
function isJunk(name: string): boolean {
  return (
    name === '.DS_Store' ||
    name.startsWith('._') ||
    name === 'Icon\r' ||
    name === '__pycache__' ||
    name.endsWith('.pyc')
  );
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
 * Ba lệnh git cho cả `.claude/` và `.mcp.json` của worktree: vị trí của `root` trong repo (`rev-parse --show-prefix`,
 * để `root` là thư mục con vẫn đúng), danh sách file đã track (kèm mode, `--full-name`) và trạng thái (chưa track, bị
 * ignore, đã sửa; porcelain luôn tính từ gốc repo). Không giữ lock của index để không tranh với git của chính run.
 */
async function readGit(ctx: MacContext, root: string): Promise<GitView> {
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
  const paths = ['--', '.claude', '.mcp.json'];
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
  const pinDir = superpowersPinDir(ctx.home, pin);
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
    existsSync(claudeDir) || existsSync(join(root, '.mcp.json')) || isSymlink(join(root, '.mcp.json'));
  if (!hasSources) return [];
  const git = await readGit(ctx, root);
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
    for (const key of enabledPluginKeys(readJson(shared))) {
      const path = `${shared}#${key}`;
      if (key.startsWith(`${pin.workflow}@`)) {
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
  return found;
}
