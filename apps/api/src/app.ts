import type { HealthResponse } from '@crew/shared';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ownerGuard, purgeExpiredSessions } from './auth/owner-auth.js';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { ApiError } from './errors.js';
import { authRoutes } from './routes/auth-routes.js';
import { commentRoutes } from './routes/comment-routes.js';
import { projectRoutes } from './routes/project-routes.js';
import { reportRoutes } from './routes/report-routes.js';
import type { RouteDeps } from './routes/route-deps.js';
import { ticketRoutes } from './routes/ticket-routes.js';
import { purgeExpiredIdempotencyKeys } from './services/idempotency.js';

export interface BuildAppOptions {
  config: AppConfig;
  db: Database;
  /** Pino logger; off by default so tests stay quiet. */
  logger?: boolean;
}

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

export async function buildApp({ config, db, logger = false }: BuildAppOptions): Promise<FastifyInstance> {
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

  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) return reply.status(error.statusCode).send(error.toBody());
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const code = status === 401 ? 'UNAUTHORIZED' : status === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED';
      return reply.status(status).send(new ApiError(code, error.message).toBody());
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(new ApiError('INTERNAL', 'internal server error').toBody());
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send(new ApiError('NOT_FOUND', 'route not found').toBody()),
  );

  app.get('/v1/health', async (): Promise<HealthResponse> => {
    await db.execute(sql`select 1`);
    return { status: 'ok', db: 'ok' };
  });

  const deps: RouteDeps = { db, config };
  await app.register(authRoutes, deps);
  await app.register(async (owner) => {
    owner.addHook('onRequest', ownerGuard(db, config));
    await owner.register(projectRoutes, deps);
    await owner.register(ticketRoutes, deps);
    await owner.register(commentRoutes, deps);
    await owner.register(reportRoutes, deps);
  });

  let timer: NodeJS.Timeout | undefined;
  app.addHook('onReady', async () => {
    timer = setInterval(() => {
      Promise.all([purgeExpiredIdempotencyKeys(db), purgeExpiredSessions(db)]).catch((error: unknown) =>
        app.log.error({ err: error }, 'maintenance sweep failed'),
      );
    }, MAINTENANCE_INTERVAL_MS);
    timer.unref();
  });
  app.addHook('onClose', async () => clearInterval(timer));

  return app;
}
