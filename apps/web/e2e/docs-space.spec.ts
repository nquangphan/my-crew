import { expect, type Locator, type Page, test } from '@playwright/test';
import { DOCS_COMMIT } from './docs-fixture';
import {
  Agent,
  closeDb,
  expectNoHorizontalOverflow,
  login,
  openNav,
  ownerCreateRequest,
  readState,
  seedDocs,
  snap,
  type Viewport,
  viewportOf,
} from './helpers';

test.afterAll(closeDb);

/** The page tree: the left column on desktop, a drawer behind "Trang docs" on phone and tablet. */
async function openTree(page: Page, viewport: Viewport): Promise<Locator> {
  if (viewport !== 'desktop') await page.getByRole('button', { name: 'Trang docs' }).click();
  const tree = page.getByRole('navigation', { name: 'Cây trang docs' });
  await expect(tree).toBeVisible();
  return tree;
}

/** A wide table or long code block scrolls inside its own box. */
async function expectScrollsInBox(box: Locator): Promise<void> {
  await expect(box).toBeVisible();
  const { scrollWidth, clientWidth } = await box.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth, 'content wider than its scroll box').toBeGreaterThan(clientWidth);
}

/**
 * The read-only docs space at every viewport, on a snapshot synced through the real daemon endpoint: the
 * sidebar entry, page tree, a flow page with breadcrumbs, TOC, files and related tickets, space search, file
 * lookup, and (desktop) the global quick search. The page never overflows sideways.
 */
test('docs space: tree, flow page, TOC, related tickets, search and file lookup', async ({
  page,
}, testInfo) => {
  const state = readState();
  const viewport = viewportOf(testInfo);
  const compact = viewport !== 'desktop';
  const agent = new Agent(state.machineA.token);
  await seedDocs(state);

  await login(page, state);
  // A ticket that touches the payments flow, for "Ticket liên quan".
  const request = await ownerCreateRequest(page, `Docs thanh toán (${viewport} ${Date.now()})`);
  await agent.transition(request.id, 'in_progress');
  const pm = await agent.createSubtask({
    type: 'pm_task',
    parentId: request.id,
    projectId: state.project.id,
    title: `Phân tích thanh toán ${viewport}`,
  });
  const dev = await agent.createSubtask({
    type: 'dev',
    parentId: pm.id,
    title: `Tách service thanh toán ${viewport}`,
    complexity: 'medium',
    complexityReason: 'Tách một service và giữ API cũ',
    flows: ['payments'],
  });

  // 1. The sidebar "Docs" entry opens the space home.
  await openNav(page, viewport, 'Docs');
  await expect(page).toHaveURL(new RegExp(`/projects/${state.project.key}/docs$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible();
  await expect(page.getByText(`Cập nhật ở commit ${DOCS_COMMIT.slice(0, 7)} lúc`)).toBeVisible();
  if (compact) {
    // The tree is in a drawer and the TOC is a closed block at the top of the article.
    await expect(page.getByRole('navigation', { name: 'Cây trang docs' })).toBeHidden();
    await expect(page.locator('article details')).not.toHaveAttribute('open');
  }
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'docs-home');

  // 2. Page tree navigation; the long code block of "Kiến trúc" scrolls in its own box.
  let tree = await openTree(page, viewport);
  await expect(tree.getByRole('button', { name: 'Flows (6)' })).toBeVisible();
  if (viewport === 'phone') await snap(page, testInfo, 'docs-drawer');
  await tree.getByRole('link', { name: 'Kiến trúc' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kiến trúc' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Cây trang docs' })).toBeVisible({ visible: !compact });
  await expectScrollsInBox(
    page
      .locator('article .docs-scroll')
      .filter({ has: page.locator('pre') })
      .first(),
  );
  await expectNoHorizontalOverflow(page);

  // 3. A flow page by `?flow=`: breadcrumbs, forge link, TOC, the files table and related tickets.
  await page.goto(`/projects/${state.project.key}/docs?flow=payments`);
  await expect(page.getByRole('heading', { level: 1, name: 'Thanh toán' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(
    `${state.project.name}/Flows/Thanh toán`,
  );
  await expect(page.getByRole('link', { name: /Xem trên GitHub/ })).toHaveAttribute(
    'href',
    `https://github.com/2p/shop-api/blob/${DOCS_COMMIT}/docs/flows/payments.md`,
  );
  const files = page.getByRole('region', { name: 'File của flow' });
  await expect(files.getByRole('link', { name: 'services/payment/src/webhook-handler.ts' })).toHaveAttribute(
    'href',
    `https://github.com/2p/shop-api/blob/${DOCS_COMMIT}/services/payment/src/webhook-handler.ts`,
  );
  await expect(files.getByRole('row')).toHaveCount(6);
  const related = page.getByRole('region', { name: 'Ticket liên quan' });
  const relatedLink = related.getByRole('link', { name: new RegExp(`${dev.key}`) });
  await expect(relatedLink).toContainText(`Tách service thanh toán ${viewport}`);
  await expect(relatedLink).toContainText('Cần làm');
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'docs-flow');

  if (compact) await page.locator('article details > summary', { hasText: 'Trên trang này' }).click();
  const toc = page.getByRole('navigation', { name: 'Mục lục' });
  await toc.getByRole('link', { name: 'Tests' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Tests' })).toBeInViewport();
  await expectNoHorizontalOverflow(page);

  // A relative link in the page stays inside the space.
  await page.getByRole('article').getByRole('link', { name: 'Hoàn tiền' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hoàn tiền' })).toBeVisible();
  await expect(page).toHaveURL(/\?flow=refunds$/);

  // 4. Space search: title and snippet, and a click opens the page.
  tree = await openTree(page, viewport);
  await page.getByRole('textbox', { name: 'Tìm trong space' }).fill('nguồn dữ liệu chính');
  const results = page.getByRole('list', { name: 'Kết quả tìm trong space' });
  const hit = results.getByRole('link', { name: /Kiến trúc/ });
  await expect(hit).toContainText('Postgres là nguồn dữ liệu chính');
  await hit.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kiến trúc' })).toBeVisible();

  // 5. File lookup on "Tra cứu file"; its wide table scrolls in its own box.
  tree = await openTree(page, viewport);
  await tree.getByRole('link', { name: 'Tra cứu file' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tra cứu file' })).toBeVisible();
  await expectScrollsInBox(
    page.locator('article .docs-prose .docs-scroll').filter({ has: page.locator('table') }),
  );
  await expectNoHorizontalOverflow(page);
  const lookup = page.getByRole('region', { name: 'Tra cứu file theo đường dẫn' });
  const pathInput = lookup.getByRole('combobox', { name: 'Tra cứu file theo đường dẫn' });
  await pathInput.fill('services/legacy/src/old-cart.ts');
  await expect(lookup).toContainText('không thuộc flow nào (ngoại lệ trong manifest): Giỏ hàng cũ');
  await pathInput.fill('services/nowhere.ts');
  await expect(lookup).toContainText('services/nowhere.ts không thuộc flow nào.');
  await pathInput.fill('./services/shared/src/db.ts');
  const owners = lookup.getByRole('list', { name: 'Flow sở hữu file' });
  await expect(owners.getByRole('listitem')).toHaveCount(3);
  await snap(page, testInfo, 'docs-file-lookup');
  await owners.getByRole('link', { name: 'Health check' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Health check' })).toBeVisible();

  // 6. The pages under "Khác" fit the viewport too; an unknown flow shows a not-found state.
  for (const name of ['Hướng dẫn agent', 'flows.yaml']) {
    tree = await openTree(page, viewport);
    await tree.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await page.goto(`/projects/${state.project.key}/docs?flow=khong-co`);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 7. Desktop: the global quick search finds docs pages too; then the space in dark mode.
  if (viewport === 'desktop') {
    await page.keyboard.press('/');
    await page.keyboard.type('Kiến trúc');
    await expect(page.getByRole('option', { name: /Kiến trúc/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Kiến trúc' })).toBeVisible();
    await expect(page).toHaveURL(/\?path=docs%2Farchitecture\.md$/);

    await page.goto(`/projects/${state.project.key}/docs?flow=payments`);
    await page.getByRole('button', { name: 'Menu tài khoản' }).click();
    await page.getByRole('menuitem', { name: 'Giao diện tối' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await snap(page, testInfo, 'docs-flow-dark');
    await page.getByRole('button', { name: 'Menu tài khoản' }).click();
    await page.getByRole('menuitem', { name: 'Giao diện sáng' }).click();
  }
});
