import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BMAD_PERSONAL_KEYS, BmadId, BmadProfile, BmadSetting } from '@crew/shared';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

/**
 * Reads a project's BMAD install (`_bmad/`, written by the `bmad-method` installer) so another machine can
 * reproduce it. Sources: `_bmad/_config/manifest.yaml` (installer version, modules, tools/IDEs) and the
 * team-scope answers in `_bmad/config.toml` (6.9 and later) or `_bmad/<module>/config.yaml` (6.0). From the
 * personal file `_bmad/config.user.toml` only the communication language is read. `_bmad/custom` and
 * `_bmad/memory` are never read.
 */

export const BMAD_DIR = '_bmad';
export const BMAD_MANIFEST = join(BMAD_DIR, '_config', 'manifest.yaml');

export interface BmadInstall {
  version: string;
  lastUpdated: string;
  /** Module codes, `core` included. */
  modules: string[];
  tools: string[];
}

type Table = Record<string, unknown>;

const isTable = (value: unknown): value is Table =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const PROJECT_ROOT = '{project-root}';
/** Core answers that have their own installer flag (or are personal): not replayed with `--set`. */
const CORE_FLAGS = new Set(['communication_language', 'document_output_language', 'output_folder']);

/** The installed version, modules and tools, or null when the folder has no readable BMAD manifest. */
export function readBmadInstall(repo: string): BmadInstall | null {
  const file = join(repo, BMAD_MANIFEST);
  if (!existsSync(file)) return null;
  const manifest: unknown = parseYaml(readFileSync(file, 'utf8'));
  if (!isTable(manifest) || !isTable(manifest.installation)) return null;
  const { version, lastUpdated, installDate } = manifest.installation;
  if (typeof version !== 'string') return null;
  const modules = Array.isArray(manifest.modules)
    ? manifest.modules.flatMap((item) => (isTable(item) && typeof item.name === 'string' ? [item.name] : []))
    : [];
  const tools = Array.isArray(manifest.ides)
    ? manifest.ides.filter((item): item is string => typeof item === 'string')
    : [];
  const stamp = [lastUpdated, installDate].find(
    (value): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)),
  );
  return {
    version,
    lastUpdated: stamp ? new Date(stamp).toISOString() : new Date(0).toISOString(),
    modules,
    tools,
  };
}

function readToml(file: string): Table | null {
  if (!existsSync(file)) return null;
  const parsed = parseToml(readFileSync(file, 'utf8'));
  return isTable(parsed) ? parsed : null;
}

function readYamlTable(file: string): Table | null {
  if (!existsSync(file)) return null;
  const parsed: unknown = parseYaml(readFileSync(file, 'utf8'));
  return isTable(parsed) ? parsed : null;
}

/** A config value as `--set` passes it; null for values that cannot be replayed (tables, nested arrays). */
function settingText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
    return value.map(String).join(',');
  }
  return null;
}

/** `{project-root}/_bmad-output` → `_bmad-output`; absolute or otherwise machine-specific paths → null. */
function relativeFolder(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const relative = trimmed.startsWith(`${PROJECT_ROOT}/`) ? trimmed.slice(PROJECT_ROOT.length + 1) : trimmed;
  return BmadProfile.shape.outputFolder.safeParse(relative).data ?? null;
}

function language(value: unknown): string | null {
  return BmadProfile.shape.communicationLanguage.safeParse(value).data ?? null;
}

/** Every replayable, non-personal answer of one module's table. */
function settingsOf(module: string, table: Table, skip: ReadonlySet<string> = new Set()): BmadSetting[] {
  return Object.entries(table).flatMap(([key, raw]) => {
    if (skip.has(key) || BMAD_PERSONAL_KEYS.includes(key)) return [];
    const value = settingText(raw);
    if (value === null) return [];
    const parsed = BmadSetting.safeParse({ module, key, value });
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The project's BMAD profile, or null when the folder has no BMAD manifest. Personal answers (user name, skill
 * level), credential-like keys, absolute paths and answers of modules that are not installed are left out.
 */
export function readBmadProfile(repo: string): BmadProfile | null {
  const install = readBmadInstall(repo);
  if (!install) return null;
  const modules = install.modules.filter((code) => BmadId.safeParse(code).success);
  const installed = new Set(modules);
  const tools = install.tools.filter((id) => BmadId.safeParse(id).success);

  const team = readToml(join(repo, BMAD_DIR, 'config.toml'));
  const settings: BmadSetting[] = [];
  let core: Table;
  let communicationLanguage: string | null;
  if (team) {
    core = isTable(team.core) ? team.core : {};
    const user = readToml(join(repo, BMAD_DIR, 'config.user.toml'));
    const userCore = user && isTable(user.core) ? user.core : {};
    communicationLanguage = language(userCore.communication_language ?? core.communication_language);
    const moduleTables = isTable(team.modules) ? team.modules : {};
    for (const [module, table] of Object.entries(moduleTables)) {
      if (installed.has(module) && isTable(table)) settings.push(...settingsOf(module, table));
    }
  } else {
    // 6.0 layout: every module's config.yaml repeats the core answers, so only core's own file is read.
    core = readYamlTable(join(repo, BMAD_DIR, 'core', 'config.yaml')) ?? {};
    communicationLanguage = language(core.communication_language);
  }
  settings.unshift(...settingsOf('core', core, CORE_FLAGS));

  return BmadProfile.parse({
    version: install.version,
    lastUpdated: install.lastUpdated,
    modules,
    tools,
    communicationLanguage,
    documentOutputLanguage: language(core.document_output_language),
    outputFolder: relativeFolder(core.output_folder),
    settings: settings.slice(0, 200),
  });
}
