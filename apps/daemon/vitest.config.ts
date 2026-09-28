import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Daemon tests use their own database on the crew dev Postgres, so they never race the API suite. */
const TEST_DATABASE_URL =
  process.env.DAEMON_TEST_DATABASE_URL ?? 'postgres://crew:crew@127.0.0.1:55432/crew_daemon_test';

export default defineConfig({
  resolve: {
    alias: {
      '@crew/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/helpers/global-setup.ts'],
    env: { TEST_DATABASE_URL, CREW_TOKEN_STORE: 'file' },
    // Every file shares one Postgres database, truncated between tests.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
