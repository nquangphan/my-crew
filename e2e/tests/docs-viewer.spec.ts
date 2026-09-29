import { expect, test } from '@playwright/test';
import { DOCS_COMMIT } from '../../apps/web/e2e/docs-fixture';
import { expectNoHorizontalOverflow, login, openNav, readState, snap, viewportOf } from '../helpers';

/**
 * The read-only docs space of the deployed stack at every viewport, on the snapshot the global setup synced
 * through the daemon endpoint: space home, page tree, a flow page with breadcrumbs and its table of contents.
 */
test('docs viewer: space home, page tree, flow page, table of contents', async ({ page }, testInfo) => {
  const state = readState();
  const viewport = viewportOf(testInfo);
  const compact = viewport !== 'desktop';

  await login(page, state);
  await openNav(page, viewport, 'Docs');
  await expect(page).toHaveURL(new RegExp(`/projects/${state.project.key}/docs$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible();
  await expect(page.getByText(`Cập nhật ở commit ${DOCS_COMMIT.slice(0, 7)} lúc`)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // The page tree: a column on desktop, a drawer on phone and tablet.
  if (compact) await page.getByRole('button', { name: 'Trang docs' }).click();
  const tree = page.getByRole('navigation', { name: 'Cây trang docs' });
  await expect(tree).toBeVisible();
  await tree.getByRole('link', { name: 'Kiến trúc' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kiến trúc' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // A flow page: breadcrumbs and its table of contents.
  await page.goto(`/projects/${state.project.key}/docs?flow=payments`);
  await expect(page.getByRole('heading', { level: 1, name: 'Thanh toán' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(
    `Tài liệu/${state.project.name}/Flows/Thanh toán`,
  );
  if (compact) await page.locator('article details > summary', { hasText: 'Trên trang này' }).click();
  await page.getByRole('navigation', { name: 'Mục lục' }).getByRole('link', { name: 'Tests' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Tests' })).toBeInViewport();
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'docs-flow');
});
