import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against the shared sources, so they need no prior build of @crew/shared.
    alias: {
      '@crew/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Fixture repos are copied into temp git repos; their files are data, not tests.
    exclude: ['test/fixtures/**'],
    // Builds the single-file bundle once; hook tests run it through real git hooks.
    globalSetup: ['test/helpers/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
