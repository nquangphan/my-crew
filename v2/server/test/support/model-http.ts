import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { bootstrapOwner } from '../../src/auth/bootstrap.ts';
import { createAuthenticator, registerAuthRoutes } from '../../src/auth/routes.ts';
import { credentialResponseCodec } from '../../src/auth/session.ts';
import {
  assertNoActiveProjectExecution,
  createExecutionAuthority,
  denyDispatch,
  denyFinalResult,
} from '../../src/execution/attempts.ts';
import { registerExecutionRoutes } from '../../src/execution/routes.ts';
import type { GatewayProjectionPolicy } from '../../src/gateway/contracts.ts';
import { registerGatewayRoutes } from '../../src/gateway/routes.ts';
import { createMutator } from '../../src/journal/mutation.ts';
import type { ModelRouteOptions } from '../../src/models/contracts.ts';
import { registerModelRoutes } from '../../src/models/routes.ts';
import type {
  AuthorizeDispatch,
  Db,
  RouteDependencies,
  ServerOptions,
} from '../../src/platform/contracts.ts';
import { ApiError } from '../../src/platform/errors.ts';
import { registerProjectRoutes } from '../../src/projects/routes.ts';
import { registerTicketRoutes } from '../../src/tickets/routes.ts';
import type { HttpIdentity, HttpResponse } from './http.ts';

const fixtureContainers = new Set<string>();
async function buildModelApp(
  input: Omit<ServerOptions, 'authorizeDispatch' | 'verifyFinalResult'> & {
    authorizeDispatch?: AuthorizeDispatch;
    gatewayProjectionPolicy?: GatewayProjectionPolicy;
    modelPorts?: ModelRouteOptions;
    configure?: (app: FastifyInstance, options: ServerOptions, deps: RouteDependencies) => Promise<void>;
  },
) {
  const options = {
    ...input,
    authorizeDispatch: input.authorizeDispatch ?? denyDispatch,
    verifyFinalResult: denyFinalResult,
  };
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } }, logger: false });
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ApiError)
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    if (err && typeof err === 'object' && 'validation' in err)
      return reply.code(400).send({ error: { code: 'INVALID_INPUT' } });

    return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE' } });
  });
  const deps = {
    auth: createAuthenticator(options.db, options),
    mutator: createMutator(options.db, credentialResponseCodec(options.sessionEncryptionKey)),
  };
  registerAuthRoutes(app, options, deps);
  registerProjectRoutes(app, options, deps, assertNoActiveProjectExecution);
  registerTicketRoutes(app, options, deps, { execution: createExecutionAuthority() });
  registerExecutionRoutes(app, options, deps);
  registerGatewayRoutes(app, options, deps, input.gatewayProjectionPolicy);
  registerModelRoutes(app, options, deps, input.modelPorts);
  await input.configure?.(app, options, deps);
  return app;
}
export async function modelFixture(
  db: Db,
  config: {
    projectionPolicy?: GatewayProjectionPolicy;
    modelPorts?: ModelRouteOptions;
    configure?: (app: FastifyInstance, options: ServerOptions, deps: RouteDependencies) => Promise<void>;
    authorizeDispatch?: AuthorizeDispatch;
    prior?: { identity: HttpIdentity; machineId: string; token: string };
    now?: () => Date;
  } = {},
) {
  const container = process.env.CREW_V2_TEST_CONTAINER_ID;
  if (container && !fixtureContainers.has(container)) {
    fixtureContainers.add(container);
    console.info(
      'model-fixture-container',
      JSON.stringify({ containerId: container, url: process.env.CREW_V2_TEST_DATABASE_URL }),
    );
  }
  const identity = config.prior?.identity ?? {
    password: randomBytes(24).toString('hex'),
    cookie: '',
    csrf: '',
    key: randomBytes(32),
  };
  if (!config.prior) await bootstrapOwner(db, identity.password);
  const app = await buildModelApp({
    db,
    publicOrigin: 'http://localhost:5182',
    secureCookies: false,
    sessionEncryptionKey: identity.key,
    now: config.now ?? (() => new Date()),
    gatewayProjectionPolicy: config.projectionPolicy,
    modelPorts: config.modelPorts,
    configure: config.configure,
    authorizeDispatch: config.authorizeDispatch,
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<HttpResponse> {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      statusCode: response.status,
      headers: response.headers,
      text,
      json: <T>() => JSON.parse(text) as T,
    };
  }
  if (!config.prior) {
    const login = await request(
      '/v2/auth/session',
      'POST',
      { password: identity.password },
      { origin: 'http://localhost:5182' },
    );
    assert.equal(login.statusCode, 200, login.text);
    identity.cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    identity.csrf = login.json<{ csrfToken: string }>().csrfToken;
  }
  const ownerWrite = (path: string, method: string, body: unknown, key: string = randomUUID()) =>
    request(path, method, body, {
      cookie: identity.cookie,
      origin: 'http://localhost:5182',
      'x-csrf-token': identity.csrf,
      'idempotency-key': key,
    });
  const machineWrite = (path: string, token: string, body: unknown, key: string = randomUUID()) =>
    request(path, 'POST', body, { authorization: `Bearer ${token}`, 'idempotency-key': key });
  let machineId: string, token: string;
  if (config.prior) {
    machineId = config.prior.machineId;
    token = config.prior.token;
  } else {
    const response = await ownerWrite('/v2/machines', 'POST', { name: 'gateway-test' });
    assert.equal(response.statusCode, 201, response.text);
    const provisioned = response.json<{ machine: { id: string }; token: string }>();
    machineId = provisioned.machine.id;
    token = provisioned.token;
  }
  return {
    app,
    url,
    identity,
    request,
    machineId,
    token,
    prior: { identity, machineId, token },
    machineWrite,
    owner: {
      put: (path: string, body: unknown, key?: string) => ownerWrite(path, 'PUT', body, key),
      post: (path: string, body: unknown, key?: string) => ownerWrite(path, 'POST', body, key),
      get: (path: string) => request(path, 'GET', undefined, { cookie: identity.cookie }),
    },
    machine: {
      post: (path: string, body: unknown, key?: string) => machineWrite(path, token, body, key),
      get: (path: string) => request(path, 'GET', undefined, { authorization: `Bearer ${token}` }),
    },
    close: () => app.close(),
  };
}
