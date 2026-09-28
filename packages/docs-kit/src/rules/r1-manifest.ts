import { FLOWS_MANIFEST_PATH, type ManifestResult } from '../manifest.js';
import type { TreeReader } from '../tree.js';
import type { Violation } from './types.js';

const violation = (path: string, message: string): Violation => ({ rule: 'R1', path, message });

/**
 * R1: `flows.yaml` parses and matches the schema (duplicate flow ids are YAML duplicate keys), and every
 * doc, entrypoint, file, test, shared and unassigned path it lists exists.
 */
export function checkManifest(tree: TreeReader, result: ManifestResult): Violation[] {
  if (result.status === 'missing') return [];
  if (result.status === 'invalid') {
    return result.errors.map((error) => violation(FLOWS_MANIFEST_PATH, `${error}; fix the manifest`));
  }
  const { manifest } = result;
  const files = tree.files();
  const violations: Violation[] = [];
  const requireFile = (path: string, what: string) => {
    if (!files.has(path)) {
      violations.push(
        violation(
          path,
          `${what} is listed in ${FLOWS_MANIFEST_PATH} but does not exist; fix the path or remove it`,
        ),
      );
    }
  };

  const flowPaths = new Set<string>();
  for (const [id, flow] of Object.entries(manifest.flows)) {
    if (!/^docs\/.+\.md$/.test(flow.doc)) {
      violations.push(
        violation(flow.doc, `doc of flow ${id} must be a markdown file under docs/ (docs/flows/${id}.md)`),
      );
    }
    requireFile(flow.doc, `doc of flow ${id}`);
    for (const path of flow.entrypoints) requireFile(path, `entrypoint of flow ${id}`);
    for (const path of flow.files) requireFile(path, `file of flow ${id}`);
    for (const path of flow.tests) requireFile(path, `test of flow ${id}`);
    for (const path of [...flow.entrypoints, ...flow.files, ...flow.tests]) flowPaths.add(path);
  }
  for (const [path, ids] of Object.entries(manifest.shared)) {
    requireFile(path, 'shared file');
    for (const id of ids) {
      if (!manifest.flows[id]) {
        violations.push(violation(path, `shared entry names unknown flow ${id}; use an id from flows`));
      }
    }
  }
  for (const entry of manifest.unassigned) {
    requireFile(entry.path, 'unassigned file');
    if (flowPaths.has(entry.path) || manifest.shared[entry.path]) {
      violations.push(violation(entry.path, 'listed as unassigned but also mapped to a flow; keep only one'));
    }
  }
  return violations;
}
