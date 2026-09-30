import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { alias, copyRolePrompts } from './electron.vite.config';

/**
 * Marks the host folder as ES modules: an installed runtime (`~/.crew/runtime/<version>/host/`) has no app
 * package.json above it, and without this Node would read `index.js` as CommonJS.
 */
export const hostPackageJson = {
  name: 'crew-host-package-json',
  writeBundle(options: { dir?: string }) {
    if (options.dir) writeFileSync(`${options.dir}/package.json`, '{ "type": "module" }\n');
  },
};

/**
 * The daemon host of the runtime bundle, built on its own so it shares no chunk with the shell's main process:
 * `out/runtime/host/index.js` (the entry the shell forks), its chunks, `package.json` and the role prompts in
 * `prompts/`.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyRolePrompts, hostPackageJson],
    resolve: { alias },
    build: {
      outDir: fileURLToPath(new URL('out/runtime/host', import.meta.url)),
      rollupOptions: {
        input: { index: fileURLToPath(new URL('src/daemon-host/index.ts', import.meta.url)) },
      },
    },
  },
});
