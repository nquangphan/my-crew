import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FlowsManifest } from '../flows-schema.js';
import { loadManifest } from '../manifest.js';
import { checkManifest } from '../rules/r1-manifest.js';
import { notInitialized } from '../rules/r5-initialized.js';
import { formatViolation } from '../rules/types.js';
import { workingTreeReader } from '../tree.js';
import { EXIT, type Io, UsageError } from './io.js';

/** Resolves symlinks (e.g. macOS /var → /private/var) of the longest existing prefix of a path. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(canonical(parent), basename(path));
  }
}

/** A path given on the command line (absolute, or relative to the cwd) as a repo-relative POSIX path. */
export function repoRelative(root: string, cwd: string, input: string): string {
  const rel = relative(canonical(root), canonical(resolve(cwd, input)));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel))
    throw new UsageError(`${input} is outside the repo`);
  return rel.split(sep).join('/');
}

/** Loads the working-tree manifest for a lookup; prints why and returns an exit code when it cannot. */
export function lookupManifest(root: string, io: Io): FlowsManifest | number {
  const tree = workingTreeReader(root);
  const result = loadManifest(tree);
  if (result.status === 'missing') {
    io.out(formatViolation(notInitialized('working tree')));
    return EXIT.notInitialized;
  }
  if (result.status === 'invalid') {
    for (const violation of checkManifest(tree, result)) io.out(formatViolation(violation));
    return EXIT.violations;
  }
  return result.manifest;
}
