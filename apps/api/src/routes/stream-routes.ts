import type { FastifyInstance } from 'fastify';
import { authenticateTokenHash, requireMachine } from '../auth/machine-auth.js';
import { sessionStillValid } from '../auth/owner-auth.js';
import { ApiError } from '../errors.js';
import { openEventStream, readCursor } from '../realtime/sse.js';
import type { RouteDeps } from './route-deps.js';

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
}
