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

/**
 * Tách lệnh shell thành các đoạn lệnh đơn (mảng từ đã bỏ nháy). Ranh giới: `;` `&&` `||` `|` `&` xuống dòng, ngoặc
 * `(` `)`, `$(` và backtick; `<` `>` là từ riêng để biết đối số nào là file đọc hay ghi. Không mở rộng biến.
 */
export function splitCommands(command: string): string[][] {
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
      else word += ch;
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
const XARGS_VALUE_FLAGS = new Set(['-n', '-I', '-P', '-L', '-s', '-E', '-d', '-J', '-R']);

/** Bỏ tiền tố không đổi nghĩa lệnh: gán biến, `sudo`, `env`, `nohup`, `time`, `command`, `exec`, `xargs`. */
function stripPrefixes(words: readonly string[]): string[] {
  let rest = [...words];
  for (;;) {
    const head = rest[0];
    if (head === undefined) return rest;
    if (ASSIGNMENT.test(head)) rest = rest.slice(1);
    else if (
      head === 'sudo' ||
      head === 'nohup' ||
      head === 'time' ||
      head === 'command' ||
      head === 'exec'
    ) {
      rest = rest.slice(1);
      while (rest[0]?.startsWith('-')) rest = rest.slice(1);
    } else if (head === 'env' && rest.length > 1) {
      rest = rest.slice(1);
      while (rest[0] !== undefined && (rest[0].startsWith('-') || ASSIGNMENT.test(rest[0])))
        rest = rest.slice(1);
    } else if (head === 'xargs') {
      rest = rest.slice(1);
      while (rest[0]?.startsWith('-')) rest = rest.slice(XARGS_VALUE_FLAGS.has(rest[0]) ? 2 : 1);
    } else return rest;
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

function targetsDefault(refspecs: readonly string[], git: GitFacts | null): boolean {
  if (!git?.originIsGithub || !git.defaultBranch) return false;
  const branch = git.defaultBranch;
  if (refspecs.length === 0) return git.currentBranch === branch;
  return refspecs.some((raw) => {
    const refspec = raw.replace(/^\+/, '');
    if (refspec === 'HEAD') return git.currentBranch === branch;
    const dst = refspec.includes(':') ? refspec.slice(refspec.lastIndexOf(':') + 1) : refspec;
    return dst.replace(/^refs\/heads\//, '') === branch;
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

/** Đường dẫn chứa credential: khóa SSH riêng, chứng chỉ, `.env` thật, token gh/Claude, thư mục Jev của crew-mac. */
function isSensitivePath(word: string): boolean {
  const path = word.replace(/^[<>]+/, '');
  if (/(^|\/)\.ssh\/id_[^/]*$/.test(path)) return true;
  if (/\.(pem|p12)$/i.test(path)) return true;
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example' && base !== '.env.sample') return true;
  if (/(^|\/)\.config\/gh\/hosts\.yml$/.test(path)) return true;
  if (/(^|\/)\.claude\/\.credentials/.test(path)) return true;
  return /(^|\/)\.crew\/jev(\/|$)/.test(path);
}

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
const SECRET_VAR = /\$\{?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*\}?/i;

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
  if (NON_READING.has(cmd)) return false;
  return operands.some(isSensitivePath);
}

function credentialCategory(words: readonly string[], cmd: string, args: readonly string[]): boolean {
  if (words[0] === 'env' && words.slice(1).every((w) => w.startsWith('-'))) return true;
  if (cmd === 'printenv' && args.length === 0) return true;
  if (
    cmd === 'security' &&
    ['find-generic-password', 'find-internet-password', 'dump-keychain'].includes(args[0] ?? '')
  )
    return true;
  if ((cmd === 'echo' || cmd === 'printf') && args.some((a) => SECRET_VAR.test(a))) return true;
  return readsSensitiveFile(cmd, args);
}

function segmentCategory(words: readonly string[], git: GitFacts | null, depth: number): Category | null {
  const stripped = stripPrefixes(words);
  const cmd = stripped[0]?.replace(/^.*\//, '');
  if (cmd === undefined) return credentialCategory(words, '', []) ? 'credential' : null;
  const args = stripped.slice(1);
  if ((cmd === 'bash' || cmd === 'sh' || cmd === 'zsh') && depth < MAX_DEPTH) {
    const at = args.findIndex((a) => /^-[a-z]*c$/.test(a));
    const script = at >= 0 ? args[at + 1] : undefined;
    if (script !== undefined) return categoryAt(script, git, depth + 1);
  }
  if (cmd === 'eval' && depth < MAX_DEPTH) return categoryAt(args.join(' '), git, depth + 1);
  if (cmd === 'rm') {
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
      const inner = segmentCategory(args.slice(exec + 1, end < 0 ? undefined : end), git, depth);
      if (inner) return inner;
    }
  }
  if (cmd === 'git') {
    const category = gitCategory(args, git);
    if (category) return category;
  }
  if (cmd === 'gh') {
    const positional = args.filter((a) => !a.startsWith('-'));
    if (positional[0] === 'pr' && positional[1] === 'merge') return 'pr_merge';
    if (positional[0] === 'api' && args.some((a) => /pulls\/\d+\/merge\b/.test(a))) return 'pr_merge';
  }
  return credentialCategory(words, cmd, args) ? 'credential' : null;
}

function categoryAt(command: string, git: GitFacts | null, depth: number): Category | null {
  for (const words of splitCommands(command)) {
    const category = segmentCategory(words, git, depth);
    if (category) return category;
  }
  return null;
}

/** Nhóm nguy hiểm đầu tiên khớp trong lệnh, hoặc null. `git` chỉ cần cho `push_default`. */
export function dangerCategory(command: string, git: GitFacts | null): Category | null {
  return categoryAt(command, git, 0);
}

/** Lệnh có `git push` (ở bất kỳ đoạn nào) thì mới cần đọc thông tin git của worktree. */
export function needsGitFacts(command: string): boolean {
  return /\bgit\b[^\n;&|]*\bpush\b/.test(command);
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
