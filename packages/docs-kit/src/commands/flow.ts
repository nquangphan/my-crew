import { EXIT, type Io } from './io.js';
import { lookupManifest } from './lookup.js';

/** `crew-docs flow <id>`: the exact doc, entrypoints, files, tests and shared files of one flow. */
export function flowCommand(root: string, id: string, io: Io): number {
  const manifest = lookupManifest(root, io);
  if (typeof manifest === 'number') return manifest;
  const flow = manifest.flows[id];
  if (!flow) {
    const known = Object.keys(manifest.flows).sort();
    io.out(`R1 docs/flows.yaml: unknown flow ${id}; known flows: ${known.join(', ') || '(none)'}`);
    return EXIT.violations;
  }
  const shared = Object.entries(manifest.shared)
    .filter(([, ids]) => ids.includes(id))
    .map(([path]) => path)
    .sort();
  io.out(`flow: ${id}`);
  io.out(`title: ${flow.title}`);
  io.out(`doc: ${flow.doc}`);
  for (const [label, paths] of [
    ['entrypoints', flow.entrypoints],
    ['files', flow.files],
    ['tests', flow.tests],
    ['shared', shared],
  ] as const) {
    io.out(`${label}:${paths.length === 0 ? ' []' : ''}`);
    for (const path of paths) io.out(`  - ${path}`);
  }
  return EXIT.ok;
}
