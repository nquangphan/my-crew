import { expect, test } from '@playwright/test';
import { E2E_API_URL } from './e2e-env';
import { call, fixtureRepo, launch, ownerSession, pairingCode, state, testEnv, totp } from './helpers';

const REPO_URL = 'https://github.com/2p/settings-fixture.git';

/** The next TOTP step's code: the owner login just used the current one, and codes are single use. */
async function nextTotp(): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500));
  return totp(state().totpSecret);
}

test('Settings → Projects asks the owner to change the project type and waits for the TOTP confirmation', async () => {
  const env = testEnv();
  const { app, page } = await launch(env);
  try {
    const repo = fixtureRepo(env, 'settings-fixture', REPO_URL);
    await call(page, 'setup.pair', {
      apiUrl: E2E_API_URL,
      code: pairingCode(4),
      machineName: 'mac-settings',
    });
    const created = await call(page, 'projects.create', {
      path: repo,
      key: 'SETT',
      name: 'Settings fixture',
      description: 'Repo mẫu cho phần cài đặt project.',
      repoUrl: REPO_URL,
      defaultBranch: 'main',
      platform: 'backend',
    });
    expect(created.status).toBe('granted');
    await call(page, 'setup.finish', {});
    await page.evaluate(() => {
      window.location.hash = '#/settings-projects?project=SETT';
    });
    await page.reload();

    const section = page.locator('[data-section="test-setup"]');
    await expect(section.getByLabel('Loại project')).toHaveValue('backend');
    await section.getByLabel('Loại project').selectOption('web');
    await section.getByLabel('MCP test UI web (mặc định Playwright)').fill('pw-cloud');
    await section.getByRole('button', { name: 'Gửi yêu cầu đổi' }).click();
    await expect(section.getByText('Đang chờ chủ dự án xác nhận')).toBeVisible();
    await expect(section.getByLabel('Loại project')).toBeDisabled();

    const owner = await ownerSession();
    const listed = await owner.request('GET', '/v1/project-change-requests?status=pending');
    const { items } = (await listed.json()) as { items: { id: string; projectKey: string }[] };
    const request = items.find((item) => item.projectKey === 'SETT');
    expect(request).toBeDefined();
    const approved = await owner.request('POST', `/v1/project-change-requests/${request?.id}/approve`, {
      code: await nextTotp(),
    });
    expect(approved.status).toBe(200);

    await expect(section.getByText('Chủ dự án đã xác nhận')).toBeVisible({ timeout: 20_000 });
    await expect(section.getByLabel('Loại project')).toHaveValue('web');
    await expect(section.getByText('QC bắt buộc dùng: pw-cloud')).toBeVisible();
  } finally {
    await app.close();
    env.cleanup();
  }
});
