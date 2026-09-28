import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
// @ts-expect-error build.mjs is plain JavaScript without type declarations.
import { buildBundle } from '../../build.mjs';

declare module 'vitest' {
  export interface ProvidedContext {
    bundlePath: string;
  }
}

let dir: string | undefined;

/** Builds the real single-file bundle once; hook tests run it through git hooks. */
export async function setup(project: TestProject): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), 'crew-docs-bundle-'));
  const bundlePath = (await buildBundle(join(dir, 'crew-docs.cjs'))) as string;
  project.provide('bundlePath', bundlePath);
}

export async function teardown(): Promise<void> {
  if (dir) rmSync(dir, { recursive: true, force: true });
}
