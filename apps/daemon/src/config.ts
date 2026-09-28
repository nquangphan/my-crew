import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { type Complexity, Effort, ModelAlias, ProjectKey } from '@crew/shared';
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

/** Every path the daemon owns under its home. */
export function homePaths(home: string) {
  return {
    home,
    config: join(home, 'config.yaml'),
    stateDb: join(home, 'state.db'),
    tokenFile: join(home, 'machine-token'),
    pidFile: join(home, 'crewd.pid'),
    bin: join(home, 'bin'),
    tmp: join(home, 'tmp'),
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

const ModelChoice = z.object({ model: ModelAlias, effort: Effort });
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
      allow: z.array(ModelAlias).min(1).default(['haiku', 'sonnet', 'opus']),
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

export function loadConfig(path: string): DaemonConfig {
  if (!existsSync(path)) throw new ConfigError(`no config at ${path}; run "crewd pair" first`);
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`cannot parse ${path}: ${(error as Error).message}`);
  }
  return parseConfig(raw ?? {});
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
