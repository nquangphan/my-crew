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

test('a pending project change is withdrawn when the owner moves the project to another machine', async () => {
  const env = testEnv();
  const { app, page } = await launch(env);
  try {
    const repoUrl = 'https://github.com/2p/settings-moved.git';
    const repo = fixtureRepo(env, 'settings-moved', repoUrl);
    await call(page, 'setup.pair', { apiUrl: E2E_API_URL, code: pairingCode(5), machineName: 'mac-moved' });
    const created = await call(page, 'projects.create', {
      path: repo,
      key: 'MOVD',
      name: 'Moved fixture',
      description: 'Repo mẫu chuyển sang máy khác khi đang chờ đổi loại.',
      repoUrl,
      defaultBranch: 'main',
      platform: 'backend',
    });
    expect(created.status).toBe('granted');
    await call(page, 'setup.finish', {});
    await page.evaluate(() => {
      window.location.hash = '#/settings-projects?project=MOVD';
    });
    await page.reload();

    const section = page.locator('[data-section="test-setup"]');
    await section.getByLabel('Loại project').selectOption('web');
    await section.getByRole('button', { name: 'Gửi yêu cầu đổi' }).click();
    await expect(section.getByText('Đang chờ chủ dự án xác nhận')).toBeVisible();

    // Another machine pairs, and the owner reassigns the project to it.
    const paired = await fetch(`${E2E_API_URL}/v1/machines/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: pairingCode(6),
        name: 'mac-other',
        hostname: 'mac-other.local',
        os: 'darwin',
        hardware: { cpus: 8, memGb: 16 },
      }),
    });
    expect(paired.status).toBe(201);
    const { machineId } = (await paired.json()) as { machineId: string };
    const owner = await ownerSession();
    const listed = await owner.request('GET', '/v1/project-change-requests?status=pending');
    const { items } = (await listed.json()) as { items: { projectId: string; projectKey: string }[] };
    const request = items.find((item) => item.projectKey === 'MOVD');
    expect(request).toBeDefined();
    const assigned = await owner.request('POST', `/v1/machines/${machineId}/claims`, {
      projectId: request?.projectId,
    });
    expect(assigned.status).toBe(200);

    await expect(section.getByText('Đang chờ chủ dự án xác nhận')).toBeHidden({ timeout: 20_000 });
    await expect(section.getByText('Yêu cầu đổi đã tự rút')).toBeVisible();
    await expect(section.getByLabel('Loại project')).toHaveValue('backend');
    const after = await owner.request('GET', '/v1/project-change-requests?status=pending');
    const pending = (await after.json()) as { items: { projectKey: string }[] };
    expect(pending.items.some((item) => item.projectKey === 'MOVD')).toBe(false);
  } finally {
    await app.close();
    env.cleanup();
  }
});
