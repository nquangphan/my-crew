import { cpSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * The workspace packages (`@crew/shared`, `@crew/daemon`) are compiled from source into the bundles. Only the
 * runtime `dependencies` stay external: native `better-sqlite3`, the Agent SDK (it spawns its platform
 * binary from its own package), the MCP SDK and `electron-updater`. `scripts/stage-app.mjs` installs exactly
 * those into the packaged app.
 */
/** The daemon's role prompts (Markdown read at runtime) next to the main bundle: `out/main/prompts/`. */
export const ROLE_PROMPTS_SOURCE = fileURLToPath(new URL('../daemon/src/roles/prompts/', import.meta.url));
export const copyRolePrompts = {
  name: 'crew-copy-role-prompts',
  writeBundle(options: { dir?: string }) {
    if (!options.dir) return;
    cpSync(ROLE_PROMPTS_SOURCE, `${options.dir}/prompts`, {
      recursive: true,
      filter: (path) => statSync(path).isDirectory() || path.endsWith('.md'),
    });
  },
};

const alias = {
  '@crew/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
  '@crew/daemon': fileURLToPath(new URL('../daemon/src/library.ts', import.meta.url)),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyRolePrompts],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL('src/main/index.ts', import.meta.url)),
          'daemon-host': fileURLToPath(new URL('src/daemon-host/index.ts', import.meta.url)),
        },
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: fileURLToPath(new URL('src/preload/index.ts', import.meta.url)) },
        // A sandboxed preload must be one CommonJS file.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: fileURLToPath(new URL('src/renderer', import.meta.url)),
    plugins: [react(), tailwindcss()],
    resolve: { alias },
    build: {
      rollupOptions: { input: { index: fileURLToPath(new URL('src/renderer/index.html', import.meta.url)) } },
    },
  },
});
