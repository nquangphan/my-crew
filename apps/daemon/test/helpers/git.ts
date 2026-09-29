import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach } from 'vitest';

/**
 * Every repo runs with an isolated git config (no global or system settings, a fixed identity), so the
 * owner's own git setup cannot leak into the tests. The daemon code under test spawns git with
 * `process.env`, so the isolation is applied to the worker's env too.
 */
let sandbox: string | null = null;

/** Creates the isolated git config on first use, so a file whose tests are all skipped leaves nothing. */
function isolateGit(): void {
  if (sandbox) return;
  sandbox = mkdtempSync(join(tmpdir(), 'crewd-gitenv-'));
  const globalConfig = join(sandbox, 'gitconfig');
  writeFileSync(
    globalConfig,
    '[user]\n\tname = Crew Test\n\temail = crew-test@example.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n',
  );
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  });
}

const cleanups: (() => void | Promise<void>)[] = [];
/**
 * Newest first, so what a test started last (a daemon, a stream client) stops before what it depends on
 * (the API server). Every cleanup runs even when one fails, so a failure never leaves the rest running.
 */
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, `${errors.length} test cleanups failed`);
});
afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

/** Registers a cleanup to run after the current test. */
export function onCleanup(cleanup: () => void | Promise<void>): void {
  cleanups.push(cleanup);
}

/** Resolves like `promise`, or rejects with `what did not finish in N ms` so a hung cleanup names itself. */
export async function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish in ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** A temp dir (realpath, so macOS /var vs /private/var never differs) removed after the current test. */
export function tempDir(prefix: string): string {
  isolateGit();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onCleanup(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function git(cwd: string, ...args: string[]): string {
  isolateGit();
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

/** A repo on `main` with one commit holding `files`. */
export function makeRepo(
  files: Record<string, string> = { 'README.md': '# test\n' },
  prefix = 'crewd-repo-',
): string {
  const root = tempDir(prefix);
  git(root, 'init', '-q', '-b', 'main');
  writeFiles(root, files);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}
