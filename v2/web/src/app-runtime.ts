/**
 * Composition root of one app mount: a single QueryClient, session, pending store, owner client and event
 * stream. `wireSession` registers its listeners here, before any React subscriber exists, so the stream is
 * started (and its catch-up request issued) before the first protected view can fetch data.
 */
import { QueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { wireSession } from './auth/session-boundary.tsx';
import type { ComposeServices } from './compose/composer.tsx';
import { isUuid } from './contracts/http.ts';
import { createOwnerClient, type OwnerClient } from './lib/api.ts';
import { EventSync, tabCursorStore } from './lib/events.ts';
import { PendingStore, type TabStorage } from './lib/pending-operation.ts';
import { appBasePath, type HttpFetch, SessionController, safeReturnPath } from './lib/session.ts';
import { clearTicketDrafts } from './tickets/create-request-state.ts';
import { parseTicketFilters, type TicketFilters } from './tickets/queries.ts';

export type AppRuntime = {
  queryClient: QueryClient;
  session: SessionController;
  pending: PendingStore;
  client: OwnerClient;
  events: EventSync;
  /** What `ComposeServicesProvider` needs; built once from this runtime's own client, pending store and session. */
  composeServices: ComposeServices;
  dispose(): void;
};

/**
 * `retry` is off because `OwnerClient.get` already retries (up to 3 times with backoff); a second layer
 * would multiply the attempts. Focus and reconnect refetch stale data after the user returns.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: true, refetchOnReconnect: true },
      mutations: { retry: false },
    },
  });
}

export function createAppRuntime(
  options: {
    fetch?: HttpFetch;
    storage?: (TabStorage & Pick<Storage, 'getItem' | 'setItem'>) | null;
    window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  } = {},
): AppRuntime {
  const storage = options.storage ?? null;
  const queryClient = createQueryClient();
  const session = new SessionController({ fetch: options.fetch });
  const pending = new PendingStore(storage);
  const client = createOwnerClient({ session, pending, fetch: options.fetch });
  const events = new EventSync({
    fetch: options.fetch,
    session,
    cursorStore: tabCursorStore(storage),
    invalidate: (keys) => Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
  const composeServices: ComposeServices = { client, pending, session, storage };
  const unwire = wireSession({ session, pending, cache: queryClient, events, window: options.window });
  // Form and comment drafts live in tab storage and may belong to a page that never opened a draft store
  // (reload without opening a ticket), so logout wipes them here rather than from a component.
  const offLogout = session.onLogout(() => clearTicketDrafts(storage));
  return {
    queryClient,
    session,
    pending,
    client,
    events,
    composeServices,
    dispose() {
      offLogout();
      unwire();
      events.stop();
    },
  };
}

/** Browser app path (`/crew-v2/...`) for a router location whose pathname has no base path. */
export function internalReturnPath(location: {
  pathname: string;
  searchStr?: string;
  hash?: string;
}): string {
  const base = appBasePath.slice(0, -1);
  const hash = location.hash ? `#${location.hash.replace(/^#/, '')}` : '';
  return safeReturnPath(`${base}${location.pathname}${location.searchStr ?? ''}${hash}`);
}

export type RouteAccess = { allowed: true } | { allowed: false; returnTo: string };

/** Protected-route gate: waits for the initial session check, then allows only an authenticated owner. */
export async function authorizeRoute(
  session: SessionController,
  location: { pathname: string; searchStr?: string; hash?: string },
): Promise<RouteAccess> {
  await session.bootstrap();
  if (session.snapshot().state === 'authenticated') return { allowed: true };
  return { allowed: false, returnTo: internalReturnPath(location) };
}

/** Login route search: any `returnTo` that is not an internal `/crew-v2/` path becomes the app root. */
export function parseLoginSearch(search: Record<string, unknown>): { returnTo: string } {
  return { returnTo: safeReturnPath(typeof search.returnTo === 'string' ? search.returnTo : null) };
}

export const ticketViews = ['board', 'list', 'requests'] as const;
export type TicketView = (typeof ticketViews)[number];
export type TicketsSearch = { view: TicketView } & Omit<TicketFilters, 'projectId'>;

/**
 * Project tickets route search: `view` defaults to the board; only the producer's filters survive, with
 * invalid values dropped. `projectId` comes from the path, never from the search.
 */
export function parseTicketsSearch(search: Record<string, unknown>): TicketsSearch {
  const { projectId: _ignored, ...filters } = parseTicketFilters({ ...search, projectId: undefined });
  const view = ticketViews.find((candidate) => candidate === search.view) ?? 'board';
  return { view, ...filters };
}

export type DocsSearch = { path?: string };

/** Docs route search: only a non-empty string `path` of sane length survives; the docs view validates it further. */
export function parseDocsSearch(search: Record<string, unknown>): DocsSearch {
  const { path } = search;
  return typeof path === 'string' && path.length > 0 && path.length <= 1024 ? { path } : {};
}

/** Ticket and project ids in the path are UUIDs; anything else is a not-found view, never an unfiltered list. */
export function routeUuid(value: string | undefined): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

export const RuntimeContext = createContext<AppRuntime | null>(null);

export function useRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('APP_RUNTIME_MISSING');
  return runtime;
}
