import { expect, type Locator, test } from '@playwright/test';
import {
  Agent,
  expectNoHorizontalOverflow,
  login,
  openNav,
  ownerTicket,
  readState,
  seedDocs,
  snap,
  viewportOf,
} from './helpers';

/** A 1x1 transparent PNG, well under the 10MB limit. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * Simulates pasting an image from the OS clipboard: a real `paste` event on `locator`'s element carrying a
 * `DataTransfer` with one file, the same shape `usePasteImage()`'s `onPaste` reads `clipboardData.items` from.
 */
async function pasteImageInto(
  locator: Locator,
  base64: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  await locator.evaluate(
    (el, { base64, filename, mimeType }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], filename, { type: mimeType });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      el.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer }),
      );
    },
    { base64, filename, mimeType },
  );
}

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
    complexity: 'small',
    complexityReason: 'Một endpoint mới và test của nó',
    flows: ['health-check'],
  });
  const qc = await agent.createSubtask({
    type: 'qc',
    parentId: pm.id,
    title: 'QC endpoint /health',
    complexity: 'trivial',
    complexityReason: 'Gọi một endpoint, không có UI',
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
  // Details show the PM's complexity rating with its reason.
  if (viewport === 'phone') await page.getByRole('button', { name: 'Chi tiết' }).click();
  await expect(page.getByText('Lý do: Một endpoint mới và test của nó')).toBeVisible();
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

/**
 * Pasting an image into "Mô tả" of the "Tạo ticket" dialog, before the ticket exists: the draft
 * paste-to-upload path (`usePasteImage()` with `draftAttachments`, `POST /v1/attachments`).
 */
test('paste images into "Mô tả" of the "Tạo ticket" dialog', async ({ page }, testInfo) => {
  const state = readState();
  const viewport = viewportOf(testInfo);
  const title = `Ticket có ảnh dán (${viewport} ${Date.now()})`;

  await login(page, state);
  await expectNoHorizontalOverflow(page);

  if (viewport === 'desktop') await page.keyboard.press('c');
  else if (viewport === 'phone') await page.getByRole('button', { name: 'Tạo ticket' }).click();
  else await page.getByRole('button', { name: 'Tạo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo ticket' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Tiêu đề').fill(title);

  // Slow the draft upload down a bit so the "đang tải" state below is reliably observable instead of racing
  // a same-machine round trip that can resolve before the assertion even runs.
  await page.route('**/v1/attachments', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });

  const description = dialog.getByLabel('Mô tả');
  await description.fill('Trước ảnh, sau ảnh');
  // Caret right after "Trước ảnh, " (11 chars), before "sau ảnh".
  await description.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(11, 11));

  // 1. First paste: placeholder lands exactly at the caret without disturbing the rest of the text, "Tạo"
  // is disabled while it is still uploading.
  await pasteImageInto(description, PNG_BASE64, 'shot1.png', 'image/png');
  await expect(description).toHaveValue(/^Trước ảnh, !\[Đang tải ảnh\.\.\.\]\(uploading:\d+\)sau ảnh$/);
  await expect(dialog.getByRole('button', { name: 'Đang tải ảnh…' })).toBeDisabled();
  await expect(description).toHaveValue(/^Trước ảnh, !\[ảnh\]\(\/v1\/attachments\/[\w-]+\)sau ảnh$/);
  await expect(dialog.getByRole('button', { name: 'Tạo', exact: true })).toBeEnabled();

  // 2. Second consecutive paste, appended at the end: both images end up in the text, in order.
  await description.evaluate((el: HTMLTextAreaElement) =>
    el.setSelectionRange(el.value.length, el.value.length),
  );
  await pasteImageInto(description, PNG_BASE64, 'shot2.png', 'image/png');
  await expect(dialog.getByRole('button', { name: 'Đang tải ảnh…' })).toBeVisible();
  await expect(description).toHaveValue(
    /^Trước ảnh, !\[ảnh\]\(\/v1\/attachments\/[\w-]+\)sau ảnh!\[ảnh\]\(\/v1\/attachments\/[\w-]+\)$/,
  );
  await expect(dialog.getByRole('button', { name: 'Tạo', exact: true })).toBeEnabled();

  // 3. "Xem trước" renders both images.
  await dialog.getByRole('button', { name: 'Xem trước' }).click();
  await expect(dialog.getByRole('img', { name: 'ảnh' })).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Viết' }).click();

  // 4. Create: the new ticket's description keeps both real links, never an "uploading:" placeholder.
  await dialog.getByRole('button', { name: 'Tạo', exact: true }).click();
  await expect(dialog).toBeHidden();

  const panel = page.getByRole('complementary', { name: /^Panel ticket/ });
  await expect(panel.getByRole('heading', { name: title })).toBeVisible();
  await expect(panel.getByRole('img', { name: 'ảnh' })).toHaveCount(2);
  await expectNoHorizontalOverflow(page);

  // 5. Both images still load after a reload.
  await page.reload();
  await expect(panel.getByRole('heading', { name: title })).toBeVisible();
  const images = panel.getByRole('img', { name: 'ảnh' });
  await expect(images).toHaveCount(2);
  const sources = await images.evaluateAll((els) => els.map((el) => el.getAttribute('src')));
  for (const src of sources) {
    expect(src).toMatch(/^\/v1\/attachments\//);
    const res = await page.request.get(src ?? '');
    expect(res.ok()).toBe(true);
  }
  await expectNoHorizontalOverflow(page);
});
