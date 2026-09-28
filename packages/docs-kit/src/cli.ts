import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { type CheckMode, CheckUsageError, runCheck } from './commands/check.js';
import { ciWorkflowCommand } from './commands/ci-workflow.js';
import { flowCommand } from './commands/flow.js';
import { generateCommand } from './commands/generate.js';
import { initCommand } from './commands/init.js';
import { installHooksCommand } from './commands/install-hooks.js';
import { EXIT, type Io, UsageError } from './commands/io.js';
import { whereCommand } from './commands/where.js';
import { GitError, repoRoot } from './git.js';
import { formatViolation } from './rules/types.js';
import { VERSION } from './version.js';

export interface CliEnv {
  cwd: string;
  /** Absolute path of the running runtime (`process.execPath`). */
  execPath: string;
  /** Path of the running script (`process.argv[1]`): the bundle when run as `crew-docs`. */
  scriptPath: string | undefined;
}

export const USAGE = `crew-docs ${VERSION}: the 2P Crew docs standard

Usage:
  crew-docs check --staged              pre-commit: R1 R2 R4 on the index, R3 and R7 on the staged diff
  crew-docs check --commit-msg <file>   commit-msg: R6 with the message trailers (docs-init exemption)
  crew-docs check --range <base>..<head>  every non-merge commit (R3 R6 R7) plus R1 R2 R4 at <head>
  crew-docs check --pre-push [remote]   pre-push: like --range for each ref on stdin
  crew-docs check --all                 R1 R2 R4 over the working tree
  crew-docs init [--flow <id> [--title <title>]]
  crew-docs generate                    rewrite the generated blocks of docs/index.md and docs/files.md
  crew-docs where <file>                flows that own a file
  crew-docs flow <id>                   exact files of a flow
  crew-docs install-hooks [--runtime <abs path>] [--bundle <abs path>]
  crew-docs ci-workflow [--bundle <abs path>]
  crew-docs --version

Exit codes: 0 ok, 1 violations (lines "RULE path: message"), 2 usage or git error, 3 not initialized.`;

/** Splits `--flag value` pairs from positional arguments. */
function parseArgs(args: readonly string[], valueFlags: readonly string[], boolFlags: readonly string[]) {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (valueFlags.includes(arg)) {
      const value = args[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      flags.set(arg, value);
    } else if (boolFlags.includes(arg)) {
      flags.set(arg, true);
    } else if (arg.startsWith('--')) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const value = (flag: string) => {
    const v = flags.get(flag);
    return typeof v === 'string' ? v : undefined;
  };
  return { flags, positional, value };
}

/** The bundle to install or vendor: `--bundle`, else the running script when it is the bundle. */
function bundlePath(env: CliEnv, explicit: string | undefined): string {
  const candidate = explicit ?? env.scriptPath;
  if (!candidate) throw new UsageError('cannot tell where the crew-docs bundle is; pass --bundle <abs path>');
  const path = isAbsolute(candidate) ? candidate : resolve(env.cwd, candidate);
  if (!existsSync(path) || !statSync(path).isFile() || !path.endsWith('.cjs')) {
    throw new UsageError(
      `not a crew-docs bundle: ${path}; run the bundled crew-docs or pass --bundle <abs path>`,
    );
  }
  return realpathSync(path);
}

async function check(root: string, args: readonly string[], io: Io): Promise<number> {
  const parsed = parseArgs(args, ['--commit-msg', '--range'], ['--staged', '--all', '--pre-push']);
  const selected = ['--staged', '--commit-msg', '--range', '--pre-push', '--all'].filter((f) =>
    parsed.flags.has(f),
  );
  if (selected.length !== 1) {
    throw new UsageError('check needs exactly one of --staged, --commit-msg, --range, --pre-push, --all');
  }
  const [flag] = selected;
  // pre-push receives "<remote> <url>" as positional args from git; nothing else takes positionals.
  if (flag !== '--pre-push' && parsed.positional.length > 0) {
    throw new UsageError(`unexpected argument ${parsed.positional[0]}`);
  }
  let mode: CheckMode;
  if (flag === '--staged') mode = { kind: 'staged' };
  else if (flag === '--all') mode = { kind: 'all' };
  else if (flag === '--commit-msg')
    mode = { kind: 'commit-msg', messageFile: parsed.value('--commit-msg') ?? '' };
  else if (flag === '--range') mode = { kind: 'range', range: parsed.value('--range') ?? '' };
  else mode = { kind: 'pre-push', stdin: await io.readStdin() };

  const outcome = runCheck(root, mode);
  for (const violation of outcome.violations) io.out(formatViolation(violation));
  const label = `crew-docs check ${flag}`;
  const scope = outcome.commitsChecked > 0 ? ` (${outcome.commitsChecked} commits)` : '';
  if (outcome.code === EXIT.ok) io.err(`${label}: ok${scope}`);
  else if (outcome.code === EXIT.notInitialized) io.err(`${label}: NOT_INITIALIZED`);
  else io.err(`${label}: ${outcome.violations.length} violation(s)${scope}. Docs standard: STANDARD.md`);
  return outcome.code;
}

async function dispatch(argv: readonly string[], env: CliEnv, io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (command === '--version' || command === '-v' || command === 'version') {
    io.out(VERSION);
    return EXIT.ok;
  }
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    io.out(USAGE);
    return command === undefined ? EXIT.usage : EXIT.ok;
  }
  const root = repoRoot(env.cwd);
  switch (command) {
    case 'check':
      return check(root, rest, io);
    case 'init': {
      const parsed = parseArgs(rest, ['--flow', '--title'], []);
      if (parsed.positional.length > 0) throw new UsageError(`unexpected argument ${parsed.positional[0]}`);
      return initCommand(root, { flow: parsed.value('--flow'), title: parsed.value('--title') }, io);
    }
    case 'generate':
      if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
      return generateCommand(root, io);
    case 'where': {
      const parsed = parseArgs(rest, [], []);
      if (parsed.positional.length !== 1) throw new UsageError('usage: crew-docs where <file>');
      return whereCommand(root, env.cwd, parsed.positional[0] ?? '', io);
    }
    case 'flow': {
      const parsed = parseArgs(rest, [], []);
      if (parsed.positional.length !== 1) throw new UsageError('usage: crew-docs flow <id>');
      return flowCommand(root, parsed.positional[0] ?? '', io);
    }
    case 'install-hooks': {
      const parsed = parseArgs(rest, ['--runtime', '--bundle'], []);
      if (parsed.positional.length > 0) throw new UsageError(`unexpected argument ${parsed.positional[0]}`);
      const runtime = parsed.value('--runtime') ?? env.execPath;
      return installHooksCommand(
        { cwd: env.cwd, runtime, bundle: bundlePath(env, parsed.value('--bundle')) },
        io,
      );
    }
    case 'ci-workflow': {
      const parsed = parseArgs(rest, ['--bundle'], []);
      if (parsed.positional.length > 0) throw new UsageError(`unexpected argument ${parsed.positional[0]}`);
      return ciWorkflowCommand(root, bundlePath(env, parsed.value('--bundle')), io);
    }
    default:
      throw new UsageError(`unknown command ${command}; see crew-docs --help`);
  }
}

/** Runs one CLI invocation and returns its exit code; nothing here calls process.exit. */
export async function main(argv: readonly string[], env: CliEnv, io: Io): Promise<number> {
  try {
    return await dispatch(argv, env, io);
  } catch (error) {
    if (error instanceof UsageError || error instanceof CheckUsageError) {
      io.err(`crew-docs: ${error.message}`);
      return EXIT.usage;
    }
    if (error instanceof GitError) {
      io.err(`crew-docs: ${error.message}`);
      return EXIT.usage;
    }
    throw error;
  }
}
