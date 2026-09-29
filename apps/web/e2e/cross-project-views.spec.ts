import { expect, type Page, test } from '@playwright/test';
import {
  Agent,
  expectNoHorizontalOverflow,
  login,
  openNav,
  ownerCreateRequest,
  readState,
  snap,
  type Viewport,
  viewportOf,
} from './helpers';

/** A second project per viewport, sorted after SHOP so other specs keep SHOP as the default project. */
const SECOND_PROJECT: Record<Viewport, string> = { phone: 'XPP', tablet: 'XPT', desktop: 'XPD' };

const card = (page: Page, key: string) => page.locator(`button[data-ticket-key="${key}"]`);

/**
 * A request routed to two projects: the "Tất cả dự án" board and list show both pm_tasks and their
 * children, the project filter narrows them, and the request's "Cây ticket" lists everything with its
 * status. At the three viewports; no page overflows sideways.
 */
test('all-projects board and list, project filter, and the request ticket tree', async ({
  page,
}, testInfo) => {
  const state = readState();
  const viewport = viewportOf(testInfo);
  const agent = new Agent(state.machineA.token);
  const tag = `xp-${viewport}-${Date.now()}`;
  const second = await agent.createProject({
    key: SECOND_PROJECT[viewport],
    name: `App ${viewport}`,
    description: 'Ứng dụng di động cho cửa hàng.',
    repoUrl: `https://github.com/2p/app-${viewport}.git`,
    platform: 'mobile',
  });

  await login(page, state);
  const request = await ownerCreateRequest(page, `Giỏ hàng web và app ${tag}`);
  await agent.transition(request.id, 'in_progress');
  const pmShop = await agent.createSubtask({
    type: 'pm_task',
    parentId: request.id,
    projectId: state.project.id,
    title: `PM shop ${tag}`,
  });
  const pmApp = await agent.createSubtask({
    type: 'pm_task',
    parentId: request.id,
    projectId: second.id,
    title: `PM app ${tag}`,
  });
  await agent.transition(pmShop.id, 'in_progress');
  await agent.transition(pmApp.id, 'in_progress');
  const dev = await agent.createSubtask({
    type: 'dev',
    parentId: pmShop.id,
    title: `Dev shop ${tag}`,
    complexity: 'small',
    complexityReason: 'Một endpoint nhỏ',
  });
  await agent.transition(dev.id, 'in_progress');
  const docs = await agent.createSubtask({ type: 'docs_init', parentId: pmApp.id, title: `Docs app ${tag}` });

  // 1. The all-projects board, from the sidebar: both pm_tasks and their children, in the request's lane.
  await openNav(page, viewport, 'Tất cả dự án');
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.getByRole('heading', { name: 'Board · Tất cả dự án' })).toBeVisible();
  for (const ticket of [request, pmShop, pmApp, dev, docs])
    await expect(card(page, ticket.key)).toBeVisible();
  await expect(page.locator('[data-lane]', { hasText: `${request.key} · ` }).first()).toBeVisible();
  await expect(card(page, pmShop.key).locator(`[data-project="${state.project.key}"]`)).toBeVisible();
  await expect(card(page, docs.key).locator(`[data-project="${second.key}"]`)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'all-board');

  // 2. The project filter narrows the board to the second project (the routed request stays).
  if (viewport === 'phone') await page.getByRole('button', { name: /^Bộ lọc/ }).click();
  await page.getByRole('button', { name: /^Dự án: Tất cả/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(second.key) }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`project=${second.key}`));
  await expect(card(page, pmShop.key)).toHaveCount(0);
  await expect(card(page, dev.key)).toHaveCount(0);
  for (const ticket of [request, pmApp, docs]) await expect(card(page, ticket.key)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'all-board-filtered');

  // 3. The all-projects list shows the same tickets, and the project filter narrows it too.
  await page.goto(`/list?q=${tag}`);
  await expect(page.getByRole('heading', { name: 'Danh sách ticket · Tất cả dự án' })).toBeVisible();
  const titles = [request, pmShop, pmApp, dev, docs].map((t) => t.key);
  for (const key of titles) await expect(page.getByText(key, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Dự án: Tất cả/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(second.key) }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`project=${second.key}`));
  await expect(page.getByText(pmShop.key, { exact: true })).toHaveCount(0);
  await expect(page.getByText(dev.key, { exact: true })).toHaveCount(0);
  for (const ticket of [request, pmApp, docs]) {
    await expect(page.getByText(ticket.key, { exact: true }).first()).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'all-list-filtered');

  // 4. The request's ticket tree lists every descendant with its project and status.
  await page.goto(`/tickets/${request.key}`);
  await expect(page.getByRole('heading', { name: 'Cây ticket (4)' })).toBeVisible();
  const tree = page.getByRole('list', { name: 'Cây ticket' });
  const row = (key: string) => tree.locator(`[data-ticket-key="${key}"]`);
  await expect(row(pmShop.key)).toContainText('Đang làm');
  await expect(row(pmShop.key).locator(`[data-project="${state.project.key}"]`)).toBeVisible();
  await expect(row(pmApp.key)).toContainText('Đang làm');
  await expect(row(pmApp.key).locator(`[data-project="${second.key}"]`)).toBeVisible();
  await expect(row(dev.key)).toContainText('Đang làm');
  await expect(row(docs.key)).toContainText('Cần làm');
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'request-tree');

  // The tree follows the owner stream: the dev ticket moves to review without a reload.
  await agent.report(dev.id, 'Đã xong endpoint.');
  await agent.transition(dev.id, 'in_review');
  await expect(row(dev.key)).toContainText('Review');
  await row(docs.key).click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${docs.key}$`));
});
