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
// Flow ownership lookup (used by `crew-docs where` and `crew-docs generate`)
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
