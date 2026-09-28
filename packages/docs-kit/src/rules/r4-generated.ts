import type { FlowsManifest } from '@crew/shared';
import { FILES_BLOCK, FLOWS_BLOCK, isBlockCurrent } from '../generate.js';
import type { TreeReader } from '../tree.js';
import type { Violation } from './types.js';

/** R4: the generated blocks in `docs/index.md` and `docs/files.md` match `crew-docs generate`. */
export function checkGenerated(tree: TreeReader, manifest: FlowsManifest): Violation[] {
  const violations: Violation[] = [];
  for (const block of [FLOWS_BLOCK, FILES_BLOCK]) {
    const text = tree.read(block.path);
    if (text === null || !isBlockCurrent(text, block, manifest)) {
      violations.push({
        rule: 'R4',
        path: block.path,
        message: `generated "${block.name}" block is ${text === null ? 'missing' : 'out of date'}; run \`crew-docs generate\` and include the result`,
      });
    }
  }
  return violations;
}
