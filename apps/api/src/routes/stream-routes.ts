import { MarkAllNoticesReadRequest, MarkNoticesReadRequest, NoticeListQuery } from '@crew/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticateTokenHash, requireMachine } from '../auth/machine-auth.js';
import { sessionStillValid } from '../auth/owner-auth.js';
import { ApiError } from '../errors.js';
import { openEventStream, readCursor } from '../realtime/sse.js';
import { listOwnerNotices, markAllNoticesRead, markNoticesRead } from '../services/notice-read-service.js';
import { parseInput, type RouteDeps } from './route-deps.js';

function ownerIdOf(request: FastifyRequest): string {
  const session = request.ownerSession;
  if (!session) throw new ApiError('UNAUTHORIZED', 'login required');
  return session.ownerId;
}

/**
 * `GET /v1/daemon/stream`: the events targeted at the calling machine, replayed from the cursor
 * (`Last-Event-ID` or `?cursor=`; 0 when absent). The token is re-checked on every heartbeat, and revoking
 * the machine closes the stream at once.
 */
export async function daemonStreamRoutes(
  app: FastifyInstance,
  { db, bus, streamHeartbeatMs }: RouteDeps,
): Promise<void> {
  app.get('/v1/daemon/stream', async (request, reply) => {
    const machine = requireMachine(request);
    const cursor = readCursor(request) ?? 0n;
    await openEventStream({
      request,
      reply,
      db,
      bus,
      machineId: machine.machineId,
      cursor,
      heartbeatMs: streamHeartbeatMs,
      stillAuthorized: async () => (await authenticateTokenHash(db, machine.tokenHash)) !== null,
    });
  });
}

/**
 * `GET /v1/stream`: every event, for the owner's web app. Honours `Last-Event-ID`; without a cursor it starts
 * at the newest event. The session is re-checked on every heartbeat.
 */
export async function ownerStreamRoutes(
  app: FastifyInstance,
  { db, bus, streamHeartbeatMs }: RouteDeps,
): Promise<void> {
  app.get('/v1/stream', async (request, reply) => {
    const session = request.ownerSession;
    if (!session) throw new ApiError('UNAUTHORIZED', 'login required');
    const cursor = readCursor(request) ?? bus.currentSeq;
    await openEventStream({
      request,
      reply,
      db,
      bus,
      machineId: null,
      cursor,
      heartbeatMs: streamHeartbeatMs,
      stillAuthorized: () => sessionStillValid(db, session.sessionIdHash),
    });
  });

  /** Machine and budget notices for the owner inbox, newest first, with the owner's read state. */
  app.get('/v1/notices', async (request) => {
    const { limit } = parseInput(NoticeListQuery, request.query);
    return listOwnerNotices(db, ownerIdOf(request), limit);
  });

  app.post('/v1/notices/read', async (request) => {
    const { ids } = parseInput(MarkNoticesReadRequest, request.body);
    return { unread: await markNoticesRead(db, ownerIdOf(request), ids) };
  });

  app.post('/v1/notices/read-all', async (request) => {
    const { throughId } = parseInput(MarkAllNoticesReadRequest, request.body ?? {});
    return { unread: await markAllNoticesRead(db, ownerIdOf(request), throughId) };
  });
}
