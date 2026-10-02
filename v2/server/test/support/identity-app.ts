import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { bootstrapOwner } from '../../src/auth/bootstrap.ts';
import { createAuthenticator, registerAuthRoutes } from '../../src/auth/routes.ts';
import { credentialResponseCodec } from '../../src/auth/session.ts';
import { createMutator } from '../../src/journal/mutation.ts';
import { registerEventRoutes } from '../../src/journal/routes.ts';
import type { Db, ServerOptions } from '../../src/platform/contracts.ts';
import { ApiError } from '../../src/platform/errors.ts';
import { registerProjectRoutes } from '../../src/projects/routes.ts';
import { denyRebinding, projectEventScope } from '../../src/projects/service.ts';

export type IdentityTestFixture = {
  app: FastifyInstance;
  password: string;
  cookie: string;
  csrf: string;
  sessionEncryptionKey: Buffer;
  ownerPost: (path: string, body: unknown, key: string) => Promise<LightMyRequestResponse>;
  ownerPut: (path: string, body: unknown, key: string) => Promise<LightMyRequestResponse>;
  ownerGet: (path: string) => Promise<LightMyRequestResponse>;
  machineGet: (path: string, token: string) => Promise<LightMyRequestResponse>;
  close: () => Promise<void>;
};

export async function buildIdentityTestApp(
  db: Db,
  prior?: IdentityTestFixture,
  bootstrap = true,
): Promise<IdentityTestFixture> {
  const password = prior?.password ?? randomBytes(24).toString('hex');
  if (!prior && bootstrap) await bootstrapOwner(db, password);
  const options: ServerOptions = {
    db,
    publicOrigin: 'http://localhost:5182',
    secureCookies: false,
    sessionEncryptionKey: prior?.sessionEncryptionKey ?? randomBytes(32),
    now: () => new Date(),
    authorizeDispatch: async () => {
      throw new Error('DISPATCH_NOT_CONFIGURED');
    },
    verifyFinalResult: async () => {
      throw new Error('FINAL_NOT_CONFIGURED');
    },
  };
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.status).send({ error: { code: error.code, message: error.message } });
      return;
    }
    const validation = error instanceof Error && 'validation' in error;
    reply
      .status(validation ? 400 : 500)
      .send({ error: { code: validation ? 'VALIDATION' : 'INTERNAL', message: 'Yêu cầu không hợp lệ' } });
  });
  const auth = createAuthenticator(db, { now: options.now, publicOrigin: options.publicOrigin });
  const deps = { auth, mutator: createMutator(db, credentialResponseCodec(options.sessionEncryptionKey)) };
  registerAuthRoutes(app, options, deps);
  registerProjectRoutes(app, options, deps, denyRebinding);
  registerEventRoutes(app, options, deps, projectEventScope);
  await app.ready();
  let cookie = prior?.cookie ?? '';
  let csrf = prior?.csrf ?? '';
  if (!prior && bootstrap) {
    const login = await app.inject({
      method: 'POST',
      url: '/v2/auth/session',
      payload: { password },
      headers: { origin: options.publicOrigin },
    });
    if (login.statusCode !== 200) throw new Error(`IDENTITY_TEST_LOGIN_FAILED_${login.statusCode}`);
    cookie = login.headers['set-cookie']?.toString().split(';')[0] ?? '';
    csrf = (login.json() as { csrfToken: string }).csrfToken;
  }
  return {
    app,
    password,
    cookie,
    csrf,
    sessionEncryptionKey: options.sessionEncryptionKey,
    ownerPost: (path, body, key) =>
      app.inject({
        method: 'POST',
        url: path,
        payload: JSON.stringify(body),
        headers: {
          cookie,
          origin: options.publicOrigin,
          'x-csrf-token': csrf,
          'idempotency-key': key,
          'content-type': 'application/json',
        },
      }),
    ownerPut: (path, body, key) =>
      app.inject({
        method: 'PUT',
        url: path,
        payload: JSON.stringify(body),
        headers: {
          cookie,
          origin: options.publicOrigin,
          'x-csrf-token': csrf,
          'idempotency-key': key,
          'content-type': 'application/json',
        },
      }),
    ownerGet: (path) => app.inject({ method: 'GET', url: path, headers: { cookie } }),
    machineGet: (path, token) =>
      app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${token}` } }),
    close: () => app.close(),
  };
}
