/**
 * Test-only module hook: lets `node --test` import `.tsx` components by compiling them with the same Oxc
 * transform Vite uses (automatic JSX runtime, TypeScript stripped). `.ts` files keep Node's own stripping.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';

type LoadResult = { format: string; source: string; shortCircuit?: boolean };
type NextLoad = (url: string, context: unknown) => Promise<LoadResult>;

export async function load(url: string, context: unknown, next: NextLoad): Promise<LoadResult> {
  if (!url.startsWith('file:') || !url.endsWith('.tsx')) return next(url, context);
  const path = fileURLToPath(url);
  const result = await transformWithOxc(await readFile(path, 'utf8'), path, {
    lang: 'tsx',
    jsx: { runtime: 'automatic' },
  });
  return { format: 'module', source: result.code, shortCircuit: true };
}
