import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { request as nativeRequest } from 'node:http';
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
  // An early real 413 may close the socket while fetch is still writing a large
  // body. This dedicated probe observes the response and stops only its own writes.
  const ownerOversizedPost = (
    path: '/v2/tickets' | '/v2/docs/imports',
    body: unknown,
    key: string = randomUUID(),
  ): Promise<HttpResponse> => {
    const bytes = Buffer.from(JSON.stringify(body));
    const limit = (path === '/v2/tickets' ? 1 : 24) * 1024 * 1024;
    assert(bytes.length > limit && bytes.length <= 26 * 1024 * 1024, 'Bounded oversized probe only');
    return new Promise((resolve, reject) => {
      let settled = false;
      let observedResponse = false;
      const request = nativeRequest(
        `${url}${path}`,
        {
          method: 'POST',
          agent: false,
          headers: {
            cookie: identity.cookie,
            origin: 'http://localhost:5182',
            'x-csrf-token': identity.csrf,
            'idempotency-key': key,
            'content-type': 'application/json',
            'content-length': bytes.length,
            connection: 'close',
          },
        },
        (response) => {
          observedResponse = true;
          const chunks: Buffer[] = [];
          let received = 0;
          response.on('error', fail);
          response.on('aborted', () => fail(new Error('OVERSIZE_RESPONSE_ABORTED')));
          response.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > 64 * 1024) {
              fail(new Error('OVERSIZE_RESPONSE_LIMIT'));
              response.destroy();
            } else chunks.push(chunk);
          });
          response.on('end', () => {
            if (settled) return;
            if (!response.complete || response.statusCode === undefined) {
              fail(new Error('OVERSIZE_RESPONSE_INCOMPLETE'));
              return;
            }
            const headers = new Headers();
            for (let i = 0; i < response.rawHeaders.length; i += 2)
              headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
            const text = Buffer.concat(chunks).toString('utf8');
            settled = true;
            clearTimeout(deadline);
            request.destroy();
            console.info(
              `HTTP oversized observed container=${process.env.CREW_V2_TEST_CONTAINER_ID} path=${path} bytes=${bytes.length} status=${response.statusCode}`,
            );
            resolve({ statusCode: response.statusCode, headers, text, json: <T>() => JSON.parse(text) as T });
          });
        },
      );
      const deadline = setTimeout(() => fail(new Error('OVERSIZE_RESPONSE_TIMEOUT')), 5000);
      function fail(error: Error): void {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        request.destroy();
        reject(error);
      }
      request.on('error', (error: NodeJS.ErrnoException) => {
        // Only a received HTTP response makes an early rejected-body write error
        // harmless. The response still has to finish and supply its real status.
        if (observedResponse && ['EPIPE', 'ECONNRESET'].includes(error.code ?? '')) return;
        fail(error);
      });
      request.flushHeaders();
      // Size rejection must happen from the declared oversized Content-Length.
      // Send one bounded prefix, then pause rather than racing more queued writes
      // against the early response. No response (including reset) fails the probe.
      // There is no second chunk to schedule even if this write applies backpressure.
      request.write(bytes.subarray(0, 64 * 1024));
    });
  };
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
    ownerOversizedPost,
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
