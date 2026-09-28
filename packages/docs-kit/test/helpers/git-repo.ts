import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach } from 'vitest';
import { main } from '../../src/cli.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const DOCS_INIT_TRAILER = 'Crew-Docs-Init: true';

/**
 * Every repo runs with an isolated git config (no global or system settings, a fixed identity), so the
 * owner's own git setup (a global core.hooksPath, signing, templates) cannot leak into the tests.
 */
const sandbox = mkdtempSync(join(tmpdir(), 'crew-docs-gitenv-'));
const globalConfig = join(sandbox, 'gitconfig');
writeFileSync(
  globalConfig,
  '[user]\n\tname = Crew Test\n\temail = crew-test@example.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n',
);
export const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: globalConfig,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};
// In-process CLI runs spawn git with the worker's env.
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: globalConfig,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
});

export interface RunResult {
  code: number;
  out: string;
  err: string;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

/** Registers a temp dir for removal after the current test. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export class TestRepo {
  constructor(readonly root: string) {}

  git(...args: string[]): string {
    return execFileSync('git', args, { cwd: this.root, env: GIT_ENV, encoding: 'utf8', stdio: 'pipe' });
  }

  /** Runs git without throwing; for commits and pushes that hooks may reject. */
  tryGit(...args: string[]): RunResult {
    const result = spawnSync('git', args, { cwd: this.root, env: GIT_ENV, encoding: 'utf8' });
    return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
  }

  write(path: string, content: string): this {
    const file = join(this.root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    return this;
  }

  append(path: string, content: string): this {
    return this.write(path, `${this.read(path)}${content}`);
  }

  read(path: string): string {
    return readFileSync(join(this.root, path), 'utf8');
  }

  /** Stages everything and commits with `--no-verify` (hooks are tested separately). Returns the SHA. */
  commit(message: string): string {
    this.git('add', '-A');
    this.git('commit', '--no-verify', '--allow-empty', '-q', '-m', message);
    return this.head();
  }

  head(): string {
    return this.git('rev-parse', 'HEAD').trim();
  }

  /** Runs the CLI in process (source, not the bundle). */
  async cli(...argv: string[]): Promise<RunResult> {
    return runCli(this.root, argv);
  }
}

export async function runCli(cwd: string, argv: string[], stdin = ''): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(
    argv,
    { cwd, execPath: process.execPath, scriptPath: undefined },
    { out: (line) => out.push(line), err: (line) => err.push(line), readStdin: async () => stdin },
  );
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** An empty git repo in a temp dir. */
export function emptyRepo(): TestRepo {
  const root = tempDir('crew-docs-repo-');
  const repo = new TestRepo(root);
  repo.git('init', '-q', '-b', 'main');
  return repo;
}

/**
 * A repo holding the `basic` fixture (two flows, a shared file, an unassigned file), with generated blocks
 * written, committed as the docs-init commit.
 */
export async function fixtureRepo(): Promise<TestRepo> {
  const repo = emptyRepo();
  cpSync(join(FIXTURES, 'basic'), repo.root, { recursive: true });
  const generated = await repo.cli('generate');
  if (generated.code !== 0) throw new Error(`generate failed: ${generated.out}${generated.err}`);
  repo.commit(`docs: khởi tạo docs\n\n${DOCS_INIT_TRAILER}`);
  return repo;
}

/** A fake AWS access key id, assembled at runtime so no credential-shaped literal is ever committed. */
export function fakeAwsKey(): string {
  return ['AK', 'IA', 'Z7Q3', 'WRT5', 'YUP2', 'KLM4'].join('');
}
