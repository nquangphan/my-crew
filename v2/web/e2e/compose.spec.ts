/**
 * A5 (text-only path) and the text-only part of A3: the shared composer through the real create-request form
 * and the ticket dialog comment box, on the real API/PostgreSQL of the Task1 fixture. The host only mounts the
 * production components (`TicketBoard` with its "Tạo yêu cầu" action, `TicketDialog`) inside the app's own
 * runtime; every request reaches the real producer. Playwright routes never fabricate data: they only drop
 * the browser side of a response after the server has committed it. Session expiry is produced through the
 * fixture's database. Submissions that carry files stay 503 EXTRACTION_NOT_CONFIGURED until an extractor
 * version is certified, and that outcome is asserted here instead of a fake success.
 */
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
  setFilters: (filters: Record<string, string>) => void;
};
type Captured = { method: string; path: string; headers: Record<string, string>; body: string | null };

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
test.describe.configure({ mode: 'serial', timeout: 150_000 });

const ticketSubmitPath = '/v2/attachment-submissions/tickets';
const commentSubmitPath = (ticketId: string) => `/v2/tickets/${ticketId}/attachment-comments`;
const ticketRoute = `POST:${ticketSubmitPath}`;

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

async function count(crew: FixtureHandle, run: (db: ReturnType<typeof connectDb>) => Promise<number>) {
  return withDb(crew, run);
}

const ticketsWithTitle = (crew: FixtureHandle, title: string) =>
  count(crew, async (db) => {
    const [row] = await db`select count(*)::int as count from tickets where title = ${title}`;
    return row?.count ?? -1;
  });

const receiptsForKey = (crew: FixtureHandle, route: string, key: string) =>
  count(crew, async (db) => {
    const [row] =
      await db`select count(*)::int as count from idempotency where route = ${route} and key = ${key}`;
    return row?.count ?? -1;
  });

const commentsWithText = (crew: FixtureHandle, text: string) =>
  count(crew, async (db) => {
    const [row] = await db`select count(*)::int as count from comments where text = ${text}`;
    return row?.count ?? -1;
  });

function capture(page: Page): Captured[] {
  const captured: Captured[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/v2/'))
      captured.push({
        method: request.method(),
        path: url.pathname,
        headers: request.headers(),
        body: request.postData(),
      });
  });
  return captured;
}

/**
 * Drop the browser side of every POST to `path` after the server answered it. The request still reaches the
 * producer (and commits), so the client sees a lost response; the same-key retries replay the stored answer
 * and are dropped too until `release()` is called.
 */
async function dropResponses(page: Page, path: string) {
  const state = { armed: true, served: [] as number[] };
  await page.route(`**${path}`, async (route) => {
    if (state.armed && route.request().method() === 'POST') {
      const response = await route.fetch();
      state.served.push(response.status());
      await route.abort('connectionreset');
      return;
    }
    await route.fallback();
  });
  return {
    state,
    release: () => {
      state.armed = false;
    },
  };
}

const ticketModules = [
  'board.tsx',
  'list.tsx',
  'dialog.tsx',
  'queries.ts',
  'requests.tsx',
  'create-request.tsx',
] as const;

/** The Vite dev server may reload once after discovering Radix; import first, then start from a fresh page. */
async function warmUp(page: Page, crew: FixtureHandle): Promise<void> {
  // Stable when every ticket module imports in one page and that page survives until the network is idle
  // (no optimizer reload replaced it); then start again from a fresh page.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto(`${crew.webOrigin}/crew-v2/`);
    await page.waitForSelector('.app-shell');
    const imported = await page
      .evaluate(async (modules) => {
        (window as unknown as { crewWarm?: boolean }).crewWarm = true;
        for (const name of modules) await import(/* @vite-ignore */ `/crew-v2/src/tickets/${name}`);
        return true;
      }, ticketModules)
      .catch(() => false);
    if (!imported) continue;
    await page.waitForLoadState('networkidle');
    const stable = await page
      .evaluate(() => (window as unknown as { crewWarm?: boolean }).crewWarm === true)
      .catch(() => false);
    if (!stable) continue;
    await page.goto(`${crew.webOrigin}/crew-v2/`);
    await page.waitForSelector('.app-shell');
    return;
  }
  throw new Error('VITE_WARM_UP_UNSTABLE');
}

/** Mounts only production components inside the app's own runtime; the host owns no network or entity logic. */
async function mountHost(page: Page, crew: FixtureHandle): Promise<void> {
  await warmUp(page, crew);
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
    const queryModule = (await dep(
      '@tanstack_react-query',
    )) as unknown as typeof import('@tanstack/react-query');
    const runtimeModule = (await load(
      '/crew-v2/src/app-runtime.ts',
    )) as typeof import('../src/app-runtime.ts');
    const boundaryModule = (await load(
      '/crew-v2/src/auth/session-boundary.tsx',
    )) as typeof import('../src/auth/session-boundary.tsx');
    const queries = (await load(
      '/crew-v2/src/tickets/queries.ts',
    )) as typeof import('../src/tickets/queries.ts');
    const boardModule = (await load(
      '/crew-v2/src/tickets/board.tsx',
    )) as typeof import('../src/tickets/board.tsx');
    const dialogModule = (await load(
      '/crew-v2/src/tickets/dialog.tsx',
    )) as typeof import('../src/tickets/dialog.tsx');
    const composerModule = (await load(
      '/crew-v2/src/compose/composer.tsx',
    )) as typeof import('../src/compose/composer.tsx');
    const createRequestModule = (await load(
      '/crew-v2/src/tickets/create-request.tsx',
    )) as typeof import('../src/tickets/create-request.tsx');

    const runtime = runtimeModule.createAppRuntime({ storage: window.sessionStorage, window });
    const { session, pending, client, queryClient: cache } = runtime;
    const harness = { session, pending, client } as Omit<Harness, 'setFilters'> & {
      setFilters?: Harness['setFilters'];
    };
    (window as unknown as { crewTest: typeof harness }).crewTest = harness;

    const h = React.createElement;
    function Views() {
      const [filters, setFilters] = React.useState<Record<string, string>>({});
      const [open, setOpen] = React.useState<{ id: string | null; trigger: HTMLElement | null }>({
        id: null,
        trigger: null,
      });
      harness.setFilters = setFilters;
      return h(
        'div',
        null,
        h(boardModule.TicketBoard, {
          filters: queries.parseTicketFilters(filters),
          onFiltersChange: (next: Record<string, string>) => setFilters({ ...next }),
          onOpenTicket: (id: string, trigger: HTMLElement) => setOpen({ id, trigger }),
        }),
        h(dialogModule.TicketDialog, {
          ticketId: open.id,
          returnFocus: open.trigger,
          onClose: () => setOpen((current) => ({ id: null, trigger: current.trigger })),
        }),
      );
    }

    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    const mount = document.createElement('main');
    mount.id = 'compose-host';
    mount.tabIndex = -1;
    mount.className = 'workspace__main';
    document.body.append(mount);
    createRoot(mount).render(
      h(
        runtimeModule.RuntimeContext.Provider,
        { value: runtime },
        h(
          queryModule.QueryClientProvider,
          { client: cache },
          h(boundaryModule.SessionBoundary, {
            session,
            pending,
            client,
            children: h(composerModule.ComposeServicesProvider, {
              services: { client, pending, session, storage: window.sessionStorage },
              children: h(createRequestModule.TicketDraftStorageProvider, {
                storage: window.sessionStorage,
                children: h(Views),
              }),
            }),
          }),
        ),
      ),
    );
  });
}

async function login(page: Page, crew: FixtureHandle, button: 'Đăng nhập' | 'Đăng nhập lại' = 'Đăng nhập') {
  const root = page.locator('#compose-host');
  await root.getByLabel('Mật khẩu').fill(crew.ownerPassword);
  await root.getByRole('button', { name: button, exact: true }).click();
  await expect(root.getByRole('button', { name: 'Tạo yêu cầu', exact: true })).toBeVisible();
}

async function seedProject(page: Page, key: string): Promise<string> {
  const project = await page.evaluate(async (projectKey) => {
    const harness = (window as unknown as { crewTest: Harness }).crewTest;
    const operation = harness.pending.begin({
      intentId: `seed-project-${projectKey}`,
      method: 'POST',
      path: '/v2/projects',
      body: { key: projectKey, name: `Dự án ${projectKey}`, repositoryUrl: null },
      storage: 'tab',
    });
    return harness.client.mutate<{ id: string }>(operation);
  }, key);
  await page.evaluate((projectId) => {
    (window as unknown as { crewTest: Harness }).crewTest.setFilters({ projectId });
  }, project.id);
  return project.id;
}

async function openCreateForm(page: Page) {
  await page
    .getByRole('region', { name: 'Bảng ticket' })
    .getByRole('button', { name: 'Tạo yêu cầu', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Tạo yêu cầu' });
  await expect(form).toBeVisible();
  return form;
}

async function fillRequest(form: ReturnType<Page['getByRole']>, title: string, description: string) {
  await form.getByLabel('Loại').selectOption('code');
  await form.getByLabel('Tiêu đề').fill(title);
  await form.getByRole('textbox', { name: 'Mô tả', exact: true }).fill(description);
}

/** Evidence line for the run log (counts the real attempts the browser made). */
const evidence = (label: string, value: unknown) =>
  process.stdout.write(`EVIDENCE ${label} ${JSON.stringify(value)}\n`);

const posts = (requests: Captured[], path: string) =>
  requests.filter((request) => request.method === 'POST' && request.path === path);

test('A5/A3 text-only: tạo yêu cầu bằng biểu mẫu rồi bình luận trong dialog, mỗi lần đúng một entity và một receipt', async ({
  page,
  crew,
}) => {
  const requests = capture(page);
  await mountHost(page, crew);
  await login(page, crew);
  const projectId = await seedProject(page, 'CMPA');
  const title = 'Yêu cầu văn bản thuần A5';
  const description = 'Mô tả tiếng Việt có dấu, không tệp đính kèm.';

  const form = await openCreateForm(page);
  await expect(form.getByLabel('Dự án')).toHaveValue(projectId);
  await form.getByLabel('Loại').selectOption('research');
  await form.getByLabel('Tiêu đề').fill(title);
  await form.getByRole('textbox', { name: 'Mô tả', exact: true }).fill(description);
  await form.getByRole('radio', { name: 'BMAD' }).check();
  await form.getByRole('button', { name: 'Tạo ticket', exact: true }).click();

  // Accepted: the create dialog closes and the shared ticket dialog opens the returned ticket.
  const detail = page.getByRole('dialog', { name: title });
  await expect(detail).toBeVisible();
  await expect(form).toBeHidden();
  const ticketId = (await detail.getByTestId('ticket-detail').getAttribute('data-ticket-id')) ?? '';
  expect(ticketId).toMatch(/^[0-9a-f-]{36}$/);

  const created = posts(requests, ticketSubmitPath);
  expect(created).toHaveLength(1);
  const createKey = created[0]?.headers['idempotency-key'] ?? '';
  expect(createKey).not.toBe('');
  // Text-only still goes through one empty compose session so the atomic submission has a selection.
  expect(posts(requests, '/v2/attachment-compose')).toHaveLength(1);
  const body = JSON.parse(created[0]?.body ?? '{}') as {
    selection?: { attachmentIds?: string[] };
    assistantRead?: string;
  };
  expect(body.selection?.attachmentIds).toEqual([]);
  expect(body.assistantRead).toBe('none');
  await withDb(crew, async (db) => {
    const rows =
      await db`select id, project_id, kind, title, description, criteria from tickets where title = ${title}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(ticketId);
    expect(rows[0]?.project_id).toBe(projectId);
    expect(rows[0]?.kind).toBe('research');
    expect(rows[0]?.description).toBe(description);
    expect(rows[0]?.criteria).toMatchObject({ workflowChoice: 'bmad' });
    const [events] =
      await db`select count(*)::int as count from events where ticket_id = ${ticketId} and type = 'ticket.created'`;
    expect(events?.count).toBe(1);
    const [links] =
      await db`select count(*)::int as count from attachment_uploads where owner_id = 'owner' and linked_at is not null`;
    expect(links?.count).toBe(0);
  });
  expect(await receiptsForKey(crew, ticketRoute, createKey)).toBe(1);

  // Comment from the ticket detail.
  const commentText = 'Bình luận văn bản thuần từ dialog.';
  const box = detail.getByRole('textbox', { name: 'Nội dung', exact: true });
  await box.fill(commentText);
  await detail.getByRole('button', { name: 'Gửi bình luận', exact: true }).click();
  await expect(detail.getByTestId('timeline-entry').filter({ hasText: commentText })).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(box).toHaveValue('');
  const comments = posts(requests, commentSubmitPath(ticketId));
  expect(comments).toHaveLength(1);
  const commentKey = comments[0]?.headers['idempotency-key'] ?? '';
  expect(commentKey).not.toBe(createKey);
  expect(await commentsWithText(crew, commentText)).toBe(1);
  expect(await receiptsForKey(crew, `POST:${commentSubmitPath(ticketId)}`, commentKey)).toBe(1);
  await withDb(crew, async (db) => {
    const [events] =
      await db`select count(*)::int as count from events where ticket_id = ${ticketId} and type = 'comment.created'`;
    expect(events?.count).toBe(1);
  });
});

test('A5/A3 text-only: mất response sau commit → phiên hết hạn → đăng nhập lại → replay cùng key/body → một ticket', async ({
  page,
  crew,
}) => {
  const requests = capture(page);
  await mountHost(page, crew);
  await login(page, crew);
  await seedProject(page, 'CMPB');
  const title = 'Yêu cầu mất phản hồi A5';
  const description = 'Máy chủ lưu rồi nhưng trình duyệt không nhận được phản hồi.';

  const lost = await dropResponses(page, ticketSubmitPath);
  const form = await openCreateForm(page);
  await fillRequest(form, title, description);
  await form.getByRole('button', { name: 'Tạo ticket', exact: true }).click();

  // The server committed; the browser only sees an unconfirmed send and locks every field.
  await expect(form.getByRole('button', { name: 'Gửi lại đúng yêu cầu cũ' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(form.locator('section[data-compose-state="ambiguous"]')).toBeVisible();
  await expect(form.getByLabel('Tiêu đề')).toBeDisabled();
  await expect(form.getByRole('textbox', { name: 'Mô tả', exact: true })).toHaveJSProperty('readOnly', true);
  expect(lost.state.served.length).toBeGreaterThanOrEqual(1);
  expect(lost.state.served[0]).toBe(201);
  expect(await ticketsWithTitle(crew, title)).toBe(1);
  const key = posts(requests, ticketSubmitPath)[0]?.headers['idempotency-key'] ?? '';
  expect(key).not.toBe('');
  expect(await receiptsForKey(crew, ticketRoute, key)).toBe(1);

  await expireSessions(crew);
  lost.release();
  await form.getByRole('button', { name: 'Gửi lại đúng yêu cầu cũ' }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập lại để tiếp tục' })).toBeVisible();
  await expect(page.locator('#compose-host')).not.toContainText(title);
  expect(await ticketsWithTitle(crew, title)).toBe(1);

  await login(page, crew, 'Đăng nhập lại');
  const reopened = await openCreateForm(page);
  // The draft survives expiry with its fields locked to the original body.
  await expect(reopened.getByLabel('Tiêu đề')).toHaveValue(title);
  await expect(reopened.getByLabel('Tiêu đề')).toBeDisabled();
  await reopened.getByRole('button', { name: 'Gửi lại đúng yêu cầu cũ' }).click();
  const detail = page.getByRole('dialog', { name: title });
  await expect(detail).toBeVisible({ timeout: 20_000 });

  const writes = posts(requests, ticketSubmitPath);
  expect(writes.length).toBeGreaterThanOrEqual(2);
  evidence('ticket-replay', { posts: writes.length, droppedAfterCommit: lost.state.served });
  expect(new Set(writes.map((request) => request.headers['idempotency-key']))).toEqual(new Set([key]));
  expect(new Set(writes.map((request) => request.body)).size).toBe(1);
  expect(writes.at(-1)?.headers['x-csrf-token']).not.toBe(writes[0]?.headers['x-csrf-token']);
  expect(await ticketsWithTitle(crew, title)).toBe(1);
  expect(await receiptsForKey(crew, ticketRoute, key)).toBe(1);
  await withDb(crew, async (db) => {
    const [events] = await db`select count(*)::int as count from events e join tickets t on t.id = e.ticket_id
      where t.title = ${title} and e.type = 'ticket.created'`;
    expect(events?.count).toBe(1);
  });
  await expect(page.getByTestId('recovery-panel')).toHaveCount(0);
  const leftover = await page.evaluate(
    () => (window as unknown as { crewTest: Harness }).crewTest.pending.list().length,
  );
  expect(leftover).toBe(0);
});

test('A5/A3 text-only: bình luận mất response → hết phiên → đăng nhập lại → replay cùng key → một bình luận', async ({
  page,
  crew,
}) => {
  const requests = capture(page);
  await mountHost(page, crew);
  await login(page, crew);
  await seedProject(page, 'CMPC');
  const title = 'Yêu cầu để bình luận A5';
  const form = await openCreateForm(page);
  await fillRequest(form, title, 'Mô tả cho ticket bình luận.');
  await form.getByRole('button', { name: 'Tạo ticket', exact: true }).click();
  const detail = page.getByRole('dialog', { name: title });
  await expect(detail).toBeVisible();
  const ticketId = (await detail.getByTestId('ticket-detail').getAttribute('data-ticket-id')) ?? '';
  const path = commentSubmitPath(ticketId);
  const commentText = 'Bình luận bị mất phản hồi.';

  const lost = await dropResponses(page, path);
  await detail.getByRole('textbox', { name: 'Nội dung', exact: true }).fill(commentText);
  await detail.getByRole('button', { name: 'Gửi bình luận', exact: true }).click();
  await expect(detail.getByRole('button', { name: 'Gửi lại đúng yêu cầu cũ' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(detail.getByRole('textbox', { name: 'Nội dung', exact: true })).toHaveJSProperty(
    'readOnly',
    true,
  );
  expect(lost.state.served[0]).toBe(201);
  expect(await commentsWithText(crew, commentText)).toBe(1);
  const key = posts(requests, path)[0]?.headers['idempotency-key'] ?? '';
  expect(await receiptsForKey(crew, `POST:${path}`, key)).toBe(1);

  await expireSessions(crew);
  lost.release();
  await detail.getByRole('button', { name: 'Gửi lại đúng yêu cầu cũ' }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập lại để tiếp tục' })).toBeVisible();
  expect(await commentsWithText(crew, commentText)).toBe(1);

  await login(page, crew, 'Đăng nhập lại');
  await page.locator(`button[data-ticket-id="${ticketId}"]`).click();
  const reopened = page.getByRole('dialog', { name: title });
  await expect(reopened).toBeVisible();
  await expect(reopened.getByRole('textbox', { name: 'Nội dung', exact: true })).toHaveValue(commentText);
  await reopened.getByRole('button', { name: 'Gửi lại đúng yêu cầu cũ' }).click();
  await expect(reopened.getByTestId('timeline-entry').filter({ hasText: commentText })).toHaveCount(1, {
    timeout: 20_000,
  });

  const writes = posts(requests, path);
  expect(writes.length).toBeGreaterThanOrEqual(2);
  evidence('comment-replay', { posts: writes.length, droppedAfterCommit: lost.state.served });
  expect(new Set(writes.map((request) => request.headers['idempotency-key']))).toEqual(new Set([key]));
  expect(new Set(writes.map((request) => request.body)).size).toBe(1);
  expect(await commentsWithText(crew, commentText)).toBe(1);
  expect(await receiptsForKey(crew, `POST:${path}`, key)).toBe(1);
  await withDb(crew, async (db) => {
    const [events] =
      await db`select count(*)::int as count from events where ticket_id = ${ticketId} and type = 'comment.created'`;
    expect(events?.count).toBe(1);
  });
});

test('A5 text-only: bỏ bản nháp khi chưa xác nhận hiện cảnh báo trùng, giữ khóa cũ và không mất ticket đã lưu', async ({
  page,
  crew,
}) => {
  const requests = capture(page);
  await mountHost(page, crew);
  await login(page, crew);
  await seedProject(page, 'CMPD');
  const title = 'Yêu cầu bỏ bản nháp A5';

  const lost = await dropResponses(page, ticketSubmitPath);
  const form = await openCreateForm(page);
  await fillRequest(form, title, 'Nội dung cần bỏ sau khi mất phản hồi.');
  await form.getByRole('button', { name: 'Tạo ticket', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Gửi lại đúng yêu cầu cũ' })).toBeVisible({
    timeout: 30_000,
  });
  expect(await ticketsWithTitle(crew, title)).toBe(1);
  const key = posts(requests, ticketSubmitPath)[0]?.headers['idempotency-key'] ?? '';

  // Ambiguous: discarding first asks the owner and nothing is dropped until they confirm.
  await form.getByRole('button', { name: 'Bỏ bản nháp yêu cầu' }).click();
  const warning = form.getByRole('alertdialog', { name: 'Xác nhận bỏ bản nháp' });
  await expect(warning).toContainText('có thể tạo bản trùng');
  await warning.getByRole('button', { name: 'Giữ lại' }).click();
  await expect(warning).toBeHidden();
  await expect(form.getByLabel('Tiêu đề')).toHaveValue(title);

  await form.getByRole('button', { name: 'Bỏ bản nháp yêu cầu' }).click();
  await warning.getByRole('button', { name: 'Vẫn bỏ bản nháp' }).click();
  await expect(form.getByLabel('Tiêu đề')).toHaveValue('');
  await expect(form.getByLabel('Tiêu đề')).toBeEnabled();
  lost.release();

  // The committed ticket is untouched, still one receipt, and the old key is still held for recovery.
  expect(await ticketsWithTitle(crew, title)).toBe(1);
  expect(await receiptsForKey(crew, ticketRoute, key)).toBe(1);
  const held = await page.evaluate(() =>
    (window as unknown as { crewTest: Harness }).crewTest.pending.list().map((item) => item.id),
  );
  expect(held).toContain(key);
  expect(
    posts(requests, ticketSubmitPath).every((request) => request.headers['idempotency-key'] === key),
  ).toBe(true);
});

// 1x1 PNG, enough for the producer's magic-number check.
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('A5: gửi kèm tệp khi chưa chứng nhận extractor → 503 EXTRACTION_NOT_CONFIGURED, giữ khóa, không tạo ticket', async ({
  page,
  crew,
}) => {
  const requests = capture(page);
  const submitResponses: { status: number; code: string | null }[] = [];
  page.on('response', async (response) => {
    const request = response.request();
    if (request.method() !== 'POST' || new URL(response.url()).pathname !== ticketSubmitPath) return;
    let code: string | null = null;
    try {
      code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? null;
    } catch {
      code = null;
    }
    submitResponses.push({ status: response.status(), code });
  });
  await mountHost(page, crew);
  await login(page, crew);
  await seedProject(page, 'CMPE');
  const title = 'Yêu cầu có tệp A5';

  const form = await openCreateForm(page);
  await fillRequest(form, title, 'Có kèm một ảnh PNG.');
  await form
    .getByLabel('Đính kèm tệp')
    .setInputFiles({ name: 'anh-a5.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(form.locator('li[data-state="ready"]')).toHaveCount(1, { timeout: 30_000 });
  await form.getByRole('button', { name: 'Tạo ticket', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Chưa cấu hình xử lý tệp', { timeout: 40_000 });

  // A configuration 503 is deterministic: exactly one submit, no blind retry, and the HTTP answer itself is
  // the producer's 503 with its code (not a transport failure dressed up as one).
  await expect.poll(() => submitResponses.length).toBe(1);
  const attempts = posts(requests, ticketSubmitPath);
  expect(attempts).toHaveLength(1);
  expect(submitResponses).toEqual([{ status: 503, code: 'EXTRACTION_NOT_CONFIGURED' }]);
  evidence('files-503', { posts: attempts.length, responses: submitResponses });
  const key = attempts[0]?.headers['idempotency-key'] ?? '';
  expect(new Set(attempts.map((request) => request.headers['idempotency-key']))).toEqual(new Set([key]));
  expect(new Set(attempts.map((request) => request.body)).size).toBe(1);
  expect(await ticketsWithTitle(crew, title)).toBe(0);
  expect(await receiptsForKey(crew, ticketRoute, key)).toBe(0);
  await withDb(crew, async (db) => {
    const [linked] =
      await db`select count(*)::int as count from attachment_uploads where owner_id = 'owner' and linked_at is not null`;
    expect(linked?.count).toBe(0);
  });
  // The form stays locked on its original body; retry uses the same key, never a new one.
  await expect(form.getByLabel('Tiêu đề')).toBeDisabled();
  await expect(form.getByRole('button', { name: 'Gửi lại đúng yêu cầu cũ' })).toBeVisible();
});
