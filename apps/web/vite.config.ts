import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** The API the dev server and `vite preview` proxy to; same-origin requests keep cookies and CSRF simple. */
const apiTarget = process.env.CREW_API_URL ?? 'http://127.0.0.1:8787';
const proxy = { '/v1': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // The web app compiles the shared contracts from source, so it needs no prior build of @crew/shared.
    alias: {
      '@crew/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: Number(process.env.CREW_WEB_PORT ?? 4173), strictPort: true, proxy },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    css: false,
  },
});
