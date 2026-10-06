import type { FlowsManifest } from '@crew/shared';
import type { FileChange } from '../git.js';
import { flowsListing, sourceMatcher } from '../manifest.js';
import type { Violation } from './types.js';

export interface FreshnessInput {
  changes: readonly FileChange[];
  /** Manifest before the change (null when the parent has none). */
  before: FlowsManifest | null;
  /** Manifest after the change. */
  after: FlowsManifest;
}

/**
 * R3: a change set (the commits of one push, merge or CI range) that adds, modifies, deletes or renames a
 * source file must also change the doc of every affected flow: the flows that list the file before or after
 * the change, including `shared` entries.
 */
export function checkFreshness({ changes, before, after }: FreshnessInput): Violation[] {
  const touched = new Set<string>();
  for (const change of changes) {
    touched.add(change.path);
    if (change.oldPath) touched.add(change.oldPath);
  }
  const manifests = before ? [before, after] : [after];
  const matchers = manifests.map(sourceMatcher);
  const isSource = (path: string) => matchers.some((matches) => matches(path));
  const docOf = (id: string) => after.flows[id]?.doc ?? before?.flows[id]?.doc ?? `docs/flows/${id}.md`;

  const violations: Violation[] = [];
  const reported = new Set<string>();
  for (const change of changes) {
    for (const path of change.oldPath ? [change.oldPath, change.path] : [change.path]) {
      if (!isSource(path)) continue;
      const flows = new Set(manifests.flatMap((manifest) => flowsListing(manifest, path)));
      for (const id of [...flows].sort()) {
        const doc = docOf(id);
        const key = `${path}\0${id}`;
        if (touched.has(doc) || reported.has(key)) continue;
        reported.add(key);
        violations.push({
          rule: 'R3',
          path,
          message: `changed without updating ${doc} (flow ${id}); edit that flow doc in a commit of the same push`,
        });
      }
    }
  }
  return violations;
}
