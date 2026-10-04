import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Actor, Db, RouteDependencies, ServerOptions, Tx } from '../platform/contracts.ts';
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
  currentCredential?: (db: Db | Tx, request: FastifyRequest) => Promise<Actor>,
): void {
  const requestScope =
    (request: FastifyRequest, actor: Actor): EventScopeReader =>
    async (db, expected) => {
      const current = currentCredential
        ? await currentCredential(db, request)
        : await deps.auth.authenticate(request);
      if (
        current.kind !== actor.kind ||
        current.id !== actor.id ||
        current.kind !== expected.kind ||
        current.id !== expected.id
      )
        throw new ApiError('UNAUTHENTICATED', 401, 'Phiên đã thay đổi');
      return scope(db, current);
    };
  const streams = new Set<FastifyRequest['raw']['socket']>();
  app.addHook('preClose', async () => {
    for (const socket of streams) socket.destroy();
    streams.clear();
  });

  app.get('/v2/events', async (request) => {
    const actor = await deps.auth.authenticate(request);
    assertAllowedQuery(request, false);
    const after = requestedCursor(request, false);
    const limit = requestedLimit(request);
    const items = await readEvents(options.db, actor, after, limit, requestScope(request, actor));
    return { items, cursor: items.at(-1)?.cursor ?? after };
  });

  app.get(
    '/v2/events/latest',
    { schema: { querystring: { type: 'object', additionalProperties: false, properties: {} } } },
    async (request) => {
      await deps.auth.authenticate(request);
      const [row] = await options.db`select value from event_cursor where singleton = true`;
      if (!row) throw new Error('EVENT_CURSOR_MISSING');
      return { cursor: parseCursor(String(row.value)) };
    },
  );

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
        const batch = await readEvents(options.db, actor, cursor, 100, requestScope(request, actor));
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
      if (!abort.signal.aborted)
        request.log.info(
          { code: error instanceof ApiError ? error.code : 'STREAM_STOPPED' },
          'Luồng sự kiện đã dừng',
        );
    } finally {
      close();
      if (!reply.raw.destroyed) reply.raw.end();
    }
  });
}
