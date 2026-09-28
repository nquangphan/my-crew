import { flowsForPath } from '@crew/shared';
import { FLOWS_MANIFEST_PATH, sourceMatcher } from '../manifest.js';
import { EXIT, type Io } from './io.js';
import { lookupManifest, repoRelative } from './lookup.js';

/**
 * `crew-docs where <file>`: the flows that own a file, one per line as `<flow-id>\t<role>\t<doc>\t<title>`,
 * or `unassigned\t<reason>`. Exit 1 when a source file belongs to no flow.
 */
export function whereCommand(root: string, cwd: string, file: string, io: Io): number {
  const manifest = lookupManifest(root, io);
  if (typeof manifest === 'number') return manifest;
  const path = repoRelative(root, cwd, file);
  const owners = flowsForPath(manifest, path);
  for (const owner of owners.flows) io.out(`${owner.flowId}\t${owner.role}\t${owner.doc}\t${owner.title}`);
  if (owners.unassignedReason !== null) io.out(`unassigned\t${owners.unassignedReason}`);
  if (owners.flows.length > 0 || owners.unassignedReason !== null) return EXIT.ok;
  if (sourceMatcher(manifest)(path)) {
    io.out(`R2 ${path}: source file is in no flow; add it to a flow's files in ${FLOWS_MANIFEST_PATH}`);
    return EXIT.violations;
  }
  io.err(`${path} is not a source file (outside source.include/exclude) and no flow lists it`);
  return EXIT.ok;
}
