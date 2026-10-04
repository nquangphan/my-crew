import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

// The wiring modules import .tsx files, so they are loaded through Vite's SSR transform exactly as the app
// compiles them; Node's own type stripping cannot read JSX.
type Runtime = typeof import('../src/app-runtime.ts');
let server: ViteDevServer;
let runtime: Runtime;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  runtime = (await server.ssrLoadModule('/src/app-runtime.ts')) as Runtime;
});

after(async () => {
  await server.close();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Log = { method: string; url: string };

/** Authenticated owner API: session GET, empty event page, a stream that stays open until aborted. */
function fakeApi(authenticated = true) {
  const log: Log[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    log.push({ method: init.method ?? 'GET', url });
    if (url === '/v2/auth/session' && (init.method ?? 'GET') === 'GET')
      return authenticated
        ? json({ owner: { id: 'owner' }, csrfToken: 'a'.repeat(64) })
        : json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401);
    if (url === '/v2/auth/session' && init.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.startsWith('/v2/events/stream')) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener('abort', () => {
            try {
              controller.error(new DOMException('aborted', 'AbortError'));
            } catch {
              // already closed
            }
          });
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    if (url.startsWith('/v2/events')) return json({ items: [], cursor: '0' });
    if (url === '/v2/projects/flaky')
      return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } }, 503);
    return json({ ok: true });
  };
  return { fetch, log };
}

test('the event stream starts before the first protected GET', async () => {
  const api = fakeApi();
  const app = runtime.createAppRuntime({ fetch: api.fetch });
  // A protected view mounts after the runtime and fetches as soon as the session is authenticated.
  app.session.subscribe(() => {
    if (app.session.snapshot().state === 'authenticated')
      void app.client.get('/v2/projects/first').catch(() => undefined);
  });
  await app.session.bootstrap();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const urls = api.log.map((entry) => entry.url);
  const catchUp = urls.findIndex((url) => url.startsWith('/v2/events?after='));
  const firstGet = urls.indexOf('/v2/projects/first');
  assert.ok(catchUp >= 0 && firstGet >= 0, urls.join(','));
  assert.ok(catchUp < firstGet, `catch-up ${catchUp} must precede first data GET ${firstGet}`);
  app.dispose();
});

test('query defaults disable retry because OwnerClient.get retries itself, and keep focus/reconnect refetch', async () => {
  const api = fakeApi();
  const app = runtime.createAppRuntime({ fetch: api.fetch });
  const options = app.queryClient.getDefaultOptions().queries;
  assert.equal(options?.retry, false);
  assert.equal(options?.refetchOnWindowFocus, true);
  assert.equal(options?.refetchOnReconnect, true);
  let calls = 0;
  await assert.rejects(
    app.queryClient.fetchQuery({
      queryKey: ['v2', 'projects'],
      queryFn: () => {
        calls++;
        return Promise.reject(new Error('boom'));
      },
    }),
  );
  assert.equal(calls, 1);
  app.dispose();
});

test('an unauthenticated protected route is sent to login with an internal return path', async () => {
  const api = fakeApi(false);
  const app = runtime.createAppRuntime({ fetch: api.fetch });
  const access = await runtime.authorizeRoute(app.session, {
    pathname: '/projects/p1',
    searchStr: '?tab=docs',
    hash: 'x',
  });
  assert.deepEqual(access, { allowed: false, returnTo: '/crew-v2/projects/p1?tab=docs#x' });
  assert.equal(
    api.log.some((entry) => entry.url.startsWith('/v2/events')),
    false,
    'no stream for a guest',
  );
  app.dispose();
  const ok = fakeApi(true);
  const owner = runtime.createAppRuntime({ fetch: ok.fetch });
  assert.deepEqual(await runtime.authorizeRoute(owner.session, { pathname: '/' }), { allowed: true });
  owner.dispose();
});

test('the login return route accepts only internal /crew-v2/ paths', () => {
  assert.equal(
    runtime.parseLoginSearch({ returnTo: '/crew-v2/projects/p1' }).returnTo,
    '/crew-v2/projects/p1',
  );
  for (const hostile of [
    'https://evil.example/crew-v2/',
    '//evil.example/crew-v2/',
    '/crew-v2/../admin',
    '/other/path',
    '/crew-v2/\\evil',
    'javascript:alert(1)',
  ])
    assert.equal(runtime.parseLoginSearch({ returnTo: hostile }).returnTo, '/crew-v2/', hostile);
  assert.equal(runtime.parseLoginSearch({}).returnTo, '/crew-v2/');
  assert.equal(runtime.parseLoginSearch({ returnTo: 42 }).returnTo, '/crew-v2/');
});

test('logout wipes the query cache and closes the event stream', async () => {
  const api = fakeApi();
  const app = runtime.createAppRuntime({ fetch: api.fetch });
  await app.session.bootstrap();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app.events.status(), 'live');
  app.queryClient.setQueryData(['v2', 'projects'], ['secret-project']);
  await app.session.logout();
  assert.equal(app.events.status(), 'stopped');
  assert.equal(app.queryClient.getQueryData(['v2', 'projects']), undefined);
  assert.equal(app.session.snapshot().state, 'guest');
  app.dispose();
});

test('session expiry stops the stream and drops the cache so the route boundary asks for re-authentication', async () => {
  const api = fakeApi();
  const app = runtime.createAppRuntime({ fetch: api.fetch });
  await app.session.bootstrap();
  app.queryClient.setQueryData(['v2', 'projects'], ['x']);
  app.session.expire();
  assert.equal(app.session.snapshot().state, 'expired');
  assert.equal(app.events.status(), 'stopped');
  assert.equal(app.queryClient.getQueryData(['v2', 'projects']), undefined);
  const access = await runtime.authorizeRoute(app.session, { pathname: '/' });
  assert.deepEqual(access, { allowed: false, returnTo: '/crew-v2/' });
  app.dispose();
});
