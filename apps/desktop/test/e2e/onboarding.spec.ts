import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Machine } from '@crew/shared';
import { expect, test } from '@playwright/test';
import { E2E_API_URL } from './e2e-env';
import {
  answerFolderDialog,
  appInfo,
  expectAllGreen,
  fixtureRepo,
  launch,
  ownerSession,
  pairingCode,
  screenshot,
  state,
  testEnv,
} from './helpers';

test('first run: pair, pick and create projects, install hooks, finish with an all-green dashboard', async () => {
  const env = testEnv();
  const { app, page } = await launch(env);
  try {
    const shop = fixtureRepo(env, 'shop-api', state().project.repoUrl);
    const tools = fixtureRepo(env, 'noi-bo-tools', 'git@github.com:2p/noi-bo-tools.git');

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

    // 4. Projects and folders: SHOP is unowned (claimed at once), NEW is created from a folder.
    const row = page.locator('[data-project="SHOP"]');
    await expect(row.getByText('chưa có máy')).toBeVisible();
    await row.getByRole('checkbox').check();
    await answerFolderDialog(app, shop);
    await row.getByRole('button', { name: 'Chọn thư mục…' }).click();
    for (const check of ['path', 'origin', 'branch', 'push', 'tree']) {
      await expect(row.locator(`[data-check="folder.${check}"][data-status="green"]`)).toBeVisible({
        timeout: 60_000,
      });
    }
    await page.getByRole('switch', { name: 'Máy này làm trợ lý' }).check();
    await screenshot(page, 'wizard-projects');
    await page.getByRole('button', { name: 'Lưu và nhận project' }).click();
    await expect(page.locator('[data-outcome="SHOP"]')).toContainText('granted');
    await expect(page.locator('[data-outcome="assistant"]')).toContainText('granted');

    await page.getByRole('button', { name: 'Thêm project mới từ thư mục' }).click();
    const form = page.locator('[data-form="new-project"]');
    await answerFolderDialog(app, tools);
    await form.getByRole('button', { name: 'Chọn thư mục repo…' }).click();
    await expect(form.getByLabel('Repo URL (origin)')).toHaveValue('git@github.com:2p/noi-bo-tools.git');
    await expect(form.getByLabel('Nhánh mặc định')).toHaveValue('main');
    await form.getByLabel('Key').fill('TOOLS');
    await form.getByLabel('Loại project').selectOption('backend');
    await form.getByLabel(/^Mô tả/).fill('Công cụ nội bộ: báo cáo doanh thu cho kế toán.');
    await form.getByRole('button', { name: 'Tạo project' }).click();
    await expect(page.locator('[data-outcome="TOOLS"]')).toContainText('Đã tạo project TOOLS');
    await expect(page.locator('[data-project="TOOLS"]').getByText('của máy này')).toBeVisible();
    await page.getByRole('button', { name: 'Lưu và nhận project' }).click();
    await expect(page.locator('[data-outcome="TOOLS"]')).toContainText('already_owned');
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();

    // 5. Docs and hooks (installed with the app binary as runtime)
    await expect(page.locator('[data-hook="SHOP"]')).toContainText('Đã cài hook', { timeout: 60_000 });
    await expect(page.locator('[data-hook="TOOLS"]')).toContainText('Đã cài hook');
    expect(existsSync(join(shop, '.githooks', 'pre-commit'))).toBe(true);
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();

    // 6. Resources and models (no pressure limits, so this busy test machine counts as free)
    await page.getByLabel('RAM trống tối thiểu (GB)').fill('0');
    await page.getByLabel('Tải tối đa mỗi CPU').fill('64');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã lưu vào ~/.crew/config.yaml.')).toBeVisible();
    const config = readFileSync(join(env.home, 'config.yaml'), 'utf8');
    expect(config).toContain('maxLoadPerCpu: 64');
    expect(config).toContain(shop);
    expect(config).not.toContain('crew_mt_');
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();

    // 7. Finish: login item on, daemon started, dashboard open and all green.
    await page.getByRole('button', { name: 'Hoàn tất' }).click();
    await expect(page.getByRole('heading', { name: 'Sức khỏe máy' })).toBeVisible();
    const info = await appInfo(page);
    expect(info).toMatchObject({ setupComplete: true, loginItem: true, paired: true });
    expect(info.daemon.daemonStarted).toBe(true);
    await expectAllGreen(page);
    await screenshot(page, 'dashboard-all-green');

    // The web Machines page shows the same health as the app (sent in the heartbeat).
    const owner = await ownerSession();
    await expect(async () => {
      const machines = (await (await owner.request('GET', '/v1/machines')).json()) as { items: Machine[] };
      const me = machines.items.find((machine) => machine.name === 'mac-e2e');
      expect(me?.health?.status).toBe('green');
      expect(me?.hostsAssistant).toBe(true);
      expect(me?.projectKeys.sort()).toEqual(['SHOP', 'TOOLS']);
    }).toPass({ timeout: 60_000 });
  } finally {
    await app.close();
    env.cleanup();
  }
});
