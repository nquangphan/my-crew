import { defineConfig } from '@playwright/test';
import { E2E_API_PORT, E2E_API_URL, E2E_DATABASE_URL } from './test/e2e/e2e-env';

/**
 * Electron E2E (`_electron`) of the staged app against the real API on its own database.
 * `pnpm --filter @crew/desktop test:e2e` stages the app if needed, starts the API and stops it afterwards.
 */
export default defineConfig({
  testDir: './test/e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    name: 'api',
    command:
      'pnpm --filter @crew/api exec tsx ../desktop/test/e2e/prepare-db.ts && pnpm --filter @crew/api exec tsx src/server.ts',
    url: `${E2E_API_URL}/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET: `desktop-e2e-${process.pid}-session-secret-not-used-anywhere-else`,
      PUBLIC_ORIGIN: E2E_API_URL,
      HOST: '127.0.0.1',
      PORT: String(E2E_API_PORT),
      COOKIE_SECURE: 'false',
      LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
      LOG_LEVEL: 'warn',
    },
  },
});
