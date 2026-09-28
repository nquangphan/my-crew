import { z } from 'zod';

const RepoPath = z.string().min(1);
const FlowId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'flow ids are kebab-case');

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
