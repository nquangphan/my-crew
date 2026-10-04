/**
 * Real app router on the Task1 fixture (PostgreSQL, API, Vite): guest redirect, login with a validated return
 * route, event stream ordering on the real protected layout, and logout. No network mocking; requests are
 * only observed.
 */
import { test as base, expect } from '@playwright/test';
import { type FixtureHandle, withFixture } from './support/fixture.ts';

const test = base.extend<Record<never, never>, { crew: FixtureHandle }>({
  crew: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern for fixture deps.
    async ({}, use) => {
      await withFixture(async (handle) => {
        await use(handle);
      });
    },
    { scope: 'worker', timeout: 180_000 },
  ],
});
test.describe.configure({ timeout: 120_000 });

test('router thật: guest chuyển login, quay về đúng path, stream trước GET dữ liệu, returnTo ngoài bị bác, logout đóng stream', async ({
  page,
  crew,
}) => {
  const calls: string[] = [];
  const streamsClosed: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/v2/')) calls.push(`${request.method()} ${pathname}`);
  });
  page.on('requestfailed', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname === '/v2/events/stream') streamsClosed.push(pathname);
  });
  const here = () => {
    const url = new URL(page.url());
    return url.pathname + url.search;
  };
  const heading = page.getByRole('heading', { name: 'Đăng nhập Crew' });
  const password = page.getByLabel('Mật khẩu');
  const signIn = page.getByRole('button', { name: 'Đăng nhập', exact: true });

  await page.goto(`${crew.webOrigin}/crew-v2/projects/abc?x=1`);
  await expect(heading).toBeVisible();
  expect(here()).toBe('/crew-v2/login?returnTo=%2Fcrew-v2%2Fprojects%2Fabc%3Fx%3D1');
  expect(calls.some((call) => call.startsWith('GET /v2/events'))).toBe(false);

  await password.fill(crew.ownerPassword);
  await signIn.click();
  await expect(page.getByRole('heading', { name: 'Dự án' })).toBeVisible();
  expect(here()).toBe('/crew-v2/projects/abc?x=1');
  await expect.poll(() => calls.some((call) => call === 'GET /v2/events/stream')).toBe(true);

  // After the session is verified, the first owner GET must be the event catch-up, before any view data.
  const verified = calls.lastIndexOf('GET /v2/auth/session');
  const afterLogin = calls.slice(verified + 1).filter((call) => call.startsWith('GET '));
  expect(afterLogin[0]).toBe('GET /v2/events');
  expect(afterLogin.filter((call) => call === 'GET /v2/events/stream')).toHaveLength(1);

  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(heading).toBeVisible();
  await expect.poll(() => streamsClosed.length).toBe(1);
  const afterLogout = calls.length;

  await page.goto(`${crew.webOrigin}/crew-v2/login?returnTo=${encodeURIComponent('https://evil.example/')}`);
  await password.fill(crew.ownerPassword);
  await signIn.click();
  await expect(page.getByRole('heading', { name: 'Không gian làm việc', level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/crew-v2/');
  expect(calls.slice(afterLogout).some((call) => call.includes('evil'))).toBe(false);
});
