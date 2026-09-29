import {
  type CrossDocsSearchResponse,
  type DocsInitTicketInfo,
  type DocsOverviewResponse,
  type DocsPageKind,
  type DocsPageResponse,
  type DocsPageSummary,
  type DocsSearchResponse,
  type DocsSnapshotInfo,
  type DocsSpaceResponse,
  DocsSyncRequest,
  type DocsSyncResponse,
  FLOWS_MANIFEST_PATH,
  FlowsManifest,
  normalizeDocsPath,
  type SearchResponse,
} from '@crew/shared';
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import type { Executor, Transaction } from '../db/client.js';
import { type DocsSnapshotRow, docsFiles, docsSnapshots, projects, tickets } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { appendEvents } from './event-service.js';
import { likePattern } from './like-pattern.js';

type SyncBody = z.output<typeof DocsSyncRequest>;

const FIXED_PAGES: Record<string, { kind: DocsPageKind; title: string }> = {
  'docs/index.md': { kind: 'index', title: 'Tổng quan' },
  'docs/architecture.md': { kind: 'architecture', title: 'Kiến trúc' },
  'docs/files.md': { kind: 'files', title: 'Tra cứu file' },
  'AGENTS.md': { kind: 'agents', title: 'Hướng dẫn agent' },
};

/** Rows are inserted in batches so a 2000-file snapshot stays under the bind-parameter limit. */
const INSERT_BATCH = 200;
const SPACE_SEARCH_LIMIT = 20;
const GLOBAL_SEARCH_LIMIT = 10;
const CROSS_SEARCH_LIMIT = 50;
const SNIPPET_RADIUS = 80;

/** Parses and validates `docs/flows.yaml`; a snapshot whose manifest is invalid is refused. */
function parseManifest(content: string): FlowsManifest {
  let raw: unknown;
  try {
    raw = parseYaml(content, { uniqueKeys: true });
  } catch (error) {
    throw new ApiError('VALIDATION_FAILED', `${FLOWS_MANIFEST_PATH} is not valid YAML`, [
      { path: FLOWS_MANIFEST_PATH, message: error instanceof Error ? error.message : String(error) },
    ]);
  }
  const parsed = FlowsManifest.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `${FLOWS_MANIFEST_PATH} does not match the manifest schema`,
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return parsed.data;
}

function firstHeading(content: string): string | null {
  const match = /^#\s+(.+?)\s*#*\s*$/m.exec(content);
  return match?.[1] ?? null;
}

/** Page kind, flow id and title of one snapshot file. */
export function classifyPage(
  path: string,
  content: string,
  manifest: FlowsManifest,
): Omit<DocsPageSummary, 'path'> {
  const fixed = FIXED_PAGES[path];
  if (fixed) return { kind: fixed.kind, title: fixed.title, flowId: null };
  const flow = Object.entries(manifest.flows).find(([, entry]) => entry.doc === path);
  if (flow) return { kind: 'flow', title: flow[1].title, flowId: flow[0] };
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  return { kind: 'other', title: (path.endsWith('.md') && firstHeading(content)) || fileName, flowId: null };
}

function toSnapshotInfo(row: DocsSnapshotRow): DocsSnapshotInfo {
  return { commit: row.commitSha, branch: row.branch, syncedAt: row.syncedAt.toISOString() };
}

/**
 * Replaces a project's docs snapshot. Only the machine that owns the project may sync it. Marks the project's
 * docs ready and tells the owner stream (`docs.synced`).
 */
export async function syncDocsSnapshot(
  tx: Transaction,
  machineId: string,
  projectKey: string,
  input: SyncBody,
): Promise<DocsSyncResponse> {
  const body = DocsSyncRequest.parse(input);
  const [project] = await tx.select().from(projects).where(eq(projects.key, projectKey)).for('update');
  if (!project) throw notFound('project');
  if (project.ownerMachineId !== machineId) {
    throw new ApiError('FORBIDDEN', 'only the machine that owns the project may sync its docs');
  }

  const manifestFile = body.files.find((file) => file.path === FLOWS_MANIFEST_PATH);
  const manifest = parseManifest(manifestFile?.content ?? '');
  const totalBytes = body.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0);
  const syncedAt = new Date();

  await tx.delete(docsFiles).where(eq(docsFiles.projectId, project.id));
  const snapshot = {
    commitSha: body.commit,
    branch: body.branch,
    machineId,
    manifest,
    totalBytes,
    syncedAt,
  };
  await tx
    .insert(docsSnapshots)
    .values({ projectId: project.id, ...snapshot })
    .onConflictDoUpdate({ target: docsSnapshots.projectId, set: snapshot });

  const rows = body.files.map((file) => ({
    projectId: project.id,
    path: file.path,
    content: file.content,
    ...classifyPage(file.path, file.content, manifest),
  }));
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    await tx.insert(docsFiles).values(rows.slice(start, start + INSERT_BATCH));
  }

  await tx
    .update(projects)
    .set({ docsStatus: 'ready', updatedAt: syncedAt })
    .where(eq(projects.id, project.id));
  await appendEvents(tx, [
    {
      payload: { type: 'docs.synced', data: { projectId: project.id, commitSha: body.commit } },
      projectId: project.id,
    },
  ]);

  return {
    projectId: project.id,
    commit: body.commit,
    branch: body.branch,
    syncedAt: syncedAt.toISOString(),
    fileCount: rows.length,
  };
}

async function getSnapshot(db: Executor, projectId: string): Promise<DocsSnapshotRow | null> {
  const [row] = await db.select().from(docsSnapshots).where(eq(docsSnapshots.projectId, projectId));
  return row ?? null;
}

async function assertProject(db: Executor, projectId: string): Promise<void> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (!row) throw notFound('project');
}

const summaryColumns = {
  path: docsFiles.path,
  title: docsFiles.title,
  kind: docsFiles.kind,
  flowId: docsFiles.flowId,
};

/** The page tree and manifest of a project's latest snapshot; empty before the first sync. */
export async function getDocsSpace(db: Executor, projectId: string): Promise<DocsSpaceResponse> {
  await assertProject(db, projectId);
  const snapshot = await getSnapshot(db, projectId);
  if (!snapshot) return { snapshot: null, pages: [], manifest: null };
  const pages = await db
    .select(summaryColumns)
    .from(docsFiles)
    .where(eq(docsFiles.projectId, projectId))
    .orderBy(asc(docsFiles.path));
  return { snapshot: toSnapshotInfo(snapshot), pages, manifest: snapshot.manifest };
}

export async function getDocsPage(
  db: Executor,
  projectId: string,
  rawPath: string,
): Promise<DocsPageResponse> {
  const path = normalizeDocsPath(rawPath);
  if (path === null) throw new ApiError('VALIDATION_FAILED', 'invalid docs path');
  await assertProject(db, projectId);
  const snapshot = await getSnapshot(db, projectId);
  if (!snapshot) throw notFound('docs snapshot');
  const [page] = await db
    .select({ ...summaryColumns, content: docsFiles.content })
    .from(docsFiles)
    .where(and(eq(docsFiles.projectId, projectId), eq(docsFiles.path, path)));
  if (!page) throw notFound('docs page');
  return { snapshot: toSnapshotInfo(snapshot), page };
}

/** A one-line excerpt around the first match (case-insensitive), or the start of the page. */
export function snippetOf(content: string, q: string): string {
  const at = content.toLowerCase().indexOf(q.toLowerCase());
  const start = Math.max(0, at < 0 ? 0 : at - SNIPPET_RADIUS);
  const end = Math.min(content.length, (at < 0 ? 0 : at + q.length) + SNIPPET_RADIUS);
  const text = content.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${text}${end < content.length ? '…' : ''}`;
}

function matchesQuery(q: string) {
  const pattern = likePattern(q);
  return or(
    ilike(docsFiles.title, pattern),
    ilike(docsFiles.content, pattern),
    ilike(docsFiles.path, pattern),
  );
}

/** Space search: an ILIKE over the title, path and content of one project's snapshot (wildcards escaped). */
export async function searchDocs(db: Executor, projectId: string, q: string): Promise<DocsSearchResponse> {
  await assertProject(db, projectId);
  const text = q.trim();
  const rows = await db
    .select({ ...summaryColumns, content: docsFiles.content })
    .from(docsFiles)
    .where(and(eq(docsFiles.projectId, projectId), matchesQuery(text)))
    .orderBy(sql`(${docsFiles.title} ilike ${likePattern(text)}) desc`, asc(docsFiles.path))
    .limit(SPACE_SEARCH_LIMIT);
  return {
    items: rows.map(({ content, ...page }) => ({ ...page, snippet: snippetOf(content, text) })),
  };
}

/** Only the pages of these projects, when a project filter is given. */
function inProjects(projectIds: readonly string[] | undefined, text: string): SQL | undefined {
  return projectIds?.length
    ? and(inArray(docsFiles.projectId, [...projectIds]), matchesQuery(text))
    : matchesQuery(text);
}

/**
 * Docs search across projects (the docs home and the space search's "Mọi dự án" scope): every project, or
 * only `projectIds`; title matches first, then by project and path.
 */
export async function searchDocsAcrossProjects(
  db: Executor,
  q: string,
  projectIds?: readonly string[],
): Promise<CrossDocsSearchResponse> {
  const text = q.trim();
  const rows = await db
    .select({ ...summaryColumns, projectId: docsFiles.projectId, content: docsFiles.content })
    .from(docsFiles)
    .innerJoin(projects, eq(projects.id, docsFiles.projectId))
    .where(inProjects(projectIds, text))
    .orderBy(
      sql`(${docsFiles.title} ilike ${likePattern(text)}) desc`,
      asc(projects.key),
      asc(docsFiles.path),
    )
    .limit(CROSS_SEARCH_LIMIT);
  return {
    items: rows.map(({ content, ...page }) => ({ ...page, snippet: snippetOf(content, text) })),
  };
}

/**
 * The docs home: every project's docs status, its latest snapshot with the file count, and its newest
 * docs_init ticket (why a space is still empty: blocked, in progress, …).
 */
export async function getDocsOverview(db: Executor): Promise<DocsOverviewResponse> {
  const [projectRows, snapshots, counts, inits] = await Promise.all([
    db.select({ id: projects.id, docsStatus: projects.docsStatus }).from(projects).orderBy(asc(projects.key)),
    db.select().from(docsSnapshots),
    db
      .select({ projectId: docsFiles.projectId, files: count() })
      .from(docsFiles)
      .groupBy(docsFiles.projectId),
    db
      .select({
        id: tickets.id,
        key: tickets.key,
        title: tickets.title,
        status: tickets.status,
        updatedAt: tickets.updatedAt,
        projectId: tickets.projectId,
      })
      .from(tickets)
      .where(eq(tickets.type, 'docs_init'))
      .orderBy(desc(tickets.createdAt), desc(tickets.id)),
  ]);
  const snapshotOf = new Map(snapshots.map((row) => [row.projectId, row]));
  const countOf = new Map(counts.map((row) => [row.projectId, row.files]));
  const initOf = new Map<string, DocsInitTicketInfo>();
  for (const { projectId, updatedAt, ...ticket } of inits) {
    if (projectId && !initOf.has(projectId)) {
      initOf.set(projectId, { ...ticket, updatedAt: updatedAt.toISOString() });
    }
  }
  return {
    items: projectRows.map((project) => {
      const snapshot = snapshotOf.get(project.id);
      return {
        projectId: project.id,
        docsStatus: project.docsStatus,
        snapshot: snapshot ? toSnapshotInfo(snapshot) : null,
        fileCount: countOf.get(project.id) ?? 0,
        docsInit: initOf.get(project.id) ?? null,
      };
    }),
  };
}

/** Docs pages of every project (or only `projectIds`) for the global quick search; title matches first. */
export async function searchAllDocs(
  db: Executor,
  q: string,
  projectIds?: readonly string[],
): Promise<SearchResponse['docs']> {
  const text = q.trim();
  return db
    .select({ projectId: docsFiles.projectId, path: docsFiles.path, title: docsFiles.title })
    .from(docsFiles)
    .where(inProjects(projectIds, text))
    .orderBy(sql`(${docsFiles.title} ilike ${likePattern(text)}) desc`, asc(docsFiles.title))
    .limit(GLOBAL_SEARCH_LIMIT);
}
