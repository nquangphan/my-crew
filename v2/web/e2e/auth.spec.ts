/**
 * A2: owner session recovery on the real API/PostgreSQL fixture. The production `SessionBoundary`/`LoginScreen`
 * are mounted into a test-owned root on the fixture's Vite page (router wiring belongs to the controller);
 * every request goes through the `/v2` proxy to the real API. Session expiry is produced only through the
 * fixture's database, never through a production endpoint.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';
import { connectDb } from '../../server/src/db/client.ts';
import type { OwnerClient } from '../src/lib/api.ts';
import type { PendingStore } from '../src/lib/pending-operation.ts';
import type { SessionController } from '../src/lib/session.ts';
import { type FixtureHandle, withFixture } from './support/fixture.ts';

type Harness = {
  session: SessionController;
  pending: PendingStore;
  client: OwnerClient;
  cacheClears: number;
  lastError: string | null;
};
type Captured = { method: string; url: string; headers: Record<string, string>; body: string | null };

const evidence = (name: string) =>
  fileURLToPath(new URL(`../../../plans/261002-0002-crew-v2/execution-phase07/${name}`, import.meta.url));

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

/** Expire every live owner session by moving `expires_at` into the past (fixture DB test support only). */
async function expireSessions(crew: FixtureHandle): Promise<void> {
  await withDb(
    crew,
    (db) => db`update sessions set expires_at = now() - interval '1 second' where revoked_at is null`,
  );
}

function capture(page: Page): Captured[] {
  const captured: Captured[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/v2/'))
      captured.push({
        method: request.method(),
        url: request.url(),
        headers: request.headers(),
        body: request.postData(),
      });
  });
  return captured;
}

/** Mount the real auth components with the same optimized React instance Vite serves to the app. */
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
    const boundaryModule = (await load(
      '/crew-v2/src/auth/session-boundary.tsx',
    )) as typeof import('../src/auth/session-boundary.tsx');
    const session = new sessionModule.SessionController();
    const pending = new pendingModule.PendingStore(window.sessionStorage);
    // Lost-response cases must surface as unconfirmed instead of being healed by an automatic retry.
    const client = apiModule.createOwnerClient({ session, pending, maxRetries: 0 });
    const harness = { session, pending, client, cacheClears: 0, lastError: null as string | null };
    boundaryModule.wireSession({
      session,
      pending,
      cache: {
        cancelQueries: async () => undefined,
        clear: () => {
          harness.cacheClears++;
        },
      },
      window,
    });
    (window as unknown as { crewTest: typeof harness }).crewTest = harness;
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
        returnTo: '/crew-v2/projects',
        children: React.createElement('p', { 'data-testid': 'protected' }, 'Nội dung được bảo vệ'),
      }),
    );
  });
}

async function login(page: Page, password: string, button: 'Đăng nhập' | 'Đăng nhập lại'): Promise<void> {
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: button, exact: true }).click();
}

/** Abort the browser side of the first matching POST after the server committed it. */
async function loseFirstResponse(page: Page, path: string): Promise<{ status: number | null }> {
  const result = { status: null as number | null };
  let armed = true;
  await page.route(`**${path}`, async (route) => {
    if (armed && route.request().method() === 'POST') {
      armed = false;
      const response = await route.fetch();
      result.status = response.status();
      await route.abort('connectionreset');
      return;
    }
    await route.fallback();
  });
  return result;
}

test('A2: mất response → phiên hết hạn → đăng nhập lại cùng owner → replay đúng key/body → một project/receipt', async ({
  page,
  crew,
}) => {
  const requests = capture(page);
  await mountHarness(page, crew);
  await expect(page.getByRole('heading', { name: 'Đăng nhập Crew' })).toBeVisible();
  await page.locator('#task2-harness').screenshot({ path: evidence('task-2-login.png') });

  await login(page, `sai-${randomUUID()}`, 'Đăng nhập');
  await expect(page.getByRole('alert')).toContainText('Mật khẩu không đúng');
  await expect(page.getByLabel('Mật khẩu')).toHaveValue('');
  await login(page, crew.ownerPassword, 'Đăng nhập');
  await expect(page.getByTestId('protected')).toBeVisible();

  const lost = await loseFirstResponse(page, '/v2/projects');
  const operationId = await page.evaluate(async () => {
    const harness = (window as unknown as { crewTest: Harness }).crewTest;
    const operation = harness.pending.begin({
      intentId: 'create-project-a2',
      method: 'POST',
      path: '/v2/projects',
      body: { key: 'ATWO', name: 'Dự án A2', repositoryUrl: null },
      storage: 'tab',
    });
    try {
      await harness.client.mutate(operation);
    } catch (error) {
      harness.lastError = (error as { code?: string }).code ?? 'UNKNOWN';
    }
    return operation.id;
  });
  expect(lost.status).toBe(201);
  expect(await page.evaluate(() => (window as unknown as { crewTest: Harness }).crewTest.lastError)).toBe(
    'UNCONFIRMED',
  );
  await withDb(crew, async (db) => {
    const [row] = await db`select count(*)::int as count from projects where key = 'ATWO'`;
    expect(row?.count).toBe(1);
  });
  const panel = page.getByTestId('recovery-panel');
  await expect(panel).toContainText('Chưa xác nhận');

  await expireSessions(crew);
  await panel.getByRole('button', { name: 'Gửi lại đúng yêu cầu cũ' }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập lại để tiếp tục' })).toBeVisible();
  await expect(page.getByTestId('recovery-panel')).toHaveCount(0);
  await expect(page.locator('#task2-harness')).not.toContainText('ATWO');
  await page.locator('#task2-harness').screenshot({ path: evidence('task-2-expired.png') });

  const beforeBlocked = requests.filter((request) => request.method === 'POST').length;
  const blocked = await page.evaluate(async () => {
    const harness = (window as unknown as { crewTest: Harness }).crewTest;
    const operation = harness.pending.begin({
      intentId: 'blocked-while-expired',
      method: 'POST',
      path: '/v2/projects',
      body: { key: 'BLOCKED', name: 'Không được gửi', repositoryUrl: null },
      storage: 'tab',
    });
    let code = 'SENT';
    try {
      await harness.client.mutate(operation);
    } catch (error) {
      code = (error as { code?: string }).code ?? 'UNKNOWN';
    }
    harness.pending.reject(operation.id);
    return { code, suspended: harness.pending.list().map((item) => item.state) };
  });
  expect(blocked.code).toBe('SESSION_REQUIRED');
  expect(blocked.suspended).toEqual(['suspended']);
  expect(requests.filter((request) => request.method === 'POST').length).toBe(beforeBlocked);
  expect(await page.evaluate(() => (window as unknown as { crewTest: Harness }).crewTest.cacheClears)).toBe(
    1,
  );

  await login(page, crew.ownerPassword, 'Đăng nhập lại');
  await expect(page.getByTestId('recovery-panel')).toContainText('Tạm dừng vì hết phiên');
  await page.locator('#task2-harness').screenshot({ path: evidence('task-2-recovery.png') });
  await page.getByRole('button', { name: 'Gửi lại đúng yêu cầu cũ' }).click();
  await expect(page.getByTestId('recovery-panel')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { crewTest: Harness }).crewTest.pending.list().length),
  ).toBe(0);

  const writes = requests.filter(
    (request) => request.method === 'POST' && new URL(request.url).pathname === '/v2/projects',
  );
  expect(writes).toHaveLength(3);
  expect(new Set(writes.map((request) => request.headers['idempotency-key']))).toEqual(
    new Set([operationId]),
  );
  expect(new Set(writes.map((request) => request.body)).size).toBe(1);
  expect(writes[2]?.headers['x-csrf-token']).not.toBe(writes[0]?.headers['x-csrf-token']);
  const loginPosts = requests.filter(
    (request) => request.method === 'POST' && new URL(request.url).pathname === '/v2/auth/session',
  );
  for (const request of loginPosts) {
    expect(request.headers['x-csrf-token']).toBeUndefined();
    expect(request.headers['idempotency-key']).toBeUndefined();
  }
  await withDb(crew, async (db) => {
    const [projects] = await db`select count(*)::int as count from projects where key = 'ATWO'`;
    const [receipts] =
      await db`select count(*)::int as count from idempotency where route = 'POST:/v2/projects' and key = ${operationId}`;
    const [events] =
      await db`select count(*)::int as count from events e join projects p on p.id = e.project_id where p.key = 'ATWO' and e.type = 'project.created'`;
    const [blockedRows] = await db`select count(*)::int as count from projects where key = 'BLOCKED'`;
    expect([projects?.count, receipts?.count, events?.count, blockedRows?.count]).toEqual([1, 1, 1, 0]);
  });
});

test('logout chỉ giữ tombstone; payload khác cùng key bị 409 và giữ tombstone; secret không vào sessionStorage', async ({
  page,
  crew,
}) => {
  const requests = capture(page);
  await mountHarness(page, crew);
  await expect(page.getByRole('heading', { name: 'Đăng nhập Crew' })).toBeVisible();
  await login(page, crew.ownerPassword, 'Đăng nhập');
  await expect(page.getByTestId('protected')).toBeVisible();

  await loseFirstResponse(page, '/v2/projects');
  const secret = `sk-e2e-${randomUUID()}`;
  const ids = await page.evaluate(
    async ({ secretValue, machineId }) => {
      const harness = (window as unknown as { crewTest: Harness }).crewTest;
      const operation = harness.pending.begin({
        intentId: 'create-project-b',
        method: 'POST',
        path: '/v2/projects',
        body: { key: 'BTWO', name: 'Dự án B', repositoryUrl: null },
        storage: 'tab',
      });
      try {
        await harness.client.mutate(operation);
      } catch {
        // Unconfirmed by design.
      }
      const secretOperation = harness.pending.begin({
        intentId: 'provider-secret',
        method: 'POST',
        path: `/v2/machines/${machineId}/api-providers/main/secret`,
        body: { expectedRevision: 1, keyId: machineId, operationId: machineId, secret: secretValue },
        storage: 'memory',
      });
      return { project: operation.id, secret: secretOperation.id };
    },
    { secretValue: secret, machineId: randomUUID() },
  );
  const storageBefore = await page.evaluate(() => JSON.stringify({ ...window.sessionStorage }));
  expect(storageBefore).not.toContain(secret);
  expect(storageBefore).toContain(ids.project);

  await page.evaluate(() => (window as unknown as { crewTest: Harness }).crewTest.session.logout());
  await expect(page.getByRole('heading', { name: 'Đăng nhập Crew' })).toBeVisible();
  const logout = requests.find((request) => request.method === 'DELETE');
  expect(logout?.headers['x-csrf-token']).toMatch(/^[0-9a-f]{64}$/);
  expect(logout?.headers['idempotency-key']).toBeUndefined();
  const storageAfter = await page.evaluate(() => JSON.stringify({ ...window.sessionStorage }));
  for (const forbidden of [secret, 'BTWO', 'Dự án B', 'bodyJson'])
    expect(storageAfter, forbidden).not.toContain(forbidden);
  const tombstones = await page.evaluate(() =>
    (window as unknown as { crewTest: Harness }).crewTest.pending.tombstones().map((item) => item.id),
  );
  expect(new Set(tombstones)).toEqual(new Set([ids.project, ids.secret]));
  await expect(page.locator('#task2-harness')).not.toContainText('BTWO');

  await login(page, crew.ownerPassword, 'Đăng nhập');
  await expect(page.getByTestId('recovery-panel')).toContainText('Chưa thể xác nhận yêu cầu cũ');
  const outcome = await page.evaluate(async (projectId) => {
    const harness = (window as unknown as { crewTest: Harness }).crewTest;
    let newKey = 'ISSUED';
    try {
      harness.pending.begin({
        intentId: 'create-project-b',
        method: 'POST',
        path: '/v2/projects',
        body: { key: 'BTWO', name: 'Dự án B', repositoryUrl: null },
        storage: 'tab',
      });
    } catch (error) {
      newKey = (error as Error).message;
    }
    let wrong = 'SENT';
    try {
      await harness.client.mutate(
        harness.pending.resume(projectId, { key: 'BTWO', name: 'Nội dung khác', repositoryUrl: null }, 'tab'),
      );
    } catch (error) {
      wrong = (error as { code?: string }).code ?? 'UNKNOWN';
    }
    const keptAfterConflict = harness.pending.tombstones().some((item) => item.id === projectId);
    const accepted = await harness.client.mutate<{ key: string }>(
      harness.pending.resume(projectId, { key: 'BTWO', name: 'Dự án B', repositoryUrl: null }, 'tab'),
    );
    return { newKey, wrong, keptAfterConflict, acceptedKey: accepted.key };
  }, ids.project);
  expect(outcome).toEqual({
    newKey: 'INTENT_UNRESOLVED',
    wrong: 'IDEMPOTENCY_CONFLICT',
    keptAfterConflict: true,
    acceptedKey: 'BTWO',
  });
  const keyed = requests.filter((request) => request.headers['idempotency-key'] === ids.project);
  expect(keyed).toHaveLength(3);
  expect(requests.some((request) => request.url.includes('/secret'))).toBe(false);
  await withDb(crew, async (db) => {
    const [projects] = await db`select count(*)::int as count from projects where key = 'BTWO'`;
    const [receipts] = await db`select count(*)::int as count from idempotency where key = ${ids.project}`;
    expect([projects?.count, receipts?.count]).toEqual([1, 1]);
  });

  // Fresh document load of the same tab: sessionStorage survives, memory payloads do not.
  await mountHarness(page, crew);
  await expect(page.getByTestId('recovery-panel')).toContainText('Chưa thể xác nhận yêu cầu cũ');
  const reloaded = await page.evaluate(() => ({
    storage: JSON.stringify({ ...window.sessionStorage }),
    tombstones: (window as unknown as { crewTest: Harness }).crewTest.pending
      .tombstones()
      .map((item) => item.id),
  }));
  expect(reloaded.tombstones).toEqual([ids.secret]);
  expect(reloaded.storage).not.toContain(secret);
});
