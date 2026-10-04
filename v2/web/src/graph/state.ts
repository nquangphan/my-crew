/**
 * View state of the ticket map, one per root and tab. Closing the ticket dialog only clears the selection, so
 * the viewport, expanded steps and focused node survive; realtime updates never touch it. The state is kept in
 * the runtime's tab storage under `crew-v2:map-view:<rootId>` (UI state only: IDs and numbers, no content or
 * credential), so reload and Back/Forward return to the same view. Stored data is validated on read.
 */
import { isUuid } from '../contracts/http.ts';
import type { TabStorage } from '../lib/pending-operation.ts';

export type MapViewport = { x: number; y: number; zoom: number };
export type MapViewState = {
  rootId: string;
  viewport: MapViewport;
  expanded: string[];
  selectedTicketId: string | null;
  focusedTicketId: string | null;
};
/** Route search of the map: `root` picks the request tree, `ticket` is the ticket open in the shared dialog. */
export type MapSearch = { root?: string; ticket?: string };

/** Zoom bounds shared with the ReactFlow instance. */
export const minZoom = 0.1;
export const maxZoom = 4;
const maxOffset = 1e7;

export function initialMapView(rootId: string): MapViewState {
  return {
    rootId,
    viewport: { x: 0, y: 0, zoom: 1 },
    expanded: [],
    selectedTicketId: null,
    focusedTicketId: null,
  };
}

/** Close keeps everything but the selection: the view behind the dialog is exactly the one the owner left. */
export function closeMapDialog(state: MapViewState): MapViewState {
  return { ...state, selectedTicketId: null };
}

export function openMapDialog(state: MapViewState, ticketId: string): MapViewState {
  return { ...state, selectedTicketId: ticketId, focusedTicketId: ticketId };
}

export function moveMapViewport(state: MapViewState, viewport: MapViewport): MapViewState {
  return { ...state, viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } };
}

export function setMapExpanded(state: MapViewState, ids: readonly string[]): MapViewState {
  return { ...state, expanded: [...new Set(ids)].sort() };
}

export function toggleMapExpanded(state: MapViewState, ticketId: string): MapViewState {
  const next = state.expanded.includes(ticketId)
    ? state.expanded.filter((id) => id !== ticketId)
    : [...state.expanded, ticketId];
  return setMapExpanded(state, next);
}

export function mapViewStorageKey(rootId: string): string {
  return `crew-v2:map-view:${rootId}`;
}

const finite = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
const optionalId = (value: unknown): value is string | null => value === null || isUuid(value);

function decodeView(raw: unknown, rootId: string): MapViewState | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const viewport = row.viewport as Record<string, unknown> | null | undefined;
  if (row.rootId !== rootId || !viewport || typeof viewport !== 'object') return null;
  if (!finite(viewport.x, maxOffset) || !finite(viewport.y, maxOffset) || !finite(viewport.zoom, maxZoom))
    return null;
  if (viewport.zoom < minZoom) return null;
  if (!Array.isArray(row.expanded) || !row.expanded.every((id) => isUuid(id))) return null;
  if (!optionalId(row.selectedTicketId) || !optionalId(row.focusedTicketId)) return null;
  return {
    rootId,
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
    expanded: [...row.expanded],
    selectedTicketId: row.selectedTicketId,
    focusedTicketId: row.focusedTicketId,
  };
}

/** Stored view of one root, or null when there is none (a new root is fitted once) or it is malformed. */
export function readMapView(
  storage: Pick<TabStorage, 'getItem'> | null,
  rootId: string,
): MapViewState | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(mapViewStorageKey(rootId));
    return text === null ? null : decodeView(JSON.parse(text), rootId);
  } catch {
    return null;
  }
}

/** Best effort: a missing or full storage leaves the in-memory view working. */
export function writeMapView(storage: Pick<TabStorage, 'setItem'> | null, state: MapViewState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(mapViewStorageKey(state.rootId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Only lower-case UUIDs survive; anything else is dropped before it can reach a request. */
export function parseMapSearch(search: unknown): MapSearch {
  if (!search || typeof search !== 'object') return {};
  const source = search as Record<string, unknown>;
  const result: MapSearch = {};
  if (isUuid(source.root)) result.root = source.root.toLowerCase();
  if (isUuid(source.ticket)) result.ticket = source.ticket.toLowerCase();
  return result;
}

/** History-state key the map writes on the entry it pushes when it opens a dialog (value: the root ID). */
export const mapDialogStateKey = 'crewMapDialog';

/**
 * How to close the dialog: go back only when the current history entry is the one this root's map pushed
 * (so the previous entry is the map itself); a deep link, a reload of another entry or anything pushed by
 * someone else is closed by replacing the entry.
 */
export function closeMapDialogNavigation(historyState: unknown, rootId: string): 'back' | 'replace' {
  if (!historyState || typeof historyState !== 'object') return 'replace';
  return (historyState as Record<string, unknown>)[mapDialogStateKey] === rootId ? 'back' : 'replace';
}
