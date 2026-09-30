import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  BudgetSettings,
  DEFAULT_BUDGET_SETTINGS,
  DEFAULT_GUARD_POLICY,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_RESOURCE_SETTINGS,
  EffectiveProjectFolders,
  EffectiveSettings,
  GuardPolicy,
  type ImportLocalSettingsRequest,
  type MachineSettingsState,
  ModelSettings,
  PROMPT_NAMES,
  ProjectMcpSettings,
  type PromptName,
  ResourceSettings,
  type SettingsSource,
  validatePromptTemplate,
} from '@crew/shared';
import type { z } from 'zod';
import type { VpsClient } from '../api/vps-client.js';
import type { DaemonConfig } from '../config.js';
import { inspectFolder } from '../health/repo-probe.js';

/**
 * The server settings a job starts with: prompt overrides, the guard's path rules, the model map, the
 * machine's resources and budgets, and the MCP switches of its projects. A part the server does not set (or
 * that fails validation here) is null or absent, and the bundled default applies.
 */
export interface ActiveSettings {
  /** The server's content revision; `bundled` when the daemon never got settings from it. */
  revision: string;
  source: SettingsSource;
  prompts: Readonly<Partial<Record<PromptName, string>>>;
  policy: GuardPolicy;
  models: ModelSettings | null;
  resources: ResourceSettings | null;
  budgets: BudgetSettings | null;
  /** Per project key. */
  projects: Readonly<Record<string, ProjectMcpSettings>>;
  /** This machine's project folders from the server; null: the local config's folders apply. */
  folders: EffectiveProjectFolders | null;
  /** Parts refused as invalid (their bundled default applies), e.g. `prompt:dev`, `policy`. */
  rejected: readonly string[];
}

export const BUNDLED_SETTINGS: ActiveSettings = {
  revision: 'bundled',
  source: 'bundled',
  prompts: {},
  policy: DEFAULT_GUARD_POLICY,
  models: null,
  resources: null,
  budgets: null,
  projects: {},
  folders: null,
  rejected: [],
};

/**
 * Validates every part of the server's answer again, with the same shared schemas the server used: a revision
 * saved by a newer server, or a bad edit that slipped through, costs only that part (its bundled default
 * applies), never a job.
 */
export function activateSettings(raw: EffectiveSettings, source: SettingsSource): ActiveSettings {
  const rejected: string[] = [];
  const part = <T>(name: string, schema: z.ZodType<T>, value: unknown): T | null => {
    if (value === null || value === undefined) return null;
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    rejected.push(name);
    return null;
  };
  const prompts: Partial<Record<PromptName, string>> = {};
  for (const [name, text] of Object.entries(raw.prompts)) {
    if (!PROMPT_NAMES.includes(name as PromptName) || validatePromptTemplate(name, text).length > 0) {
      rejected.push(`prompt:${name}`);
      continue;
    }
    prompts[name as PromptName] = text;
  }
  const projects: Record<string, ProjectMcpSettings> = {};
  for (const [key, value] of Object.entries(raw.projects)) {
    const parsed = part(`project_mcp:${key}`, ProjectMcpSettings, value);
    if (parsed) projects[key] = parsed;
  }
  return {
    revision: raw.revision,
    source,
    prompts,
    policy: part('policy', GuardPolicy, raw.policy) ?? DEFAULT_GUARD_POLICY,
    models: part('models', ModelSettings, raw.models),
    resources: part('resources', ResourceSettings, raw.resources),
    budgets: part('budgets', BudgetSettings, raw.budgets),
    projects,
    folders: part('project_folders', EffectiveProjectFolders, raw.folders),
    rejected,
  };
}

/**
 * The config jobs run with: the local config (API URL, folders, shared paths: machine-private) with the
 * server settings on top. Until this machine's one-time import succeeded, a part the server does not set
 * keeps its local `config.yaml` value (so an unreachable server never loosens a machine's own limits);
 * afterwards the bundled default applies.
 */
export function effectiveConfig(
  local: DaemonConfig,
  settings: ActiveSettings,
  imported: boolean,
  folderOk: (entry: { key: string; repoPath: string }) => boolean = () => true,
): DaemonConfig {
  // The server's folders replace the local list once there are any; a folder this machine could not use
  // (missing, not a repo) is left out, so the jobs of that project wait instead of failing.
  const projects: DaemonConfig['projects'] = settings.folders
    ? settings.folders.projects.filter(folderOk).map((entry) => {
        const localEntry = local.projects.find((project) => project.key === entry.key);
        return {
          key: entry.key,
          repoPath: entry.repoPath,
          defaultBranch: entry.defaultBranch,
          sharedPaths: entry.sharedPaths,
          // The test command runs as a shell command on this machine: it only ever comes from the local config.
          ...(localEntry?.testCommand ? { testCommand: localEntry.testCommand } : {}),
          disabledMcpServers: localEntry?.disabledMcpServers ?? [],
        };
      })
    : local.projects;
  return {
    ...local,
    resources: settings.resources ?? (imported ? DEFAULT_RESOURCE_SETTINGS : local.resources),
    models: settings.models ?? (imported ? DEFAULT_MODEL_SETTINGS : local.models),
    budgets: settings.budgets ?? (imported ? DEFAULT_BUDGET_SETTINGS : local.budgets),
    projects: projects.map((project) => ({
      ...project,
      disabledMcpServers:
        settings.projects[project.key]?.disabledMcpServers ?? (imported ? [] : project.disabledMcpServers),
    })),
  };
}

/**
 * What the one-time import uploads from a local config: every value the owner may have set by hand. Models
 * the server would refuse (a complexity entry on a model outside the allowlist, which the daemon used to clamp)
 * are left out, so the rest still goes up.
 */
export function localSettingsUpload(local: DaemonConfig): ImportLocalSettingsRequest {
  const modelsChanged = JSON.stringify(local.models) !== JSON.stringify(DEFAULT_MODEL_SETTINGS);
  const modelsValid = ModelSettings.safeParse(local.models).success;
  return {
    resources: local.resources,
    ...(modelsChanged && modelsValid ? { models: local.models } : {}),
    ...(local.budgets.perJobUsd !== null ? { budgets: local.budgets } : {}),
    projects: local.projects
      .filter((project) => project.disabledMcpServers.length > 0)
      .map((project) => ({ key: project.key, disabledMcpServers: project.disabledMcpServers })),
    ...(local.projects.length > 0
      ? {
          folders: {
            projects: local.projects.map((project) => ({
              key: project.key,
              repoPath: project.repoPath,
              sharedPaths: project.sharedPaths,
            })),
          },
        }
      : {}),
  };
}

/**
 * Why this machine cannot use a project folder from the server, or null when it can: it must exist, be
 * readable and be the root of a git repo. The first read is asynchronous, so a macOS folder-permission
 * prompt waits in a worker thread instead of freezing the daemon; the git calls come after it.
 */
export async function projectFolderProblem(path: string): Promise<string | null> {
  try {
    await readdir(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' ? 'thư mục không tồn tại' : `không đọc được thư mục (${code ?? 'lỗi'})`;
  }
  const folder = inspectFolder(path);
  if (!folder.isRepo) return 'không phải repo git';
  const real = realpathSync(path);
  if (real !== folder.root) return `không phải thư mục gốc của repo (gốc là ${folder.root})`;
  return null;
}

/** State-db meta key set once the one-time upload of the local values succeeded (per paired machine). */
export const settingsImportedKey = (machineId: string | undefined) =>
  `settings-imported:${machineId ?? 'unpaired'}`;

/**
 * The effective config outside a running daemon (`crewd doctor`, the desktop app while the daemon is
 * stopped): the server settings now, else the cached copy, on top of the local config.
 */
export async function loadEffectiveConfig(input: {
  local: DaemonConfig;
  vps: VpsClient | null;
  cacheFile: string;
  imported: boolean;
}): Promise<DaemonConfig> {
  const store = new SettingsStore({
    vps:
      input.vps ?? ({ settings: async () => Promise.reject(new Error('offline')) } as unknown as VpsClient),
    cacheFile: input.cacheFile,
    log: () => {},
  });
  if (input.vps) await store.refresh();
  return effectiveConfig(input.local, store.current(), input.imported);
}

export interface SettingsStoreOptions {
  vps: VpsClient;
  /** `~/.crew/settings-cache.json`: the last good copy. */
  cacheFile: string;
  log: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
}

const CacheFile = EffectiveSettings;

/**
 * Keeps the machine's server settings: fetched at start, on `settings.changed` and hourly (with an ETag, so an
 * unchanged poll is a 304), cached on disk after every good fetch. While the server is unreachable the cached
 * copy applies; without one, the bundled defaults.
 */
export class SettingsStore {
  private active: ActiveSettings = BUNDLED_SETTINGS;
  private raw: EffectiveSettings | null = null;
  private inFlight: Promise<boolean> | null = null;
  private again = false;

  constructor(private readonly options: SettingsStoreOptions) {
    this.loadCache();
  }

  current(): ActiveSettings {
    return this.active;
  }

  /** What the heartbeat reports. */
  state(): MachineSettingsState {
    return {
      revision: this.active.revision,
      source: this.active.source,
      rejected: [...this.active.rejected],
    };
  }

  private loadCache(): void {
    const { cacheFile, log } = this.options;
    if (!existsSync(cacheFile)) return;
    try {
      const parsed = CacheFile.parse(JSON.parse(readFileSync(cacheFile, 'utf8')));
      this.raw = parsed;
      this.active = activateSettings(parsed, 'cache');
    } catch (error) {
      log('warn', 'settings cache unreadable; using the bundled defaults until the server answers', {
        error: (error as Error).message,
      });
    }
  }

  private saveCache(settings: EffectiveSettings): void {
    const { cacheFile } = this.options;
    mkdirSync(dirname(cacheFile), { recursive: true, mode: 0o700 });
    const temp = `${cacheFile}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(settings), { mode: 0o600 });
    renameSync(temp, cacheFile);
    chmodSync(cacheFile, 0o600);
  }

  /**
   * Fetches the settings. Resolves true when the active settings changed. A failure keeps the current copy
   * (cached or bundled) and is logged, never thrown. A call while a fetch is in flight is answered by one more
   * fetch after it (a change may have landed after the first request left), shared by every such caller.
   */
  refresh(): Promise<boolean> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    this.inFlight = (async () => {
      let changed = false;
      do {
        this.again = false;
        changed = (await this.fetch()) || changed;
      } while (this.again);
      return changed;
    })().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetch(): Promise<boolean> {
    const { vps, log } = this.options;
    const before = this.active;
    let fetched: EffectiveSettings | null;
    try {
      fetched = await vps.settings(
        this.raw && this.active.source !== 'bundled' ? `"${this.raw.revision}"` : null,
      );
    } catch (error) {
      log('warn', 'settings fetch failed; keeping the current settings', {
        source: this.active.source,
        revision: this.active.revision,
        error: (error as Error).message,
      });
      return false;
    }
    if (fetched === null) {
      // 304: the cached copy is still the server's.
      if (this.active.source === 'cache') this.active = { ...this.active, source: 'server' };
      return false;
    }
    this.raw = fetched;
    this.active = activateSettings(fetched, 'server');
    try {
      this.saveCache(fetched);
    } catch (error) {
      log('warn', 'settings cache write failed', { error: (error as Error).message });
    }
    if (this.active.rejected.length > 0) {
      log('warn', 'server settings refused as invalid; their bundled defaults apply', {
        revision: fetched.revision,
        rejected: this.active.rejected,
      });
    }
    const changed = before.revision !== this.active.revision || before.source === 'bundled';
    if (changed) log('info', 'settings updated', { revision: fetched.revision, previous: before.revision });
    return changed;
  }
}
