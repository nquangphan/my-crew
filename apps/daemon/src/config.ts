import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { type Complexity, Effort, ModelAlias, ProjectKey, type SelectableModel } from '@crew/shared';
import { parse, stringify } from 'yaml';
import { z } from 'zod';

/** Root of the daemon's local state: `$CREW_HOME`, or `~/.crew`. */
export function crewHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CREW_HOME;
  if (override) {
    if (!isAbsolute(override)) throw new ConfigError(`CREW_HOME must be an absolute path, got "${override}"`);
    return override;
  }
  return join(homedir(), '.crew');
}

/**
 * Root of the per-job temp dirs: `/tmp/crew-<uid>/<8 hex of the home path>`, NOT under the home. macOS
 * caps a Unix socket path at 104 bytes and tools (Playwright MCP, …) create their sockets under
 * `$TMPDIR`, so the job's `$TMPDIR` must stay short. One root per OS user and daemon home, so two
 * daemons (or a test daemon next to the real one) never sweep each other's temp dirs.
 */
export function jobTmpRoot(home: string): string {
  const uid = process.getuid?.() ?? 0;
  return join('/tmp', `crew-${uid}`, createHash('sha256').update(home).digest('hex').slice(0, 8));
}

/** Every path the daemon owns (all under its home except the short per-job temp root). */
export function homePaths(home: string) {
  return {
    home,
    config: join(home, 'config.yaml'),
    stateDb: join(home, 'state.db'),
    tokenFile: join(home, 'machine-token'),
    pidFile: join(home, 'crewd.pid'),
    bin: join(home, 'bin'),
    tmp: jobTmpRoot(home),
    logs: join(home, 'logs'),
    /** Working directory of assistant runs (they have no repo). */
    assistantDir: join(home, 'assistant'),
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const AbsolutePath = z
  .string()
  .trim()
  .min(1)
  .refine((path) => isAbsolute(path), 'must be an absolute path');

/** A path relative to the repo root that stays inside it (no `..`, not absolute). */
const RepoRelativePath = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((path) => !isAbsolute(path) && !path.split(/[\\/]/).includes('..'), 'must stay inside the repo');

export const ProjectConfig = z.object({
  key: ProjectKey,
  repoPath: AbsolutePath,
  defaultBranch: z.string().trim().min(1).max(200).default('main'),
  testCommand: z.string().trim().min(1).max(2_000).optional(),
  /**
   * Untracked agent config linked into every worktree, in addition to the auto-detected `.claude/`,
   * `CLAUDE.md` and `AGENTS.md` (each linked only when it exists and is not tracked).
   */
  sharedPaths: z.array(RepoRelativePath).max(50).default([]),
  /** MCP servers the owner switched off for this project: their tools never reach `allowedTools`. */
  disabledMcpServers: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

/**
 * Fable is not used at all (owner decision), but a config saved before that may still name it, possibly on
 * another machine. It stays valid: `fable` in `models.allow` is dropped and a complexity map entry on fable
 * runs on opus. `loadConfig` warns once per file, and the next save writes the cleaned values.
 */
const toSelectable = (model: ModelAlias): SelectableModel => (model === 'fable' ? 'opus' : model);

const ModelChoice = z.object({ model: ModelAlias.transform(toSelectable), effort: Effort });
export type ModelChoice = z.infer<typeof ModelChoice>;

export const DEFAULT_COMPLEXITY_MAP: Record<Complexity, ModelChoice> = {
  trivial: { model: 'haiku', effort: 'low' },
  small: { model: 'sonnet', effort: 'medium' },
  medium: { model: 'sonnet', effort: 'high' },
  large: { model: 'opus', effort: 'high' },
};

export const DaemonConfig = z.object({
  apiUrl: z.url().refine((url) => /^https?:\/\//.test(url), 'apiUrl must be http(s)'),
  machineName: z.string().trim().min(1).max(100),
  /** Set by `crewd pair`; the token itself lives in the Keychain or a 0600 file, never here. */
  machineId: z.string().trim().min(1).max(100).optional(),
  projects: z
    .array(ProjectConfig)
    .max(100)
    .default([])
    .refine((list) => new Set(list.map((p) => p.key)).size === list.length, 'project keys must be unique'),
  resources: z
    .object({
      maxConcurrentJobs: z.number().int().min(1).max(64).default(2),
      minFreeMemGb: z.number().min(0).max(1_024).default(2),
      maxLoadPerCpu: z.number().positive().max(64).default(1.5),
    })
    .prefault({}),
  models: z
    .object({
      allow: z
        .array(ModelAlias)
        .min(1)
        .transform((list) => list.filter((model): model is SelectableModel => model !== 'fable'))
        .default(['haiku', 'sonnet', 'opus']),
      complexityMap: z
        .object({
          trivial: ModelChoice.default(DEFAULT_COMPLEXITY_MAP.trivial),
          small: ModelChoice.default(DEFAULT_COMPLEXITY_MAP.small),
          medium: ModelChoice.default(DEFAULT_COMPLEXITY_MAP.medium),
          large: ModelChoice.default(DEFAULT_COMPLEXITY_MAP.large),
        })
        .prefault({}),
    })
    .prefault({})
    // Docs-init and docs-update always run on sonnet (owner decision), so sonnet must be allowed.
    .refine((models) => models.allow.includes('sonnet'), {
      message: 'models.allow must include sonnet: docs-init and docs-update always run on sonnet',
      path: ['allow'],
    }),
  budgets: z.object({ perJobUsd: z.number().positive().max(10_000).nullable().default(null) }).prefault({}),
  /** When true the assistant moves a finished request straight to `done`, otherwise to `in_review`. */
  autoCloseRequests: z.boolean().default(false),
});
export type DaemonConfig = z.infer<typeof DaemonConfig>;
export type DaemonConfigInput = z.input<typeof DaemonConfig>;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

export function parseConfig(input: unknown): DaemonConfig {
  const result = DaemonConfig.safeParse(input);
  if (!result.success) throw new ConfigError(`invalid config: ${formatIssues(result.error)}`);
  return result.data;
}

/** The `models` fields of a stored config that still name `fable` (the parse replaces them). */
export function legacyFableFields(input: unknown): string[] {
  const models = (input as { models?: unknown } | null)?.models;
  if (!models || typeof models !== 'object') return [];
  const { allow, complexityMap } = models as { allow?: unknown; complexityMap?: unknown };
  const fields: string[] = [];
  if (Array.isArray(allow) && allow.includes('fable')) fields.push('models.allow');
  if (complexityMap && typeof complexityMap === 'object') {
    for (const [key, choice] of Object.entries(complexityMap)) {
      if ((choice as { model?: unknown } | null)?.model === 'fable')
        fields.push(`models.complexityMap.${key}`);
    }
  }
  return fields;
}

/** Receives a one-line warning about the config file (the daemon's stderr log by default). */
export type ConfigWarn = (message: string, fields: Record<string, unknown>) => void;

const stderrWarn: ConfigWarn = (message, fields) => {
  process.stderr.write(
    `${JSON.stringify({ at: new Date().toISOString(), level: 'warn', message, ...fields })}\n`,
  );
};

/** Config files already warned about a legacy `fable`: the config is read often, the warning is logged once. */
const warnedLegacyFable = new Set<string>();

export function loadConfig(path: string, warn: ConfigWarn = stderrWarn): DaemonConfig {
  if (!existsSync(path)) throw new ConfigError(`no config at ${path}; run "crewd pair" first`);
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`cannot parse ${path}: ${(error as Error).message}`);
  }
  const config = parseConfig(raw ?? {});
  const legacy = legacyFableFields(raw);
  if (legacy.length > 0 && !warnedLegacyFable.has(path)) {
    warnedLegacyFable.add(path);
    warn(
      'config names fable, which is no longer used: dropped from models.allow, opus in the complexity map',
      {
        path,
        fields: legacy,
        note: 'the file is rewritten without fable on the next save',
      },
    );
  }
  return config;
}

/** Writes the config atomically (temp file + rename), readable by the owner only. */
export function saveConfig(path: string, config: DaemonConfigInput): DaemonConfig {
  const parsed = parseConfig(config);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, stringify(parsed), { mode: 0o600 });
  renameSync(temp, path);
  chmodSync(path, 0o600);
  return parsed;
}

export function findProject(config: DaemonConfig, key: string): ProjectConfig | undefined {
  return config.projects.find((project) => project.key === key);
}
