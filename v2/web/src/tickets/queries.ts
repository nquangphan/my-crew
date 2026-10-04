/**
 * Ticket read layer shared by board, list, graph and the ticket dialog. Every view reads the same query keys
 * (`queryKeys.ticket/tickets/comments/decisions/graph`), so one event invalidation refreshes all of them and
 * they show the same revision. Only producer routes that exist are called; typed run projections (machine,
 * model, attempt, evidence) and the full chronology wait for gates G1/G3 and are never derived here.
 */
import { type QueryClient, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { type Actor, isUuid } from '../contracts/http.ts';
import {
  type Comment,
  type Decision,
  decodeCommentPage,
  decodeDecisionPage,
  decodeTicket,
  decodeTicketGraph,
  decodeTicketPage,
  newerTicket,
  type Ticket,
  type TicketGraph,
  type TicketPage,
  type TicketStatus,
  ticketKind,
  ticketStatus,
} from '../contracts/tickets.ts';
import { ApiFailure, getDecoded, type OwnerClient } from '../lib/api.ts';
import { queryKeys } from '../lib/query-keys.ts';
import { mergeTicketPages } from './status.ts';

/** Exactly the filters accepted by GET `/v2/tickets` (`v2/server/src/tickets/routes.ts:199`). */
export type TicketFilters = {
  projectId?: string;
  status?: TicketStatus;
  kind?: Ticket['kind'];
  rootId?: string;
};
export const ticketListPageLimit = 50;
/** Producer maximum page size for comments/decisions (`routes.ts:150`). */
export const historyPageLimit = 100;
const maxHistoryPages = 1000;

function accepts<T>(decoder: (value: unknown) => T, value: unknown): value is T {
  try {
    decoder(value);
    return true;
  } catch {
    return false;
  }
}

/** Keeps only supported filters with valid values, in a fixed key order (stable query key and URL). */
export function parseTicketFilters(search: unknown): TicketFilters {
  if (!search || typeof search !== 'object') return {};
  const source = search as Record<string, unknown>;
  const filters: TicketFilters = {};
  if (isUuid(source.projectId)) filters.projectId = source.projectId.toLowerCase();
  if (accepts(ticketStatus, source.status)) filters.status = source.status;
  if (accepts(ticketKind, source.kind)) filters.kind = source.kind;
  if (isUuid(source.rootId)) filters.rootId = source.rootId.toLowerCase();
  return filters;
}

function filterRecord(filters: TicketFilters): Record<string, string> {
  return { ...parseTicketFilters(filters) } as Record<string, string>;
}

export function ticketListPath(filters: TicketFilters, cursor: string | null): string {
  if (cursor !== null && !isUuid(cursor)) throw new ApiFailure(null, 'CURSOR_INVALID', 'local');
  const params = new URLSearchParams(filterRecord(filters));
  if (cursor) params.set('cursor', cursor);
  params.set('limit', String(ticketListPageLimit));
  return `/v2/tickets?${params.toString()}`;
}

function ticketPath(ticketId: string, suffix = ''): string {
  if (!isUuid(ticketId)) throw new ApiFailure(null, 'TICKET_ID_INVALID', 'local');
  return `/v2/tickets/${ticketId}${suffix}`;
}

export function fetchTicketPage(
  client: OwnerClient,
  filters: TicketFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<TicketPage> {
  return getDecoded(client, ticketListPath(filters, cursor), decodeTicketPage, signal);
}

/** Infinite list: one page per explicit “Tải thêm”, until the producer's `nextCursor` is null. */
export function ticketListOptions(client: OwnerClient, filters: TicketFilters) {
  return {
    queryKey: queryKeys.tickets(filterRecord(filters)),
    queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) =>
      fetchTicketPage(client, filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: TicketPage): string | undefined => last.nextCursor ?? undefined,
    retry: false as const,
  };
}

/** Single ticket with a revision guard: an older response never replaces a newer cached row. */
export function ticketQueryOptions(client: OwnerClient, cache: QueryClient, ticketId: string) {
  const queryKey = queryKeys.ticket(ticketId);
  return {
    queryKey,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Ticket> => {
      const incoming = await getDecoded(client, ticketPath(ticketId), decodeTicket, signal);
      return newerTicket(cache.getQueryData<Ticket>(queryKey), incoming);
    },
    retry: false as const,
  };
}

type HistoryItem = { comment: Comment; decision: Decision };
const historyDecoders = { comment: decodeCommentPage, decision: decodeDecisionPage } as const;

/**
 * Reads every page of a legacy UUID-cursor collection. Chronology needs the whole set because the producer
 * orders by UUID, not by time. A repeated cursor stops the loop instead of spinning.
 */
export async function fetchAllPages<K extends keyof HistoryItem>(
  client: OwnerClient,
  path: string,
  kind: K,
  signal?: AbortSignal,
): Promise<HistoryItem[K][]> {
  const decoder = historyDecoders[kind] as (value: unknown) => {
    items: HistoryItem[K][];
    nextCursor: string | null;
  };
  const items: HistoryItem[K][] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let pageIndex = 0; pageIndex < maxHistoryPages; pageIndex++) {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('limit', String(historyPageLimit));
    const page = await getDecoded(client, `${path}?${params.toString()}`, decoder, signal);
    items.push(...page.items);
    if (page.nextCursor === null) return items;
    if (seen.has(page.nextCursor)) throw new ApiFailure(null, 'PAGE_CURSOR_LOOP', 'shape');
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new ApiFailure(null, 'HISTORY_TOO_LARGE', 'shape');
}

export type TimelineEntry =
  | { source: 'comment'; id: string; actor: Actor; createdAt: string; text: string }
  | {
      source: 'decision';
      id: string;
      actor: Actor;
      createdAt: string;
      kind: Decision['kind'];
      content: string;
      rationale: string;
      sources: Decision['sources'];
    };

function instant(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

/** Merges fully-read comments and decisions by `createdAt`, then `id`; unparsable times sort last. */
export function buildLegacyTimeline(
  comments: readonly Comment[],
  decisions: readonly Decision[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...comments.map((row) => ({
      source: 'comment' as const,
      id: row.id,
      actor: row.actor,
      createdAt: row.createdAt,
      text: row.text,
    })),
    ...decisions.map((row) => ({
      source: 'decision' as const,
      id: row.id,
      actor: row.actor,
      createdAt: row.createdAt,
      kind: row.kind,
      content: row.content,
      rationale: row.rationale,
      sources: row.sources,
    })),
  ];
  return entries.sort((a, b) => {
    const delta = instant(a.createdAt) - instant(b.createdAt);
    if (delta !== 0 && !Number.isNaN(delta)) return delta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : a.source.localeCompare(b.source);
  });
}

const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `HH:mm dd/MM/yyyy` in Asia/Ho_Chi_Minh; an unparsable value is shown as received. */
export function formatTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const parts = Object.fromEntries(timeFormat.formatToParts(parsed).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}/${parts.year}`;
}

export function actorLabel(actor: Actor): string {
  return actor.kind === 'owner' ? 'Chủ dự án' : `Máy ${actor.id.slice(0, 8)}`;
}

/**
 * Hooks take the app runtime's single `OwnerClient` (`useRuntime().client`) from the calling component, so
 * this module stays free of the app composition root.
 */
export function useTicket(client: OwnerClient, ticketId: string) {
  const cache = useQueryClient();
  return useQuery(ticketQueryOptions(client, cache, ticketId));
}

export function useTicketList(client: OwnerClient, filters: TicketFilters) {
  const query = useInfiniteQuery(ticketListOptions(client, filters));
  const tickets = useMemo(
    () => mergeTicketPages(query.data?.pages.map((page) => page.items) ?? []),
    [query.data],
  );
  return { query, tickets };
}

export function useTicketHistory(client: OwnerClient, ticketId: string) {
  const comments = useQuery({
    queryKey: queryKeys.comments(ticketId),
    queryFn: ({ signal }) => fetchAllPages(client, ticketPath(ticketId, '/comments'), 'comment', signal),
    retry: false,
  });
  const decisions = useQuery({
    queryKey: queryKeys.decisions(ticketId),
    queryFn: ({ signal }) => fetchAllPages(client, ticketPath(ticketId, '/decisions'), 'decision', signal),
    retry: false,
  });
  const entries = useMemo(
    () => (comments.data && decisions.data ? buildLegacyTimeline(comments.data, decisions.data) : undefined),
    [comments.data, decisions.data],
  );
  return {
    entries,
    error: comments.error ?? decisions.error,
    isPending: comments.isPending || decisions.isPending,
    refetch: () => Promise.all([comments.refetch(), decisions.refetch()]),
  };
}

/** Whole-root graph (`/v2/tickets/:rootId/graph`); used here only to list direct children. */
export function useTicketGraph(client: OwnerClient, rootId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.graph(rootId ?? ''),
    queryFn: ({ signal }): Promise<TicketGraph> =>
      getDecoded(client, ticketPath(rootId ?? '', '/graph'), decodeTicketGraph, signal),
    enabled: rootId !== undefined,
    retry: false,
  });
}
