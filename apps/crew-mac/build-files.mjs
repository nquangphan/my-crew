// Gom các phần cần dependency thành file CommonJS đơn: trình đọc file (DOCX/XLSX/CSV/text, kèm yauzl và saxes) thành
// `dist/files-worker.cjs`, hook gate Crew Jev (kèm jev-use) thành `dist/jev-gate.cjs`. Bản cài `~/.crew/app/crew-mac`
// và bản app mang theo chỉ có `dist/**`, không có node_modules.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

const bundles = [
  ['src/files/worker-entry.ts', 'dist/files-worker.cjs'],
  ['src/jev/gate-entry.ts', 'dist/jev-gate.cjs'],
];

for (const [entry, out] of bundles) {
  await build({
    entryPoints: [resolve(here, entry)],
    outfile: resolve(here, out),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    legalComments: 'none',
    logLevel: 'warning',
  });
}
