import { expect, test } from '@playwright/test';
import {
  Agent,
  closeDb,
  expectNoHorizontalOverflow,
  login,
  openNav,
  ownerTicket,
  readState,
  seedDocs,
  snap,
  viewportOf,
} from './helpers';

test.afterAll(closeDb);

/**
 * The owner's core loop at every viewport: create a ticket, open it, answer an agent's `needs_input`,
 * change status from the Details dropdown (the report gate included), open the related docs, and cancel
 * a pm_task with its open children. The page never overflows sideways.
 */
test('create, open, answer needs_input, change status, open docs, cancel', async ({ page }, testInfo) => {
  const state = readState();
  const viewport = viewportOf(testInfo);
  const agent = new Agent(state.machineA.token);
  const title = `Thêm endpoint /health (${viewport} ${Date.now()})`;

  await login(page, state);
  await expect(page.getByRole('heading', { name: `Board ${state.project.key}` })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 1. Create a ticket.
  if (viewport === 'desktop') await page.keyboard.press('c');
  else if (viewport === 'phone') await page.getByRole('button', { name: 'Tạo ticket' }).click();
  else await page.getByRole('button', { name: 'Tạo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo ticket' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Tiêu đề').fill(title);
  await dialog.getByLabel('Mô tả').fill('Cần **/health** kiểm tra kết nối DB.');
  await dialog.getByLabel('Ưu tiên').selectOption('high');
  await dialog.getByRole('button', { name: 'Tạo', exact: true }).click();
  await expect(dialog).toBeHidden();

  // 2. It opens in the side panel over the requests board.
  const panel = page.getByRole('complementary', { name: /^Panel ticket/ });
  await expect(panel.getByRole('heading', { name: title })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const requestKey = new URL(page.url()).searchParams.get('selected');
  expect(requestKey).toMatch(/^AST-\d+$/);
  const request = (await ownerTicket(page, requestKey ?? '')).ticket;

  // The agent side: triage to a pm_task with a dev and QC pair, then ask the owner.
  await agent.transition(request.id, 'in_progress');
  const pm = await agent.createSubtask({
    type: 'pm_task',
    parentId: request.id,
    projectId: state.project.id,
    title: `Phân tích: ${title}`,
  });
  const dev = await agent.createSubtask({
    type: 'dev',
    parentId: pm.id,
    title: 'Làm endpoint /health',
    flows: ['health-check'],
  });
  const qc = await agent.createSubtask({
    type: 'qc',
    parentId: pm.id,
    title: 'QC endpoint /health',
    pairsWith: dev.id,
  });
  await agent.comment(pm.id, 'PM hỏi: /health kiểm tra cả Redis hay chỉ Postgres?');
  await agent.transition(pm.id, 'needs_input');

  // 3. Find the pm_task on the project board and open it in the panel.
  if (viewport === 'phone') await page.getByRole('button', { name: 'Quay lại' }).click();
  else await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await openNav(page, viewport, 'Board');
  await expect(page.getByRole('heading', { name: `Board ${state.project.key}` })).toBeVisible();
  if (viewport === 'phone') {
    await page
      .getByRole('navigation', { name: 'Cột trạng thái' })
      .getByRole('button', { name: /^Chờ bạn/ })
      .click();
  }
  const card = page.getByRole('button', { name: `${pm.key}: Phân tích: ${title}` });
  await expect(card).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'board');
  await card.click();
  await expect(panel.getByText('Agent đang chờ bạn trả lời')).toBeVisible();
  await expect(panel.getByText('PM hỏi: /health kiểm tra')).toBeVisible();
  await snap(page, testInfo, 'board-panel-needs-input');
  await expectNoHorizontalOverflow(page);

  // A new agent comment shows up live, without a reload, in under 2 s.
  await agent.comment(pm.id, 'PM hỏi thêm: cảnh báo ghi log hay gọi webhook Slack?');
  await expect(panel.getByText('PM hỏi thêm: cảnh báo ghi log')).toBeVisible({ timeout: 2_000 });

  // 4. Answer needs_input: the server resumes the ticket.
  await panel
    .getByRole('textbox', { name: 'Trả lời' })
    .fill('Chỉ Postgres. Cảnh báo gọi webhook Slack trong env SLACK_WEBHOOK.');
  await panel.getByRole('button', { name: 'Gửi' }).click();
  await expect(panel.getByRole('button', { name: /^Trạng thái: Đang làm/ })).toBeVisible();
  await expect(panel.getByText('Agent đang chờ bạn trả lời')).toBeHidden();

  // 5. Change status from the Details dropdown on the full page; the report gate is shown, then passes.
  await agent.transition(dev.id, 'in_progress');
  await agent.transition(dev.id, 'in_review');
  await panel
    .getByRole('button', { name: new RegExp(`${dev.key}`) })
    .first()
    .click();
  await expect(panel.getByRole('heading', { name: 'Làm endpoint /health' })).toBeVisible();
  await panel.getByRole('link', { name: 'Mở toàn trang' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Làm endpoint /health' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: /^Trạng thái: Review/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Xong', 'Đang làm', 'Đã hủy']);
  await menu.getByRole('menuitem', { name: 'Xong' }).click();
  await expect(page.getByText('Ticket cần có report trước khi chuyển sang Xong.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Trạng thái: Review/ })).toBeVisible();
  await agent.report(dev.id, 'Đã thêm `/health` kiểm tra Postgres và cảnh báo Slack.');
  await page.getByRole('button', { name: /^Trạng thái: Review/ }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Xong' }).click();
  await expect(page.getByRole('button', { name: /^Trạng thái: Xong/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Report' }).click();
  await expect(page.getByText('kiểm tra Postgres và cảnh báo Slack')).toBeVisible();
  await snap(page, testInfo, 'ticket-page');

  // 6. Open the related docs from the ticket (the flow's page in the synced space), then from the sidebar.
  await seedDocs(state);
  await page.getByRole('link', { name: 'Flow: health-check' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Health check' })).toBeVisible();
  await expect(page).toHaveURL(/\?flow=health-check$/);
  await expectNoHorizontalOverflow(page);
  await openNav(page, viewport, 'Docs');
  await expect(page).toHaveURL(new RegExp(`/projects/${state.project.key}/docs$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Tổng quan' })).toBeVisible();

  // The list view at this viewport.
  await openNav(page, viewport, 'Danh sách');
  await expect(page.getByRole('heading', { name: 'Danh sách ticket' })).toBeVisible();
  await expect(page.getByRole('button', { name: qc.key }).or(page.getByText(qc.key)).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'list');

  // 7. Cancel the in-progress pm_task: the dialog lists the open child, and both end up cancelled.
  await page.goto(`/tickets/${pm.key}`);
  await expect(page.getByRole('heading', { level: 1, name: `Phân tích: ${title}` })).toBeVisible();
  await page.getByRole('button', { name: 'Hủy', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: `Hủy ${pm.key}?` });
  await expect(cancel.getByRole('list', { name: 'Ticket con sẽ bị hủy' }).getByText(qc.key)).toBeVisible();
  await expect(cancel.getByText(dev.key)).toBeHidden();
  await cancel.getByRole('button', { name: `Hủy ${pm.key}` }).click();
  await expect(page.getByRole('button', { name: /^Trạng thái: Đã hủy/ })).toBeVisible();
  const after = await ownerTicket(page, pm.key);
  expect(after.ticket.status).toBe('cancelled');
  expect(after.children.find((c) => c.id === qc.id)?.status).toBe('cancelled');
  expect(after.children.find((c) => c.id === dev.id)?.status).toBe('done');
  await expectNoHorizontalOverflow(page);

  // The remaining owner pages fit the viewport too.
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'inbox');
  await page.goto('/machines');
  await expect(page.getByRole('heading', { name: 'Máy', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'machines');
});
