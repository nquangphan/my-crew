/**
 * Shared TanStack Query keys. Every key starts with `'v2'` so session teardown and broad event invalidation
 * can address the whole owner cache. Credentials, CSRF tokens and machine/API secrets never become query data.
 */
export const queryKeys = {
  ticket: (id: string) => ['v2', 'ticket', id] as const,
  graph: (rootId: string) => ['v2', 'graph', rootId] as const,
  tickets: (filters: Record<string, string>) => ['v2', 'tickets', filters] as const,
  attention: (filters: Record<string, string>) => ['v2', 'attention', filters] as const,
  docsPage: (projectId: string, snapshotId: string, path: string) =>
    ['v2', 'docs', projectId, snapshotId, path] as const,
  comments: (ticketId: string) => ['v2', 'comments', ticketId] as const,
  decisions: (ticketId: string) => ['v2', 'decisions', ticketId] as const,
  docsTree: (projectId: string, snapshotId: string | null) =>
    ['v2', 'docs', projectId, snapshotId ?? 'latest', 'tree'] as const,
  docsSearch: (filters: Record<string, string>) => ['v2', 'docs-search', filters] as const,
  projects: () => ['v2', 'projects'] as const,
  project: (id: string) => ['v2', 'project', id] as const,
  machines: () => ['v2', 'machines'] as const,
  machine: (id: string) => ['v2', 'machine', id] as const,
  modelSources: (machineId: string) => ['v2', 'model-sources', machineId] as const,
  models: (machineId: string, workflow: string) => ['v2', 'models', machineId, workflow] as const,
  gatewayStatus: (machineId: string) => ['v2', 'gateway-status', machineId] as const,
  attachments: (ticketId: string) => ['v2', 'attachments', ticketId] as const,
};

/** Prefix keys used by event invalidation (TanStack matches by prefix). */
export const queryRoots = {
  all: ['v2'] as const,
  ticket: (id: string) => ['v2', 'ticket', id] as const,
  graphs: ['v2', 'graph'] as const,
  tickets: ['v2', 'tickets'] as const,
  attention: ['v2', 'attention'] as const,
  comments: (ticketId: string) => ['v2', 'comments', ticketId] as const,
  decisions: (ticketId: string) => ['v2', 'decisions', ticketId] as const,
  attachments: (ticketId: string) => ['v2', 'attachments', ticketId] as const,
  allAttachments: ['v2', 'attachments'] as const,
  docs: (projectId: string) => ['v2', 'docs', projectId] as const,
  allDocs: ['v2', 'docs'] as const,
  docsSearch: ['v2', 'docs-search'] as const,
  projects: ['v2', 'projects'] as const,
  project: (id: string) => ['v2', 'project', id] as const,
  machines: ['v2', 'machines'] as const,
  machine: (id: string) => ['v2', 'machine', id] as const,
  modelSources: (machineId: string) => ['v2', 'model-sources', machineId] as const,
  models: (machineId: string) => ['v2', 'models', machineId] as const,
  gatewayStatus: (machineId: string) => ['v2', 'gateway-status', machineId] as const,
};
