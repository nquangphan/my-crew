import { execFileSync } from 'node:child_process';

/** A git command failed; `stderr` carries git's own message. */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
    readonly status: number | null,
  ) {
    super(`git ${args.join(' ')} failed${stderr ? `: ${stderr.trim()}` : ''}`);
    this.name = 'GitError';
  }
}

/** SHA of git's empty tree, the "before" side of a root commit or an unborn branch. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const ZERO_SHA = /^0{40}$/;

export function isZeroSha(sha: string): boolean {
  return ZERO_SHA.test(sha);
}

/** Runs git in `cwd` and returns stdout. Git's environment (e.g. GIT_INDEX_FILE inside hooks) is kept. */
export function git(cwd: string, args: readonly string[], input?: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      input,
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const failure = error as { stderr?: string | Buffer; status?: number | null };
    throw new GitError(args, String(failure.stderr ?? ''), failure.status ?? null);
  }
}

/** Like `git()`, but returns null when git exits non-zero (e.g. a missing path or ref). */
export function tryGit(cwd: string, args: readonly string[]): string | null {
  try {
    return git(cwd, args);
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

const splitZ = (out: string) => out.split('\0').filter((part) => part.length > 0);

export function repoRoot(cwd: string): string {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

/** True inside a linked worktree (its git dir differs from the shared common dir). */
export function isLinkedWorktree(cwd: string): boolean {
  const gitDir = git(cwd, ['rev-parse', '--path-format=absolute', '--git-dir']).trim();
  const commonDir = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  return gitDir !== commonDir;
}

export function resolveCommit(cwd: string, rev: string): string | null {
  return tryGit(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])?.trim() ?? null;
}

export function headCommit(cwd: string): string | null {
  return resolveCommit(cwd, 'HEAD');
}

/** True while a merge is being concluded (MERGE_HEAD exists): the next commit is a merge commit. */
export function isMerging(cwd: string): boolean {
  return resolveCommit(cwd, 'MERGE_HEAD') !== null;
}

export function firstParent(cwd: string, sha: string): string | null {
  return resolveCommit(cwd, `${sha}^1`);
}

export function commitMessage(cwd: string, sha: string): string {
  return git(cwd, ['log', '-1', '--format=%B', sha]);
}

/** Non-merge commits in `revListArgs` (e.g. `a..b`, or `sha --not --remotes`), oldest first. */
export function nonMergeCommits(cwd: string, revListArgs: readonly string[]): string[] {
  return git(cwd, ['rev-list', '--reverse', '--no-merges', ...revListArgs])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';

export interface FileChange {
  status: ChangeStatus;
  /** The path after the change (the deleted path for `D`). */
  path: string;
  /** The path before a rename or copy. */
  oldPath?: string;
}

/** Parses `--name-status -z` output with rename detection. */
function parseNameStatus(out: string): FileChange[] {
  const parts = splitZ(out);
  const changes: FileChange[] = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++] ?? '';
    const status = code.charAt(0) as ChangeStatus;
    if (status === 'R' || status === 'C') {
      const oldPath = parts[i++] ?? '';
      const path = parts[i++] ?? '';
      changes.push({ status, path, oldPath });
    } else {
      changes.push({ status, path: parts[i++] ?? '' });
    }
  }
  return changes;
}

/** Changes staged in the index against HEAD (against the empty tree on an unborn branch). */
export function stagedChanges(cwd: string): FileChange[] {
  const base = headCommit(cwd) ?? EMPTY_TREE;
  return parseNameStatus(git(cwd, ['diff', '--cached', '--name-status', '-M', '-z', '--no-ext-diff', base]));
}

/** Changes a non-merge commit makes against its first parent (the empty tree for a root commit). */
export function commitChanges(cwd: string, sha: string): FileChange[] {
  const parent = firstParent(cwd, sha) ?? EMPTY_TREE;
  return parseNameStatus(git(cwd, ['diff', '--name-status', '-M', '-z', '--no-ext-diff', parent, sha]));
}

/** Unified diff (no context) of the staged changes. */
export function stagedPatch(cwd: string): string {
  const base = headCommit(cwd) ?? EMPTY_TREE;
  return git(cwd, ['diff', '--cached', '-U0', '-M', '--no-color', '--no-ext-diff', base]);
}

/** Unified diff (no context) of one commit against its first parent. */
export function commitPatch(cwd: string, sha: string): string {
  const parent = firstParent(cwd, sha) ?? EMPTY_TREE;
  return git(cwd, ['diff', '-U0', '-M', '--no-color', '--no-ext-diff', parent, sha]);
}

/** Tracked files in the index. */
export function indexFiles(cwd: string): string[] {
  return splitZ(git(cwd, ['ls-files', '-z', '--cached']));
}

/** Tracked plus untracked, non-ignored files (what a commit of the working tree could contain). */
export function workingTreeCandidates(cwd: string): string[] {
  return splitZ(git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']));
}

export function commitFiles(cwd: string, sha: string): string[] {
  return splitZ(git(cwd, ['ls-tree', '-r', '-z', '--name-only', sha]));
}

/** Blob content of `spec` (`:path` for the index, `sha:path` for a commit), or null when absent. */
export function readBlob(cwd: string, spec: string): string | null {
  return tryGit(cwd, ['cat-file', 'blob', spec]);
}

export function getConfig(cwd: string, key: string, scope: '--local' | null = null): string | null {
  const args = scope ? ['config', scope, '--get', key] : ['config', '--get', key];
  return tryGit(cwd, args)?.trim() || null;
}

export function setLocalConfig(cwd: string, key: string, value: string): void {
  git(cwd, ['config', '--local', key, value]);
}

/** Absolute path of a file inside the common git dir, e.g. `hooks`. */
export function gitPath(cwd: string, name: string): string {
  return git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', name]).trim();
}

/**
 * A commit-message trailer line anywhere in the message (not only in the final trailer block), so it
 * survives a squash that concatenates several messages.
 */
export function hasTrailer(message: string, key: string, valuePattern: RegExp): boolean {
  for (const line of message.split('\n')) {
    const match = /^([A-Za-z0-9-]+):\s*(.*?)\s*$/.exec(line);
    if (match && match[1]?.toLowerCase() === key.toLowerCase() && valuePattern.test(match[2] ?? '')) {
      return true;
    }
  }
  return false;
}
