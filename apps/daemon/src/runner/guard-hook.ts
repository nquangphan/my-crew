import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { HookCallback, PreToolUseHookInput, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { DEFAULT_GUARD_POLICY, type GuardPolicy, matchesAnyGlob } from '@crew/shared';
import { parse } from 'yaml';
import type { JobKind, StateDb } from '../state-db.js';

export interface GuardContext {
  /** The job's worktree (or working dir); writes outside it are denied. */
  cwd: string;
  kind: JobKind;
  /** Repo-relative paths linked into the worktree from the main checkout; they may resolve outside cwd. */
  sharedPaths?: readonly string[];
  /** The job's temp dir (`$TMPDIR`), which Bash may clean up. */
  tmpDir?: string;
  home?: string;
  /**
   * A dev or bug run: it writes code and tests only. Writes to docs (see `isDocsPath`) and `git commit` are
   * denied; the docs-update job updates the docs and commits everything together.
   */
  codeOnly?: boolean;
  /** The path rules the job started with (server setting); the bundled rules when absent. */
  policy?: GuardPolicy;
}

export interface GuardVerdict {
  decision: 'allow' | 'deny';
  reason: string | null;
  /** What the call touches, for the tool log (path, command, skill, …). */
  target: string | null;
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MANIFEST = 'docs/flows.yaml';
/** Sections of `docs/flows.yaml` that only the owner may change (rule R6). */
const PROTECTED_MANIFEST_SECTIONS = ['source', 'shared', 'unassigned'] as const;

/**
 * Repo-root agent instructions. Always protected and never docs, whatever the policy says (owner invariant):
 * only the docs-init job writes them. Case-insensitive, as a macOS worktree is.
 */
const ROOT_AGENT_FILES = new Set(['agents.md', 'claude.md']);
const isRootAgentFile = (rel: string) => ROOT_AGENT_FILES.has(rel.split(sep).join('/').toLowerCase());

/**
 * Protected config (rule R6), mirrored from crew-docs: agent config, the files that wire the crew-docs
 * hooks and CI in, and the agent instructions `CLAUDE.md` and `AGENTS.md`. Only the docs-init job may
 * write them. The list is the policy's `protectedPaths` (bundled: `.claude/**`, `.githooks/**`, …).
 */
export function isProtectedPath(rel: string, policy: GuardPolicy = DEFAULT_GUARD_POLICY): boolean {
  return isRootAgentFile(rel) || matchesAnyGlob(rel.split(sep).join('/'), policy.protectedPaths);
}

/**
 * Docs written by the docs-update job, never by a dev run: the policy's `docsPaths` (bundled: everything
 * under `docs/` and the Markdown files directly at the repo root, `README.md`, `CHANGELOG.md`, …), never
 * `AGENTS.md` or `CLAUDE.md`. Case-insensitive, as a macOS worktree is.
 */
export function isDocsPath(rel: string, policy: GuardPolicy = DEFAULT_GUARD_POLICY): boolean {
  return !isRootAgentFile(rel) && matchesAnyGlob(rel.split(sep).join('/'), policy.docsPaths);
}

const isInside = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Resolves symlinks of the deepest existing ancestor, so a path through a link is judged where it lands. */
function realTarget(path: string): string {
  let current = path;
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return path;
    rest.unshift(current.slice(parent.length + 1));
    current = parent;
  }
  try {
    return join(realpathSync(current), ...rest);
  } catch {
    return path;
  }
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

type Input = Record<string, unknown>;
const str = (value: unknown) => (typeof value === 'string' ? value : null);

/** The file content an Edit, MultiEdit or Write would leave behind, or null when it cannot be computed. */
function contentAfter(tool: string, input: Input, current: string | null): string | null {
  if (tool === 'Write') return str(input.content);
  const edits: Input[] =
    tool === 'MultiEdit' && Array.isArray(input.edits)
      ? (input.edits as Input[])
      : tool === 'Edit'
        ? [input]
        : [];
  if (current === null || edits.length === 0) return null;
  let text = current;
  for (const edit of edits) {
    const oldString = str(edit.old_string);
    const newString = str(edit.new_string);
    if (oldString === null || newString === null) return null;
    text =
      edit.replace_all === true
        ? text.split(oldString).join(newString)
        : text.replace(oldString, () => newString);
  }
  return text;
}

function manifestSections(text: string): string | null {
  try {
    const doc = (parse(text) ?? {}) as Record<string, unknown>;
    return JSON.stringify(PROTECTED_MANIFEST_SECTIONS.map((key) => doc[key] ?? null));
  } catch {
    return null;
  }
}

/** True when the write changes a protected section of `docs/flows.yaml` (or makes it unparseable). */
function touchesProtectedManifest(tool: string, input: Input, absPath: string): boolean {
  const current = existsSync(absPath) ? readFileSync(absPath, 'utf8') : null;
  const after = contentAfter(tool, input, current);
  if (after === null) return tool !== 'NotebookEdit';
  const before =
    current === null
      ? JSON.stringify(PROTECTED_MANIFEST_SECTIONS.map(() => null))
      : manifestSections(current);
  const next = manifestSections(after);
  return next === null || next !== before;
}

function checkWrite(ctx: GuardContext, tool: string, input: Input): GuardVerdict {
  const raw = str(input.file_path) ?? str(input.notebook_path);
  if (!raw) return { decision: 'deny', reason: `${tool} without a file path`, target: null };
  const cwd = resolve(ctx.cwd);
  const abs = resolve(cwd, raw);
  if (!isInside(cwd, abs)) {
    return { decision: 'deny', reason: `ghi ra ngoài thư mục làm việc (${cwd}) bị chặn`, target: abs };
  }
  const rel = relative(cwd, abs);
  const shared = (ctx.sharedPaths ?? []).some((path) => rel === path || rel.startsWith(`${path}${sep}`));
  if (!shared && !isInside(safeRealpath(cwd), realTarget(abs))) {
    return { decision: 'deny', reason: 'đường dẫn đi qua symlink ra ngoài thư mục làm việc', target: abs };
  }
  const policy = ctx.policy ?? DEFAULT_GUARD_POLICY;
  if (ctx.kind !== 'docs_init') {
    // A case-insensitive worktree (macOS) writes `agents.md` into `AGENTS.md`.
    if (isRootAgentFile(rel)) {
      return {
        decision: 'deny',
        reason: `${rel} là hướng dẫn agent được bảo vệ (R6): chỉ job docs_init được ghi; nếu cần đổi, ghi đề xuất vào comment để chủ dự án duyệt`,
        target: rel,
      };
    }
    if (isProtectedPath(rel, policy)) {
      return {
        decision: 'deny',
        reason: `${rel} là cấu hình được bảo vệ (R6), agent không được sửa`,
        target: rel,
      };
    }
    if (rel.split(sep).join('/') === MANIFEST && touchesProtectedManifest(tool, input, abs)) {
      return {
        decision: 'deny',
        reason: 'chỉ được sửa mục flows của docs/flows.yaml; source, shared, unassigned được bảo vệ (R6)',
        target: rel,
      };
    }
  }
  if (
    ctx.kind === 'docs_update' &&
    (isRootAgentFile(rel) || !matchesAnyGlob(rel.split(sep).join('/'), policy.docsUpdateWritePaths))
  ) {
    return {
      decision: 'deny',
      reason: `job docs_update chỉ được ghi docs (${policy.docsUpdateWritePaths.join(', ') || 'không đường dẫn nào'}), không ghi ${rel}`,
      target: rel,
    };
  }
  if (ctx.codeOnly && isDocsPath(rel, policy)) {
    return {
      decision: 'deny',
      reason: `dev không sửa docs: ${rel} thuộc docs (${policy.docsPaths.join(', ')}); job docs_update (sonnet) cập nhật docs sau khi bạn gọi handoff_docs`,
      target: rel,
    };
  }
  return { decision: 'allow', reason: null, target: rel };
}

// ---------------------------------------------------------------------------
// Bash (best effort: R6, R7 and the pre-push gate remain the hard gates)
// ---------------------------------------------------------------------------

/** Splits a shell line into simple commands on `;`, `&&`, `||`, `|` and newlines (quotes respected). */
function simpleCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  let quote: '"' | "'" | null = null;
  const flushWord = () => {
    if (word !== '') words.push(word);
    word = '';
  };
  const flushCommand = () => {
    flushWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '\\' && i + 1 < command.length) word += command[++i];
    else if (ch === ' ' || ch === '\t') flushWord();
    else if (ch === ';' || ch === '\n' || ch === '|' || ch === '&' || ch === '(' || ch === ')')
      flushCommand();
    else word += ch;
  }
  flushCommand();
  return commands;
}

const WRAPPERS = new Set(['sudo', 'command', 'exec', 'nohup', 'env', 'time', 'nice', 'xargs']);

function stripWrappers(words: string[]): string[] {
  let i = 0;
  while (
    i < words.length &&
    (WRAPPERS.has(words[i] as string) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] as string))
  )
    i++;
  return words.slice(i);
}

function isForcePush(words: string[]): boolean {
  const pushAt = words.indexOf('push');
  if (words[0] !== 'git' || pushAt < 0) return false;
  return words
    .slice(pushAt + 1)
    .some(
      (arg) =>
        arg.startsWith('--force') ||
        /^-[A-Za-z]*f[A-Za-z]*$/.test(arg) ||
        (arg.startsWith('+') && arg.length > 1),
    );
}

function isGitCommit(words: string[]): boolean {
  if (words[0] !== 'git') return false;
  for (let i = 1; i < words.length; i++) {
    const word = words[i] as string;
    // Global options that take a separate value: `git -C <dir> commit`, `git -c k=v commit`.
    if (word === '-C' || word === '-c' || word === '--git-dir' || word === '--work-tree') {
      i++;
      continue;
    }
    if (word.startsWith('-')) continue;
    return word === 'commit';
  }
  return false;
}

function touchesHooksPath(words: string[]): boolean {
  if (words[0] !== 'git') return false;
  return words.some((arg) => /core\.hookspath/i.test(arg));
}

/** Resolves one `rm` operand; null when it contains a variable or substitution the guard cannot expand. */
function expandOperand(ctx: GuardContext, operand: string): string | null {
  const home = ctx.home ?? homedir();
  let path = operand;
  if (path === '~' || path.startsWith('~/')) path = home + path.slice(1);
  const vars: Record<string, string | undefined> = {
    HOME: home,
    PWD: ctx.cwd,
    TMPDIR: ctx.tmpDir,
    TMP: ctx.tmpDir,
    TEMP: ctx.tmpDir,
  };
  let unknown = false;
  path = path.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) unknown = true;
    return value ?? '';
  });
  if (unknown || /[`$]/.test(path)) return null;
  return resolve(ctx.cwd, path);
}

function rmOutsideCwd(ctx: GuardContext, words: string[]): string | null {
  if (words[0] !== 'rm') return null;
  const args = words.slice(1);
  const flags = args.filter((arg) => arg.startsWith('-'));
  const short = flags.filter((f) => !f.startsWith('--')).join('');
  const recursive = /[rR]/.test(short) || flags.includes('--recursive');
  const force = short.includes('f') || flags.includes('--force');
  if (!recursive || !force) return null;
  const cwd = resolve(ctx.cwd);
  for (const operand of args.filter((arg) => !arg.startsWith('-'))) {
    const target = expandOperand(ctx, operand);
    if (target === null) return operand;
    const allowedRoots = [cwd, ...(ctx.tmpDir ? [resolve(ctx.tmpDir)] : [])];
    const inside = allowedRoots.some((root) => isInside(root, target) && target !== root);
    if (!inside) return operand;
  }
  return null;
}

function checkBash(ctx: GuardContext, input: Input): GuardVerdict {
  const command = str(input.command) ?? '';
  const target = command.length > 500 ? `${command.slice(0, 500)}…` : command;
  for (const raw of simpleCommands(command)) {
    const words = stripWrappers(raw);
    if (isForcePush(words)) {
      return { decision: 'deny', reason: 'git push --force bị chặn', target };
    }
    if (touchesHooksPath(words)) {
      return {
        decision: 'deny',
        reason: 'không được đổi core.hooksPath (hook crew-docs là cổng bắt buộc)',
        target,
      };
    }
    if (ctx.codeOnly && isGitCommit(words)) {
      return {
        decision: 'deny',
        reason: 'dev không commit: gọi handoff_docs, job docs_update sẽ commit code, test và docs cùng nhau',
        target,
      };
    }
    const outside = rmOutsideCwd(ctx, words);
    if (outside !== null) {
      return { decision: 'deny', reason: `rm -rf ngoài thư mục làm việc bị chặn (${outside})`, target };
    }
  }
  return { decision: 'allow', reason: null, target };
}

/** What the tool log records for a call that is not a write or a shell command. */
function describeTarget(tool: string, input: Input): string | null {
  switch (tool) {
    case 'Read':
      return str(input.file_path);
    case 'Grep':
      return [str(input.pattern), str(input.path)].filter(Boolean).join(' @ ') || null;
    case 'Glob':
      return [str(input.pattern), str(input.path)].filter(Boolean).join(' @ ') || null;
    case 'Skill':
      return str(input.skill) ?? str(input.command);
    case 'Task':
    case 'Agent':
      return str(input.subagent_type);
    default: {
      const text = JSON.stringify(input ?? {});
      return text.length > 500 ? `${text.slice(0, 500)}…` : text;
    }
  }
}

/** Pure decision for one tool call. Writes and Bash get checked; everything else is logged and allowed. */
export function evaluateToolCall(ctx: GuardContext, tool: string, rawInput: unknown): GuardVerdict {
  const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Input;
  if (WRITE_TOOLS.has(tool)) return checkWrite(ctx, tool, input);
  if (tool === 'Bash') return checkBash(ctx, input);
  return { decision: 'allow', reason: null, target: describeTarget(tool, input) };
}

/**
 * The inline `PreToolUse` hook. It runs before any settings allow rule or permission mode, so a permissive
 * repo `.claude/settings.json` cannot widen what an agent may do. An allowed call returns no decision, so
 * the normal `dontAsk` + `allowedTools` check still applies after it; a denied call is refused outright.
 * Every call is written to `tool_log`.
 */
export function createGuardHook(ctx: GuardContext & { jobId: string; state: StateDb }): HookCallback {
  return async (input): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const call = input as PreToolUseHookInput;
    const verdict = evaluateToolCall(ctx, call.tool_name, call.tool_input);
    ctx.state.logTool({
      jobId: ctx.jobId,
      tool: call.tool_name,
      target: verdict.target,
      decision: verdict.decision,
      reason: verdict.reason,
    });
    if (verdict.decision === 'allow') return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.reason ?? 'bị chặn bởi guard của 2P Crew',
      },
    };
  };
}
