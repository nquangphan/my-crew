import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BMAD_6_12 } from '../../../daemon/test/fixtures/bmad-installs';
import { E2E_API_URL } from './e2e-env';
import { call, fixtureRepo, launch, pairingCode, testEnv } from './helpers';

const REPO_URL = 'https://github.com/2p/bmad-fixture.git';

test('Settings → Projects reports the BMAD profile; "Cài BMAD" installs only into a folder without BMAD (stand-in installer)', async () => {
  const env = testEnv();
  const { app, page } = await launch(env);
  try {
    const repo = fixtureRepo(env, 'bmad-fixture', REPO_URL);
    await call(page, 'setup.pair', { apiUrl: E2E_API_URL, code: pairingCode(8), machineName: 'mac-bmad' });
    const created = await call(page, 'projects.create', {
      path: repo,
      key: 'BMAD',
      name: 'BMAD fixture',
      description: 'Repo mẫu cho nút Cài BMAD.',
      repoUrl: REPO_URL,
      defaultBranch: 'main',
      platform: 'backend',
    });
    expect(created.status).toBe('granted');
    await call(page, 'setup.finish', {});
    await page.evaluate(() => {
      window.location.hash = '#/settings-projects?project=BMAD';
    });
    await page.reload();

    // No machine holding the project has BMAD yet: nothing to install.
    const section = page.locator('[data-section="bmad"]');
    await expect(
      section.getByText('Chưa có cấu hình BMAD (máy đang giữ project chưa có BMAD).'),
    ).toBeVisible();
    await expect(section.getByRole('button', { name: 'Cài BMAD' })).toBeDisabled();

    // The folder gets a BMAD install; the inventory refresh reports it as the project's profile.
    for (const [path, content] of Object.entries(BMAD_6_12)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await expect(section.getByText('core, bmm, bmb, cis, tea, bmad-loop').first()).toBeVisible();
    await expect(section.getByText('Khớp cấu hình')).toBeVisible();
    // A folder that already has BMAD is never reinstalled or updated.
    await expect(section.getByText('Máy này đã có BMAD 6.12.0; không cài lại.')).toBeVisible();
    await expect(section.getByRole('button', { name: 'Cài BMAD' })).toBeDisabled();

    // Without the local install, the button installs the profile (the test seam stands in for npx).
    rmSync(join(repo, '_bmad'), { recursive: true, force: true });
    await page.getByRole('button', { name: 'Làm mới' }).click();
    await expect(section.getByText('Chưa cài', { exact: true })).toBeVisible();
    await section.getByRole('button', { name: 'Cài BMAD' }).click();
    await expect(section.locator('[data-bmad-log]')).toContainText('bộ cài giả lập của bộ test');
    await expect(section.getByText(/Đã cài BMAD 6\.12\.0/)).toBeVisible();
    await expect(section.getByText(/vùng luật R6 bảo vệ/)).toBeVisible();
    await expect(section.getByText('Khớp cấu hình')).toBeVisible();
  } finally {
    await app.close();
    env.cleanup();
  }
});
