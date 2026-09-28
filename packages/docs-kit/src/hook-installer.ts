import { execFileSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { getConfig, gitPath, isLinkedWorktree, repoRoot, setLocalConfig } from './git.js';

export const HOOK_NAMES = ['pre-commit', 'commit-msg', 'pre-push'] as const;
export type HookName = (typeof HOOK_NAMES)[number];

/** Local git config keys holding the absolute runtime and bundle paths (shared by every worktree). */
export const RUNTIME_KEY = 'crew-docs.runtime';
export const BUNDLE_KEY = 'crew-docs.bundle';
export const PLAIN_HOOKS_DIR = '.githooks';

const LEFTHOOK_CONFIGS = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml'];

const CHECK_ARGS: Record<HookName, { shell: string; lefthook: string }> = {
  'pre-commit': { shell: 'check --staged', lefthook: 'check --staged' },
  'commit-msg': { shell: 'check --commit-msg "$1"', lefthook: 'check --commit-msg {1}' },
  'pre-push': { shell: 'check --pre-push "$@"', lefthook: 'check --pre-push' },
};

/**
 * The command every hook runs. The runtime and bundle come from local git config as absolute paths, so
 * PATH differences (launchd, IDEs, nvm) cannot break it, and the committed hook files stay the same on
 * every machine. A machine without the config fails closed with a self-explaining path in the error.
 */
function crewDocsCommand(args: string): string {
  return (
    `ELECTRON_RUN_AS_NODE=1 "$(git config --get ${RUNTIME_KEY} || echo /crew-docs-runtime-not-configured)" ` +
    `"$(git config --get ${BUNDLE_KEY} || echo /crew-docs-bundle-not-configured)" ${args}`
  );
}

const marker = (hook: HookName) => `# crew-docs:${hook}`;

/** The one guarded line added to a shell hook: it fails the hook when crew-docs fails. */
export function hookLine(hook: HookName): string {
  return `${crewDocsCommand(CHECK_ARGS[hook].shell)} || exit 1 ${marker(hook)}`;
}

export type HookSetupKind = 'githooks' | 'husky' | 'lefthook' | 'hooks-path' | 'git-hooks-dir';

export interface InstallOptions {
  cwd: string;
  /** Absolute path of the runtime: `node`, or the desktop app binary run with ELECTRON_RUN_AS_NODE=1. */
  runtime: string;
  /** Absolute path of the crew-docs single-file bundle. */
  bundle: string;
  /** PATH used to find the `lefthook` binary (defaults to the process PATH). */
  pathEnv?: string;
}

export interface InstallResult {
  kind: HookSetupKind;
  /** Files written or updated, relative to the repo root when inside it. */
  changed: string[];
  notes: string[];
}

export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallError';
  }
}

interface Detected {
  kind: HookSetupKind;
  dir?: string;
  config?: string;
}

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/** Finds the hook setup already in place, so crew-docs chains into it instead of replacing it. */
export function detectHookSetup(root: string): Detected {
  const hooksPath = getConfig(root, 'core.hooksPath', '--local');
  if (isDir(join(root, '.husky')) || (hooksPath && /(^|\/)\.husky(\/_)?\/?$/.test(hooksPath))) {
    return { kind: 'husky', dir: join(root, '.husky') };
  }
  const lefthookConfig = LEFTHOOK_CONFIGS.find((name) => existsSync(join(root, name)));
  if (lefthookConfig) return { kind: 'lefthook', config: join(root, lefthookConfig) };
  if (hooksPath) {
    const dir = resolve(root, hooksPath);
    if (dir === resolve(root, PLAIN_HOOKS_DIR)) return { kind: 'githooks', dir };
    return { kind: 'hooks-path', dir };
  }
  const gitHooks = gitPath(root, 'hooks');
  if (HOOK_NAMES.some((hook) => existsSync(join(gitHooks, hook))))
    return { kind: 'git-hooks-dir', dir: gitHooks };
  return { kind: 'githooks', dir: join(root, PLAIN_HOOKS_DIR) };
}

/** Puts the guarded line right after the shebang, replacing an older crew-docs line for the same hook. */
export function withHookLine(text: string | null, hook: HookName): string {
  const lines = (text ?? '#!/bin/sh\n').replace(/\r\n/g, '\n').split('\n');
  const kept = lines.filter((line) => !line.trimEnd().endsWith(marker(hook)));
  const at = kept[0]?.startsWith('#!') ? 1 : 0;
  kept.splice(at, 0, hookLine(hook));
  const result = kept.join('\n');
  return result.endsWith('\n') ? result : `${result}\n`;
}

function writeIfChanged(path: string, content: string, mode?: number): boolean {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  let changed = false;
  if (current !== content) {
    writeFileSync(path, content);
    changed = true;
  }
  if (mode !== undefined && (statSync(path).mode & 0o777) !== mode) {
    chmodSync(path, mode);
    changed = true;
  }
  return changed;
}

function ensureShellHooks(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const changed: string[] = [];
  for (const hook of HOOK_NAMES) {
    const file = join(dir, hook);
    const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (writeIfChanged(file, withHookLine(current, hook), 0o755)) changed.push(file);
  }
  return changed;
}

/** Adds a `crew-docs` command to each hook of a lefthook config, keeping its comments and other commands. */
export function withLefthookCommands(text: string): string {
  const doc = parseDocument(text);
  for (const hook of HOOK_NAMES) {
    const command: Record<string, unknown> = { run: crewDocsCommand(CHECK_ARGS[hook].lefthook) };
    if (hook === 'pre-push') command.use_stdin = true;
    doc.setIn([hook, 'commands', 'crew-docs'], doc.createNode(command));
  }
  return doc.toString();
}

function findExecutable(name: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function assertExecutableFile(path: string, what: string): void {
  if (!isAbsolute(path)) throw new InstallError(`${what} must be an absolute path: ${path}`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new InstallError(`${what} not found: ${path}`);
}

/**
 * Installs the crew-docs checks into a repo's git hooks: pre-commit (`check --staged`), commit-msg
 * (`check --commit-msg`, the trailer-based R6 and docs-init checks) and pre-push (`check --pre-push`).
 * Runs once per repo in the main checkout; worktrees share its git config. Running it again changes nothing.
 */
export function installHooks(options: InstallOptions): InstallResult {
  assertExecutableFile(options.runtime, 'runtime');
  assertExecutableFile(options.bundle, 'bundle');
  try {
    accessSync(options.runtime, constants.X_OK);
  } catch {
    throw new InstallError(`runtime is not executable: ${options.runtime}`);
  }
  if (isLinkedWorktree(options.cwd)) {
    throw new InstallError(
      'install-hooks runs in the main checkout; worktrees share its git config and hooks',
    );
  }
  const root = repoRoot(options.cwd);
  const changed: string[] = [];
  const notes: string[] = [];

  for (const [key, value] of [
    [RUNTIME_KEY, options.runtime],
    [BUNDLE_KEY, options.bundle],
  ] as const) {
    if (getConfig(root, key, '--local') !== value) {
      setLocalConfig(root, key, value);
      changed.push(`git config ${key}`);
    }
  }

  const detected = detectHookSetup(root);
  switch (detected.kind) {
    case 'githooks': {
      if (getConfig(root, 'core.hooksPath', '--local') !== PLAIN_HOOKS_DIR) {
        setLocalConfig(root, 'core.hooksPath', PLAIN_HOOKS_DIR);
        changed.push('git config core.hooksPath');
      }
      changed.push(...ensureShellHooks(join(root, PLAIN_HOOKS_DIR)));
      break;
    }
    case 'husky': {
      changed.push(...ensureShellHooks(detected.dir ?? ''));
      // Husky's runner dir (.husky/_) is gitignored, so a relative hooksPath finds no hooks in a linked
      // worktree. The absolute path makes every worktree run the main checkout's husky hooks.
      const hooksPath = getConfig(root, 'core.hooksPath', '--local');
      if (hooksPath && !isAbsolute(hooksPath)) {
        setLocalConfig(root, 'core.hooksPath', resolve(root, hooksPath));
        changed.push('git config core.hooksPath');
        notes.push('husky: core.hooksPath made absolute so linked worktrees run the same hooks');
      } else if (!hooksPath) {
        notes.push('husky: core.hooksPath is not set; run husky (npm install) to activate its hooks');
      }
      break;
    }
    case 'hooks-path':
    case 'git-hooks-dir':
      changed.push(...ensureShellHooks(detected.dir ?? ''));
      break;
    case 'lefthook': {
      const config = detected.config ?? '';
      const text = readFileSync(config, 'utf8');
      const updated = withLefthookCommands(text);
      if (updated !== text) {
        writeFileSync(config, updated);
        changed.push(config);
      }
      const pathDirs = (options.pathEnv ?? process.env.PATH ?? '').split(delimiter).filter(Boolean);
      const lefthook = findExecutable('lefthook', [join(root, 'node_modules', '.bin'), ...pathDirs]);
      if (lefthook) {
        execFileSync(lefthook, ['install'], { cwd: root, stdio: 'pipe' });
      } else {
        notes.push('lefthook not found: run `lefthook install` so the commit-msg and pre-push hooks exist');
      }
      break;
    }
  }

  return {
    kind: detected.kind,
    changed: changed.map((path) =>
      isAbsolute(path) && !relative(root, path).startsWith('..') ? relative(root, path) : path,
    ),
    notes,
  };
}
