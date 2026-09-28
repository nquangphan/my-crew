import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against the shared sources, so they need no prior build of @crew/shared.
    alias: {
      '@crew/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/helpers/global-setup.ts'],
    // Every file shares one Postgres database, truncated between tests.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
