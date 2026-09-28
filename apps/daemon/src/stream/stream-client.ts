import { EventEnvelope, StreamCursor } from '@crew/shared';
import type { VpsClient } from '../api/vps-client.js';
import type { StateDb } from '../state-db.js';
import { type DispatchEffect, dispatchEvent } from './dispatcher.js';

export interface StreamClientOptions {
  vps: VpsClient;
  state: StateDb;
  /** Called after each event's transaction committed. */
  onEffect: (effect: DispatchEffect, envelope: EventEnvelope) => void;
  /** Called after each (re)connect, so the scheduler re-checks waiting jobs. */
  onConnected?: () => void;
  onError?: (error: Error) => void;
  fetch?: typeof fetch;
  /** First reconnect delay; doubles up to `maxBackoffMs`, with full jitter. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** No byte for this long (the server pings every 20 s) means a dead connection. */
  idleTimeoutMs?: number;
  /** Test hook: runs inside the event transaction after the job write and before the cursor write. */
  beforeCursorWrite?: (envelope: EventEnvelope) => void;
}

interface SseFrame {
  id: string | null;
  data: string;
}

/** Splits an SSE byte stream into frames (`id:` and `data:` fields; comments are skipped). */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  const normalized = buffer.replace(/\r\n/g, '\n');
  let rest = normalized;
  let split = rest.indexOf('\n\n');
  while (split >= 0) {
    const block = rest.slice(0, split);
    rest = rest.slice(split + 2);
    let id: string | null = null;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':') || line === '') continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id') id = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0 || id !== null) frames.push({ id, data: data.join('\n') });
    split = rest.indexOf('\n\n');
  }
  return { frames, rest };
}

const isNewer = (id: string, cursor: string | null) => cursor === null || BigInt(id) > BigInt(cursor);

/**
 * Keeps `GET /v1/daemon/stream` open and resumes from the saved cursor with `Last-Event-ID`. Each event is
 * applied in one SQLite transaction together with the cursor advance, so a crash at any point either keeps
 * the job write and the new cursor, or neither (the event is then replayed).
 */
export class StreamClient {
  private controller: AbortController | null = null;
  private stopped = true;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  connected = false;
  lastEventAt: Date | null = null;

  constructor(private readonly options: StreamClientOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.controller?.abort();
    this.wake?.();
    await this.loop;
    this.loop = null;
  }

  /** Applies one event: dispatch plus cursor advance, atomically. Duplicates below the cursor are skipped. */
  applyEnvelope(envelope: EventEnvelope): DispatchEffect | null {
    const { state } = this.options;
    const effect = state.transaction(() => {
      if (!isNewer(envelope.id, state.getCursor())) return null;
      const result = dispatchEvent(state, envelope);
      this.options.beforeCursorWrite?.(envelope);
      state.setCursor(envelope.id);
      return result;
    });
    if (effect) {
      this.lastEventAt = new Date();
      try {
        this.options.onEffect(effect, envelope);
      } catch (error) {
        // The event is committed; a failing side effect must not tear down the stream.
        this.options.onError?.(error as Error);
      }
    }
    return effect;
  }

  /** An event this daemon cannot parse still advances the cursor, so it cannot wedge the stream. */
  private skipUnknown(id: string): void {
    const { state } = this.options;
    state.transaction(() => {
      if (isNewer(id, state.getCursor())) state.setCursor(id);
    });
  }

  private async run(): Promise<void> {
    const min = this.options.minBackoffMs ?? 1_000;
    const max = this.options.maxBackoffMs ?? 30_000;
    let failures = 0;
    while (!this.stopped) {
      try {
        const receivedAny = await this.connectOnce();
        if (receivedAny) failures = 0;
      } catch (error) {
        if (this.stopped) break;
        this.options.onError?.(error as Error);
      }
      this.connected = false;
      if (this.stopped) break;
      failures += 1;
      const ceiling = Math.min(max, min * 2 ** Math.min(failures - 1, 16));
      await this.sleep(Math.round(Math.random() * ceiling));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }

  /** One connection. Resolves when the server ends the stream; true when it delivered anything. */
  private async connectOnce(): Promise<boolean> {
    const { vps, state } = this.options;
    this.controller = new AbortController();
    const cursor = state.getCursor();
    const headers: Record<string, string> = { ...vps.authHeader(), accept: 'text/event-stream' };
    if (cursor && StreamCursor.safeParse(cursor).success) headers['last-event-id'] = cursor;
    const fetchImpl = this.options.fetch ?? fetch;
    const response = await fetchImpl(`${vps.apiUrl}/v1/daemon/stream`, {
      headers,
      signal: this.controller.signal,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`stream refused: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    this.connected = true;
    this.options.onConnected?.();
    const idleMs = this.options.idleTimeoutMs ?? 60_000;
    let idle = setTimeout(() => this.controller?.abort(), idleMs);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedAny = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedAny = true;
        clearTimeout(idle);
        idle = setTimeout(() => this.controller?.abort(), idleMs);
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = parseSseFrames(buffer);
        buffer = rest;
        for (const frame of frames) this.handleFrame(frame);
      }
    } catch (error) {
      if (!this.stopped && !this.controller.signal.aborted) throw error;
    } finally {
      clearTimeout(idle);
      reader.releaseLock();
    }
    return receivedAny;
  }

  private handleFrame(frame: SseFrame): void {
    if (frame.data === '') return;
    let raw: unknown;
    try {
      raw = JSON.parse(frame.data);
    } catch {
      raw = null;
    }
    const parsed = EventEnvelope.safeParse(raw);
    if (parsed.success) {
      this.applyEnvelope(parsed.data);
      return;
    }
    const id = frame.id ?? (raw as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && StreamCursor.safeParse(id).success) {
      this.options.onError?.(
        new Error(`skipped event ${id}: ${parsed.error.issues[0]?.message ?? 'invalid'}`),
      );
      this.skipUnknown(id);
    }
  }
}

export interface HeartbeatLoopOptions {
  intervalMs?: number;
  beat: () => Promise<void>;
  onError?: (error: Error) => void;
}

/** Sends a heartbeat at once and then every 30 s (a full-state replace on the server). */
export class HeartbeatLoop {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private again = false;

  constructor(private readonly options: HeartbeatLoopOptions) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? 30_000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  /** Sends a heartbeat now; one requested while another is in flight is sent right after it. */
  tick(): Promise<void> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    this.inFlight = (async () => {
      do {
        this.again = false;
        await this.options.beat().catch((error: Error) => this.options.onError?.(error));
      } while (this.again);
    })().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
}
