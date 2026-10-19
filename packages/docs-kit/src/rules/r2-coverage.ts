import type { FlowsManifest } from '../flows-schema.js';
import { FLOWS_MANIFEST_PATH, mappedPaths, sourceMatcher } from '../manifest.js';
import type { TreeReader } from '../tree.js';
import type { Violation } from './types.js';

/** R2: every source file (include minus exclude) is in a flow, a `shared` entry or an `unassigned` entry. */
export function checkCoverage(tree: TreeReader, manifest: FlowsManifest): Violation[] {
  const isSource = sourceMatcher(manifest);
  const mapped = mappedPaths(manifest);
  return [...tree.files()]
    .filter((path) => isSource(path) && !mapped.has(path))
    .sort()
    .map((path) => ({
      rule: 'R2',
      path,
      message: `source file is in no flow; add it to a flow's files in ${FLOWS_MANIFEST_PATH} (or to shared/unassigned with a reason) and describe it in that flow's doc`,
    }));
}
