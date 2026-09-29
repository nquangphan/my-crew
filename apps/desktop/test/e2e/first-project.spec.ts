import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Machine } from '@crew/shared';
import { expect, test } from '@playwright/test';
import { E2E_API_URL } from './e2e-env';
import {
  answerFolderDialog,
  fixtureRepo,
  launch,
  ownerSession,
  pairingCode,
  screenshot,
  testEnv,
} from './helpers';

/**
 * The owner's first real install: a new mobile project from a folder that has no docs yet, drafted in the
 * wizard and saved with the step's own button, then the same project created again from the Project page.
 */
test('a new project drafted in the wizard is created on save; a repeated create is a success; hooks, health and app log', async () => {
  const env = testEnv();
  const { app, page } = await launch(env);
  try {
    const repo = fixtureRepo(env, 'kidy_school', 'git@github.com:2p/kidy_school.git', { docs: false });
    // The QC MCP the mobile project needs is present, so only the device check can warn.
    writeFileSync(
      join(env.home, '.test-inventory.json'),
      JSON.stringify({
        skills: [],
        mcpServers: [{ name: 'maestro', source: 'user', status: 'connected', tools: [{ name: 'tap' }] }],
      }),
    );
    const code = pairingCode(7);

    await page.getByLabel('URL server').fill(E2E_API_URL);
    await page.getByRole('button', { name: 'Kiểm tra', exact: true }).click();
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    await page.getByLabel('Tên máy').fill('mac-first-project');
    await page.getByLabel('Mã ghép').fill(code);
    await page.getByRole('button', { name: 'Ghép máy' }).click();
    await expect(page.getByText('Máy đã được ghép')).toBeVisible();
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    await expect(page.locator('[data-check="claude.login"][data-status="green"]')).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();

    // Draft the project, leave the description empty, and press the step's button (the owner's path).
    await page.getByRole('button', { name: 'Thêm project mới từ thư mục' }).click();
    const form = page.locator('[data-form="new-project"]');
    await answerFolderDialog(app, repo);
    await form.getByRole('button', { name: 'Chọn thư mục repo…' }).click();
    await form.getByLabel('Key').fill('KIDYSCHOOL');
    await form.getByLabel('Loại project').selectOption('mobile');
    await expect(form.getByText('Còn thiếu mô tả.')).toBeVisible();
    await expect(page.getByText('Project mới ở trên chưa được tạo')).toBeVisible();
    const next = page.getByRole('button', { name: 'Tiếp', exact: true });
    await page.getByRole('button', { name: 'Lưu và nhận project' }).click();
    await expect(page.getByText('Project mới chưa được tạo: sửa theo thông báo')).toBeVisible();
    await expect(next).toBeDisabled();

    await form.getByLabel(/^Mô tả/).fill('App trường mầm non cho phụ huynh và giáo viên.');
    await page.getByRole('button', { name: 'Lưu và nhận project' }).click();
    await expect(page.locator('[data-outcome="KIDYSCHOOL"]')).toContainText('Đã tạo project KIDYSCHOOL');
    await expect(page.locator('[data-project="KIDYSCHOOL"]').getByText('của máy này')).toBeVisible();
    await expect(next).toBeEnabled();
    await screenshot(page, 'wizard-new-project-saved');
    await next.click();

    // The hooks were installed with the project; the repo has no docs yet.
    await expect(page.locator('[data-hook="KIDYSCHOOL"]')).toContainText('Đã cài hook', { timeout: 60_000 });
    await expect(page.locator('[data-hook="KIDYSCHOOL"]')).toContainText('Chưa có docs');
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    await page.getByLabel('RAM trống tối thiểu (GB)').fill('0');
    await page.getByLabel('Tải tối đa mỗi CPU').fill('64');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
    await page.getByRole('button', { name: 'Hoàn tất' }).click();
    await expect(page.getByRole('heading', { name: 'Sức khỏe máy' })).toBeVisible();

    // Before docs-init the owner's own commits go through, with a one-line warning from the hook.
    writeFileSync(join(repo, 'lib.dart'), 'void main() {}\n');
    const gitEnv = { ...env.env };
    execFileSync('git', ['add', '-A'], { cwd: repo, env: gitEnv });
    const commit = execFileSync('git', ['commit', '-m', 'feat: màn hình đầu tiên'], {
      cwd: repo,
      env: gitEnv,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(commit).toContain('màn hình đầu tiên');

    // Health: hooks green, "no docs yet" is a green note, nothing red; the web sees the same.
    await expect(async () => {
      await page.getByRole('button', { name: 'Kiểm tra ngay' }).click();
      await expect(page.getByRole('button', { name: 'Kiểm tra ngay' })).toBeEnabled({ timeout: 60_000 });
      await expect(page.locator('[data-check="repos.KIDYSCHOOL.hooks"][data-status="green"]')).toBeVisible();
      await expect(page.locator('[data-check="repos.KIDYSCHOOL.docs"][data-status="green"]')).toBeVisible();
      await expect(
        page.locator('[data-check="mcp.KIDYSCHOOL.qc-maestro"][data-status="green"]'),
      ).toBeVisible();
      expect(await page.locator('[data-check][data-status="red"]').count()).toBe(0);
    }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 5_000] });
    const owner = await ownerSession();
    await expect(async () => {
      const machines = (await (await owner.request('GET', '/v1/machines')).json()) as { items: Machine[] };
      const me = machines.items.find((machine) => machine.name === 'mac-first-project');
      expect(me?.projectKeys).toEqual(['KIDYSCHOOL']);
      expect(me?.health?.status).not.toBe('red');
      expect(me?.health?.failing).toEqual([]);
    }).toPass({ timeout: 60_000 });

    // The owner creates the same project again from the Project page: the same success, not an error.
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.getByRole('button', { name: 'Tạo project từ thư mục' }).click();
    await answerFolderDialog(app, repo);
    await form.getByRole('button', { name: 'Chọn thư mục repo…' }).click();
    await form.getByLabel('Key').fill('KIDYSCHOOL');
    await form.getByLabel('Loại project').selectOption('mobile');
    await form.getByLabel(/^Mô tả/).fill('App trường mầm non cho phụ huynh và giáo viên.');
    await form.getByRole('button', { name: 'Tạo project' }).click();
    await expect(page.getByText('KIDYSCHOOL: Project KIDYSCHOOL đã được tạo trước đó')).toBeVisible();
    // A key that belongs to another project keeps the clear conflict message.
    await page.getByRole('button', { name: 'Tạo project từ thư mục' }).click();
    await answerFolderDialog(app, repo);
    await form.getByRole('button', { name: 'Chọn thư mục repo…' }).click();
    await form.getByLabel('Key').fill('SHOP');
    await form.getByLabel(/^Mô tả/).fill('Trùng key');
    await form.getByRole('button', { name: 'Tạo project' }).click();
    await expect(form.getByText('Key SHOP đã có trên server')).toBeVisible();

    // "Mở thư mục log" opens ~/.crew/logs.
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as { openedPaths?: string[] }).openedPaths = opened;
      shell.openPath = (async (path: string) => {
        opened.push(path);
        return '';
      }) as typeof shell.openPath;
    });
    await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
    await page.getByRole('button', { name: 'Mở thư mục log' }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as { openedPaths?: string[] }).openedPaths ?? []))
      .toEqual([join(env.home, 'logs')]);

    // The app log: every IPC outcome, the failed API call, no pairing code or token, mode 0600.
    const logFile = join(env.home, 'logs', 'app.log');
    expect(statSync(logFile).mode & 0o777).toBe(0o600);
    const lines = readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'main', event: 'app-start' }),
        expect.objectContaining({ event: 'ipc', method: 'setup.pair', outcome: 'ok' }),
        expect.objectContaining({ event: 'ipc', method: 'projects.create', outcome: 'ok' }),
        expect.objectContaining({ event: 'ipc', method: 'projects.create', outcome: 'error' }),
        expect.objectContaining({
          source: 'host',
          event: 'api-error',
          method: 'POST',
          path: '/v1/daemon/projects',
          status: 409,
          errorCode: 'CONFLICT',
        }),
        expect.objectContaining({ source: 'host', event: 'hooks-installed', project: 'KIDYSCHOOL' }),
      ]),
    );
    const raw = readFileSync(logFile, 'utf8');
    expect(raw).not.toContain(code);
    expect(raw).not.toContain('crew_mt_');
  } finally {
    await app.close();
    env.cleanup();
  }
});
