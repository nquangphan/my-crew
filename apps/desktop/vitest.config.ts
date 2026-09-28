import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** The desktop suite has its own database on the crew dev Postgres, so it never races the API or daemon suites. */
const TEST_DATABASE_URL =
  process.env.DESKTOP_TEST_DATABASE_URL ?? 'postgres://crew:crew@127.0.0.1:55432/crew_desktop_test';
// The global setup runs in this process (test.env does not reach it), so it must see the same database.
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  resolve: {
    alias: {
      '@crew/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@crew/daemon': fileURLToPath(new URL('../daemon/src/library.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/e2e/**'],
    // Creates and migrates the test database and builds the real crew-docs bundle (shared with the daemon).
    globalSetup: ['../daemon/test/helpers/global-setup.ts'],
    env: { TEST_DATABASE_URL, CREW_TOKEN_STORE: 'file' },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
