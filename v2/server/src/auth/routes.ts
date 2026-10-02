import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Actor, Db, RouteDependencies, ServerOptions } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { provisionMachine } from './machine.ts';
import { verifyPassword } from './password.ts';
import {
  clearSessionCookie,
  createSession,
  getSession,
  makeSessionCookie,
  readSessionCookie,
  revealCsrf,
  revokeSession,
  sha256,
} from './session.ts';

const ownerActor: Actor = { kind: 'owner', id: 'owner' };
const sessionRegex = /^Bearer ([0-9a-f]{64})$/;
const machineIdSchema = { type: 'string', format: 'uuid' } as const;
const nameSchema = { type: 'string', minLength: 1, maxLength: 200 } as const;
const loginWindowMs = 5 * 60_000;
const maxTrackedIps = 10_000;

function sameSecret(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function createAuthenticator(
  db: Db,
  options: { now: () => Date; publicOrigin: string },
): {
  authenticate: (request: FastifyRequest) => Promise<Actor>;
  requireOwner: (request: FastifyRequest, input: { csrf: boolean }) => Promise<Actor>;
} {
  const requireBootstrap = async (): Promise<void> => {
    const rows = await db`select 1 from owners where id='owner'`;
    if (!rows.length) throw new ApiError('OWNER_NOT_BOOTSTRAPPED', 503, 'Chủ dự án chưa được khởi tạo');
  };
  const requireOwner = async (request: FastifyRequest, input: { csrf: boolean }): Promise<Actor> => {
    await requireBootstrap();
    if (request.headers.authorization) throw new ApiError('OWNER_REQUIRED', 403, 'Cần quyền chủ dự án');
    const session = await getSession(db, request, options.now());
    if (input.csrf) {
      if (request.headers.origin !== options.publicOrigin)
        throw new ApiError('ORIGIN_INVALID', 403, 'Nguồn yêu cầu không hợp lệ');
      const token = request.headers['x-csrf-token'];
      if (typeof token !== 'string' || !sameSecret(sha256(token), session.csrfHash)) {
        throw new ApiError('CSRF_INVALID', 403, 'Mã bảo vệ không hợp lệ');
      }
    }
    return ownerActor;
  };
  const authenticate = async (request: FastifyRequest): Promise<Actor> => {
    await requireBootstrap();
    if (request.headers.authorization) {
      const token = sessionRegex.exec(request.headers.authorization)?.[1];
      if (!token) throw new ApiError('UNAUTHENTICATED', 401, 'Cần xác thực máy');
      const [machine] =
        await db`select id from machines where token_hash=${sha256(token)} and revoked_at is null`;
      if (!machine) throw new ApiError('UNAUTHENTICATED', 401, 'Cần xác thực máy');
      return { kind: 'machine', id: machine.id as string };
    }
    await getSession(db, request, options.now());
    return ownerActor;
  };
  return { authenticate, requireOwner };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  options: ServerOptions,
  deps: RouteDependencies,
): void {
  if (!options.secureCookies && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(options.publicOrigin)) {
    throw new Error('INSECURE_COOKIES_NONLOCAL');
  }
  const attempts = new Map<string, { failures: number[]; pending: number }>();
  let loginCalls = 0;
  const sweepAttempts = (now: number): void => {
    for (const [ipHash, bucket] of attempts) {
      bucket.failures = bucket.failures.filter((time) => time > now - loginWindowMs);
      if (!bucket.failures.length && bucket.pending === 0) attempts.delete(ipHash);
    }
  };
  const checkOrigin = (request: FastifyRequest): void => {
    if (request.headers.origin !== options.publicOrigin)
      throw new ApiError('ORIGIN_INVALID', 403, 'Nguồn yêu cầu không hợp lệ');
  };
  app.post<{ Body: { password: string } }>(
    '/v2/auth/session',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['password'],
          properties: { password: { type: 'string', minLength: 1, maxLength: 4096 } },
        },
      },
    },
    async (request, reply) => {
      checkOrigin(request);
      const ipHash = createHash('sha256').update(request.ip).digest('hex');
      const now = options.now();
      if (++loginCalls % 64 === 0 || attempts.size >= maxTrackedIps) sweepAttempts(now.getTime());
      let bucket = attempts.get(ipHash);
      if (!bucket) {
        if (attempts.size >= maxTrackedIps) throw new ApiError('LOGIN_THROTTLED', 429, 'Thử lại sau');
        bucket = { failures: [], pending: 0 };
        attempts.set(ipHash, bucket);
      }
      bucket.failures = bucket.failures.filter((time) => time > now.getTime() - loginWindowMs);
      if (bucket.failures.length + bucket.pending >= 5)
        throw new ApiError('LOGIN_THROTTLED', 429, 'Thử lại sau');
      bucket.pending++;
      try {
        const [owner] = await options.db`select password_salt, password_hash from owners where id='owner'`;
        if (!owner) throw new ApiError('OWNER_NOT_BOOTSTRAPPED', 503, 'Chủ dự án chưa được khởi tạo');
        if (
          !(await verifyPassword(
            request.body.password,
            owner.password_salt as string,
            owner.password_hash as string,
          ))
        ) {
          bucket.failures.push(options.now().getTime());
          throw new ApiError('INVALID_CREDENTIALS', 401, 'Thông tin đăng nhập không hợp lệ');
        }
        const session = await createSession(options.db, options.sessionEncryptionKey, now);
        bucket.failures = [];
        reply.header('set-cookie', makeSessionCookie(session.secret, options.secureCookies));
        return { owner: { id: 'owner' }, csrfToken: session.csrfToken };
      } finally {
        bucket.pending--;
        if (!bucket.failures.length && bucket.pending === 0) attempts.delete(ipHash);
      }
    },
  );
  app.get('/v2/auth/session', async (request) => {
    await deps.auth.requireOwner(request, { csrf: false });
    const session = await getSession(options.db, request, options.now());
    return { owner: { id: 'owner' }, csrfToken: revealCsrf(options.sessionEncryptionKey, session) };
  });
  app.delete('/v2/auth/session', async (request, reply) => {
    await deps.auth.requireOwner(request, { csrf: true });
    await revokeSession(options.db, request, options.now());
    reply.header('set-cookie', clearSessionCookie(options.secureCookies));
    reply.status(204).send();
  });
  app.post<{ Body: { name: string } }>(
    '/v2/machines',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: nameSchema },
        },
      },
    },
    async (request, reply) => {
      const actor = await deps.auth.requireOwner(request, { csrf: true });
      const result = await deps.mutator(
        {
          actor,
          route: 'POST:/v2/machines',
          key: String(request.headers['idempotency-key'] ?? ''),
          body: request.body,
        },
        async (tx) => ({ status: 201, body: await provisionMachine(tx, request.body.name) }),
      );
      reply.status(result.status);
      return result.body;
    },
  );
  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/v2/machines',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' },
            cursor: machineIdSchema,
          },
        },
      },
    },
    async (request) => {
      await deps.auth.requireOwner(request, { csrf: false });
      const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new ApiError('LIMIT_INVALID', 400, 'Giới hạn không hợp lệ');
      const rows = request.query.cursor
        ? await options.db`select id, name, revoked_at from machines where id > ${request.query.cursor} order by id limit ${limit + 1}`
        : await options.db`select id, name, revoked_at from machines order by id limit ${limit + 1}`;
      const items = rows.slice(0, limit).map((row) => ({
        id: row.id as string,
        name: row.name,
        revokedAt: row.revoked_at ? (row.revoked_at as Date).toISOString() : null,
      }));
      return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
    },
  );
  app.get('/v2/machines/self', async (request) => {
    if (readSessionCookie(request) && !request.headers.authorization)
      throw new ApiError('MACHINE_REQUIRED', 401, 'Cần xác thực máy');
    const actor = await deps.auth.authenticate(request);
    if (actor.kind !== 'machine') throw new ApiError('MACHINE_REQUIRED', 401, 'Cần xác thực máy');
    return { machineId: actor.id };
  });
  app.get<{ Params: { id: string } }>(
    '/v2/machines/:id',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: machineIdSchema },
        },
      },
    },
    async (request) => {
      await deps.auth.requireOwner(request, { csrf: false });
      const [row] = await options.db`select id, name, revoked_at from machines where id=${request.params.id}`;
      if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy máy');
      return {
        id: row.id,
        name: row.name,
        revokedAt: row.revoked_at ? (row.revoked_at as Date).toISOString() : null,
      };
    },
  );
}
