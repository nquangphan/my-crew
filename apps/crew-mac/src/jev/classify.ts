import { isAbsolute, resolve } from 'node:path';
import type { MacContext } from '../context.js';

/**
 * Nhóm lệnh nguy hiểm lấy từ mục "Không bao giờ" của vai trò executor/integrator/reviewer. Chỉ lệnh thuộc một nhóm mới
 * có thể bị chặn (khi `enforce` và Jev trả `deny`); phân nhóm chạy cục bộ, không gọi mạng.
 */
export type Category =
  | 'rm_recursive'
  | 'no_verify'
  | 'force_push'
  | 'push_default'
  | 'pr_merge'
  | 'credential';

export const CATEGORIES: readonly Category[] = [
  'rm_recursive',
  'no_verify',
  'force_push',
  'push_default',
  'pr_merge',
  'credential',
];

/** Thông tin git của worktree, chỉ đọc khi lệnh có `git push`. */
export interface GitFacts {
  defaultBranch: string | null;
  currentBranch: string | null;
  originIsGithub: boolean;
}

const GIT_TIMEOUT_MS = 1000;
/** Lệnh lồng (`bash -c`, `eval`) được tách tiếp tới độ sâu này. */
const MAX_DEPTH = 3;

/** `$` trong nháy đơn là chữ thường, không phải biến: đổi sang ký tự này để luật biến secret không khớp. */
export const LITERAL_DOLLAR = '\u0001';

/** Bỏ thân heredoc (`<<EOF` … `EOF`, cả `<<-` và tên trong nháy): đó là dữ liệu, không phải lệnh. */
export function stripHeredocs(command: string): string {
  const lines = command.split('\n');
  const out: string[] = [];
  let pending: { tag: string; dash: boolean }[] = [];
  for (const line of lines) {
    if (pending.length > 0) {
      const head = pending[0] as { tag: string; dash: boolean };
      if ((head.dash ? line.replace(/^\t+/, '') : line) === head.tag) pending = pending.slice(1);
      continue;
    }
    out.push(line);
    for (const match of line.matchAll(/<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g))
      pending.push({ tag: match[3] as string, dash: match[1] === '-' });
  }
  return out.join('\n');
}

/**
 * Tách lệnh shell thành các đoạn lệnh đơn (mảng từ đã bỏ nháy). Ranh giới: `;` `&&` `||` `|` `&` xuống dòng, ngoặc
 * `(` `)`, `$(` và backtick; `<` `>` là từ riêng để biết đối số nào là file đọc hay ghi. Không mở rộng biến; thân
 * heredoc bị bỏ; `$` trong nháy đơn thành `LITERAL_DOLLAR`.
 */
export function splitCommands(input: string): string[][] {
  const command = stripHeredocs(input);
  const segments: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch === '$' ? LITERAL_DOLLAR : ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < command.length && '"\\$`'.includes(command[i + 1] as string)) {
        word += command[++i];
      } else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
      continue;
    }
    if (ch === '\\') {
      if (i + 1 < command.length) {
        const next = command[++i] as string;
        if (next !== '\n') {
          word += next;
          inWord = true;
        }
      }
      continue;
    }
    if (ch === '$' && command[i + 1] === '(') {
      // `X=$(cmd)`: phần trước là một đoạn riêng, lệnh trong ngoặc là đoạn tiếp theo.
      endSegment();
      i++;
      continue;
    }
    if (';&|()`\n'.includes(ch)) {
      endSegment();
      continue;
    }
    if (ch === '<' || ch === '>') {
      endWord();
      let op = ch;
      while (command[i + 1] === '>' || command[i + 1] === '<' || command[i + 1] === '&') op += command[++i];
      words.push(op);
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endWord();
      continue;
    }
    word += ch;
    inWord = true;
  }
  endSegment();
  return segments;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Tiền tố chạy lệnh khác: tên → cờ nhận giá trị (phần sau là giá trị), và số đối số vị trí phải bỏ thêm. */
const RUNNERS: Record<string, { valueFlags: readonly string[]; positional?: number }> = {
  sudo: { valueFlags: ['-u', '-g', '-h', '-p', '-C', '-U', '-D', '-r', '-t', '-T'] },
  doas: { valueFlags: ['-u', '-C'] },
  nohup: { valueFlags: [] },
  time: { valueFlags: [] },
  command: { valueFlags: [] },
  exec: { valueFlags: ['-a'] },
  nice: { valueFlags: ['-n'] },
  ionice: { valueFlags: ['-c', '-n', '-p'] },
  caffeinate: { valueFlags: ['-t', '-w'] },
  stdbuf: { valueFlags: ['-i', '-o', '-e'] },
  timeout: { valueFlags: ['-s', '-k', '--signal', '--kill-after'], positional: 1 },
  gtimeout: { valueFlags: ['-s', '-k', '--signal', '--kill-after'], positional: 1 },
  xargs: { valueFlags: ['-n', '-I', '-P', '-L', '-s', '-E', '-d', '-J', '-R'] },
};
/** Từ khóa shell đứng đầu một đoạn (`if x; then y; fi`, `for …; do …; done`, `{ …; }`, `! cmd`). */
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', '}']);

const baseName = (word: string) => word.slice(word.lastIndexOf('/') + 1);

/** Bỏ tiền tố không đổi nghĩa lệnh: gán biến, từ khóa shell, `env`, và các lệnh trong `RUNNERS` cùng cờ của chúng. */
function stripPrefixes(words: readonly string[]): string[] {
  let rest = [...words];
  for (;;) {
    const head = rest[0];
    if (head === undefined) return rest;
    const name = baseName(head);
    if (ASSIGNMENT.test(head) || KEYWORDS.has(head)) {
      rest = rest.slice(1);
      continue;
    }
    if (name === 'env' && rest.length > 1) {
      rest = rest.slice(1);
      while (rest[0] !== undefined && (rest[0].startsWith('-') || ASSIGNMENT.test(rest[0]))) {
        rest = rest.slice(rest[0] === '-u' || rest[0] === '-S' || rest[0] === '-P' ? 2 : 1);
      }
      continue;
    }
    const runner = RUNNERS[name];
    if (!runner || rest.length === 1) return rest;
    rest = rest.slice(1);
    while (rest[0]?.startsWith('-') && rest[0] !== '-') {
      const flag = rest[0];
      if (flag === '--') {
        rest = rest.slice(1);
        break;
      }
      // `-n 5`, `--signal KILL` lấy đối số kế; `-n5`, `-oL`, `--signal=KILL` đã gồm giá trị.
      rest = rest.slice(runner.valueFlags.includes(flag) ? 2 : 1);
    }
    // `nice -5 cmd` (số âm kiểu cũ) đã bị bỏ như cờ; `timeout 10 cmd` còn thời lượng.
    rest = rest.slice(runner.positional ?? 0);
  }
}

const GIT_GLOBAL_VALUE_FLAGS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
]);

/** `git [tuỳ chọn chung] <lệnh con> …`: trả các `-c` đã đặt, lệnh con và đối số của nó. */
function parseGit(args: readonly string[]): { configs: string[]; sub: string | null; rest: string[] } {
  const configs: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i] as string;
    if (!arg.startsWith('-')) break;
    if (arg === '-c') configs.push(args[i + 1] ?? '');
    else if (arg.startsWith('-c') && arg.length > 2) configs.push(arg.slice(2));
    i += GIT_GLOBAL_VALUE_FLAGS.has(arg) ? 2 : 1;
  }
  return { configs, sub: args[i] ?? null, rest: args.slice(i + 1) };
}

/** Cờ ngắn của `git commit` nhận giá trị: phần còn lại của cụm (hoặc đối số kế) là giá trị, không phải cờ. */
const COMMIT_VALUE_SHORT = 'mFCct';
const COMMIT_VALUE_LONG = new Set([
  '--message',
  '--file',
  '--reuse-message',
  '--reedit-message',
  '--template',
  '--author',
  '--date',
  '--cleanup',
  '--fixup',
  '--squash',
  '--trailer',
  '--pathspec-from-file',
]);

function commitHasShortN(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '--') return false;
    if (arg.startsWith('--')) {
      if (COMMIT_VALUE_LONG.has(arg)) i++;
      continue;
    }
    if (!arg.startsWith('-') || arg === '-') continue;
    for (let j = 1; j < arg.length; j++) {
      const flag = arg[j] as string;
      if (flag === 'n') return true;
      if (COMMIT_VALUE_SHORT.includes(flag)) {
        if (j === arg.length - 1) i++;
        break;
      }
    }
  }
  return false;
}

const PUSH_VALUE_FLAGS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);

function parsePush(args: readonly string[]): { flags: string[]; positional: string[] } {
  const flags: string[] = [];
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('-') && arg !== '-') {
      flags.push(arg);
      if (PUSH_VALUE_FLAGS.has(arg)) i++;
    } else positional.push(arg);
  }
  return { flags, positional };
}

function isForcePush(flags: readonly string[], refspecs: readonly string[]): boolean {
  for (const flag of flags) {
    if (flag === '--force' || flag.startsWith('--force-with-lease') || flag === '--force-if-includes')
      return true;
    if (flag === '--mirror') return true;
    if (!flag.startsWith('--') && flag.slice(1).includes('f')) return true;
  }
  return refspecs.some((refspec) => refspec.startsWith('+'));
}

/** Nhánh mặc định; repo thiếu `origin/HEAD` cục bộ thì coi `main` và `master` là nhánh mặc định. */
export function defaultBranches(git: GitFacts): string[] {
  return git.defaultBranch ? [git.defaultBranch] : ['main', 'master'];
}

function targetsDefault(refspecs: readonly string[], git: GitFacts | null): boolean {
  if (!git?.originIsGithub) return false;
  const branches = defaultBranches(git);
  const onDefault = git.currentBranch !== null && branches.includes(git.currentBranch);
  if (refspecs.length === 0) return onDefault;
  return refspecs.some((raw) => {
    const refspec = raw.replace(/^\+/, '');
    if (refspec === 'HEAD') return onDefault;
    const dst = refspec.includes(':') ? refspec.slice(refspec.lastIndexOf(':') + 1) : refspec;
    return branches.includes(dst.replace(/^refs\/heads\//, ''));
  });
}

function gitCategory(args: readonly string[], git: GitFacts | null): Category | null {
  const { configs, sub, rest } = parseGit(args);
  if (configs.some((c) => c.toLowerCase().startsWith('core.hookspath'))) return 'no_verify';
  if (rest.includes('--no-verify')) return 'no_verify';
  if (sub === 'commit' && commitHasShortN(rest)) return 'no_verify';
  if (sub !== 'push') return null;
  const { flags, positional } = parsePush(rest);
  const refspecs = positional.slice(1);
  if (isForcePush(flags, refspecs)) return 'force_push';
  if (targetsDefault(refspecs, git)) return 'push_default';
  return null;
}

const GLOB = /[*?[]/;

/**
 * Đường dẫn chứa credential: khóa SSH riêng, chứng chỉ, `.env` thật, token gh/Claude, thư mục Jev của crew-mac. Glob
 * (`~/.ssh/*`, `~/.ssh/id*`, `.env*`) được tính khi phần trước ký tự glob đã nằm trong vùng nhạy cảm.
 */
function isSensitivePath(word: string): boolean {
  const path = word.replace(/^[<>]+/, '');
  if (/(^|\/)\.ssh\/id_[^/]*$/.test(path)) return true;
  if (GLOB.test(path) && /(^|\/)\.ssh\/[^/]*$/.test(path)) return true;
  if (/\.(pem|p12)$/i.test(path)) return true;
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example' && base !== '.env.sample') return true;
  if (GLOB.test(base) && /^\.env/.test(base)) return true;
  if (/(^|\/)\.config\/gh\/hosts\.yml$/.test(path)) return true;
  if (/(^|\/)\.claude\/\.credentials/.test(path)) return true;
  return /(^|\/)\.crew\/jev(\/|$)/.test(path);
}

/** Cả thư mục `~/.ssh` (đứng một mình) làm đối số của lệnh nén hay chép. */
const isSshDir = (word: string) => /(^|\/)\.ssh\/?$/.test(word);

/** Lệnh chỉ xem tên/quyền hoặc dùng khóa mà không in nội dung (`.crew/jev` vẫn bị tính với mọi lệnh). */
const NON_READING = new Set([
  'ls',
  'test',
  '[',
  'stat',
  'chmod',
  'ssh',
  'ssh-add',
  'ssh-keygen',
  'touch',
  'mkdir',
  'rm',
]);
const COPYING = new Set(['cp', 'mv', 'scp', 'rsync', 'ditto', 'install']);
const ARCHIVING = new Set(['tar', 'zip', '7z', 'gtar', 'bsdtar', 'ditto', 'cp', 'scp', 'rsync']);
const SECRET_VAR = /\$\{?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*\}?/i;
const SECRET_NAME = /^[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*$/i;

function readsSensitiveFile(cmd: string, args: readonly string[]): boolean {
  // Bỏ file đích của chuyển hướng ghi (`> .env`) và của lệnh chép (`cp .env.example .env`): đó là ghi, không phải đọc.
  const read: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg.startsWith('>')) {
      i++;
      continue;
    }
    if (arg.startsWith('<')) continue;
    read.push(arg);
  }
  const operands = COPYING.has(cmd) ? read.filter((a) => !a.startsWith('-')).slice(0, -1) : read;
  if (operands.some((a) => /(^|\/)\.crew\/jev(\/|$)/.test(a))) return true;
  if (ARCHIVING.has(cmd) && operands.some(isSshDir)) return true;
  if (NON_READING.has(cmd)) return false;
  return operands.some(isSensitivePath);
}

/** In toàn bộ env: `env`/`printenv`/`export`/`set` không đối số, `export -p`, `declare -x|-p`, `typeset -x`. */
function dumpsEnvironment(words: readonly string[], cmd: string, args: readonly string[]): boolean {
  if (baseName(words[0] ?? '') === 'env' && words.slice(1).every((w) => w.startsWith('-'))) return true;
  if ((cmd === 'printenv' || cmd === 'export' || cmd === 'set') && args.length === 0) return true;
  if (cmd === 'export' && args.length === 1 && args[0] === '-p') return true;
  return (cmd === 'declare' || cmd === 'typeset') && args.length === 1 && /^-[a-z]*[xp]/.test(args[0] ?? '');
}

function credentialCategory(words: readonly string[], cmd: string, args: readonly string[]): boolean {
  if (dumpsEnvironment(words, cmd, args)) return true;
  if (cmd === 'printenv' && args.some((a) => SECRET_NAME.test(a))) return true;
  if (
    cmd === 'security' &&
    ['find-generic-password', 'find-internet-password', 'dump-keychain'].includes(args[0] ?? '')
  )
    return true;
  if ((cmd === 'echo' || cmd === 'printf') && args.some((a) => SECRET_VAR.test(a))) return true;
  return readsSensitiveFile(cmd, args);
}

/**
 * Biến được gán đúng một lần trong lệnh, bằng `$(mktemp -d …)`, và không bị `read`/`for` gán lại: `rm -rf "$D"` với
 * biến này là dọn thư mục tạm của chính lệnh, không tính nhóm `rm_recursive`.
 */
export function mktempDirVars(command: string): Set<string> {
  const vars = new Set<string>();
  for (const match of command.matchAll(
    /(?:^|[^A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)="?\$\(\s*mktemp\b([^)]*)\)/g,
  )) {
    const name = match[1] as string;
    if (!/(^|\s)-[A-Za-z]*d/.test(match[2] as string)) continue;
    const assignments = command.match(new RegExp(`(?:^|[^A-Za-z0-9_$])${name}=`, 'g'))?.length ?? 0;
    const rebound = new RegExp(`\\b(read|for|mapfile|readarray|getopts)\\b[^;&|\\n]*\\b${name}\\b`).test(
      command,
    );
    if (assignments === 1 && !rebound) vars.add(name);
  }
  return vars;
}

function removesOnlyMktempDirs(args: readonly string[], tempVars: ReadonlySet<string>): boolean {
  const operands = args.filter((a) => !a.startsWith('-'));
  return (
    operands.length > 0 &&
    operands.every((a) => {
      const match = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?(\/.*)?$/.exec(a);
      return match !== null && tempVars.has(match[1] as string) && !(match[2] ?? '').includes('..');
    })
  );
}

const PR_MERGE_ARG = /pulls\/\d+\/merge\b|mergePullRequest/;
const GH_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname']);

function segmentCategory(
  words: readonly string[],
  git: GitFacts | null,
  depth: number,
  tempVars: ReadonlySet<string>,
): Category | null {
  const stripped = stripPrefixes(words);
  const cmd = stripped[0] === undefined ? undefined : baseName(stripped[0]);
  if (cmd === undefined) return credentialCategory(words, '', []) ? 'credential' : null;
  const args = stripped.slice(1);
  if ((cmd === 'bash' || cmd === 'sh' || cmd === 'zsh') && depth < MAX_DEPTH) {
    const at = args.findIndex((a) => /^-[a-z]*c$/.test(a));
    const script = at >= 0 ? args[at + 1] : undefined;
    if (script !== undefined) return categoryAt(script, git, depth + 1);
  }
  if (cmd === 'eval' && depth < MAX_DEPTH) return categoryAt(args.join(' '), git, depth + 1);
  if (cmd === 'rm' && !removesOnlyMktempDirs(args, tempVars)) {
    for (const arg of args) {
      if (arg === '--') break;
      if (arg === '--recursive') return 'rm_recursive';
      if (/^-[A-Za-z]*[rR]/.test(arg)) return 'rm_recursive';
    }
  }
  if (cmd === 'find') {
    if (args.includes('-delete')) return 'rm_recursive';
    const exec = args.findIndex((a) => a === '-exec' || a === '-execdir' || a === '-ok' || a === '-okdir');
    if (exec >= 0) {
      const end = args.findIndex((a, i) => i > exec && (a === ';' || a === '+'));
      const inner = segmentCategory(args.slice(exec + 1, end < 0 ? undefined : end), git, depth, tempVars);
      if (inner) return inner;
    }
  }
  if (cmd === 'git') {
    const category = gitCategory(args, git);
    if (category) return category;
  }
  if (cmd === 'gh') {
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] as string;
      if (GH_VALUE_FLAGS.has(arg)) i++;
      else if (!arg.startsWith('-')) positional.push(arg);
    }
    if (positional[0] === 'pr' && positional[1] === 'merge') return 'pr_merge';
  }
  // Merge qua API bằng bất kỳ công cụ nào (`gh api`, `curl`, `wget`, `http`): REST `pulls/<n>/merge` hay GraphQL.
  if (args.some((a) => PR_MERGE_ARG.test(a))) return 'pr_merge';
  return credentialCategory(words, cmd, args) ? 'credential' : null;
}

function categoryAt(command: string, git: GitFacts | null, depth: number): Category | null {
  const tempVars = mktempDirVars(command);
  for (const words of splitCommands(command)) {
    const category = segmentCategory(words, git, depth, tempVars);
    if (category) return category;
  }
  return null;
}

/** Nhóm nguy hiểm đầu tiên khớp trong lệnh, hoặc null. `git` chỉ cần cho `push_default`. */
export function dangerCategory(command: string, git: GitFacts | null): Category | null {
  return categoryAt(command, git, 0);
}

/**
 * Thư mục repo của `git push` đầu tiên trong lệnh (theo `cd <dir>` đứng trước và `git -C <dir>`), hoặc null khi lệnh
 * không có `git push` thật (chuỗi trong `echo` không tính). `cd` tới đường dẫn không mở rộng được (`~`, `$X`) thì giữ
 * thư mục hiện tại.
 */
export function gitPushDir(command: string, cwd: string, depth = 0): string | null {
  let dir = cwd;
  const move = (target: string | undefined) => {
    if (target === undefined || /^[~$]/.test(target) || target.includes(LITERAL_DOLLAR)) return;
    dir = isAbsolute(target) ? target : resolve(dir, target);
  };
  for (const words of splitCommands(command)) {
    const stripped = stripPrefixes(words);
    const cmd = stripped[0] === undefined ? undefined : baseName(stripped[0]);
    const args = stripped.slice(1);
    if (cmd === 'cd') move(args.find((a) => !a.startsWith('-')));
    if ((cmd === 'bash' || cmd === 'sh' || cmd === 'zsh' || cmd === 'eval') && depth < MAX_DEPTH) {
      const at = args.findIndex((a) => /^-[a-z]*c$/.test(a));
      const script = cmd === 'eval' ? args.join(' ') : at >= 0 ? args[at + 1] : undefined;
      const inner = script === undefined ? null : gitPushDir(script, dir, depth + 1);
      if (inner !== null) return inner;
    }
    if (cmd !== 'git') continue;
    const { sub } = parseGit(args);
    if (sub !== 'push') continue;
    let repo = dir;
    for (let i = 0; i < args.length && args[i] !== 'push'; i++) {
      if (args[i] === '-C') {
        const target = args[i + 1];
        if (target !== undefined && !/^[~$]/.test(target))
          repo = isAbsolute(target) ? target : resolve(repo, target);
        i++;
      }
    }
    return repo;
  }
  return null;
}

/** Lệnh có `git push` thật (ở bất kỳ đoạn nào) thì mới cần đọc thông tin git của worktree. */
export function needsGitFacts(command: string): boolean {
  return gitPushDir(command, '/') !== null;
}

async function gitLine(ctx: MacContext, cwd: string, args: string[]): Promise<string | null> {
  const result = await ctx.runner.run('git', ['-C', cwd, ...args], { timeoutMs: GIT_TIMEOUT_MS });
  const line = result.stdout.trim();
  return result.code === 0 && line !== '' ? line : null;
}

/** Ba lệnh git chạy song song, mỗi lệnh hạn 1 giây; lỗi nào cũng thành giá trị rỗng. */
export async function readGitFacts(ctx: MacContext, cwd: string): Promise<GitFacts> {
  const [originHead, current, origin] = await Promise.all([
    gitLine(ctx, cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
    gitLine(ctx, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    gitLine(ctx, cwd, ['remote', 'get-url', 'origin']),
  ]);
  return {
    defaultBranch: originHead?.replace(/^origin\//, '') ?? null,
    currentBranch: current,
    originIsGithub: origin !== null && /(^|[@/.])github\.com[:/]/i.test(origin),
  };
}
