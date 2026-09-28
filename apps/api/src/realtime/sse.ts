import { type EventEnvelope, StreamCursor, StreamQuery } from '@crew/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client.js';
import { ApiError } from '../errors.js';
import { listEventsAfter } from '../services/event-service.js';
import type { BusSubscriber, EventBus } from './event-bus.js';

const REPLAY_PAGE = 500;
/** A client this far behind is dropped; it reconnects and replays from its cursor. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
/** EventSource reconnect delay hint. */
const RETRY_MS = 3_000;

/**
 * Resume point: the SSE `Last-Event-ID` header, else `?cursor=`, else null. Invalid values are a 400.
 */
export function readCursor(request: FastifyRequest): bigint | null {
  const header = request.headers['last-event-id'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader !== undefined && fromHeader !== '') {
    const parsed = StreamCursor.safeParse(fromHeader);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 'invalid Last-Event-ID');
    return BigInt(parsed.data);
  }
  const query = StreamQuery.safeParse(request.query ?? {});
  if (!query.success) throw new ApiError('VALIDATION_FAILED', 'invalid cursor');
  return query.data.cursor === undefined ? null : BigInt(query.data.cursor);
}

export interface OpenStreamOptions {
  request: FastifyRequest;
  reply: FastifyReply;
  db: Database;
  bus: EventBus;
  /** Null for the owner stream (every event); otherwise only events targeted at this machine. */
  machineId: string | null;
  /** Replay events with a sequence above this one. */
  cursor: bigint;
  heartbeatMs: number;
  /** Re-checked on every heartbeat; false closes the stream. */
  stillAuthorized: () => Promise<boolean>;
}

/**
 * Serves one SSE stream with gap-free resume:
 * 1. subscribe to the bus first, buffering live events;
 * 2. replay committed events with `seq > cursor` from the database;
 * 3. flush the buffer, skipping anything already sent, then forward live events directly.
 * Every event committed before step 2 is found by the replay, and every event after it reaches the buffer,
 * so none is lost; the sequence check drops the overlap.
 */
export async function openEventStream(options: OpenStreamOptions): Promise<void> {
  const { request, reply, db, bus, machineId, heartbeatMs } = options;
  const res = reply.raw;
  let lastSent = options.cursor;
  let live = false;
  let closed = false;
  const buffer: EventEnvelope[] = [];
  let heartbeat: NodeJS.Timeout | undefined;
  let unsubscribe: () => void = () => {};

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    if (!res.writableEnded) res.end();
  };

  const send = (event: EventEnvelope) => {
    if (closed) return;
    const seq = BigInt(event.id);
    if (seq <= lastSent) return;
    lastSent = seq;
    res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    if (res.writableLength > MAX_BUFFERED_BYTES) {
      request.log.warn({ machineId }, 'SSE client too slow; closing so it resumes from its cursor');
      close();
    }
  };

  const subscriber: BusSubscriber = {
    machineId,
    deliver: (event) => {
      if (live) send(event);
      else buffer.push(event);
    },
    close: () => close(),
  };
  try {
    unsubscribe = bus.subscribe(subscriber);
  } catch {
    throw new ApiError('UNAUTHORIZED', 'invalid, expired or revoked machine token');
  }

  reply.hijack();
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`retry: ${RETRY_MS}\n\n`);
  res.on('close', close);

  heartbeat = setInterval(() => {
    if (closed) return;
    res.write(': ping\n\n');
    options.stillAuthorized().then(
      (ok) => {
        if (!ok) close();
      },
      (error: unknown) => request.log.error({ err: error }, 'SSE authorization re-check failed'),
    );
  }, heartbeatMs);

  try {
    for (;;) {
      const page = await listEventsAfter(db, {
        cursor: lastSent,
        machineId: machineId ?? undefined,
        limit: REPLAY_PAGE,
      });
      for (const event of page) send(event);
      if (closed || page.length < REPLAY_PAGE) break;
    }
    for (const event of buffer) send(event);
    buffer.length = 0;
    live = true;
  } catch (error) {
    request.log.error({ err: error }, 'SSE replay failed; closing so the client resumes');
    close();
  }
}
