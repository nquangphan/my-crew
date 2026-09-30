import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HealthReport } from '@crew/shared';
import { expect, type Page, test } from '@playwright/test';
import { E2E_API_URL } from './e2e-env';
import {
  appInfo,
  call,
  expectAllGreen,
  fixtureRepo,
  launch,
  machineIdOf,
  ownerWeb,
  pairingCode,
  type TestEnv,
  testEnv,
} from './helpers';

const HEALTH_REPO_URL = 'https://github.com/2p/health-fixture.git';

/**
 * Sets the machine up through the same IPC the app uses (the wizard UI itself is covered by onboarding); the
 * owner creates and assigns the project on the web, the folder picker saves its folder.
 */
async function setUp(page: Page, env: TestEnv, repo: string, code: string) {
  await call(page, 'setup.pair', { apiUrl: E2E_API_URL, code, machineName: 'mac-health' });
  const web = await ownerWeb();
  const project = await web.createProject({
    key: 'HLTH',
    name: 'Health fixture',
    repoUrl: HEALTH_REPO_URL,
    platform: 'backend',
  });
  const machineId = machineIdOf(env);
  await web.assign(machineId, { projectId: project.id });
  const folder = await call(page, 'projects.setFolder', { key: 'HLTH', path: repo });
  expect(folder.ok).toBe(true);
  await call(page, 'setup.finish', {});
  await page.evaluate(() => {
    window.location.hash = '#/status';
  });
  return { web, machineId };
}

const health = (page: Page) => page.getByRole('region', { name: 'Sức khỏe' });
const row = (page: Page, id: string) => health(page).locator(`[data-check="${id}"]`);

async function recheck(page: Page): Promise<void> {
  await health(page).getByRole('button', { name: 'Kiểm tra ngay' }).click();
  await expect(health(page).getByRole('button', { name: 'Kiểm tra ngay' })).toBeEnabled({ timeout: 60_000 });
}

test('breaking a check turns it red and its fix turns it green, here and from the web; the daemon survives the UI and restarts after a kill', async () => {
  const env = testEnv();
  const { app, page } = await launch(env);
  try {
    const repo = fixtureRepo(env, 'health-fixture', HEALTH_REPO_URL);
    const { web, machineId } = await setUp(page, env, repo, pairingCode(2));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Trạng thái máy' })).toBeVisible();
    await expectAllGreen(page);

    // Delete a repo hook → red → "Cài lại hook" here → green.
    rmSync(join(repo, '.githooks', 'pre-commit'));
    await recheck(page);
    await expect(row(page, 'repos.HLTH.hooks')).toHaveAttribute('data-status', 'red');
    await row(page, 'repos.HLTH.hooks').getByRole('button', { name: 'Cài lại hook' }).click();
    await expect(row(page, 'repos.HLTH.hooks')).toHaveCount(0, { timeout: 60_000 });
    expect(existsSync(join(repo, '.githooks', 'pre-commit'))).toBe(true);

    // The same from the web: the owner runs the checks and the fix remotely; the machine reports back.
    rmSync(join(repo, '.githooks', 'pre-commit'));
    const broken = await web.command(machineId, { action: 'health.run', quick: true });
    expect(
      (broken.result as HealthReport).results.find((item) => item.id === 'repos.HLTH.hooks')?.status,
    ).toBe('red');
    const fixed = await web.command(machineId, {
      action: 'health.fix',
      group: 'repos',
      fixId: 'install-hooks:HLTH',
    });
    expect(
      (fixed.result as HealthReport).results.find((item) => item.id === 'repos.HLTH.hooks')?.status,
    ).toBe('green');
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
    await expect(row(page, 'claude.login')).toHaveCount(0);

    // Closing the window or reloading the renderer never touches the daemon process.
    const before = await appInfo(page);
    expect(before.daemon.pid).not.toBeNull();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Trạng thái máy' })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => app.windows().length).toBe(0);
    process.kill(before.daemon.pid as number, 0); // still alive
    const reopened = app.waitForEvent('window');
    await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
    const window = await reopened;
    await window.waitForLoadState('domcontentloaded');
    expect((await appInfo(window)).daemon.pid).toBe(before.daemon.pid);

    // A pause from the web is kept like one from the tray.
    await web.command(machineId, { action: 'pause' });
    await expect.poll(async () => (await appInfo(window)).status?.paused).toBe(true);
    await web.command(machineId, { action: 'resume' });
    await expect.poll(async () => (await appInfo(window)).status?.paused).toBe(false);

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
    const revoked = await web.request('POST', `/v1/machines/${machineId}/revoke`, {});
    expect(revoked.status).toBe(200);
    await recheck(window);
    const token = window.getByRole('region', { name: 'Sức khỏe' }).locator('[data-check="server.token"]');
    await expect(token).toHaveAttribute('data-status', 'red');
    await token.getByRole('button', { name: 'Ghép lại máy' }).click();
    await expect(window.locator('[data-step="pairing"]')).toBeVisible();
    await window.getByLabel('Tên máy').fill('mac-health-2');
    await window.getByLabel('Mã ghép').fill(pairingCode(3));
    await window.getByRole('button', { name: 'Ghép máy' }).click();
    await expect(window.getByText('Máy đã được ghép với tên "mac-health-2"')).toBeVisible();
    await window.getByRole('button', { name: 'Đóng trình cài đặt' }).click();
    await recheck(window);
    await expect(token).toHaveCount(0);
  } finally {
    await app.close();
    env.cleanup();
  }
});
