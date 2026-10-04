import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

// The router imports .tsx modules, so it is loaded through Vite's SSR transform like app-wiring.test.ts.
type Runtime = typeof import('../src/app-runtime.ts');
type RouterModule = typeof import('../src/router.tsx');
let server: ViteDevServer;
let runtime: Runtime;
let routerModule: RouterModule;

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
  routerModule = (await server.ssrLoadModule('/src/router.tsx')) as RouterModule;
});

after(async () => {
  await server.close();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeApi(authenticated: boolean) {
  const fetch = async (url: string, init: RequestInit = {}) => {
    if (url === '/v2/auth/session' && (init.method ?? 'GET') === 'GET')
      return authenticated
        ? json({ owner: { id: 'owner' }, csrfToken: 'a'.repeat(64) })
        : json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401);
    if (url === '/v2/auth/session' && init.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.startsWith('/v2/events/stream'))
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            init.signal?.addEventListener('abort', () => {
              try {
                controller.error(new DOMException('aborted', 'AbortError'));
              } catch {
                // already closed
              }
            });
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    if (url.startsWith('/v2/events')) return json({ items: [], cursor: '0' });
    return json({ ok: true });
  };
  return fetch;
}

const ticketId = '0197a3c2-7d1e-7a40-8b53-2f6a1c4d9e10';
const projectId = '0197a3c2-7d1e-7a40-8b53-2f6a1c4d9e11';

// `router.load()` takes the server path under Vite SSR, so route matching (path, params, validated search)
// is checked through `matchRoutes`; the guest redirect and the real browser flow are covered by e2e.
function match(pathname: string, search: Record<string, unknown> = {}) {
  const app = runtime.createAppRuntime({ fetch: fakeApi(true) });
  const router = routerModule.createAppRouter(app);
  const matches = router.matchRoutes(pathname, search);
  app.dispose();
  return matches;
}

test('ticket deep link mounts the ticket page route for any id, so an unknown id reaches the 404 view', () => {
  for (const id of [ticketId, '0197a3c2-7d1e-7a40-8b53-ffffffffffff', 'khong-phai-uuid']) {
    const matches = match(`/tickets/${id}`);
    const last = matches.at(-1);
    assert.equal(last?.routeId, '/protected/tickets/$ticketId', id);
    assert.deepEqual({ ...last?.params }, { ticketId: id });
    assert.equal(
      matches.some((entry) => entry.routeId === '/protected'),
      true,
      'the ticket page sits under the owner-protected layout',
    );
  }
});

test('the project tickets route sits under the owner layout and keeps its filters in the search', () => {
  const matches = match(`/projects/${projectId}/tickets`, {
    view: 'list',
    status: 'ready',
    kind: 'code',
    rootId: ticketId,
  });
  const last = matches.at(-1);
  assert.equal(last?.routeId, '/protected/projects/$projectId/tickets');
  assert.deepEqual({ ...last?.params }, { projectId });
  assert.deepEqual({ ...last?.search }, { view: 'list', status: 'ready', kind: 'code', rootId: ticketId });
  assert.equal(match(`/projects/${projectId}`).at(-1)?.routeId, '/protected/projects/$projectId');
});

test('the project docs route sits under the owner layout and passes the path through', () => {
  const last = match(`/projects/${projectId}/docs`, { path: 'docs/tài-liệu/index.md' }).at(-1);
  assert.equal(last?.routeId, '/protected/projects/$projectId/docs');
  assert.deepEqual({ ...last?.params }, { projectId });
});

test('parseDocsSearch keeps only a sane non-empty string path', () => {
  assert.deepEqual(runtime.parseDocsSearch({ path: 'docs/a.md' }), { path: 'docs/a.md' });
  for (const bad of [{}, { path: '' }, { path: 5 }, { path: 'x'.repeat(1025) }])
    assert.deepEqual(runtime.parseDocsSearch(bad), {});
});

test('parseTicketsSearch defaults to the board and keeps only producer filters', () => {
  assert.deepEqual(runtime.parseTicketsSearch({}), { view: 'board' });
  assert.deepEqual(runtime.parseTicketsSearch({ view: 'grid', status: 'nope', kind: 'x', rootId: 'abc' }), {
    view: 'board',
  });
  assert.deepEqual(
    runtime.parseTicketsSearch({
      view: 'list',
      status: 'running',
      kind: 'research',
      rootId: ticketId.toUpperCase(),
    }),
    { view: 'list', status: 'running', kind: 'research', rootId: ticketId },
  );
  assert.deepEqual(runtime.parseTicketsSearch({ projectId, view: 'list' }), { view: 'list' });
  assert.deepEqual(runtime.parseTicketsSearch({ view: 'requests' }), { view: 'requests' });
});

test('the runtime provides compose services built from its own client, pending store and session', () => {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  const app = runtime.createAppRuntime({ fetch: fakeApi(true), storage });
  assert.equal(app.composeServices.client, app.client);
  assert.equal(app.composeServices.pending, app.pending);
  assert.equal(app.composeServices.session, app.session);
  assert.equal(app.composeServices.storage, storage);
  app.dispose();
  const bare = runtime.createAppRuntime({ fetch: fakeApi(true) });
  assert.equal(bare.composeServices.storage, null);
  bare.dispose();
});

/** Tab storage with enumeration, like `sessionStorage`. */
function tabStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const draftKeys = {
  'crew-v2:form-draft:create-request': '{"title":"bản nháp"}',
  [`crew-v2:form-draft:comment:${ticketId}`]: 'bình luận dở',
};

test('logout wipes form drafts of a reloaded page that never opened a ticket, and keeps unrelated keys', async () => {
  // A reload creates a fresh runtime over the same tab storage; no draft store exists in this page.
  const storage = tabStorage({ ...draftKeys, 'unrelated:key': 'giữ' });
  const app = runtime.createAppRuntime({ fetch: fakeApi(true), storage });
  await app.session.bootstrap();
  assert.equal(storage.map.size, 3);
  await app.session.logout();
  assert.deepEqual([...storage.map.keys()], ['unrelated:key']);
  app.dispose();
});

// The "logout, then reload as guest" path is covered only in the browser (e2e/ticket-routes.spec.ts): a guest
// page never writes drafts, so a unit test of it would pass with or without the logout wipe above.
