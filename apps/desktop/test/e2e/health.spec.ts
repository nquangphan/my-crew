import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { E2E_API_URL } from './e2e-env';
import {
  appInfo,
  call,
  expectAllGreen,
  fixtureRepo,
  launch,
  ownerSession,
  pairingCode,
  testEnv,
} from './helpers';

/** Sets the machine up through the same IPC the wizard uses (the wizard UI itself is covered by onboarding). */
async function setUp(page: Page, repo: string, code: string): Promise<void> {
  await call(page, 'setup.pair', { apiUrl: E2E_API_URL, code, machineName: 'mac-health' });
  const created = await call(page, 'projects.create', {
    path: repo,
    key: 'HLTH',
    name: 'Health fixture',
    description: 'Repo mẫu cho bộ test sức khỏe.',
    repoUrl: HEALTH_REPO_URL,
    defaultBranch: 'main',
    platform: 'backend',
  });
  expect(created.status).toBe('granted');
  await call(page, 'hooks.install', { key: 'HLTH' });
  const resources = await call(page, 'config.resources', {});
  await call(page, 'config.saveResources', {
    resources: { ...resources.resources, minFreeMemGb: 0, maxLoadPerCpu: 64 },
    models: resources.models,
  });
  await call(page, 'setup.finish', {});
  await page.evaluate(() => {
    window.location.hash = '#/health';
  });
}

const HEALTH_REPO_URL = 'https://github.com/2p/health-fixture.git';

const row = (page: Page, id: string) => page.locator(`[data-check="${id}"]`);

async function recheck(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Kiểm tra ngay' }).click();
  await expect(page.getByRole('button', { name: 'Kiểm tra ngay' })).toBeEnabled({ timeout: 60_000 });
}

test('breaking a check turns it red and its fix turns it green; the daemon survives the UI and restarts after a kill', async () => {
  const env = testEnv();
  const { app, page } = await launch(env);
  try {
    const repo = fixtureRepo(env, 'health-fixture', HEALTH_REPO_URL);
    await setUp(page, repo, pairingCode(2));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sức khỏe máy' })).toBeVisible();
    await expectAllGreen(page);

    // Delete a repo hook → red → "Cài lại hook" → green.
    rmSync(join(repo, '.githooks', 'pre-commit'));
    await recheck(page);
    await expect(row(page, 'repos.HLTH.hooks')).toHaveAttribute('data-status', 'red');
    await row(page, 'repos.HLTH.hooks').getByRole('button', { name: 'Cài lại hook' }).click();
    await expect(row(page, 'repos.HLTH.hooks')).toHaveAttribute('data-status', 'green', { timeout: 60_000 });
    expect(existsSync(join(repo, '.githooks', 'pre-commit'))).toBe(true);

    // Log out of Claude → red → "Đăng nhập Claude" opens Terminal with `claude` → log in again → green.
    writeFileSync(join(env.home, '.test-claude-logged-out'), '');
    await recheck(page);
    await expect(row(page, 'claude.login')).toHaveAttribute('data-status', 'red');
    await row(page, 'claude.login').getByRole('button', { name: 'Đăng nhập Claude' }).click();
    await expect.poll(() => existsSync(join(env.home, '.test-terminal-launches'))).toBe(true);
    expect(readFileSync(join(env.home, '.test-terminal-launches'), 'utf8')).toContain('claude');
    rmSync(join(env.home, '.test-claude-logged-out'));
    await recheck(page);
    await expect(row(page, 'claude.login')).toHaveAttribute('data-status', 'green');

    // Closing the window or reloading the renderer never touches the daemon process.
    const before = await appInfo(page);
    expect(before.daemon.pid).not.toBeNull();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sức khỏe máy' })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => app.windows().length).toBe(0);
    process.kill(before.daemon.pid as number, 0); // still alive
    const reopened = app.waitForEvent('window');
    await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
    const window = await reopened;
    await window.waitForLoadState('domcontentloaded');
    expect((await appInfo(window)).daemon.pid).toBe(before.daemon.pid);

    // Killing the daemon process: the supervisor restarts it (and the daemon) within 10 s.
    const killedAt = Date.now();
    process.kill(before.daemon.pid as number, 'SIGKILL');
    await expect
      .poll(
        async () => {
          const info = await appInfo(window);
          return (
            info.daemon.pid !== before.daemon.pid &&
            info.daemon.daemonStarted &&
            info.status?.running === true
          );
        },
        { timeout: 10_000, intervals: [250] },
      )
      .toBe(true);
    expect(Date.now() - killedAt).toBeLessThan(10_000);

    // Revoke the machine on the web → the token check is red → "Ghép lại máy" opens the pairing step.
    const owner = await ownerSession();
    const machineId = readFileSync(join(env.home, 'config.yaml'), 'utf8').match(/machineId: (\S+)/)?.[1];
    const revoked = await owner.request('POST', `/v1/machines/${machineId}/revoke`, {});
    expect(revoked.status).toBe(200);
    await recheck(window);
    await expect(window.locator('[data-check="server.token"]')).toHaveAttribute('data-status', 'red');
    await window.locator('[data-check="server.token"]').getByRole('button', { name: 'Ghép lại máy' }).click();
    await expect(window.locator('[data-step="pairing"]')).toBeVisible();
    await window.getByLabel('Tên máy').fill('mac-health-2');
    await window.getByLabel('Mã ghép').fill(pairingCode(3));
    await window.getByRole('button', { name: 'Ghép máy' }).click();
    await expect(window.getByText('Máy đã được ghép với tên "mac-health-2"')).toBeVisible();
    await window.getByRole('button', { name: 'Đóng trình cài đặt' }).click();
    await recheck(window);
    await expect(window.locator('[data-check="server.token"]')).toHaveAttribute('data-status', 'green');
  } finally {
    await app.close();
    env.cleanup();
  }
});
