import { expect, type Page, test } from '@playwright/test';
import { E2E_WEB_ORIGIN } from './e2e-env';
import { expectNoHorizontalOverflow, login, readState, snap } from './helpers';

async function openAccountMenu(page: Page, item: 'Tài khoản' | 'Đăng xuất'): Promise<void> {
  await page.getByRole('button', { name: 'Menu tài khoản' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/**
 * Change the password from the account page, log out, log back in with the new one. Another device's
 * session is signed out by the change. The password is restored at the end, because the other specs log in
 * with the one from the prepare step.
 */
test('change password, log out and log in with the new one', async ({ page, browser }, testInfo) => {
  const state = readState();
  const newPassword = `${state.password}-moi-${testInfo.project.name}`;

  const otherContext = await browser.newContext();
  try {
    const otherDevice = await otherContext.newPage();
    await login(otherDevice, state);
    await login(page, state);

    await openAccountMenu(page, 'Tài khoản');
    await expect(page.getByRole('heading', { name: 'Tài khoản', level: 1 })).toBeVisible();
    const form = page.getByRole('form', { name: 'Đổi mật khẩu' });

    // The form asks only for the current password and the new one twice; client-side checks come first.
    await expect(form.locator('input')).toHaveCount(3);
    await expect(form.getByLabel(/Mã TOTP|Mã khôi phục|Mã xác thực/)).toHaveCount(0);
    await form.getByLabel('Mật khẩu hiện tại').fill(state.password);
    await form.getByLabel('Mật khẩu mới', { exact: true }).fill(newPassword);
    await form.getByLabel('Nhập lại mật khẩu mới').fill(`${newPassword}x`);
    await form.getByRole('button', { name: 'Đổi mật khẩu' }).click();
    await expect(form.getByText('Mật khẩu nhập lại không khớp.')).toBeVisible();

    await form.getByLabel('Nhập lại mật khẩu mới').fill(newPassword);
    await expectNoHorizontalOverflow(page);
    await snap(page, testInfo, 'account-password');
    await form.getByRole('button', { name: 'Đổi mật khẩu' }).click();
    await expect(page.getByText('Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất.')).toBeVisible();
    await expect(form.getByLabel('Mật khẩu mới', { exact: true })).toHaveValue('');

    // This device stays signed in under the rotated session; the other one is signed out.
    expect((await page.request.get('/v1/auth/session')).status()).toBe(200);
    expect((await otherDevice.request.get('/v1/auth/session')).status()).toBe(401);

    await openAccountMenu(page, 'Đăng xuất');
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();

    // The old password no longer works; the new one does.
    await page.getByLabel('Tên đăng nhập').fill(state.username);
    await page.getByLabel('Mật khẩu').fill(state.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByText('Sai tên đăng nhập hoặc mật khẩu.')).toBeVisible();
    await login(page, { ...state, password: newPassword });
    await expectNoHorizontalOverflow(page);
  } finally {
    await otherContext.close();
  }

  // Restore the prepared password through the API as the signed-in owner.
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'crew_csrf')?.value ?? '';
  const restore = await page.request.post('/v1/auth/password', {
    data: { currentPassword: newPassword, newPassword: state.password },
    headers: { 'x-csrf-token': csrf, origin: E2E_WEB_ORIGIN },
  });
  expect(restore.status(), await restore.text()).toBe(200);
});
