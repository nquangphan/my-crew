import { EventEnvelope } from '@crew/shared';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { keys } from './queries';

const TICKET_KEYS: QueryKey[] = [keys.tickets, ['ticket'], ['descendants'], ['report']];
const MACHINE_KEYS: QueryKey[] = [keys.machines, ['machine'], ['claims'], keys.notices, keys.projects];

/** The query-key prefixes an owner-stream event makes stale. */
export function invalidationsFor(event: EventEnvelope): QueryKey[] {
  switch (event.payload.type) {
    case 'ticket.assigned':
    case 'ticket.comment_added':
    case 'ticket.status_changed':
    case 'ticket.updated':
    case 'dependency.resolved':
    case 'children.all_done':
    case 'ticket.reopened':
    case 'ticket.unblocked':
    case 'ticket.cancelled':
      return TICKET_KEYS;
    case 'budget.exceeded':
    case 'ticket.stuck':
      return [...TICKET_KEYS, keys.notices];
    case 'machine.claimed':
    case 'claim.requested':
    case 'claim.changed':
    case 'machine.released':
    case 'machine.offline':
    case 'machine.unhealthy':
      // Claims move tickets between machines, so ticket views refresh too.
      return [...MACHINE_KEYS, keys.tickets, ['ticket']];
    case 'project.created':
      return [keys.projects, keys.notices];
    case 'project.change_requested':
      return [['projectChanges'], keys.notices];
    case 'project.change_decided':
      return [keys.projects, ['projectChanges']];
    // Another device read the inbox: the badge and the dots follow.
    case 'inbox.read':
      return [keys.notices];
    case 'docs.synced':
      return [keys.projects, ['docs']];
    default:
      return [];
  }
}

export interface LiveEventsOptions {
  /** Called with every parsed event, after its invalidations are queued. */
  onEvent?: (event: EventEnvelope) => void;
  /** Called when the stream stays closed (e.g. a 401); the app re-checks the session. */
  onClosed?: () => void;
  /** Coalesces bursts of events into one invalidation pass. */
  batchMs?: number;
  /** Delay before re-opening a stream the browser gave up on. */
  retryMs?: number;
  EventSourceImpl?: typeof EventSource;
}

/**
 * Opens the owner SSE stream (`/v1/stream`) and maps events to TanStack Query invalidations.
 * The browser resumes with `Last-Event-ID` on its own reconnects; when it gives up (readyState CLOSED)
 * the stream is re-opened with `?cursor=<last id>`. After any reconnect every query is invalidated,
 * because events can be missed while the connection was down.
 */
export function startLiveEvents(queryClient: QueryClient, options: LiveEventsOptions = {}): () => void {
  const Impl = options.EventSourceImpl ?? globalThis.EventSource;
  const batchMs = options.batchMs ?? 100;
  const retryMs = options.retryMs ?? 3_000;
  let source: EventSource | null = null;
  let lastEventId: string | null = null;
  let opened = false;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, QueryKey>();

  const flush = () => {
    flushTimer = undefined;
    const list = [...pending.values()];
    pending.clear();
    for (const queryKey of list) void queryClient.invalidateQueries({ queryKey });
  };

  const queue = (list: QueryKey[]) => {
    for (const queryKey of list) pending.set(JSON.stringify(queryKey), queryKey);
    if (flushTimer === undefined) flushTimer = setTimeout(flush, batchMs);
  };

  const connect = () => {
    if (stopped || !Impl) return;
    const url = lastEventId ? `/v1/stream?cursor=${encodeURIComponent(lastEventId)}` : '/v1/stream';
    const es = new Impl(url, { withCredentials: true });
    source = es;
    es.onopen = () => {
      if (opened) void queryClient.invalidateQueries();
      opened = true;
    };
    es.onmessage = (message: MessageEvent<string>) => {
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        return;
      }
      const parsed = EventEnvelope.safeParse(data);
      if (!parsed.success) return;
      lastEventId = parsed.data.id;
      queue(invalidationsFor(parsed.data));
      options.onEvent?.(parsed.data);
    };
    es.onerror = () => {
      if (es.readyState !== Impl.CLOSED) return; // the browser retries with Last-Event-ID itself
      es.close();
      source = null;
      options.onClosed?.();
      if (!stopped) retryTimer = setTimeout(connect, retryMs);
    };
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(flushTimer);
    source?.close();
    source = null;
  };
}
