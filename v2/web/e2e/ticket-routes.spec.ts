/**
 * Ticket routes on the real app router with the Task1 fixture (PostgreSQL, API, Vite): deep link with login
 * return, reload, unknown and malformed ids, the project board/list with its URL state, the shared dialog
 * and the back link. Data is created through the owner API; no network is mocked.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { type FixtureHandle, withFixture } from './support/fixture.ts';
import { type SeededTicket, seedOwnerTicket } from './support/owner-seed.ts';

const test = base.extend<Record<never, never>, { crew: FixtureHandle; seeded: SeededTicket }>({
  crew: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern for fixture deps.
    async ({}, use) => {
      await withFixture(async (handle) => {
        await use(handle);
      });
    },
    { scope: 'worker', timeout: 180_000 },
  ],
  seeded: [
    async ({ crew }, use) => {
      await use(await seedOwnerTicket(crew, 'Yêu cầu mở bằng đường dẫn'));
    },
    { scope: 'worker', timeout: 60_000 },
  ],
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function signIn(page: Page, crew: FixtureHandle): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Đăng nhập Crew' })).toBeVisible();
  await page.getByLabel('Mật khẩu').fill(crew.ownerPassword);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

function here(page: Page): string {
  const url = new URL(page.url());
  return url.pathname + url.search;
}

test('deep link /tickets/<id>: guest quay về đúng trang sau đăng nhập, reload vẫn giữ trang, GET ticket sau catch-up', async ({
  page,
  crew,
  seeded,
}) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/v2/')) calls.push(`${request.method()} ${pathname}`);
  });
  const path = `/crew-v2/tickets/${seeded.ticketId}`;
  await page.goto(`${crew.webOrigin}${path}`);
  await signIn(page, crew);
  await expect(page.getByRole('heading', { name: seeded.title, level: 1 })).toBeVisible();
  expect(here(page)).toBe(path);
  await expect(page.getByTestId('ticket-detail')).toHaveAttribute('data-ticket-id', seeded.ticketId);

  calls.length = 0;
  await page.reload();
  await expect(page.getByRole('heading', { name: seeded.title, level: 1 })).toBeVisible();
  expect(here(page)).toBe(path);
  const gets = calls.filter((call) => call.startsWith('GET '));
  const catchUp = gets.indexOf('GET /v2/events');
  const ticketGet = gets.indexOf(`GET /v2/tickets/${seeded.ticketId}`);
  expect(catchUp).toBeGreaterThanOrEqual(0);
  expect(ticketGet).toBeGreaterThan(catchUp);
});

test('id không tồn tại hoặc không phải UUID hiện view không tìm thấy, không lộ dữ liệu', async ({
  page,
  crew,
}) => {
  await page.goto(`${crew.webOrigin}/crew-v2/tickets/0197a3c2-7d1e-7a40-8b53-ffffffffffff`);
  await signIn(page, crew);
  await expect(page.getByText('Không tìm thấy ticket hoặc bạn không có quyền xem.')).toBeVisible();
  await page.goto(`${crew.webOrigin}/crew-v2/tickets/khong-phai-uuid`);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy ticket' })).toBeVisible();
  await page.goto(`${crew.webOrigin}/crew-v2/projects/khong-phai-uuid/tickets`);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy dự án' })).toBeVisible();
});

test('bảng/danh sách giữ view và bộ lọc trên URL, dialog dùng chung, nút quay lại từ trang ticket', async ({
  page,
  crew,
  seeded,
}) => {
  const base = `/crew-v2/projects/${seeded.projectId}/tickets`;
  await page.goto(`${crew.webOrigin}${base}?view=list`);
  await signIn(page, crew);
  const list = page.getByRole('region', { name: 'Danh sách ticket' });
  const row = list.locator(`tr[data-ticket-id="${seeded.ticketId}"]`);
  await expect(row).toBeVisible();
  expect(here(page)).toBe(`${base}?view=list`);

  await list.getByLabel('Loại').selectOption('research');
  await expect(list.locator('tr[data-ticket-id]')).toHaveCount(0);
  expect(here(page)).toBe(`${base}?view=list&kind=research`);
  await page.reload();
  await expect(list.getByLabel('Loại')).toHaveValue('research');
  await list.getByLabel('Loại').selectOption('');
  await expect(row).toBeVisible();

  const dialog = page.getByRole('dialog', { name: seeded.title });
  await row.getByRole('button', { name: seeded.title }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(row.getByRole('button', { name: seeded.title })).toBeFocused();

  await page.getByRole('button', { name: 'Dạng bảng' }).click();
  await expect(page.getByRole('region', { name: 'Bảng ticket' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('board');

  await page.getByRole('button', { name: 'Yêu cầu', exact: true }).click();
  const requests = page.getByRole('region', { name: 'Danh sách yêu cầu' });
  await expect(requests.locator(`li[data-ticket-id="${seeded.ticketId}"]`)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('requests');

  await page.goto(`${crew.webOrigin}/crew-v2/tickets/${seeded.ticketId}`);
  await page.getByRole('link', { name: 'Quay lại danh sách ticket' }).click();
  await expect(page.getByRole('region', { name: 'Bảng ticket' })).toBeVisible();
  expect(here(page)).toBe(`${base}?view=board`);
});

const draftKeys = {
  'crew-v2:form-draft:create-request': '{"title":"bản nháp dở"}',
  'crew-v2:form-draft:comment:0197a3c2-7d1e-7a40-8b53-2f6a1c4d9e10': 'bình luận dở',
};
const draftsInTab = (page: Page) =>
  page.evaluate(() =>
    Object.keys(window.sessionStorage).filter((key) => key.startsWith('crew-v2:form-draft:')),
  );

test('đăng xuất xóa bản nháp: reload không mở ticket rồi logout; logout xong reload ở guest', async ({
  page,
  crew,
  seeded,
}) => {
  await page.goto(`${crew.webOrigin}/crew-v2/tickets/${seeded.ticketId}`);
  await signIn(page, crew);
  await expect(page.getByRole('heading', { name: seeded.title, level: 1 })).toBeVisible();
  await page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries)) window.sessionStorage.setItem(key, value);
  }, draftKeys);

  // Reload onto a page that opens no ticket and no draft store, then log out.
  await page.goto(`${crew.webOrigin}/crew-v2/`);
  await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
  expect(await draftsInTab(page)).toHaveLength(2);
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập Crew' })).toBeVisible();
  expect(await draftsInTab(page)).toEqual([]);

  // Reload as a guest: nothing comes back.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Đăng nhập Crew' })).toBeVisible();
  expect(await draftsInTab(page)).toEqual([]);
});
