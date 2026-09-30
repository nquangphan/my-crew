import { Socket } from 'node:net';
import { type HealthResponse, STREAM_HEARTBEAT_MS } from '@crew/shared';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { machineGuard } from './auth/machine-auth.js';
import { ownerGuard, purgeExpiredSessions } from './auth/owner-auth.js';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { ApiError, sendApiError } from './errors.js';
import { startHeartbeatSweeper } from './jobs/heartbeat-sweeper.js';
import { startRuntimeImport } from './jobs/runtime-import.js';
import { startStuckTicketAlarm, WaitingJobsRegistry } from './jobs/stuck-ticket-alarm.js';
import { EventBus } from './realtime/event-bus.js';
import { attachmentRoutes, daemonAttachmentRoutes } from './routes/attachment-routes.js';
import { authRoutes } from './routes/auth-routes.js';
import { daemonBmadProfileRoutes } from './routes/bmad-profile-routes.js';
import { commentRoutes } from './routes/comment-routes.js';
import { daemonRoutes } from './routes/daemon-routes.js';
import { daemonDocsRoutes, docsRoutes } from './routes/docs-routes.js';
import { daemonCommandRoutes, machineCommandRoutes } from './routes/machine-command-routes.js';
import { machineRoutes, pairRoutes } from './routes/machine-routes.js';
import { projectRoutes } from './routes/project-routes.js';
import { reportRoutes } from './routes/report-routes.js';
import type { RouteDeps } from './routes/route-deps.js';
import { daemonRuntimeRoutes, runtimeRoutes } from './routes/runtime-routes.js';
import { daemonSettingsRoutes, settingsRoutes } from './routes/settings-routes.js';
import { daemonStreamRoutes, ownerStreamRoutes } from './routes/stream-routes.js';
import { ticketRoutes } from './routes/ticket-routes.js';
import { purgeExpiredIdempotencyKeys } from './services/idempotency.js';
import { trustedRuntimeKeys } from './services/runtime-service.js';

export interface BuildAppOptions {
  config: AppConfig;
  db: Database;
  /** Pino logger; off by default so tests stay quiet. */
  logger?: boolean;
  /** Realtime tuning; the defaults are the production values. Tests shorten them. */
  realtime?: {
    streamHeartbeatMs?: number;
    pollMs?: number;
    /** False disables LISTEN so only the poll delivers (tests the fallback). */
    listen?: boolean;
    /** False keeps the heartbeat sweeper and stuck-ticket timers off (tests call the checks directly). */
    sweeper?: boolean;
  };
  /** Where heartbeats record waiting jobs; tests pass their own to inspect it. */
  waitingJobs?: WaitingJobsRegistry;
  /** How long `close()` lets in-flight requests finish before cutting their connections. */
  closeDrainMs?: number;
}

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
/** Well inside the container's 20 s stop grace period, so a redeploy never waits for SIGKILL. */
const CLOSE_DRAIN_MS = 10_000;

export async function buildApp({
  config,
  db,
  logger = false,
  realtime = {},
  waitingJobs = new WaitingJobsRegistry(),
  closeDrainMs = CLOSE_DRAIN_MS,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ? { level: config.logLevel } : false,
    // Only the reverse proxy (Caddy) may set X-Forwarded-For; the login rate limit keys on the real client IP.
    trustProxy: config.trustProxy.length > 0 ? config.trustProxy : false,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      new ApiError('RATE_LIMITED', `too many attempts, retry in ${Math.ceil(context.ttl / 1000)}s`),
  });

  app.setErrorHandler((error: FastifyError | ApiError, request, reply) =>
    sendApiError(error, request, reply),
  );
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send(new ApiError('NOT_FOUND', 'route not found').toBody()),
  );

  app.get('/v1/health', async (): Promise<HealthResponse> => {
    await db.execute(sql`select 1`);
    return { status: 'ok', db: 'ok' };
  });

  const bus = new EventBus(db, { pollMs: realtime.pollMs, listen: realtime.listen, log: app.log });
  const deps: RouteDeps = {
    db,
    config,
    bus,
    streamHeartbeatMs: realtime.streamHeartbeatMs ?? STREAM_HEARTBEAT_MS,
    waitingJobs,
  };
  await app.register(authRoutes, deps);
  await app.register(pairRoutes, deps);
  // Owner routes: session cookie only; a bearer token is ignored.
  await app.register(async (owner) => {
    owner.addHook('onRequest', ownerGuard(db, config));
    await owner.register(projectRoutes, deps);
    await owner.register(ticketRoutes, deps);
    await owner.register(commentRoutes, deps);
    await owner.register(attachmentRoutes, deps);
    await owner.register(reportRoutes, deps);
    await owner.register(machineRoutes, deps);
    await owner.register(machineCommandRoutes, deps);
    await owner.register(docsRoutes, deps);
    await owner.register(settingsRoutes, deps);
    await owner.register(runtimeRoutes, deps);
    await owner.register(ownerStreamRoutes, deps);
  });
  // Daemon routes: machine bearer token only; cookies are ignored.
  await app.register(async (daemon) => {
    daemon.addHook('onRequest', machineGuard(db));
    await daemon.register(daemonRoutes, deps);
    await daemon.register(daemonAttachmentRoutes, deps);
    await daemon.register(daemonDocsRoutes, deps);
    await daemon.register(daemonBmadProfileRoutes, deps);
    await daemon.register(daemonSettingsRoutes, deps);
    await daemon.register(daemonCommandRoutes, deps);
    await daemon.register(daemonRuntimeRoutes, deps);
    await daemon.register(daemonStreamRoutes, deps);
  });

  let timer: NodeJS.Timeout | undefined;
  let stopSweeper: (() => void) | undefined;
  let stopStuckAlarm: (() => void) | undefined;
  let stopRuntimeImport: (() => void) | undefined;
  app.addHook('onReady', async () => {
    await bus.start();
    if (realtime.sweeper !== false) {
      stopSweeper = startHeartbeatSweeper(db, app.log);
      stopStuckAlarm = startStuckTicketAlarm(db, deps.waitingJobs, app.log);
      if (config.runtimeReleasesRepo) {
        stopRuntimeImport = startRuntimeImport(
          db,
          { repo: config.runtimeReleasesRepo, keys: trustedRuntimeKeys(config) },
          app.log,
        );
      }
    }
    timer = setInterval(() => {
      Promise.all([purgeExpiredIdempotencyKeys(db), purgeExpiredSessions(db)]).catch((error: unknown) =>
        app.log.error({ err: error }, 'maintenance sweep failed'),
      );
    }, MAINTENANCE_INTERVAL_MS);
    timer.unref();
  });
  // Shutdown. Fastify answers requests arriving after close() begins with 503, but a request already past
  // that check keeps its keep-alive connection once answered, and `server.close()` would wait for the
  // client (a daemon, or nginx's pooled upstream connection) to drop it: up to the 72 s keep-alive timeout.
  // So every response finished from then on closes its connection, and anything still open after the
  // drain window (a stuck handler) is cut.
  let closing = false;
  app.addHook('onSend', async (_request, reply) => {
    if (closing) reply.header('connection', 'close');
  });
  app.addHook('onResponse', async (request) => {
    const socket = request.raw.socket;
    // Covers a response whose headers went out as keep-alive just before close() began. (`inject()`
    // requests have a mock socket, which is not a `Socket`.)
    if (closing && socket instanceof Socket && !socket.destroyed && !socket.writableEnded) socket.end();
  });
  // SSE responses are hijacked; end them before the server waits for open connections to drain.
  app.addHook('preClose', async () => {
    closing = true;
    if (app.server.listening) {
      const drain = setTimeout(() => {
        app.log.warn({ drainMs: closeDrainMs }, 'requests still open at shutdown; closing their connections');
        app.server.closeAllConnections();
      }, closeDrainMs);
      drain.unref();
      app.server.once('close', () => clearTimeout(drain));
    }
    stopSweeper?.();
    stopStuckAlarm?.();
    stopRuntimeImport?.();
    await bus.stop();
  });
  app.addHook('onClose', async () => clearInterval(timer));

  return app;
}
