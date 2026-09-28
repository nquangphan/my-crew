import { readFileSync } from 'node:fs';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { E2E_ORIGIN, E2E_STATE_FILE, type E2eState } from './env';
import { asMachine, freshTotp } from './stack';

export function readState(): E2eState {
  return JSON.parse(readFileSync(E2E_STATE_FILE, 'utf8')) as E2eState;
}

export type Viewport = 'phone' | 'tablet' | 'desktop';
export const viewportOf = (testInfo: TestInfo): Viewport => testInfo.project.name as Viewport;

/** Logs in through the UI: password, then the TOTP step. */
export async function login(page: Page, state: E2eState): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  await page.getByLabel('Tên đăng nhập').fill(state.username);
  await page.getByLabel('Mật khẩu').fill(state.password);
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(page.getByRole('heading', { name: 'Xác thực hai bước' })).toBeVisible();
  await page.getByLabel('Mã xác thực').fill(freshTotp(state.postgresContainer, state.totpSecret));
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('link', { name: /^Inbox/ }).first()).toBeVisible();
}

/** The page never scrolls sideways. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'document.documentElement.scrollWidth <= innerWidth').toBeLessThanOrEqual(innerWidth);
}

/** Opens a sidebar entry; on phones and tablets the sidebar sits behind a button. */
export async function openNav(page: Page, viewport: Viewport, label: string): Promise<void> {
  if (viewport !== 'desktop') {
    await page.getByRole('button', { name: viewport === 'phone' ? 'Mở menu' : 'Mở rộng thanh bên' }).click();
  }
  const nav = page.getByRole('navigation', { name: 'Điều hướng dự án' }).last();
  await nav.getByRole('link', { name: label, exact: true }).click();
}

export async function snap(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${name}.png`) });
}

interface TicketDto {
  id: string;
  key: string;
  status: string;
  assigneeRole: string;
}

/** Reads a ticket as the logged-in owner (the page's cookies). */
export async function ownerTicket(
  page: Page,
  key: string,
): Promise<{ ticket: TicketDto; children: TicketDto[] }> {
  const res = await page.request.get(`${E2E_ORIGIN}/v1/tickets/${key}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as { ticket: TicketDto; children: TicketDto[] };
}

/** A status change made by the assistant host's machine, as its daemon would. */
export async function assistantTransition(state: E2eState, ticketId: string, to: string): Promise<void> {
  await asMachine(state.assistant.token)('POST', `/v1/daemon/tickets/${ticketId}/transition`, { to });
}
