import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RouteDependencies, ServerOptions } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { type EventScopeReader, parseCursor, readEvents } from './events.ts';

function queryValue(request: FastifyRequest, name: string): unknown {
  const query = request.query;
  if (!query || typeof query !== 'object' || Array.isArray(query)) return undefined;
  return Object.hasOwn(query, name) ? (query as Record<string, unknown>)[name] : undefined;
}

function assertAllowedQuery(request: FastifyRequest, stream: boolean): void {
  const query = request.query;
  if (!query || typeof query !== 'object' || Array.isArray(query))
    throw new ApiError('QUERY_INVALID', 400, 'Tham số sự kiện không hợp lệ');
  const allowed = stream ? ['after'] : ['after', 'limit'];
  if (Object.keys(query).some((key) => !allowed.includes(key)))
    throw new ApiError('QUERY_INVALID', 400, 'Tham số sự kiện không hợp lệ');
}

function requestedCursor(request: FastifyRequest, stream: boolean): string {
  const fromHeader = stream ? request.headers['last-event-id'] : undefined;
  const value = fromHeader ?? queryValue(request, 'after') ?? '0';
  if (typeof value !== 'string') throw new ApiError('CURSOR_INVALID', 400, 'Con trỏ sự kiện không hợp lệ');
  return parseCursor(value);
}

function requestedLimit(request: FastifyRequest): number {
  const raw = queryValue(request, 'limit');
  if (raw === undefined) return 50;
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw))
    throw new ApiError('LIMIT_INVALID', 400, 'Giới hạn sự kiện không hợp lệ');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 100)
    throw new ApiError('LIMIT_INVALID', 400, 'Giới hạn sự kiện không hợp lệ');
  return value;
}

export function registerEventRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
  scope: EventScopeReader,
): void {
  const streams = new Set<FastifyRequest['raw']['socket']>();
  app.addHook('onClose', async () => {
    for (const socket of streams) socket.destroy();
    streams.clear();
  });

  app.get('/v2/events', async (request) => {
    const actor = await deps.auth.authenticate(request);
    assertAllowedQuery(request, false);
    const after = requestedCursor(request, false);
    const limit = requestedLimit(request);
    const items = await readEvents(options.db, actor, after, limit, scope);
    return { items, cursor: items.at(-1)?.cursor ?? after };
  });

  app.get('/v2/events/stream', async (request, reply) => {
    const actor = await deps.auth.authenticate(request);
    assertAllowedQuery(request, true);
    let cursor = requestedCursor(request, true);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connected\n\n');
    const abort = new AbortController();
    const socket = request.raw.socket;
    streams.add(socket);
    const close = () => {
      abort.abort();
      streams.delete(socket);
    };
    const writeBounded = (packet: string): boolean => {
      if (reply.raw.writableLength + Buffer.byteLength(packet) > 65_536) {
        socket.destroy();
        return false;
      }
      reply.raw.write(packet);
      return true;
    };
    reply.raw.on('close', close);
    let lastHeartbeat = Date.now();
    try {
      while (!abort.signal.aborted) {
        const batch = await readEvents(options.db, actor, cursor, 100, scope);
        for (const event of batch) {
          if (abort.signal.aborted) break;
          const packet = `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          if (!writeBounded(packet)) break;
          cursor = event.cursor;
        }
        if (batch.length === 100 && !abort.signal.aborted) continue;
        if (Date.now() - lastHeartbeat >= 15_000 && !abort.signal.aborted) {
          writeBounded(': heartbeat\n\n');
          lastHeartbeat = Date.now();
        }
        await delay(1000, undefined, { signal: abort.signal });
      }
    } catch (error) {
      if (!abort.signal.aborted) request.log.error(error, 'event stream stopped');
    } finally {
      close();
      if (!reply.raw.destroyed) reply.raw.end();
    }
  });
}
