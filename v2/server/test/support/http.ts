import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';
import { bootstrapOwner } from '../../src/auth/bootstrap.ts';
import type { DocsImport, ImportResult } from '../../src/docs/contracts.ts';
import type { Db, ServerOptions } from '../../src/platform/contracts.ts';

export type HttpResponse = {
  statusCode: number;
  headers: Headers;
  json: <T = Record<string, unknown>>() => T;
  text: string;
};
export type HttpIdentity = { password: string; cookie: string; csrf: string; key: Buffer };
export async function apiFixture(
  db: Db,
  config: {
    prior?: HttpIdentity;
    authority?: Partial<Pick<ServerOptions, 'authorizeDispatch' | 'verifyFinalResult'>>;
    now?: () => Date;
  } = {},
) {
  const identity = config.prior ?? {
    password: randomBytes(24).toString('hex'),
    cookie: '',
    csrf: '',
    key: randomBytes(32),
  };
  if (!config.prior) await bootstrapOwner(db, identity.password);
  const app: FastifyInstance = await buildApp({
    db,
    publicOrigin: 'http://localhost:5182',
    secureCookies: false,
    sessionEncryptionKey: identity.key,
    now: config.now ?? (() => new Date()),
    ...config.authority,
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
    const response = await request(
      '/v2/auth/session',
      'POST',
      { password: identity.password },
      { origin: 'http://localhost:5182' },
    );
    assert.equal(response.statusCode, 200, response.text);
    identity.cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    identity.csrf = response.json<{ csrfToken: string }>().csrfToken;
  }
  const ownerWrite = (path: string, method: string, body: unknown, key: string = randomUUID()) =>
    request(path, method, body, {
      cookie: identity.cookie,
      origin: 'http://localhost:5182',
      'x-csrf-token': identity.csrf,
      'idempotency-key': key,
    });
  const machineWrite = (
    path: string,
    token: string,
    body: unknown,
    key: string = randomUUID(),
    method = 'POST',
  ) => request(path, method, body, { authorization: `Bearer ${token}`, 'idempotency-key': key });
  return {
    app,
    url,
    identity,
    request,
    ownerPost: (path: string, body: unknown, key?: string) => ownerWrite(path, 'POST', body, key),
    ownerPut: (path: string, body: unknown, key?: string) => ownerWrite(path, 'PUT', body, key),
    ownerGet: (path: string) => request(path, 'GET', undefined, { cookie: identity.cookie }),
    machineGet: (path: string, token: string) =>
      request(path, 'GET', undefined, { authorization: `Bearer ${token}` }),
    machineWrite,
    import: async (input: DocsImport, key?: string) => {
      const result = await ownerWrite('/v2/docs/imports', 'POST', input, key);
      assert.equal(result.statusCode, 201, result.text);
      return result.json<ImportResult>();
    },
    close: () => app.close(),
  };
}
