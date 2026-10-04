/**
 * A7 (baseline onboarding) on the real API/PostgreSQL fixture and the real app router: sign in through the
 * login UI, register a machine, create a project, bind a checkout, reload, two-tab stale binding, and a
 * rebind that the server blocks while an execution is active or uncertain. Nothing is mocked. The only
 * Playwright route parks a GET (never edits it) so a second tab keeps genuinely stale data for one click.
 * Execution rows are written to the fixture's own database, the same way no production route can yet.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { connectDb } from '../../server/src/db/client.ts';
import { type FixtureHandle, withFixture } from './support/fixture.ts';

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

const scratch = join(process.env.TMPDIR ?? tmpdir(), 'crew-v2-web-s7basic');

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

async function signIn(page: Page, crew: FixtureHandle, path: string): Promise<void> {
  await page.goto(`${crew.webOrigin}/crew-v2${path}`);
  await page.getByLabel('Mật khẩu').fill(crew.ownerPassword);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

/** Registers a machine through the UI and returns its one-time token after closing the panel. */
async function registerMachine(page: Page, name: string): Promise<string> {
  await page.getByRole('link', { name: 'Đăng ký máy' }).click();
  await expect(page.getByRole('heading', { name: 'Đăng ký máy', level: 1 })).toBeVisible();
  await page.getByLabel('Tên máy').fill(name);
  await page.getByRole('button', { name: 'Đăng ký máy', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Token máy vừa đăng ký' });
  await expect(panel).toBeVisible();
  const token = (await panel.locator('code').textContent()) ?? '';
  expect(token.length).toBeGreaterThan(20);
  await panel.getByRole('button', { name: 'Đã lưu token, đóng' }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('list').getByText(name, { exact: true })).toBeVisible();
  return token;
}

async function createProject(page: Page, key: string, name: string): Promise<Locator> {
  await page.getByRole('link', { name: 'Tạo dự án/Gắn máy' }).click();
  await expect(page.getByRole('heading', { name: 'Tạo dự án và gắn máy', level: 1 })).toBeVisible();
  await page.getByLabel('Mã dự án').fill(key);
  await page.getByLabel('Tên dự án').fill(name);
  await page.getByRole('button', { name: 'Tạo dự án', exact: true }).click();
  const section = page.getByRole('region', { name: `Gắn máy cho dự án ${name}` });
  await expect(section).toBeVisible();
  return section;
}

async function binding(crew: FixtureHandle, key: string) {
  return withDb(crew, async (db) => {
    const [row] =
      await db`select machine_id, checkout_path, binding_revision from projects where key = ${key}`;
    return row as { machine_id: string | null; checkout_path: string | null; binding_revision: number };
  });
}

test('hành trình sạch: đăng nhập, đăng ký máy, tạo dự án, gắn checkout, tải lại giữ nguyên và không lộ token', async ({
  page,
  crew,
}) => {
  mkdirSync(scratch, { recursive: true });
  const logs: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  page.on('pageerror', (error) => logs.push(error.message));

  await signIn(page, crew, '/machines');
  await expect(page.getByRole('heading', { name: 'Đăng ký máy', level: 1 })).toBeVisible();
  await expect(page.getByText('Chưa có máy nào được đăng ký.')).toBeVisible();

  await page.getByLabel('Tên máy').fill('Máy E2E 1');
  await page.getByRole('button', { name: 'Đăng ký máy', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Token máy vừa đăng ký' });
  await expect(panel).toBeVisible();
  const token = (await panel.locator('code').textContent()) ?? '';
  expect(token.length).toBeGreaterThan(20);
  expect(
    await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }])),
  ).not.toContain(token);
  await panel.getByRole('button', { name: 'Đã lưu token, đóng' }).click();
  await expect(page.getByRole('list').getByText('Máy E2E 1', { exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain(token);
  await withDb(crew, async (db) => {
    const rows = await db`select name, revoked_at from machines where name = 'Máy E2E 1'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revoked_at).toBeNull();
  });

  const section = await createProject(page, 'E2EONB', 'Dự án E2E');
  await expect(section.getByText(/Chưa gắn máy · Revision 1/)).toBeVisible();
  await section.getByLabel('Máy').selectOption({ label: 'Máy E2E 1' });
  await section.getByLabel('Đường dẫn checkout').fill('/srv/e2e/checkout');
  await section.getByRole('button', { name: 'Gắn máy', exact: true }).click();
  await expect(section.getByText(/Máy E2E 1 · \/srv\/e2e\/checkout · Revision 2/)).toBeVisible();
  const saved = await binding(crew, 'E2EONB');
  expect(saved.checkout_path).toBe('/srv/e2e/checkout');
  expect(Number(saved.binding_revision)).toBe(2);
  await page.screenshot({ path: join(scratch, 'project-setup.png') });

  await page.reload();
  const again = page.getByRole('region', { name: 'Gắn máy cho dự án Dự án E2E' });
  await expect(again.getByText(/Máy E2E 1 · \/srv\/e2e\/checkout · Revision 2/)).toBeVisible();
  await expect(again.getByLabel('Đường dẫn checkout')).toHaveValue('/srv/e2e/checkout');
  await expect(again.getByLabel('Máy')).toHaveValue(saved.machine_id ?? '');

  const storage = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  for (const secret of [token, crew.ownerPassword]) {
    expect(storage).not.toContain(secret);
    expect(logs.join('\n')).not.toContain(secret);
    expect(await page.content()).not.toContain(secret);
  }
  // Neither IndexedDB, CacheStorage nor cookies hold anything of the credential.
  const stores = await page.evaluate(async () => ({
    databases: (await indexedDB.databases()).map((database) => database.name),
    caches: await caches.keys(),
    cookie: document.cookie,
  }));
  expect(stores.databases).toEqual([]);
  expect(stores.caches).toEqual([]);
  for (const secret of [token, crew.ownerPassword]) expect(stores.cookie).not.toContain(secret);
});

test('hai tab: revision cũ trả 409, giữ đường dẫn đã nhập, tải lại rồi áp dụng bằng khóa mới', async ({
  page,
  crew,
  context,
}) => {
  await signIn(page, crew, '/machines');
  await registerMachine(page, 'Máy hai tab');
  const first = await createProject(page, 'E2ESTALE', 'Dự án hai tab');
  await expect(first).toBeVisible();

  const other = await context.newPage();
  await other.goto(`${crew.webOrigin}/crew-v2/setup/projects`);
  const second = other.getByRole('region', { name: 'Gắn máy cho dự án Dự án hai tab' });
  await expect(second.getByText(/Chưa gắn máy · Revision 1/)).toBeVisible();

  // Park the second tab's project reads, so the event-driven refetch cannot refresh it before the click.
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await other.route('**/v2/projects?*', async (route) => {
    await gate;
    await route.continue();
  });

  await first.getByLabel('Máy').selectOption({ label: 'Máy hai tab' });
  await first.getByLabel('Đường dẫn checkout').fill('/srv/tab-mot');
  await first.getByRole('button', { name: 'Gắn máy', exact: true }).click();
  await expect(first.getByText(/Revision 2/)).toBeVisible();

  const puts: { key: string | undefined; body: string | null }[] = [];
  other.on('request', (request) => {
    if (request.method() === 'PUT')
      puts.push({ key: request.headers()['idempotency-key'], body: request.postData() });
  });
  await second.getByLabel('Máy').selectOption({ label: 'Máy hai tab' });
  await second.getByLabel('Đường dẫn checkout').fill('/srv/tab-hai');
  await second.getByRole('button', { name: 'Gắn máy', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('đã được thay đổi');
  await expect(second.getByLabel('Đường dẫn checkout')).toHaveValue('/srv/tab-hai');
  expect((await binding(crew, 'E2ESTALE')).checkout_path).toBe('/srv/tab-mot');

  release();
  await expect(second.getByText(/Revision 2/)).toBeVisible();
  await second.getByRole('button', { name: 'Đổi máy', exact: true }).click();
  await expect(second.getByText(/\/srv\/tab-hai · Revision 3/)).toBeVisible();
  expect(puts).toHaveLength(2);
  expect(puts[1]?.key).not.toBe(puts[0]?.key);
  expect(JSON.parse(puts[0]?.body ?? '{}').expectedRevision).toBe(1);
  expect(JSON.parse(puts[1]?.body ?? '{}').expectedRevision).toBe(2);
  expect((await binding(crew, 'E2ESTALE')).checkout_path).toBe('/srv/tab-hai');
  await other.close();
});

/** One reserved attempt on the project's first ticket, as the execution layer would leave it. */
async function reserveAttempt(
  crew: FixtureHandle,
  projectKey: string,
  state: 'active' | 'uncertain',
): Promise<string> {
  return withDb(crew, async (db) => {
    const [project] =
      await db`select id, machine_id, binding_revision from projects where key = ${projectKey}`;
    if (!project) throw new Error('PROJECT_MISSING');
    const ticketId = randomUUID();
    const commandId = randomUUID();
    const attemptId = randomUUID();
    await db.begin(async (tx) => {
      await tx`insert into tickets (id, project_id, root_id, level, kind, title, description, status, created_actor_kind, created_actor_id)
        values (${ticketId}, ${project.id}, ${ticketId}, 'request', 'code', 'Ticket đang chạy', 'Mô tả', 'running', 'owner', 'owner')`;
      await tx`insert into commands (id, machine_id, ticket_id, binding_revision, type, payload, state)
        values (${commandId}, ${project.machine_id}, ${ticketId}, ${project.binding_revision}, 'start', '{}'::jsonb, 'completed')`;
      await tx`insert into execution_guards (ticket_id, fence) values (${ticketId}, 1)`;
      await tx`insert into attempts (id, ticket_id, machine_id, command_id, fence, binding_revision, process_instance_id, state, lease_expires_at, workflow_pin)
        values (${attemptId}, ${ticketId}, ${project.machine_id}, ${commandId}, 1, ${project.binding_revision}, 'proc-e2e', ${state}, now() + interval '1 hour', '{}'::jsonb)`;
      await tx`update execution_guards set active_attempt_id = ${attemptId} where ticket_id = ${ticketId}`;
    });
    return attemptId;
  });
}

test('đổi máy khi attempt active hoặc uncertain: 409 giải thích lý do, giữ trường, DB binding không đổi', async ({
  page,
  crew,
}) => {
  await signIn(page, crew, '/machines');
  await registerMachine(page, 'Máy gốc');
  await registerMachine(page, 'Máy đích');
  const section = await createProject(page, 'E2EACT', 'Dự án đang chạy');
  await section.getByLabel('Máy').selectOption({ label: 'Máy gốc' });
  await section.getByLabel('Đường dẫn checkout').fill('/srv/e2e/goc');
  await section.getByRole('button', { name: 'Gắn máy', exact: true }).click();
  await expect(section.getByText(/Máy gốc · \/srv\/e2e\/goc · Revision 2/)).toBeVisible();
  const before = await binding(crew, 'E2EACT');

  const attemptId = await reserveAttempt(crew, 'E2EACT', 'uncertain');
  for (const state of ['uncertain', 'active'] as const) {
    if (state === 'active')
      await withDb(crew, (db) => db`update attempts set state = 'active' where id = ${attemptId}`);
    await section.getByLabel('Máy').selectOption({ label: 'Máy đích' });
    await section.getByLabel('Đường dẫn checkout').fill('/srv/e2e/moi');
    const answered = page.waitForResponse((response) => response.request().method() === 'PUT');
    await section.getByRole('button', { name: 'Đổi máy', exact: true }).click();
    const response = await answered;
    expect(response.status()).toBe(409);
    expect((await response.json()).error.code).toBe('ACTIVE_EXECUTION');
    const alert = section.getByRole('alert');
    await expect(alert).toContainText('tiến trình');
    await expect(alert).toContainText('không tự dừng');
    await expect(section.getByLabel('Đường dẫn checkout')).toHaveValue('/srv/e2e/moi');
    await expect(section.getByLabel('Máy').locator('option:checked')).toHaveText('Máy đích');
    expect(await binding(crew, 'E2EACT')).toEqual(before);
    await withDb(crew, async (db) => {
      const [row] = await db`select state from attempts where id = ${attemptId}`;
      expect(row?.state).toBe(state);
    });
  }
});
