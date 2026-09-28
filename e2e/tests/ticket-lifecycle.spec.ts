import { expect, test } from '@playwright/test';
import {
  assistantTransition,
  expectNoHorizontalOverflow,
  login,
  ownerTicket,
  readState,
  snap,
  viewportOf,
} from '../helpers';

/**
 * The owner's loop against the deployed stack and the daemon under test, at every viewport: log in, create a
 * request (it is assigned to the assistant), watch the assistant pick it up live, answer its needs_input
 * question so it resumes and routes the request, then hit the "Done needs a report" gate.
 */
test('login, create a request, live assistant pickup, answer needs_input, Done needs a report', async ({
  page,
}, testInfo) => {
  const state = readState();
  const viewport = viewportOf(testInfo);
  const title = `Thêm trang liên hệ (${viewport} ${Date.now()})`;

  // 1. Login with password and TOTP.
  await login(page, state);
  await expectNoHorizontalOverflow(page);

  // 2. Create a ticket.
  if (viewport === 'desktop') await page.keyboard.press('c');
  else if (viewport === 'phone') await page.getByRole('button', { name: 'Tạo ticket' }).click();
  else await page.getByRole('button', { name: 'Tạo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo ticket' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Tiêu đề').fill(title);
  await dialog.getByLabel('Mô tả').fill('Trang liên hệ có form gửi email.');
  await dialog.getByRole('button', { name: 'Tạo', exact: true }).click();
  await expect(dialog).toBeHidden();

  const panel = page.getByRole('complementary', { name: /^Panel ticket/ });
  await expect(panel.getByRole('heading', { name: title })).toBeVisible();
  const key = new URL(page.url()).searchParams.get('selected') ?? '';
  expect(key).toMatch(/^AST-\d+$/);

  // 3. A request is assigned to the assistant.
  const created = await ownerTicket(page, key);
  expect(created.ticket.assigneeRole).toBe('assistant');

  // 4. The assistant daemon picks it up: its question and the status change arrive live, without a reload.
  await expect(panel.getByText(`Trợ lý hỏi: yêu cầu ${key} thuộc dự án Shop API phải không?`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(panel.getByRole('button', { name: /^Trạng thái: Chờ bạn/ })).toBeVisible();
  await expect(panel.getByText('Agent đang chờ bạn trả lời')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'needs-input');

  // 5. Answer: the server resumes the request and the daemon continues the same session, routing it.
  await panel.getByRole('textbox', { name: 'Trả lời' }).fill('Đúng, dự án Shop API.');
  await panel.getByRole('button', { name: 'Gửi' }).click();
  await expect(panel.getByRole('button', { name: /^Trạng thái: Đang làm/ })).toBeVisible();
  await expect(panel.getByText('Agent đang chờ bạn trả lời')).toBeHidden();
  await expect(panel.getByText(`Đã định tuyến ${key} tới dự án Shop API.`)).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(`Phân tích ${key}`)).toBeVisible();
  const routed = await ownerTicket(page, key);
  expect(routed.children.map((child) => child.key)).toHaveLength(1);

  // 6. Done without a report is refused.
  await assistantTransition(state, created.ticket.id, 'in_review');
  await page.goto(`/tickets/${key}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await page.getByRole('button', { name: /^Trạng thái: Review/ }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Xong' }).click();
  await expect(page.getByText('Ticket cần có report trước khi chuyển sang Xong.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Trạng thái: Review/ })).toBeVisible();
  expect((await ownerTicket(page, key)).ticket.status).toBe('in_review');
  await expectNoHorizontalOverflow(page);
  await snap(page, testInfo, 'done-needs-report');
});
