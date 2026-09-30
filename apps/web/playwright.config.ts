import { defineConfig, devices } from '@playwright/test';
import { E2E_API_PORT, E2E_API_URL, E2E_DATABASE_URL, E2E_WEB_ORIGIN, E2E_WEB_PORT } from './e2e/e2e-env';

/**
 * Core flows at the three viewports of the responsive spec, against the real API and a dedicated
 * Postgres database. `pnpm --filter @crew/web test:e2e` starts both servers and stops them afterwards.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: E2E_WEB_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Ho_Chi_Minh',
    locale: 'vi-VN',
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
      testIgnore: /owner-admin|system-settings/,
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true },
      testIgnore: /owner-admin|system-settings/,
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      name: 'api',
      command:
        'pnpm --filter @crew/api exec tsx ../web/e2e/prepare-db.ts && pnpm --filter @crew/api exec tsx src/server.ts',
      url: `${E2E_API_URL}/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        // Signs this run's CSRF tokens only; the database is recreated every run.
        SESSION_SECRET: `e2e-${process.pid}-session-secret-not-used-anywhere-else`,
        PUBLIC_ORIGIN: E2E_WEB_ORIGIN,
        HOST: '127.0.0.1',
        PORT: String(E2E_API_PORT),
        COOKIE_SECURE: 'false',
        LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
        LOG_LEVEL: 'warn',
      },
    },
    {
      name: 'web',
      command: 'pnpm exec vite build && pnpm exec vite preview',
      url: E2E_WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      env: { CREW_API_URL: E2E_API_URL, CREW_WEB_PORT: String(E2E_WEB_PORT) },
    },
  ],
});
