import { z } from 'zod';

const RepoPath = z.string().min(1);
export const FlowId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'flow ids are kebab-case');

export const FlowEntry = z.object({
  title: z.string().min(1),
  doc: RepoPath,
  entrypoints: z.array(RepoPath).default([]),
  files: z.array(RepoPath).default([]),
  tests: z.array(RepoPath).default([]),
});
export type FlowEntry = z.infer<typeof FlowEntry>;

/** Schema of `docs/flows.yaml`, the manifest that maps flows to files. */
export const FlowsManifest = z.object({
  version: z.literal(1),
  source: z.object({
    include: z.array(z.string()).min(1),
    exclude: z.array(z.string()).default([]),
  }),
  flows: z.record(FlowId, FlowEntry),
  /** Cross-cutting files; each must list the flows that rely on it. */
  shared: z.record(RepoPath, z.array(FlowId).min(1)).default({}),
  /** Explicit, reasoned exceptions. */
  unassigned: z.array(z.object({ path: RepoPath, reason: z.string().min(1) })).default([]),
});
export type FlowsManifest = z.infer<typeof FlowsManifest>;

/** Repo path of the manifest in every project that follows the docs standard. */
export const FLOWS_MANIFEST_PATH = 'docs/flows.yaml';

// ---------------------------------------------------------------------------
// Flow ownership lookup (shared by `crew-docs where` and the web file lookup)
// ---------------------------------------------------------------------------

export type FlowFileRole = 'entrypoint' | 'file' | 'test' | 'shared';

export interface FlowOwnership {
  flowId: string;
  title: string;
  doc: string;
  role: FlowFileRole;
}

export interface PathOwnership {
  flows: FlowOwnership[];
  /** The reason when the path is an explicit `unassigned` exception, else null. */
  unassignedReason: string | null;
}

/** The flows that own a repo path, in manifest order, plus its `unassigned` reason when it has one. */
export function flowsForPath(manifest: FlowsManifest, path: string): PathOwnership {
  const flows: FlowOwnership[] = [];
  const seen = new Set<string>();
  const add = (flowId: string, role: FlowFileRole) => {
    const flow = manifest.flows[flowId];
    const key = `${flowId}:${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    flows.push({ flowId, title: flow?.title ?? flowId, doc: flow?.doc ?? '', role });
  };
  for (const [flowId, flow] of Object.entries(manifest.flows)) {
    if (flow.entrypoints.includes(path)) add(flowId, 'entrypoint');
    if (flow.files.includes(path)) add(flowId, 'file');
    if (flow.tests.includes(path)) add(flowId, 'test');
  }
  for (const flowId of manifest.shared[path] ?? []) add(flowId, 'shared');
  const unassigned = manifest.unassigned.find((entry) => entry.path === path);
  return { flows, unassignedReason: unassigned?.reason ?? null };
}

// ---------------------------------------------------------------------------
// Docs snapshot sync (daemon → API) and the read-only docs space (web)
// ---------------------------------------------------------------------------

/** Cap of one snapshot: the sum of the UTF-8 sizes of every file, and the request body. */
export const DOCS_SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const DOCS_SNAPSHOT_MAX_FILES = 2000;

/** Paths a snapshot may carry: markdown and YAML under `docs/`, plus the root `AGENTS.md`. */
export const DOCS_SYNC_PATH_RE = /^(docs\/[A-Za-z0-9._/-]+\.(md|yaml)|AGENTS\.md)$/;

export const CommitSha = z.string().regex(/^[0-9a-f]{40}$/, 'commit must be a full 40-char lowercase SHA');

/**
 * Normalizes a snapshot path (drops `.` and empty segments) and rejects anything that could leave the docs
 * tree: `..` segments, absolute paths, backslashes, or a path outside the allow-list.
 */
export function normalizeDocsPath(raw: string): string | null {
  if (raw.length === 0 || raw.length > 300 || raw.startsWith('/') || raw.includes('\\')) return null;
  const segments = raw.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.some((segment) => segment === '..')) return null;
  const path = segments.join('/');
  return DOCS_SYNC_PATH_RE.test(path) ? path : null;
}

export const DocsSyncPath = z.string().transform((raw, ctx) => {
  const path = normalizeDocsPath(raw);
  if (path === null) {
    ctx.addIssue({ code: 'custom', message: 'path must be docs/**/*.md|yaml or AGENTS.md, without ..' });
    return z.NEVER;
  }
  return path;
});

/** UTF-8 size of a string, without depending on DOM or Node typings. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Body of `PUT /v1/daemon/projects/:key/docs`: the full docs tree at one commit (it replaces the last one). */
export const DocsSyncRequest = z
  .object({
    commit: CommitSha,
    branch: z.string().trim().min(1).max(200),
    files: z
      .array(z.object({ path: DocsSyncPath, content: z.string() }))
      .min(1)
      .max(DOCS_SNAPSHOT_MAX_FILES),
  })
  .superRefine((body, ctx) => {
    const paths = new Set<string>();
    let bytes = 0;
    for (const file of body.files) {
      if (paths.has(file.path)) {
        ctx.addIssue({ code: 'custom', path: ['files'], message: `duplicate path ${file.path}` });
      }
      paths.add(file.path);
      bytes += utf8Bytes(file.content);
    }
    if (bytes > DOCS_SNAPSHOT_MAX_BYTES) {
      ctx.addIssue({ code: 'custom', path: ['files'], message: 'snapshot exceeds 5 MB' });
    }
    if (!paths.has(FLOWS_MANIFEST_PATH)) {
      ctx.addIssue({ code: 'custom', path: ['files'], message: `${FLOWS_MANIFEST_PATH} is required` });
    }
  });
export type DocsSyncRequest = z.input<typeof DocsSyncRequest>;

export const DocsSnapshotInfo = z.object({
  commit: z.string(),
  branch: z.string(),
  syncedAt: z.iso.datetime(),
});
export type DocsSnapshotInfo = z.infer<typeof DocsSnapshotInfo>;

export const DocsSyncResponse = DocsSnapshotInfo.extend({
  projectId: z.string(),
  fileCount: z.number().int(),
});
export type DocsSyncResponse = z.infer<typeof DocsSyncResponse>;

/** Where a page sits in the space's page tree. */
export const DocsPageKind = z.enum(['index', 'architecture', 'flow', 'files', 'agents', 'other']);
export type DocsPageKind = z.infer<typeof DocsPageKind>;

export const DocsPageSummary = z.object({
  path: z.string(),
  title: z.string(),
  kind: DocsPageKind,
  /** Set for flow pages: the flow id whose `doc` is this path. */
  flowId: z.string().nullable(),
});
export type DocsPageSummary = z.infer<typeof DocsPageSummary>;

/** `GET /v1/projects/:id/docs`: the page tree and manifest of the latest snapshot (null before any sync). */
export const DocsSpaceResponse = z.object({
  snapshot: DocsSnapshotInfo.nullable(),
  pages: z.array(DocsPageSummary),
  manifest: FlowsManifest.nullable(),
});
export type DocsSpaceResponse = z.infer<typeof DocsSpaceResponse>;

export const DocsPageQuery = z.object({ path: z.string().min(1).max(300) });

/** `GET /v1/projects/:id/docs/page?path=`. */
export const DocsPageResponse = z.object({
  snapshot: DocsSnapshotInfo,
  page: DocsPageSummary.extend({ content: z.string() }),
});
export type DocsPageResponse = z.infer<typeof DocsPageResponse>;

export const DocsSearchQuery = z.object({ q: z.string().trim().min(1).max(200) });

/** `GET /v1/projects/:id/docs/search?q=`: pages of one project's snapshot, with a text snippet. */
export const DocsSearchResponse = z.object({
  items: z.array(DocsPageSummary.extend({ snippet: z.string() })),
});
export type DocsSearchResponse = z.infer<typeof DocsSearchResponse>;
