import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@crew/mac': fileURLToPath(new URL('../crew-mac/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 20_000,
  },
});
