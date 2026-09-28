import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyBlock, FILES_BLOCK, FLOWS_BLOCK } from '../generate.js';
import { loadManifest } from '../manifest.js';
import { checkManifest } from '../rules/r1-manifest.js';
import { notInitialized } from '../rules/r5-initialized.js';
import { formatViolation } from '../rules/types.js';
import { workingTreeReader } from '../tree.js';
import { EXIT, type Io } from './io.js';

/** Rewrites the generated blocks of docs/index.md and docs/files.md from docs/flows.yaml. */
export function generateCommand(root: string, io: Io): number {
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
  for (const block of [FLOWS_BLOCK, FILES_BLOCK]) {
    const file = join(root, block.path);
    const current = tree.read(block.path);
    const next = applyBlock(current, block, result.manifest);
    if (next !== current) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, next);
      io.out(`updated ${block.path}`);
    } else {
      io.out(`unchanged ${block.path}`);
    }
  }
  return EXIT.ok;
}
