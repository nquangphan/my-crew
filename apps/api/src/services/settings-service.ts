import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BUDGET_SETTINGS,
  DEFAULT_GUARD_POLICY,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_RESOURCE_SETTINGS,
  type EffectiveSettings,
  type ImportLocalSettingsRequest as ImportInput,
  ImportLocalSettingsRequest,
  type ImportLocalSettingsResponse,
  isPartialPrompt,
  lineDiff,
  PROMPT_CATALOG,
  PROMPT_VARIABLES,
  ProjectFolders,
  type PromptContent,
  type SaveSettingsResponse,
  SETTINGS_CONTENT,
  type SettingsDiffResponse,
  type SettingsKey,
  type SettingsOverviewResponse,
  type SettingsRevision,
  settingsText,
  validateSettingsContent,
} from '@crew/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { MachineContext } from '../auth/machine-auth.js';
import type { Executor } from '../db/client.js';
import { machines, projects, type SettingsRevisionRow, settingsRevisions } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { appendEvents } from './event-service.js';

// ---------------------------------------------------------------------------
// Bundled prompt defaults
// ---------------------------------------------------------------------------

/**
 * The daemon's bundled role prompts, read from its source folder (the API image copies it to the same place
 * relative to `dist/services`). The web shows them as the default and diffs against them; the daemon itself
 * always falls back to the copy it ships with.
 */
const PROMPT_DEFAULTS_DIR = fileURLToPath(new URL('../../../daemon/src/roles/prompts/', import.meta.url));
let promptDefaults: Map<string, string | null> | null = null;

export function bundledPrompt(name: string): string | null {
  promptDefaults ??= new Map(
    PROMPT_CATALOG.map(({ name: prompt }) => {
      try {
        return [prompt, readFileSync(`${PROMPT_DEFAULTS_DIR}${prompt}.md`, 'utf8')];
      } catch {
        return [prompt, null];
      }
    }),
  );
  return promptDefaults.get(name) ?? null;
}

// ---------------------------------------------------------------------------
// Rows and keys
// ---------------------------------------------------------------------------

export function toRevisionDto(row: SettingsRevisionRow): SettingsRevision {
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    machineId: row.machineId,
    projectId: row.projectId,
    name: row.name,
    version: row.version,
    content: row.content ?? null,
    note: row.note,
    author: row.author,
    restoredFrom: row.restoredFrom,
    createdAt: row.createdAt.toISOString(),
  };
}

const keyText = (key: SettingsKey) =>
  [key.kind, key.scope, key.machineId ?? '', key.projectId ?? '', key.name].join('|');

function keyWhere(key: SettingsKey) {
  return and(
    eq(settingsRevisions.kind, key.kind),
    eq(settingsRevisions.scope, key.scope),
    key.machineId === null
      ? isNull(settingsRevisions.machineId)
      : eq(settingsRevisions.machineId, key.machineId),
    key.projectId === null
      ? isNull(settingsRevisions.projectId)
      : eq(settingsRevisions.projectId, key.projectId),
    eq(settingsRevisions.name, key.name),
  );
}

const rowKey = (row: SettingsRevisionRow): SettingsKey => ({
  kind: row.kind,
  scope: row.scope,
  machineId: row.machineId,
  projectId: row.projectId,
  name: row.name,
});

/** The active (newest) revision of every setting key. */
export async function listActive(db: Executor): Promise<SettingsRevisionRow[]> {
  return db
    .selectDistinctOn([
      settingsRevisions.kind,
      settingsRevisions.scope,
      settingsRevisions.machineId,
      settingsRevisions.projectId,
      settingsRevisions.name,
    ])
    .from(settingsRevisions)
    .orderBy(
      settingsRevisions.kind,
      settingsRevisions.scope,
      settingsRevisions.machineId,
      settingsRevisions.projectId,
      settingsRevisions.name,
      desc(settingsRevisions.version),
    );
}

export async function activeRevision(db: Executor, key: SettingsKey): Promise<SettingsRevisionRow | null> {
  const [row] = await db
    .select()
    .from(settingsRevisions)
    .where(keyWhere(key))
    .orderBy(desc(settingsRevisions.version))
    .limit(1);
  return row ?? null;
}

export async function settingsHistory(
  db: Executor,
  key: SettingsKey,
  limit = 100,
): Promise<SettingsRevision[]> {
  const rows = await db
    .select()
    .from(settingsRevisions)
    .where(keyWhere(key))
    .orderBy(desc(settingsRevisions.version))
    .limit(limit);
  return rows.map(toRevisionDto);
}

async function requireRevision(db: Executor, id: string): Promise<SettingsRevisionRow> {
  const [row] = await db.select().from(settingsRevisions).where(eq(settingsRevisions.id, id));
  if (!row) throw notFound('settings revision');
  return row;
}

export async function getRevision(db: Executor, id: string): Promise<SettingsRevision> {
  return toRevisionDto(await requireRevision(db, id));
}

// ---------------------------------------------------------------------------
// Validation and saving
// ---------------------------------------------------------------------------

/** The scope of a key must exist: a live machine, or a project. */
async function assertScopeExists(db: Executor, key: SettingsKey): Promise<void> {
  if (key.machineId) {
    const [row] = await db
      .select({ id: machines.id, revokedAt: machines.revokedAt })
      .from(machines)
      .where(eq(machines.id, key.machineId));
    if (!row) throw notFound('machine');
    if (row.revokedAt) throw new ApiError('CONFLICT', 'the machine was revoked');
  }
  if (key.projectId) {
    const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, key.projectId));
    if (!row) throw notFound('project');
  }
}

/** Field problems of a content value; content null (remove the override) is always valid. */
export function contentErrors(key: SettingsKey, content: unknown): { path: string; message: string }[] {
  return content === null ? [] : validateSettingsContent(key.kind, key.name, content);
}

/** The machines a revision of this key applies to: every live machine, the machine, or the project's owner. */
async function affectedMachines(db: Executor, key: SettingsKey): Promise<string[]> {
  if (key.machineId) return [key.machineId];
  if (key.projectId) {
    const [row] = await db
      .select({ owner: projects.ownerMachineId })
      .from(projects)
      .where(eq(projects.id, key.projectId));
    return row?.owner ? [row.owner] : [];
  }
  const rows = await db
    .select({ id: machines.id })
    .from(machines)
    .where(isNull(machines.revokedAt))
    .orderBy(asc(machines.createdAt));
  return rows.map((row) => row.id);
}

/**
 * Saves a new revision of one setting inside the caller's transaction, after validating it with the shared
 * schemas. `baseVersion` guards against saving over a revision the editor never saw. Tells the owner stream
 * and every machine the setting applies to.
 */
export async function saveRevision(
  tx: Executor,
  input: {
    key: SettingsKey;
    content: unknown;
    note: string;
    author: string;
    baseVersion?: number;
    restoredFrom?: number;
  },
): Promise<SaveSettingsResponse> {
  const { key } = input;
  const errors = contentErrors(key, input.content);
  if (errors.length > 0) throw new ApiError('VALIDATION_FAILED', 'invalid setting', errors);
  await assertScopeExists(tx, key);
  // One writer per key at a time, so versions never collide and `baseVersion` compares with the real head.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`settings:${keyText(key)}`}))`);
  const current = await activeRevision(tx, key);
  if (input.baseVersion !== undefined && input.baseVersion !== (current?.version ?? 0)) {
    throw new ApiError(
      'CONFLICT',
      `the setting changed since it was opened (now version ${current?.version ?? 0})`,
      { currentVersion: current?.version ?? 0 },
    );
  }
  const [row] = await tx
    .insert(settingsRevisions)
    .values({
      kind: key.kind,
      scope: key.scope,
      machineId: key.machineId,
      projectId: key.projectId,
      name: key.name,
      version: (current?.version ?? 0) + 1,
      // Stored as the schema outputs it (trimmed strings); `contentErrors` already accepted it.
      content: input.content === null ? null : SETTINGS_CONTENT[key.kind].parse(input.content),
      note: input.note,
      author: input.author,
      restoredFrom: input.restoredFrom ?? null,
    })
    .returning();
  if (!row) throw new Error('settings revision insert returned no row');
  const affected = await affectedMachines(tx, key);
  const data = {
    revisionId: row.id,
    kind: row.kind,
    scope: row.scope,
    machineId: row.machineId,
    projectId: row.projectId,
    name: row.name,
    version: row.version,
  };
  await appendEvents(tx, [
    { payload: { type: 'settings.changed', data } },
    ...affected.map((machineId) => ({
      payload: { type: 'settings.changed' as const, data },
      targetMachineId: machineId,
    })),
  ]);
  return { revision: toRevisionDto(row), affectedMachineIds: affected };
}

/** Restores an earlier revision by saving its content as the newest one. */
export async function restoreRevision(
  db: Executor,
  input: { revisionId: string; note: string; author: string },
): Promise<SaveSettingsResponse> {
  return db.transaction(async (tx) => {
    const source = await requireRevision(tx, input.revisionId);
    return saveRevision(tx, {
      key: rowKey(source),
      content: source.content ?? null,
      note: input.note || `Khôi phục bản ${source.version}`,
      author: input.author,
      restoredFrom: source.version,
    });
  });
}

export async function diffRevisions(
  db: Executor,
  fromId: string,
  toId: string,
): Promise<SettingsDiffResponse> {
  const [from, to] = await Promise.all([requireRevision(db, fromId), requireRevision(db, toId)]);
  if (keyText(rowKey(from)) !== keyText(rowKey(to))) {
    throw new ApiError('VALIDATION_FAILED', 'the two revisions belong to different settings');
  }
  return {
    from: toRevisionDto(from),
    to: toRevisionDto(to),
    lines: lineDiff(settingsText(from.kind, from.content ?? null), settingsText(to.kind, to.content ?? null)),
  };
}

export async function settingsOverview(db: Executor): Promise<SettingsOverviewResponse> {
  return {
    prompts: PROMPT_CATALOG.map(({ name, label }) => ({
      name,
      label,
      partial: isPartialPrompt(name),
      defaultText: bundledPrompt(name),
    })),
    variables: Object.entries(PROMPT_VARIABLES).map(([name, description]) => ({ name, description })),
    defaults: {
      policy: DEFAULT_GUARD_POLICY,
      models: DEFAULT_MODEL_SETTINGS,
      budgets: DEFAULT_BUDGET_SETTINGS,
      resources: DEFAULT_RESOURCE_SETTINGS,
    },
    active: (await listActive(db)).map(toRevisionDto),
  };
}

// ---------------------------------------------------------------------------
// Effective settings of a machine
// ---------------------------------------------------------------------------

type EffectiveBody = Omit<EffectiveSettings, 'revision'>;

/** Merges the active revisions for one machine: global ← machine override, and its owned projects. */
function mergeFor(
  active: readonly SettingsRevisionRow[],
  machineId: string,
  ownedProjects: ReadonlyMap<string, string>,
  branches: ReadonlyMap<string, string>,
): EffectiveBody {
  const content = (row: SettingsRevisionRow | undefined) => row?.content ?? null;
  const find = (kind: SettingsRevisionRow['kind'], scope: SettingsRevisionRow['scope'], id?: string | null) =>
    active.find(
      (row) =>
        row.kind === kind &&
        row.scope === scope &&
        (scope !== 'machine' || row.machineId === id) &&
        (scope !== 'project' || row.projectId === id),
    );
  const prompts: Record<string, string> = {};
  for (const row of active) {
    if (row.kind === 'prompt' && row.content) prompts[row.name] = (row.content as PromptContent).text;
  }
  const projectSettings: Record<string, unknown> = {};
  for (const [projectId, projectKey] of ownedProjects) {
    const value = content(find('project_mcp', 'project', projectId));
    if (value !== null) projectSettings[projectKey] = value;
  }
  // The machine's folders, each with its project's default branch (the daemon needs it for worktrees).
  const folders = ProjectFolders.safeParse(content(find('project_folders', 'machine', machineId)));
  return {
    prompts,
    folders: folders.success
      ? {
          projects: folders.data.projects.map((entry) => ({
            ...entry,
            defaultBranch: branches.get(entry.key) ?? 'main',
          })),
        }
      : null,
    policy: content(find('policy', 'global')),
    models: content(find('models', 'machine', machineId)) ?? content(find('models', 'global')),
    budgets: content(find('budgets', 'machine', machineId)) ?? content(find('budgets', 'global')),
    resources: content(find('resources', 'machine', machineId)),
    projects: projectSettings,
  };
}

/** A stable hash of the merged content: equal settings give equal revisions, whatever their history. */
function revisionOf(body: EffectiveBody): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  return createHash('sha256')
    .update(JSON.stringify(stable(body)))
    .digest('hex')
    .slice(0, 16);
}

async function ownedProjectsOf(db: Executor, machineIds: readonly string[]) {
  if (machineIds.length === 0) return new Map<string, Map<string, string>>();
  const rows = await db
    .select({ id: projects.id, key: projects.key, owner: projects.ownerMachineId })
    .from(projects)
    .where(inArray(projects.ownerMachineId, [...machineIds]))
    .orderBy(asc(projects.key));
  const out = new Map<string, Map<string, string>>();
  for (const row of rows) {
    if (!row.owner) continue;
    const map = out.get(row.owner) ?? new Map<string, string>();
    map.set(row.id, row.key);
    out.set(row.owner, map);
  }
  return out;
}

async function projectBranches(db: Executor): Promise<Map<string, string>> {
  const rows = await db.select({ key: projects.key, branch: projects.defaultBranch }).from(projects);
  return new Map(rows.map((row) => [row.key, row.branch]));
}

/** `GET /v1/daemon/settings`: the merged settings of one machine and their content revision. */
export async function effectiveSettings(db: Executor, machineId: string): Promise<EffectiveSettings> {
  const [active, owned, branches] = await Promise.all([
    listActive(db),
    ownedProjectsOf(db, [machineId]),
    projectBranches(db),
  ]);
  const body = mergeFor(active, machineId, owned.get(machineId) ?? new Map(), branches);
  return { revision: revisionOf(body), ...body };
}

/** The revision each machine would get now (the web compares it with what their heartbeats report). */
export async function expectedRevisions(
  db: Executor,
  machineIds: readonly string[],
): Promise<Map<string, string>> {
  if (machineIds.length === 0) return new Map();
  const [active, owned, branches] = await Promise.all([
    listActive(db),
    ownedProjectsOf(db, machineIds),
    projectBranches(db),
  ]);
  return new Map(
    machineIds.map((id) => [id, revisionOf(mergeFor(active, id, owned.get(id) ?? new Map(), branches))]),
  );
}

// ---------------------------------------------------------------------------
// Machine writes
// ---------------------------------------------------------------------------

const machineAuthor = (machine: MachineContext) => `machine:${machine.machineName}`;

async function ownedProject(db: Executor, machineId: string, projectKey: string) {
  const [project] = await db
    .select({ id: projects.id, owner: projects.ownerMachineId })
    .from(projects)
    .where(eq(projects.key, projectKey));
  if (!project) throw notFound('project');
  if (project.owner !== machineId) {
    throw new ApiError('FORBIDDEN', `project ${projectKey} belongs to another machine`);
  }
  return project.id;
}

/**
 * The one-time upload of a machine's local `config.yaml` values: each becomes the machine's (or its
 * project's) override only when that setting has no revision on the server yet. Projects the machine does
 * not own are skipped.
 */
export async function importLocalSettings(
  db: Executor,
  machine: MachineContext,
  input: ImportInput,
): Promise<ImportLocalSettingsResponse> {
  const data = ImportLocalSettingsRequest.parse(input);
  return db.transaction(async (tx) => {
    const created: string[] = [];
    const kept: string[] = [];
    const note = `Chuyển từ config.yaml của máy ${machine.machineName}`;
    const put = async (label: string, key: SettingsKey, content: unknown) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`settings:${keyText(key)}`}))`);
      if (await activeRevision(tx, key)) {
        kept.push(label);
        return;
      }
      await saveRevision(tx, { key, content, note, author: machineAuthor(machine) });
      created.push(label);
    };
    const machineKey = (kind: 'resources' | 'models' | 'budgets' | 'project_folders'): SettingsKey => ({
      kind,
      scope: 'machine',
      machineId: machine.machineId,
      projectId: null,
      name: '',
    });
    if (data.resources) await put('resources', machineKey('resources'), data.resources);
    if (data.models) await put('models', machineKey('models'), data.models);
    if (data.budgets) await put('budgets', machineKey('budgets'), data.budgets);
    if (data.folders && data.folders.projects.length > 0) {
      await put('project_folders', machineKey('project_folders'), data.folders);
    }
    for (const project of data.projects) {
      const [row] = await tx
        .select({ id: projects.id, owner: projects.ownerMachineId })
        .from(projects)
        .where(eq(projects.key, project.key));
      if (!row || row.owner !== machine.machineId || project.disabledMcpServers.length === 0) continue;
      await put(
        `project_mcp:${project.key}`,
        { kind: 'project_mcp', scope: 'project', machineId: null, projectId: row.id, name: '' },
        { disabledMcpServers: project.disabledMcpServers },
      );
    }
    return { created, kept };
  });
}

/** The owning machine switches MCP servers of its project (the health dashboard's one-click fix). */
export async function putProjectMcpFromMachine(
  db: Executor,
  machine: MachineContext,
  projectKey: string,
  input: { disabledMcpServers: string[]; note: string },
): Promise<SaveSettingsResponse> {
  return db.transaction(async (tx) => {
    const projectId = await ownedProject(tx, machine.machineId, projectKey);
    return saveRevision(tx, {
      key: { kind: 'project_mcp', scope: 'project', machineId: null, projectId, name: '' },
      content: { disabledMcpServers: input.disabledMcpServers },
      note: input.note || `Đổi từ máy ${machine.machineName}`,
      author: machineAuthor(machine),
    });
  });
}

/**
 * The machine sets (or, with `repoPath` null, removes) one project's folder in its folders setting; the other
 * projects' folders are kept. Used by the app's folder picker and `crewd project add|remove`.
 */
export async function putProjectFolderFromMachine(
  db: Executor,
  machine: MachineContext,
  projectKey: string,
  input: { repoPath: string; sharedPaths?: string[] } | null,
): Promise<SaveSettingsResponse> {
  return db.transaction(async (tx) => {
    const key: SettingsKey = {
      kind: 'project_folders',
      scope: 'machine',
      machineId: machine.machineId,
      projectId: null,
      name: '',
    };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`settings:${keyText(key)}`}))`);
    const current = ProjectFolders.safeParse((await activeRevision(tx, key))?.content).data?.projects ?? [];
    const kept = current.filter((entry) => entry.key !== projectKey);
    const previous = current.find((entry) => entry.key === projectKey);
    const projects = input
      ? [
          ...kept,
          {
            key: projectKey,
            repoPath: input.repoPath,
            sharedPaths: input.sharedPaths ?? previous?.sharedPaths ?? [],
          },
        ]
      : kept;
    return saveRevision(tx, {
      key,
      content: { projects },
      note: input
        ? `Thư mục ${projectKey} đặt từ máy ${machine.machineName}`
        : `Bỏ thư mục ${projectKey} trên máy ${machine.machineName}`,
      author: machineAuthor(machine),
    });
  });
}
