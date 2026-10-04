/**
 * Docs space on the real app router with the Task1 fixture (PostgreSQL, API, Vite). The snapshot is imported
 * through the production route `POST /v2/docs/imports`; nothing is written to the database directly and no
 * network is mocked. Covers the Unicode tree, opening a page by URL, an internal link, and the metadata block
 * (commit, content class, audit state). The Assistant part of this surface waits for its producer routes.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { type FixtureHandle, withFixture } from './support/fixture.ts';
import { type SeededDocs, seedDocsProject } from './support/owner-seed.ts';

const files = {
  'docs/index.md': '# Tổng quan dự án\n\nĐọc [hướng dẫn bắt đầu](hướng-dẫn/bắt-đầu.md) trước.\n',
  'docs/hướng-dẫn/bắt-đầu.md': '# Bắt đầu nhanh\n\nNội dung tiếng Việt có dấu: ước lượng, đường dẫn.\n',
  'docs/superpowers/specs/thiết-kế.md': '# Thiết kế dự kiến\n\nChưa triển khai.\n',
};

const test = base.extend<Record<never, never>, { crew: FixtureHandle; docs: SeededDocs }>({
  crew: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern for fixture deps.
    async ({}, use) => {
      await withFixture(async (handle) => {
        await use(handle);
      });
    },
    { scope: 'worker', timeout: 180_000 },
  ],
  docs: [
    async ({ crew }, use) => {
      await use(await seedDocsProject(crew, files));
    },
    { scope: 'worker', timeout: 60_000 },
  ],
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function signIn(page: Page, crew: FixtureHandle): Promise<void> {
  await page.getByLabel('Mật khẩu').fill(crew.ownerPassword);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

test('cây Unicode, mở trang theo URL, link nội bộ và metadata phiên bản', async ({ page, crew, docs }) => {
  const base = `/crew-v2/projects/${docs.projectId}/docs`;
  await page.goto(`${crew.webOrigin}${base}`);
  await signIn(page, crew);
  await expect(page.getByRole('heading', { name: 'Tài liệu', level: 1 })).toBeVisible();

  const tree = page.getByRole('navigation', { name: 'Cây tài liệu' });
  await expect(tree).toBeVisible();
  // The tree lists pages by title (the first heading), nested by the links between them.
  await expect(tree.getByRole('button', { name: 'Tổng quan dự án' })).toBeVisible();
  await expect(tree.getByRole('button', { name: 'Bắt đầu nhanh' })).toBeVisible();
  await expect(tree.getByRole('button', { name: /Thiết kế dự kiến/ })).toBeVisible();

  // The page title and the markdown's own first heading both match, so the first one is enough.
  const content = page.getByRole('main', { name: 'Nội dung tài liệu' });
  await expect(content.getByRole('heading', { name: 'Tổng quan dự án' }).first()).toBeVisible();
  const meta = content.getByRole('region', { name: 'Thông tin phiên bản tài liệu' });
  await expect(meta.getByText('Không có commit')).toBeVisible();
  // A legacy import has no source commit and only a structural audit: the page says so instead of hiding it.
  await expect(meta.getByText('Không hợp lệ').first()).toBeVisible();
  await expect(meta.getByText('Đã triển khai')).toBeVisible();
  await expect(content.getByRole('alert')).toContainText('Tài liệu không hợp lệ theo kiểm tra');

  await content.getByRole('link', { name: 'hướng dẫn bắt đầu' }).click();
  await expect(content.getByRole('heading', { name: 'Bắt đầu nhanh' }).first()).toBeVisible();
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('path') ?? '')).toBe(
    'docs/hướng-dẫn/bắt-đầu.md',
  );

  await page.reload();
  await expect(content.getByRole('heading', { name: 'Bắt đầu nhanh' }).first()).toBeVisible();
  await expect(content.getByText('ước lượng, đường dẫn')).toBeVisible();

  await page.goto(
    `${crew.webOrigin}${base}?path=${encodeURIComponent('docs/superpowers/specs/thiết-kế.md')}`,
  );
  await expect(content.getByRole('heading', { name: 'Thiết kế dự kiến' }).first()).toBeVisible();
  await expect(meta.getByText('Thiết kế/kế hoạch')).toBeVisible();
});

test('mục điều hướng Tài liệu dẫn tới không gian tài liệu của dự án', async ({ page, crew, docs }) => {
  await page.goto(`${crew.webOrigin}/crew-v2/`);
  await signIn(page, crew);
  const nav = page.getByRole('navigation', { name: 'Điều hướng dự án' });
  await expect(nav.getByText(docs.projectName)).toBeVisible();
  await nav.getByRole('link', { name: 'Tài liệu' }).click();
  await expect(page.getByRole('navigation', { name: 'Cây tài liệu' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/crew-v2/projects/${docs.projectId}/docs`);
});
