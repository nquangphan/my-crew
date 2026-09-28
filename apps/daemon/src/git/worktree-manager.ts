import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...(env ?? process.env), GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '');
    throw new GitError(`git ${args.join(' ')} failed in ${cwd}: ${stderr.trim()}`, stderr);
  }
}

function gitOk(cwd: string, args: string[]): boolean {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

/** Agent config that is often kept out of git; linked into worktrees when untracked in the main checkout. */
export const DEFAULT_SHARED_PATHS = ['.claude', 'CLAUDE.md', 'AGENTS.md'] as const;

export const WORKTREES_DIR = join('.crew', 'worktrees');
export const BRANCH_PREFIX = 'crew/';
const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;

/** True when git tracks the path, or anything under it. */
export function isTracked(repo: string, path: string): boolean {
  return git(repo, ['ls-files', '--', path]).trim() !== '';
}

/**
 * Shared paths for a project: the defaults that exist in the main checkout and are not tracked, plus the
 * owner's extra paths (same rule). Tracked paths are never linked: the worktree has its own copy.
 */
export function detectSharedPaths(repo: string, extra: readonly string[] = []): string[] {
  const paths = [...new Set([...DEFAULT_SHARED_PATHS, ...extra])];
  return paths.filter((path) => existsSync(join(repo, path)) && !isTracked(repo, path));
}

/** The repo's common git dir (shared by every worktree), absolute. */
export function commonGitDir(repo: string): string {
  const dir = git(repo, ['rev-parse', '--git-common-dir']).trim();
  return isAbsolute(dir) ? dir : resolve(repo, dir);
}

/** Appends `lines` to `info/exclude` of the common git dir unless already there. */
export function addExcludes(repo: string, lines: readonly string[]): void {
  const file = join(commonGitDir(repo), 'info', 'exclude');
  mkdirSync(dirname(file), { recursive: true });
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const have = new Set(current.split('\n').map((line) => line.trim()));
  const missing = lines.filter((line) => !have.has(line));
  if (missing.length === 0) return;
  const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
  appendFileSync(file, `${prefix}${missing.join('\n')}\n`);
}

export interface EnsureWorktreeOptions {
  repo: string;
  /** Ticket key (e.g. `WEB-12`), or a reserved name such as `_probe`. */
  key: string;
  /** Branch, tag or commit the new branch starts from (QC passes the dev report's `head_sha`). */
  base: string;
  /** Repo-relative paths to link from the main checkout (see `detectSharedPaths`). */
  sharedPaths?: readonly string[];
  /** Check the base out detached instead of on `crew/<key>` (the inventory probe). */
  detach?: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  created: boolean;
  linked: string[];
}

export function worktreePath(repo: string, key: string): string {
  return join(repo, WORKTREES_DIR, key);
}

/** Worktrees git knows for the repo: path → branch (null when detached). */
export function listWorktrees(repo: string): Map<string, string | null> {
  const out = git(repo, ['worktree', 'list', '--porcelain']);
  const result = new Map<string, string | null>();
  let path: string | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length);
      result.set(path, null);
    } else if (line.startsWith('branch ') && path) {
      result.set(path, line.slice('branch refs/heads/'.length));
    }
  }
  return result;
}

function sameDir(a: string, b: string): boolean {
  try {
    return resolve(a) === resolve(b) || lstatSync(a).ino === lstatSync(b).ino;
  } catch {
    return false;
  }
}

/**
 * Reuses the ticket's worktree, or its branch, or creates `<repo>/.crew/worktrees/<key>` on a new branch
 * `crew/<key>` from `base`. Then links the shared (untracked) agent config from the main checkout and
 * keeps `.crew/` and the links out of git through `info/exclude`.
 */
export function ensureWorktree(options: EnsureWorktreeOptions): WorktreeInfo {
  const { repo, key, base } = options;
  if (!KEY_RE.test(key)) throw new GitError(`invalid worktree key "${key}"`);
  const path = worktreePath(repo, key);
  const branch = options.detach ? null : `${BRANCH_PREFIX}${key}`;
  const shared = options.sharedPaths ?? [];
  // Anchored, without a trailing slash: a symlink is not a directory to git, so `.claude/` would not match.
  addExcludes(repo, ['/.crew/', ...shared.map((p) => `/${p.replace(/\/+$/, '')}`)]);

  let created = false;
  const known = [...listWorktrees(repo).keys()].some((dir) => sameDir(dir, path));
  if (!known) {
    if (existsSync(path)) git(repo, ['worktree', 'prune']);
    mkdirSync(dirname(path), { recursive: true });
    if (branch === null) {
      git(repo, ['worktree', 'add', '--detach', path, base]);
    } else if (gitOk(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) {
      git(repo, ['worktree', 'add', path, branch]);
    } else {
      git(repo, ['worktree', 'add', '-b', branch, path, base]);
    }
    created = true;
  }

  const linked: string[] = [];
  for (const rel of shared) {
    const target = join(path, rel);
    const source = join(repo, rel);
    if (!existsSync(source)) continue;
    let present = false;
    try {
      lstatSync(target);
      present = true;
    } catch {
      present = false;
    }
    if (present) continue;
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target);
    linked.push(rel);
  }
  return { path, branch, created, linked };
}

/** Removes a ticket worktree (the branch is kept: PM accept merges it by `head_sha`). */
export function removeWorktree(repo: string, key: string): boolean {
  const path = worktreePath(repo, key);
  const known = [...listWorktrees(repo).keys()].some((dir) => sameDir(dir, path));
  if (!known && !existsSync(path)) return false;
  if (known) git(repo, ['worktree', 'remove', '--force', path]);
  // A leftover directory git no longer knows (links are removed, never followed).
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  git(repo, ['worktree', 'prune']);
  return true;
}

/** Keys of the worktrees under `<repo>/.crew/worktrees`. */
export function worktreeKeys(repo: string): string[] {
  const dir = join(repo, WORKTREES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => KEY_RE.test(name));
}
