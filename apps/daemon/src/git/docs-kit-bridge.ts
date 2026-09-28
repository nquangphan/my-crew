import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { DOCS_SYNC_PATH_RE, type DocsSyncRequest } from '@crew/shared';
import { git } from './worktree-manager.js';

export const CREW_DOCS_BUNDLE = 'crew-docs.cjs';
const BUILD_OUTPUT_DIR = 'dist';

/** The bundle shipped with the `@crew/docs-kit` package this daemon was built with. */
export function packagedCrewDocs(): string {
  const packageJson = createRequire(import.meta.url).resolve('@crew/docs-kit/package.json');
  return join(dirname(packageJson), BUILD_OUTPUT_DIR, CREW_DOCS_BUNDLE);
}

export interface CrewDocsResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the crew-docs bundle with an absolute runtime. `ELECTRON_RUN_AS_NODE=1` makes the desktop app's own
 * binary behave as Node, so the same call works from the CLI and from the app.
 */
export function runCrewDocs(
  bundle: string,
  args: readonly string[],
  cwd: string,
  runtime: string = process.execPath,
): CrewDocsResult {
  const result = spawnSync(runtime, [bundle, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) return { code: 2, stdout: '', stderr: result.error.message };
  return { code: result.status ?? 2, stdout: result.stdout, stderr: result.stderr };
}

export interface InstalledCrewDocs {
  bundle: string;
  /** `crew-docs` wrapper on the agents' PATH. */
  wrapper: string;
  version: string;
}

/**
 * Copies the crew-docs bundle into `~/.crew/bin` (on first run and on every update) and writes a
 * `crew-docs` wrapper there, so agents and hooks use one stable absolute path.
 */
export function installCrewDocs(
  binDir: string,
  source: string = packagedCrewDocs(),
  runtime: string = process.execPath,
): InstalledCrewDocs {
  if (!existsSync(source)) {
    throw new Error(
      `crew-docs bundle not found at ${source}; build it with pnpm --filter @crew/docs-kit build`,
    );
  }
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const bundle = join(binDir, CREW_DOCS_BUNDLE);
  copyFileSync(source, bundle);
  chmodSync(bundle, 0o755);
  const wrapper = join(binDir, 'crew-docs');
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  writeFileSync(wrapper, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(runtime)} ${quote(bundle)} "$@"\n`, {
    mode: 0o755,
  });
  chmodSync(wrapper, 0o755);
  const version = runCrewDocs(bundle, ['--version'], binDir, runtime);
  if (version.code !== 0) throw new Error(`installed crew-docs does not run: ${version.stderr.trim()}`);
  return { bundle, wrapper, version: version.stdout.trim() };
}

function gitConfig(repo: string, key: string): string | null {
  try {
    const value = git(repo, ['config', '--get', key]).trim();
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

export interface HookStatus {
  installed: boolean;
  runtime: string | null;
  bundle: string | null;
  hooksPath: string | null;
}

/** The crew-docs hooks are wired in when git config points at a runtime and bundle that both exist. */
export function hookStatus(repo: string): HookStatus {
  const runtime = gitConfig(repo, 'crew-docs.runtime');
  const bundle = gitConfig(repo, 'crew-docs.bundle');
  const hooksPath = gitConfig(repo, 'core.hooksPath');
  const installed = runtime !== null && bundle !== null && existsSync(runtime) && existsSync(bundle);
  return { installed, runtime, bundle, hooksPath };
}

export function installHooks(
  repo: string,
  bundle: string,
  runtime: string = process.execPath,
): CrewDocsResult {
  return runCrewDocs(bundle, ['install-hooks', '--runtime', runtime, '--bundle', bundle], repo, runtime);
}

/** The docs tree at `ref`, shaped for `PUT /v1/daemon/projects/:key/docs`. */
export function docsSnapshot(repo: string, ref = 'HEAD'): DocsSyncRequest {
  const commit = git(repo, ['rev-parse', `${ref}^{commit}`]).trim();
  const branch = git(repo, ['rev-parse', '--abbrev-ref', ref]).trim();
  const paths = git(repo, ['ls-tree', '-r', '--name-only', commit, '--', 'docs', 'AGENTS.md'])
    .split('\n')
    .filter((path) => DOCS_SYNC_PATH_RE.test(path));
  const files = paths.map((path) => ({ path, content: git(repo, ['show', `${commit}:${path}`]) }));
  return { commit, branch: branch === 'HEAD' ? ref : branch, files };
}
