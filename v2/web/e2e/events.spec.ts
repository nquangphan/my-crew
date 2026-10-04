/**
 * Real SSE through the fixture's Vite `/v2` proxy: catch-up GET, fetch stream with Last-Event-ID, invalidation
 * from a real `project.created` event, and stream shutdown when the session expires in the fixture DB.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { connectDb } from '../../server/src/db/client.ts';
import type { OwnerClient } from '../src/lib/api.ts';
import type { EventSync } from '../src/lib/events.ts';
import type { PendingStore } from '../src/lib/pending-operation.ts';
import type { SessionController } from '../src/lib/session.ts';
import { type FixtureHandle, withFixture } from './support/fixture.ts';

type Harness = {
  session: SessionController;
  pending: PendingStore;
  client: OwnerClient;
  events: EventSync;
  invalidated: string[];
};
type Captured = { method: string; path: string; search: string; headers: Record<string, string> };

const test = base.extend<Record<never, never>, { crew: FixtureHandle }>({
  crew: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern for fixture deps.
    async ({}, use) => {
      await withFixture(async (handle) => {
        await use(handle);
      });
    },
    { scope: 'worker', timeout: 180_000 },
  ],
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function withDb<T>(
  crew: FixtureHandle,
  run: (db: ReturnType<typeof connectDb>) => Promise<T>,
): Promise<T> {
  const db = connectDb(`postgres://postgres@127.0.0.1:${crew.dbPort}/${crew.dbName}`);
  try {
    return await run(db);
  } finally {
    await db.end({ timeout: 2 });
  }
}

async function mountHarness(page: Page, crew: FixtureHandle): Promise<void> {
  await page.goto(`${crew.webOrigin}/crew-v2/`);
  await page.waitForSelector('.app-shell');
  await page.evaluate(async () => {
    const load = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);
    const entry = await (await fetch('/crew-v2/src/main.tsx')).text();
    const dep = async (name: string) => {
      const url = [...entry.matchAll(/["']([^"']*\/\.vite\/deps\/[^"']+)["']/g)]
        .map((match) => match[1] ?? '')
        .find((candidate) => (candidate.split('/').pop() ?? '').startsWith(`${name}.js`));
      if (!url) throw new Error(`DEP_NOT_FOUND:${name}`);
      return (await load(url)) as Record<string, unknown> & { default?: Record<string, unknown> };
    };
    const reactModule = await dep('react');
    const React = (reactModule.default ?? reactModule) as typeof import('react');
    const domModule = await dep('react-dom_client');
    const { createRoot } = (
      domModule.createRoot ? domModule : domModule.default
    ) as typeof import('react-dom/client');
    const sessionModule = (await load(
      '/crew-v2/src/lib/session.ts',
    )) as typeof import('../src/lib/session.ts');
    const pendingModule = (await load(
      '/crew-v2/src/lib/pending-operation.ts',
    )) as typeof import('../src/lib/pending-operation.ts');
    const apiModule = (await load('/crew-v2/src/lib/api.ts')) as typeof import('../src/lib/api.ts');
    const eventsModule = (await load('/crew-v2/src/lib/events.ts')) as typeof import('../src/lib/events.ts');
    const boundaryModule = (await load(
      '/crew-v2/src/auth/session-boundary.tsx',
    )) as typeof import('../src/auth/session-boundary.tsx');
    const session = new sessionModule.SessionController();
    const pending = new pendingModule.PendingStore(window.sessionStorage);
    const client = apiModule.createOwnerClient({ session, pending });
    const invalidated: string[] = [];
    const events = new eventsModule.EventSync({
      session,
      cursorStore: eventsModule.tabCursorStore(window.sessionStorage),
      invalidate: (keys) => {
        invalidated.push(...keys.map((key) => JSON.stringify(key)));
      },
    });
    boundaryModule.wireSession({
      session,
      pending,
      events,
      cache: { cancelQueries: async () => undefined, clear: () => undefined },
      window,
    });
    (window as unknown as { crewTest: Harness }).crewTest = { session, pending, client, events, invalidated };
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    const mount = document.createElement('main');
    mount.id = 'task2-harness';
    mount.className = 'workspace__main';
    document.body.append(mount);
    createRoot(mount).render(
      React.createElement(boundaryModule.SessionBoundary, {
        session,
        pending,
        client,
        children: React.createElement('p', { 'data-testid': 'protected' }, 'Nội dung được bảo vệ'),
      }),
    );
  });
}

type Observed = { status: string; applied: string; state: string; invalidated: string[] };
const observe = (page: Page): Promise<Observed> =>
  page.evaluate(() => {
    const harness = (window as unknown as { crewTest: Harness }).crewTest;
    return {
      status: harness.events.status(),
      applied: harness.events.applied(),
      state: harness.session.snapshot().state,
      invalidated: [...harness.invalidated],
    };
  });

test('SSE thật: latest cursor, catch-up rồi stream Last-Event-ID, event làm stale query, hết phiên đóng stream và nối lại sau reauth', async ({
  page,
  crew,
}) => {
  const requests: Captured[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/v2/events'))
      requests.push({
        method: request.method(),
        path: url.pathname,
        search: url.search,
        headers: request.headers(),
      });
  });
  await mountHarness(page, crew);
  await page.locator('#task2-harness').getByLabel('Mật khẩu').fill(crew.ownerPassword);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByTestId('protected')).toBeVisible();
  await expect.poll(() => observe(page).then((value) => value.status)).toBe('live');
  // A fresh tab anchors at the journal head instead of replaying from 0, then catches up from that cursor.
  expect(requests[0]).toMatchObject({ path: '/v2/events/latest', search: '' });
  expect(requests[1]?.path).toBe('/v2/events');
  expect(requests[1]?.search).toMatch(/^\?after=(0|[1-9][0-9]*)&limit=100$/);
  expect(await observe(page).then((value) => value.invalidated)).toContain(JSON.stringify(['v2']));
  const firstStream = requests.find((request) => request.path === '/v2/events/stream');
  expect(firstStream?.headers['last-event-id']).toMatch(/^(0|[1-9][0-9]*)$/);
  expect(requests.filter((request) => request.path === '/v2/events/stream')).toHaveLength(1);

  const created = await page.evaluate(async () => {
    const harness = (window as unknown as { crewTest: Harness }).crewTest;
    const operation = harness.pending.begin({
      intentId: 'create-project-events',
      method: 'POST',
      path: '/v2/projects',
      body: { key: 'EVT', name: 'Dự án sự kiện', repositoryUrl: null },
      storage: 'tab',
    });
    return harness.client.mutate<{ id: string }>(operation);
  });
  await expect
    .poll(() => observe(page).then((value) => value.invalidated), { timeout: 15_000 })
    .toContain(JSON.stringify(['v2', 'project', created.id]));
  const cursor = await withDb(crew, async (db) => {
    const [row] =
      await db`select max(cursor)::text as cursor from events where type = 'project.created' and project_id = ${created.id}`;
    return row?.cursor as string;
  });
  await expect.poll(() => observe(page).then((value) => value.applied)).toBe(cursor);
  expect(await page.evaluate(() => window.sessionStorage.getItem('crew-v2:event-cursor'))).toBe(cursor);
  expect(requests.filter((request) => request.path === '/v2/events/stream')).toHaveLength(1);

  await withDb(
    crew,
    (db) => db`update sessions set expires_at = now() - interval '1 second' where revoked_at is null`,
  );
  await expect(page.getByRole('heading', { name: 'Đăng nhập lại để tiếp tục' })).toBeVisible({
    timeout: 20_000,
  });
  expect(await observe(page).then((value) => value.status)).toBe('stopped');
  expect(await observe(page).then((value) => value.state)).toBe('expired');
  const afterExpiry = requests.length;

  await page.locator('#task2-harness').getByLabel('Mật khẩu').fill(crew.ownerPassword);
  await page.getByRole('button', { name: 'Đăng nhập lại', exact: true }).click();
  await expect(page.getByTestId('protected')).toBeVisible();
  await expect.poll(() => observe(page).then((value) => value.status)).toBe('live');
  const resumed = requests.slice(afterExpiry);
  expect(resumed[0]).toMatchObject({ path: '/v2/events', search: `?after=${cursor}&limit=100` });
  expect(resumed.find((request) => request.path === '/v2/events/stream')?.headers['last-event-id']).toBe(
    cursor,
  );
});
