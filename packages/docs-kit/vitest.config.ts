import { defineConfig } from 'vitest/config';

export default defineConfig({
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
