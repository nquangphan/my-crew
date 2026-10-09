// Gom trình đọc file (DOCX/XLSX/CSV/text, kèm yauzl và saxes) thành một file CommonJS `dist/files-worker.cjs`:
// bản cài `~/.crew/app/crew-mac` và bản app mang theo chỉ có `dist/**`, không có node_modules.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(here, 'src/files/worker-entry.ts')],
  outfile: resolve(here, 'dist/files-worker.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  legalComments: 'none',
  logLevel: 'warning',
});
