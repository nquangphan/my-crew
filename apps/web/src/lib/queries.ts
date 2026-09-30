import type {
  ClaimRequestStatus,
  ListTicketsQuery,
  Machine,
  Project,
  ProjectChangeStatus,
  SettingsKeyInput,
  Ticket,
  TicketDetailResponse,
  TicketPriority,
  TicketStatus,
  UploadAttachmentRequest,
} from '@crew/shared';
import { type QueryClient, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';

/** Query-key roots; live events invalidate by these prefixes. */
export const keys = {
  session: ['session'] as const,
  tickets: ['tickets'] as const,
  ticketList: (query: ListTicketsQuery) => ['tickets', query] as const,
  ticket: (idOrKey: string) => ['ticket', idOrKey] as const,
  descendants: (id: string) => ['descendants', id] as const,
  /** Under `descendants`, so ticket events and writes refresh it with the cancel list. */
  tree: (id: string) => ['descendants', id, 'tree'] as const,
  reports: (idOrKey: string) => ['report', idOrKey] as const,
  projects: ['projects'] as const,
  machines: ['machines'] as const,
  machine: (id: string) => ['machine', id] as const,
  /** Refetched when a runtime bundle is published. */
  runtimeReleases: ['runtime', 'releases'] as const,
  claims: (status?: ClaimRequestStatus) => ['claims', status ?? 'all'] as const,
  projectChanges: (status?: ProjectChangeStatus) => ['projectChanges', status ?? 'all'] as const,
  notices: ['notices'] as const,
  search: (q: string, projectIds: readonly string[] = []) => ['search', q, [...projectIds]] as const,
  /** Every project's docs status; ticket events refresh it too (a docs_init ticket changes status). */
  docsOverview: ['docs', 'overview'] as const,
  docsSearchAcross: (q: string, projectIds: readonly string[]) =>
    ['docs', 'search-across', q, [...projectIds]] as const,
  /** Everything under `docs` is refetched when a `docs.synced` event arrives. */
  docsSpace: (projectId: string) => ['docs', projectId, 'space'] as const,
  docsPage: (projectId: string, path: string) => ['docs', projectId, 'page', path] as const,
  docsSearch: (projectId: string, q: string) => ['docs', projectId, 'search', q] as const,
  /** Everything under `settings` is refetched when a `settings.changed` event arrives. */
  settings: ['settings'] as const,
  settingsHistory: (key: SettingsKeyInput) =>
    [
      'settings',
      'history',
      key.kind,
      key.scope,
      key.machineId ?? '',
      key.projectId ?? '',
      key.name ?? '',
    ] as const,
};

export const sessionQuery = queryOptions({
  queryKey: keys.session,
  queryFn: async () => {
    try {
      return await api.session();
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 401) return null;
      throw error;
    }
  },
  staleTime: 5 * 60_000,
});

export function useTickets(query: ListTicketsQuery, enabled = true) {
  return useQuery({
    queryKey: keys.ticketList(query),
    queryFn: () => api.listTickets(query),
    enabled,
  });
}

export function useTicket(idOrKey: string | null | undefined) {
  return useQuery({
    queryKey: keys.ticket(idOrKey ?? ''),
    queryFn: () => api.getTicket(idOrKey ?? ''),
    enabled: Boolean(idOrKey),
  });
}

export function useReports(idOrKey: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.reports(idOrKey ?? ''),
    queryFn: () => api.getReports(idOrKey ?? ''),
    enabled: Boolean(idOrKey) && enabled,
  });
}

/** Every open descendant of a ticket (3 levels at most), for the cancel confirmation. */
export async function fetchOpenDescendants(root: Ticket): Promise<Ticket[]> {
  const found: Ticket[] = [];
  let frontier = [root.id];
  for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
    const levels = await Promise.all(frontier.map((parentId) => api.listTickets({ parentId })));
    const level = levels.flat();
    found.push(...level);
    frontier = level.map((ticket) => ticket.id);
  }
  return found.filter((ticket) => ticket.status !== 'done' && ticket.status !== 'cancelled');
}

export function useOpenDescendants(root: Ticket | null, enabled: boolean) {
  return useQuery({
    queryKey: keys.descendants(root?.id ?? ''),
    queryFn: () => (root ? fetchOpenDescendants(root) : Promise.resolve([])),
    enabled: Boolean(root) && enabled,
  });
}

/** Every descendant of a ticket, open and closed, in one call (the "Cây ticket" section). */
export function useTicketTree(ticket: Ticket | null, enabled = true) {
  return useQuery({
    queryKey: keys.tree(ticket?.id ?? ''),
    queryFn: () => api.getTicketTree(ticket?.id ?? ''),
    enabled: Boolean(ticket) && enabled,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: async () => (await api.listProjects()).items,
    staleTime: 30_000,
  });
}

export function useProjectByKey(key: string | undefined): {
  project: Project | undefined;
  isLoading: boolean;
} {
  const projects = useProjects();
  return {
    project: projects.data?.find((p) => p.key === key),
    isLoading: projects.isLoading,
  };
}

/** Recent tickets whose flows include one flow ("Ticket liên quan" on a flow page). */
export function useFlowTickets(projectId: string | undefined, flow: string | null, limit = 10) {
  const query: ListTicketsQuery = { projectId, flow: flow ?? undefined, limit };
  return useQuery({
    queryKey: keys.ticketList(query),
    queryFn: async () => (await api.listTicketsPage(query)).items,
    enabled: Boolean(projectId && flow),
  });
}

/** A project's docs space; also fetched on demand by the docs project switcher. */
export const docsSpaceQuery = (projectId: string) =>
  queryOptions({ queryKey: keys.docsSpace(projectId), queryFn: () => api.getDocsSpace(projectId) });

export function useDocsSpace(projectId: string | undefined) {
  return useQuery({ ...docsSpaceQuery(projectId ?? ''), enabled: Boolean(projectId) });
}

export function useDocsPage(projectId: string | undefined, path: string | null) {
  return useQuery({
    queryKey: keys.docsPage(projectId ?? '', path ?? ''),
    queryFn: () => api.getDocsPage(projectId ?? '', path ?? ''),
    enabled: Boolean(projectId && path),
  });
}

/** Every project's docs status, snapshot, file count and docs-init ticket (the docs home and switcher). */
export function useDocsOverview() {
  return useQuery({ queryKey: keys.docsOverview, queryFn: () => api.getDocsOverview() });
}

/** Docs search across projects: every project when `projectIds` is empty. */
export function useDocsSearchAcross(q: string, projectIds: readonly string[], enabled = true) {
  return useQuery({
    queryKey: keys.docsSearchAcross(q, projectIds),
    queryFn: ({ signal }) => api.searchDocsAcross(q, projectIds, signal),
    enabled: enabled && q.length > 0,
    staleTime: 5_000,
  });
}

export function useDocsSearch(projectId: string | undefined, q: string) {
  return useQuery({
    queryKey: keys.docsSearch(projectId ?? '', q),
    queryFn: ({ signal }) => api.searchDocs(projectId ?? '', q, signal),
    enabled: Boolean(projectId) && q.length > 0,
    staleTime: 5_000,
  });
}

/**
 * Machines refresh on live events and every 30 s (heartbeats do not emit events); `refetchMs` polls faster,
 * e.g. while a saved setting waits for the machines to pick it up.
 */
export function useMachines(refetchMs = 30_000) {
  return useQuery({
    queryKey: keys.machines,
    queryFn: async () => (await api.listMachines()).items,
    refetchInterval: refetchMs,
    staleTime: Math.min(10_000, refetchMs),
  });
}

export function useRuntimeReleases() {
  return useQuery({
    queryKey: keys.runtimeReleases,
    queryFn: () => api.listRuntimeReleases(),
    staleTime: 60_000,
  });
}

export function useMachine(id: string | null) {
  return useQuery({
    queryKey: keys.machine(id ?? ''),
    queryFn: () => api.getMachine(id ?? ''),
    enabled: Boolean(id),
  });
}

export function useMachineNames(): Map<string, Machine> {
  const machines = useMachines();
  return new Map((machines.data ?? []).map((m) => [m.id, m]));
}

/** Ticket ids with an agent job running right now, from the machines' last heartbeat. */
export function useRunningTicketIds(): Set<string> {
  const machines = useMachines();
  const ids = new Set<string>();
  for (const machine of machines.data ?? []) {
    if (!machine.online) continue;
    for (const job of machine.runningJobs) ids.add(job.ticketId);
  }
  return ids;
}

export function useClaimRequests(status?: ClaimRequestStatus) {
  return useQuery({
    queryKey: keys.claims(status),
    queryFn: async () => (await api.listClaimRequests(status)).items,
  });
}

export function useProjectChanges(status?: ProjectChangeStatus) {
  return useQuery({
    queryKey: keys.projectChanges(status),
    queryFn: async () => (await api.listProjectChanges(status)).items,
  });
}

/** "Cài đặt hệ thống": defaults, active revisions, prompt catalog. */
export function useSettingsOverview() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.getSettings() });
}

export function useSettingsHistory(key: SettingsKeyInput, enabled = true) {
  return useQuery({
    queryKey: keys.settingsHistory(key),
    queryFn: async () => (await api.getSettingsHistory(key)).items,
    enabled,
  });
}

/** The newest notices with the owner's read state (kept on the server) and the unread count. */
export function useNotices() {
  return useQuery({ queryKey: keys.notices, queryFn: () => api.listNotices() });
}

/** Refreshes everything a ticket write can change. */
export function invalidateTicketData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.tickets }),
    queryClient.invalidateQueries({ queryKey: ['ticket'] }),
    queryClient.invalidateQueries({ queryKey: ['descendants'] }),
    queryClient.invalidateQueries({ queryKey: ['report'] }),
  ]);
}

/**
 * Writes a changed ticket into every cached list and detail, so the UI updates before the refetch. Write
 * responses carry no agent activity, so the cached one is kept.
 */
function patchCachedTicket(queryClient: QueryClient, ticket: Ticket) {
  const merge = (cached: Ticket): Ticket => ({ ...ticket, agentActivity: cached.agentActivity });
  queryClient.setQueriesData<Ticket[]>({ queryKey: keys.tickets }, (list) =>
    list?.map((item) => (item.id === ticket.id ? merge(item) : item)),
  );
  queryClient.setQueriesData<TicketDetailResponse>({ queryKey: ['ticket'] }, (detail) => {
    if (!detail) return detail;
    if (detail.ticket.id === ticket.id) return { ...detail, ticket: merge(detail.ticket) };
    return {
      ...detail,
      children: detail.children.map((child) => (child.id === ticket.id ? merge(child) : child)),
    };
  });
}

interface TransitionVars {
  ticket: Ticket;
  to: TicketStatus;
}

/**
 * Owner status change. The card moves at once (optimistic); on an error such as REPORT_REQUIRED or an
 * illegal transition every cached list is restored, so the card snaps back.
 */
export function useTransition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ticket, to }: TransitionVars) => api.transition(ticket.id, to),
    onMutate: async ({ ticket, to }: TransitionVars) => {
      await queryClient.cancelQueries({ queryKey: keys.tickets });
      const snapshot = queryClient.getQueriesData<Ticket[]>({ queryKey: keys.tickets });
      queryClient.setQueriesData<Ticket[]>({ queryKey: keys.tickets }, (list) =>
        list?.map((item) => (item.id === ticket.id ? { ...item, status: to } : item)),
      );
      return { snapshot };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: (ticket) => patchCachedTicket(queryClient, ticket),
    onSettled: () => invalidateTicketData(queryClient),
  });
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticket,
      patch,
    }: {
      ticket: Ticket;
      patch: { title?: string; description?: string; priority?: TicketPriority };
    }) => api.updateTicket(ticket.id, patch),
    onSuccess: (ticket) => patchCachedTicket(queryClient, ticket),
    onSettled: () => invalidateTicketData(queryClient),
  });
}

export function useAddComment(ticketKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.addComment(ticketKey, body),
    onSettled: () => invalidateTicketData(queryClient),
  });
}

/** Paste-to-upload of a pasted image (ticket description or comment); does not change ticket state. */
export function useUploadAttachment(ticketIdOrKey: string) {
  return useMutation({
    mutationFn: (body: UploadAttachmentRequest) => api.uploadAttachment(ticketIdOrKey, body),
  });
}
