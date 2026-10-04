/**
 * Journal event sync: catch-up through GET `/v2/events?after=&limit=100` until empty, then one fetch-based
 * SSE stream per app/session with `Last-Event-ID`. Events only mark queries stale; event payloads are never
 * merged into business data. Cursors stay decimal strings compared with BigInt.
 */
import { decodeEventPage, decodeJournalEvent, isCursor, type JournalEvent } from '../contracts/http.ts';
import { queryRoots } from './query-keys.ts';
import type { HttpFetch } from './session.ts';

export type { JournalEvent } from '../contracts/http.ts';
export type QueryKeyPrefix = readonly unknown[];
export type SseFrame = { id: string | null; event: string; data: string };
export type SyncStatus = 'idle' | 'catching_up' | 'live' | 'reconnecting' | 'failed' | 'stopped';
export type CursorStore = { read(): string | null; write(cursor: string): void };
export type SyncSession = { signal(): AbortSignal; expire(): void };

export const maxSseFrameBytes = 1024 * 1024;
const eventPageLimit = 100;
const stableStreamMs = 30_000;
const maxBackoffMs = 30_000;

export function compareCursor(a: string, b: string): -1 | 0 | 1 {
  if (!isCursor(a) || !isCursor(b)) throw new Error('CURSOR_INVALID');
  const left = BigInt(a);
  const right = BigInt(b);
  return left === right ? 0 : left > right ? 1 : -1;
}

/**
 * Query prefixes made stale by one event. Known types map to the views they change; an unknown type is
 * invalidated broadly inside its scope (ticket → project → machine → whole cache), never dropped.
 */
export function invalidations(event: JournalEvent): readonly QueryKeyPrefix[] {
  const { type, projectId, ticketId, audienceMachineId: machineId } = event;
  const ticketViews = (): QueryKeyPrefix[] => [
    ...(ticketId ? [queryRoots.ticket(ticketId)] : []),
    queryRoots.graphs,
    queryRoots.tickets,
    queryRoots.attention,
  ];
  const machineViews = (id: string): QueryKeyPrefix[] => [
    queryRoots.machine(id),
    queryRoots.modelSources(id),
    queryRoots.models(id),
    queryRoots.gatewayStatus(id),
  ];
  switch (type) {
    case 'ticket.created':
    case 'ticket.changed':
    case 'dependency.added':
    case 'repair.recorded':
      return ticketViews();
    case 'comment.created':
      return [...(ticketId ? [queryRoots.comments(ticketId)] : []), ...ticketViews()];
    case 'decision.created':
      return [...(ticketId ? [queryRoots.decisions(ticketId)] : []), ...ticketViews()];
    case 'command.created':
    case 'command.acknowledged':
    case 'attempt.claimed':
    case 'attempt.checkpoint':
    case 'attempt.stopped':
    case 'attempt.finalized':
      return [...ticketViews(), ...(machineId ? machineViews(machineId) : [])];
    case 'project.created':
      return [queryRoots.projects, ...(projectId ? [queryRoots.project(projectId)] : [])];
    case 'project.bound':
      return [
        queryRoots.projects,
        queryRoots.machines,
        ...(projectId ? [queryRoots.project(projectId)] : []),
      ];
    case 'docs.synced':
      return projectId
        ? [
            queryRoots.docs(projectId),
            queryRoots.docsSearch,
            queryRoots.project(projectId),
            queryRoots.projects,
          ]
        : [queryRoots.allDocs, queryRoots.docsSearch, queryRoots.projects];
    case 'docs.imported':
      return [queryRoots.allDocs, queryRoots.docsSearch, queryRoots.projects];
    case 'machine.provisioned':
      return [queryRoots.machines];
    case 'attachment.changed':
    case 'attachment.input.changed':
      return ticketId
        ? [queryRoots.attachments(ticketId), queryRoots.ticket(ticketId), queryRoots.attention]
        : [queryRoots.allAttachments, queryRoots.attention];
    case 'source.desired':
    case 'source.applied':
    case 'gateway.config.changed':
    case 'gateway.booted':
    case 'gateway.install.reported':
    case 'gateway.command.created':
    case 'gateway.command.acknowledged':
      if (machineId) return [queryRoots.machines, ...machineViews(machineId)];
      break;
  }
  if (ticketId)
    return [
      ...ticketViews(),
      ...(projectId ? [queryRoots.project(projectId), queryRoots.docs(projectId)] : []),
    ];
  if (projectId)
    return [
      queryRoots.project(projectId),
      queryRoots.projects,
      queryRoots.docs(projectId),
      queryRoots.tickets,
      queryRoots.graphs,
      queryRoots.attention,
    ];
  if (machineId) return [queryRoots.machines, ...machineViews(machineId)];
  return [queryRoots.all];
}

export class SseProtocolError extends Error {
  readonly code: 'FRAME_TOO_LARGE' | 'UTF8_INVALID' | 'EVENT_INVALID';

  constructor(code: SseProtocolError['code']) {
    super(`SSE_${code}`);
    this.name = 'SseProtocolError';
    this.code = code;
  }
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Incremental `text/event-stream` parser: strict UTF-8 across chunk boundaries, CRLF/CR/LF line endings
 * (including CRLF split between chunks), comments, multi-line data and a byte bound per frame.
 */
export class SseParser {
  readonly #onFrame: (frame: SseFrame) => void;
  readonly #maxBytes: number;
  readonly #decoder = new TextDecoder('utf-8', { fatal: true });
  #buffer = '';
  #bufferBytes = 0;
  #frameBytes = 0;
  #pendingCR = false;
  #data: string[] = [];
  #event = '';
  #id: string | null = null;

  constructor(onFrame: (frame: SseFrame) => void, maxFrameBytes = maxSseFrameBytes) {
    this.#onFrame = onFrame;
    this.#maxBytes = maxFrameBytes;
  }

  push(chunk: Uint8Array): void {
    let text: string;
    try {
      text = this.#decoder.decode(chunk, { stream: true });
    } catch {
      throw new SseProtocolError('UTF8_INVALID');
    }
    this.#consume(text);
  }

  /** Stream finished: flush the decoder; an unterminated frame is discarded per the SSE spec. */
  end(): void {
    let rest: string;
    try {
      rest = this.#decoder.decode();
    } catch {
      throw new SseProtocolError('UTF8_INVALID');
    }
    this.#consume(rest);
  }

  #consume(text: string): void {
    let start = 0;
    if (this.#pendingCR && text.length > 0) {
      if (text.charCodeAt(0) === 10) start = 1;
      this.#pendingCR = false;
    }
    for (let index = start; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code !== 10 && code !== 13) continue;
      const line = this.#buffer + text.slice(start, index);
      this.#buffer = '';
      this.#bufferBytes = 0;
      if (code === 13) {
        if (index + 1 < text.length) {
          if (text.charCodeAt(index + 1) === 10) index++;
        } else this.#pendingCR = true;
      }
      this.#line(line);
      start = index + 1;
    }
    const tail = text.slice(start);
    this.#buffer += tail;
    this.#bufferBytes += utf8Length(tail);
    if (this.#frameBytes + this.#bufferBytes > this.#maxBytes) throw new SseProtocolError('FRAME_TOO_LARGE');
  }

  #line(line: string): void {
    this.#frameBytes += utf8Length(line) + 1;
    if (this.#frameBytes > this.#maxBytes) throw new SseProtocolError('FRAME_TOO_LARGE');
    if (line === '') {
      this.#dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.#data.push(value);
    else if (field === 'event') this.#event = value;
    else if (field === 'id' && !value.includes('\u0000')) this.#id = value;
  }

  #dispatch(): void {
    const frame = this.#data.length
      ? { id: this.#id, event: this.#event || 'message', data: this.#data.join('\n') }
      : null;
    this.#data = [];
    this.#event = '';
    this.#id = null;
    this.#frameBytes = 0;
    if (frame) this.#onFrame(frame);
  }
}

export const eventCursorStorageKey = 'crew-v2:event-cursor';

export function tabCursorStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null): CursorStore {
  let memory: string | null = null;
  return {
    read: () => {
      const value = storage?.getItem(eventCursorStorageKey) ?? memory;
      return isCursor(value) ? value : null;
    },
    write: (cursor) => {
      memory = cursor;
      storage?.setItem(eventCursorStorageKey, cursor);
    },
  };
}

class AuthLost extends Error {}
class StreamEnded extends Error {}

export type EventSyncOptions = {
  fetch?: HttpFetch;
  session: SyncSession;
  invalidate: (keys: readonly QueryKeyPrefix[]) => Promise<unknown> | unknown;
  cursorStore?: CursorStore;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  maxFailures?: number;
  invalidationRetryMs?: number;
};

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export class EventSync {
  readonly #fetch: HttpFetch;
  readonly #session: SyncSession;
  readonly #invalidate: EventSyncOptions['invalidate'];
  readonly #cursorStore: CursorStore;
  readonly #sleep: NonNullable<EventSyncOptions['sleep']>;
  readonly #now: () => number;
  readonly #maxFailures: number;
  readonly #retryMs: number;
  readonly #listeners = new Set<() => void>();
  readonly #queue = new Map<string, QueryKeyPrefix>();
  #inFlight = 0;
  #flushing = false;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #status: SyncStatus = 'idle';
  #applied: string;
  #run: AbortController | null = null;

  constructor(options: EventSyncOptions) {
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#session = options.session;
    this.#invalidate = options.invalidate;
    this.#cursorStore = options.cursorStore ?? tabCursorStore(null);
    this.#sleep = options.sleep ?? abortableDelay;
    this.#now = options.now ?? Date.now;
    this.#maxFailures = options.maxFailures ?? 6;
    this.#retryMs = options.invalidationRetryMs ?? 1000;
    const stored = this.#cursorStore.read();
    this.#applied = isCursor(stored) ? stored : '0';
  }

  status(): SyncStatus {
    return this.#status;
  }

  applied(): string {
    return this.#applied;
  }

  /** Invalidations enqueued or in flight; non-zero after a failed refetch until a retry succeeds. */
  pendingInvalidations(): number {
    return this.#queue.size + this.#inFlight;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Idempotent: a running sync keeps its single stream. Call before the first data GET of a session. */
  start(): void {
    if (this.#run && !this.#run.signal.aborted) return;
    const run = new AbortController();
    this.#run = run;
    void this.#loop(run.signal);
  }

  stop(): void {
    this.#run?.abort();
    this.#run = null;
    clearTimeout(this.#retryTimer);
    this.#setStatus('stopped');
  }

  /** Manual retry after the bounded reconnect budget ran out. */
  retry(): void {
    if (this.#status === 'failed') this.start();
  }

  async #loop(runSignal: AbortSignal): Promise<void> {
    let failures = 0;
    let connected = false;
    while (!runSignal.aborted) {
      const connection = new AbortController();
      const signal = AbortSignal.any([runSignal, this.#session.signal(), connection.signal]);
      try {
        this.#setStatus(connected ? 'reconnecting' : 'catching_up');
        await this.#catchUp(signal);
        if (connected) this.#enqueue([queryRoots.all]);
        connected = true;
        const healthy = await this.#stream(signal);
        if (healthy) failures = 0;
        throw new StreamEnded();
      } catch (error) {
        if (runSignal.aborted) return;
        if (error instanceof AuthLost || this.#session.signal().aborted) {
          this.#run = null;
          this.#setStatus('stopped');
          if (error instanceof AuthLost) this.#session.expire();
          return;
        }
        failures++;
        if (failures >= this.#maxFailures) {
          this.#run = null;
          this.#setStatus('failed');
          return;
        }
        this.#setStatus('reconnecting');
        await this.#sleep(Math.min(1000 * 2 ** (failures - 1), maxBackoffMs), runSignal);
      } finally {
        connection.abort();
      }
    }
  }

  async #catchUp(signal: AbortSignal): Promise<void> {
    for (;;) {
      const response = await this.#fetch(`/v2/events?after=${this.#applied}&limit=${eventPageLimit}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal,
      });
      if (response.status === 401) throw new AuthLost();
      if (!response.ok) throw new Error(`EVENTS_HTTP_${response.status}`);
      const page = decodeEventPage(await response.json());
      if (page.items.length === 0) return;
      const before = this.#applied;
      for (const event of page.items) this.#apply(event);
      if (compareCursor(this.#applied, before) <= 0) throw new Error('EVENTS_NO_PROGRESS');
    }
  }

  /** Returns true when the stream delivered events or stayed open long enough to reset the failure budget. */
  async #stream(signal: AbortSignal): Promise<boolean> {
    const opened = this.#now();
    const response = await this.#fetch('/v2/events/stream', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'text/event-stream', 'last-event-id': this.#applied },
      signal,
    });
    if (response.status === 401) throw new AuthLost();
    if (!response.ok || !response.body) throw new Error(`EVENTS_STREAM_HTTP_${response.status}`);
    this.#setStatus('live');
    let delivered = false;
    const parser = new SseParser((frame) => {
      let event: JournalEvent;
      try {
        event = decodeJournalEvent(JSON.parse(frame.data));
      } catch {
        throw new SseProtocolError('EVENT_INVALID');
      }
      if (frame.event !== event.type || frame.id !== event.cursor)
        throw new SseProtocolError('EVENT_INVALID');
      this.#apply(event);
      delivered = true;
    });
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(value);
      }
      parser.end();
    } finally {
      void reader.cancel().catch(() => undefined);
    }
    return delivered || this.#now() - opened >= stableStreamMs;
  }

  /** Dedup by BigInt cursor; persist the cursor only after its invalidations are enqueued. */
  #apply(event: JournalEvent): void {
    if (compareCursor(event.cursor, this.#applied) <= 0) return;
    this.#enqueue(invalidations(event));
    this.#applied = event.cursor;
    this.#cursorStore.write(event.cursor);
  }

  #enqueue(keys: readonly QueryKeyPrefix[]): void {
    for (const key of keys) this.#queue.set(JSON.stringify(key), key);
    queueMicrotask(() => void this.#flush());
  }

  async #flush(): Promise<void> {
    if (this.#flushing) return;
    this.#flushing = true;
    try {
      while (this.#queue.size > 0) {
        const batch = [...this.#queue.entries()];
        this.#queue.clear();
        this.#inFlight = batch.length;
        try {
          await this.#invalidate(batch.map(([, key]) => key));
        } catch {
          for (const [id, key] of batch) if (!this.#queue.has(id)) this.#queue.set(id, key);
          clearTimeout(this.#retryTimer);
          this.#retryTimer = setTimeout(() => void this.#flush(), this.#retryMs);
          return;
        } finally {
          this.#inFlight = 0;
          this.#notify();
        }
      }
    } finally {
      this.#flushing = false;
    }
  }

  #setStatus(status: SyncStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
