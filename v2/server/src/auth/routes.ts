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
  const failed = new Map<string, number[]>();
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
      const recent = (failed.get(ipHash) ?? []).filter((time) => time > now.getTime() - 5 * 60_000);
      if (recent.length >= 5) throw new ApiError('LOGIN_THROTTLED', 429, 'Thử lại sau');
      const [owner] = await options.db`select password_salt, password_hash from owners where id='owner'`;
      if (!owner) throw new ApiError('OWNER_NOT_BOOTSTRAPPED', 503, 'Chủ dự án chưa được khởi tạo');
      if (
        !(await verifyPassword(
          request.body.password,
          owner.password_salt as string,
          owner.password_hash as string,
        ))
      ) {
        recent.push(now.getTime());
        failed.set(ipHash, recent);
        throw new ApiError('INVALID_CREDENTIALS', 401, 'Thông tin đăng nhập không hợp lệ');
      }
      failed.delete(ipHash);
      const session = await createSession(options.db, options.sessionEncryptionKey, now);
      reply.header('set-cookie', makeSessionCookie(session.secret, options.secureCookies));
      return { owner: { id: 'owner' }, csrfToken: session.csrfToken };
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
  app.get('/v2/machines', async (request) => {
    await deps.auth.requireOwner(request, { csrf: false });
    const rows = await options.db`select id, name, revoked_at from machines order by created_at, id`;
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        revokedAt: row.revoked_at ? (row.revoked_at as Date).toISOString() : null,
      })),
    };
  });
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
