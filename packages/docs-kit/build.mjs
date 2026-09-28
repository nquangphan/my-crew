// Bundles the crew-docs CLI into one self-contained CommonJS file that runs with nothing but an absolute
// Node (or Electron with ELECTRON_RUN_AS_NODE=1) path. Templates are inlined as text.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8'));

export const DEFAULT_OUTFILE = resolve(here, 'dist', 'crew-docs.cjs');

/** `import text from './file.md?raw'`: the same raw-text import Vitest understands. */
const rawTextPlugin = {
  name: 'raw-text',
  setup(builder) {
    builder.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.slice(0, -'?raw'.length)),
      namespace: 'raw-text',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'raw-text' }, (args) => ({
      contents: readFileSync(args.path, 'utf8'),
      loader: 'text',
    }));
  },
};

export async function buildBundle(outfile = DEFAULT_OUTFILE) {
  await build({
    entryPoints: [resolve(here, 'src', 'bin.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    banner: { js: '#!/usr/bin/env node' },
    define: { __CREW_DOCS_VERSION__: JSON.stringify(pkg.version) },
    // crew-docs uses only the docs contracts; bundling them alone keeps the other API schemas out.
    alias: { '@crew/shared': resolve(here, '..', 'shared', 'src', 'docs-schemas.ts') },
    minifySyntax: true,
    minifyWhitespace: true,
    plugins: [rawTextPlugin],
    legalComments: 'none',
    logLevel: 'warning',
  });
  return outfile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outfile = await buildBundle();
  console.log(`crew-docs ${pkg.version} bundled to ${outfile}`);
}
