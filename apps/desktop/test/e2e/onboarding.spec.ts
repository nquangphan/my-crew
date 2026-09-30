import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_API_URL } from './e2e-env';
import {
  answerFolderDialog,
  appInfo,
  expectAllGreen,
  fixtureRepo,
  launch,
  machineIdOf,
  ownerWeb,
  pairingCode,
  screenshot,
  state,
  testEnv,
} from './helpers';

test('first run: pair, check Claude, finish; projects come from the web and the folder picker saves to the server', async () => {
  const env = testEnv();
  const { app, page } = await launch(env);
  try {
    const shop = fixtureRepo(env, 'shop-api', state().project.repoUrl);

    // 1. Server
    await expect(page.locator('[data-step="server"]')).toBeVisible();
    await page.getByLabel('URL server').fill(E2E_API_URL);
    await page.getByRole('button', { name: 'Kiểm tra', exact: true }).click();
    await expect(page.getByText('kết nối, TLS và phiên bản API v1 đều ổn')).toBeVisible();
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();

    // 2. Pairing
    await page.getByLabel('Tên máy').fill('mac-e2e');
    await page.getByLabel('Mã ghép').fill(pairingCode(0));
    await page.getByRole('button', { name: 'Ghép máy' }).click();
    await expect(page.getByText('Máy đã được ghép với tên "mac-e2e"')).toBeVisible();
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();

    // 3. Claude (runtime, login probe, no API key)
    await expect(page.locator('[data-check="claude.login"][data-status="green"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-check="claude.api-key-env"][data-status="green"]')).toBeVisible();
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();

    // 4. Finish: login item on, daemon started, the status view open. Nothing else is set up in the app.
    await page.getByRole('button', { name: 'Hoàn tất' }).click();
    await expect(page.getByRole('heading', { name: 'Trạng thái máy' })).toBeVisible();
    const info = await appInfo(page);
    expect(info).toMatchObject({ setupComplete: true, loginItem: true, paired: true });
    expect(info.daemon.daemonStarted).toBe(true);
    const projects = page.getByRole('region', { name: 'Dự án của máy này' });
    await expect(projects.getByText('Máy chưa giữ dự án nào')).toBeVisible();

    // The owner assigns SHOP and the assistant role on the web.
    const web = await ownerWeb();
    const machineId = machineIdOf(env);
    await web.assign(machineId, { projectId: await web.projectId('SHOP') });
    await web.assign(machineId, { hostsAssistant: true });
    await page.reload();
    const row = page.locator('[data-project="SHOP"]');
    await expect(row.getByText('của máy này')).toBeVisible();
    await expect(row.getByText('chưa chọn thư mục')).toBeVisible();

    // The folder picker checks the folder here and saves it to the server; the hooks come with it.
    await answerFolderDialog(app, shop);
    await row.getByRole('button', { name: 'Chọn thư mục…' }).click();
    for (const check of ['path', 'origin', 'branch', 'push', 'tree']) {
      await expect(row.locator(`[data-check="folder.${check}"][data-status="green"]`)).toBeVisible({
        timeout: 60_000,
      });
    }
    await expect(row.getByText('Đã lưu thư mục lên server')).toBeVisible();
    expect(existsSync(join(shop, '.githooks', 'pre-commit'))).toBe(true);
    await screenshot(page, 'status-folder-saved');
    await page.reload();
    await expect(page.locator('[data-project="SHOP"]').getByText(shop)).toBeVisible();

    // Everything green, and the web sees the same machine: health, assistant, project, settings revision.
    await expectAllGreen(page);
    await screenshot(page, 'status-all-green');
    await expect(async () => {
      const me = await web.machine('mac-e2e');
      expect(me?.health?.status).toBe('green');
      expect(me?.hostsAssistant).toBe(true);
      expect(me?.projectKeys).toEqual(['SHOP']);
      expect(me?.settings.current).toBe(true);
    }).toPass({ timeout: 60_000 });

    // "Mở thư mục log" opens ~/.crew/logs; "Mở trên web" goes to the paired server only.
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as { openedPaths?: string[]; openedUrls?: string[] }).openedPaths = opened;
      const urls: string[] = [];
      (globalThis as { openedUrls?: string[] }).openedUrls = urls;
      shell.openPath = (async (path: string) => {
        opened.push(path);
        return '';
      }) as typeof shell.openPath;
      shell.openExternal = (async (url: string) => {
        urls.push(url);
      }) as typeof shell.openExternal;
    });
    await page.getByRole('button', { name: 'Mở thư mục log' }).click();
    await page
      .getByRole('region', { name: 'Mở trên web' })
      .getByRole('button', { name: 'Cài đặt máy này' })
      .click();
    await expect
      .poll(() =>
        app.evaluate(() => ({
          paths: (globalThis as { openedPaths?: string[] }).openedPaths ?? [],
          urls: (globalThis as { openedUrls?: string[] }).openedUrls ?? [],
        })),
      )
      .toEqual({
        paths: [join(env.home, 'logs')],
        urls: [`${E2E_API_URL}/settings/machines/${machineId}`],
      });
  } finally {
    await app.close();
    env.cleanup();
  }
});
