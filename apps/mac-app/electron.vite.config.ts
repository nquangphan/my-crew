import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const url = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * `@crew/mac` được bundle thẳng từ nguồn vào main và utility (không externalize). Nguồn của nó đọc
 * `../assets/crew-claude-run.sh` theo `import.meta.url`, nên chép `assets/` sang `out/assets/` để đường dẫn đó
 * vẫn đúng với file `out/main/*.js`.
 */
const copyMacAssets = {
  name: 'crew-copy-mac-assets',
  writeBundle() {
    cpSync(url('../crew-mac/assets'), url('out/assets'), { recursive: true });
  },
};

export default defineConfig({
  main: {
    // Chỉ `dependencies` (electron-updater) ở ngoài bundle; còn lại, kể cả @crew/mac, gộp vào file build.
    plugins: [externalizeDepsPlugin(), copyMacAssets],
    resolve: { alias: { '@crew/mac': url('../crew-mac/src/index.ts') } },
    build: {
      rollupOptions: {
        // `ops` là file của utilityProcess (src/utility/ops.ts), cùng thư mục main.
        input: { index: url('src/main/index.ts'), ops: url('src/utility/ops.ts') },
        // Chunk chung nằm phẳng trong out/main để `../assets` của @crew/mac trỏ tới out/assets.
        output: { chunkFileNames: '[name]-[hash].js' },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: url('src/preload/index.ts') },
        // Preload sandbox phải là một file CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: url('src/renderer'),
    plugins: [react()],
    build: {
      outDir: url('out/renderer'),
      rollupOptions: { input: { index: url('src/renderer/index.html') } },
    },
  },
});
