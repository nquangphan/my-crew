import { cpSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * The app is split in two. The shell — the main process (`out/main`) and the preload (`out/preload`) — is built
 * here with the renderer, and changes only with a dmg. The runtime bundle — the daemon host
 * (`out/runtime/host`, built by `electron.vite.host.config.ts` as its own self-contained bundle) and the
 * renderer (`out/runtime/renderer`) — is what a signed hot update replaces (see `scripts/runtime-bundle.mjs`).
 *
 * The workspace packages (`@crew/shared`, `@crew/daemon`) are compiled from source into the bundles. Only the
 * runtime `dependencies` stay external: native `better-sqlite3`, the Agent SDK (it spawns its platform
 * binary from its own package), the MCP SDK and `electron-updater`. `scripts/stage-app.mjs` installs exactly
 * those into the packaged app; a hot-updated host reaches them through a `node_modules` link the shell makes.
 */
/** The daemon's role prompts (Markdown read at runtime) next to the host bundle: `out/runtime/host/prompts/`. */
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

export const alias = {
  '@crew/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
  '@crew/daemon': fileURLToPath(new URL('../daemon/src/library.ts', import.meta.url)),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: { input: { index: fileURLToPath(new URL('src/main/index.ts', import.meta.url)) } },
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
      outDir: fileURLToPath(new URL('out/runtime/renderer', import.meta.url)),
      rollupOptions: { input: { index: fileURLToPath(new URL('src/renderer/index.html', import.meta.url)) } },
    },
  },
});
