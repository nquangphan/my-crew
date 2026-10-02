import { Launcher, type LaunchInput, ProcessJournal } from '../../src/journal/process-journal.ts';
import { ResourceRegistry } from '../../src/resources/registry.ts';

const source = {
  name: 'bmad' as const,
  version: 'fixture',
  sourceRevision: 'fixture',
  sourceUrl: 'https://example.invalid',
  payloadSha256: 'a'.repeat(64),
  packageIntegrity: null,
  sourceManifestSha256: 'b'.repeat(64),
  sourceTreeSha256: 'c'.repeat(64),
};
const input: LaunchInput = {
  commandId: 'command',
  ticketId: 'ticket',
  processInstanceId: 'instance',
  source,
  projection: {
    runtime: 'api',
    sourceTreeSha256: source.sourceTreeSha256,
    manifestSha256: 'd'.repeat(64),
    treeSha256: 'e'.repeat(64),
    derivation: {
      tool: 'fixture',
      version: '1',
      options: [],
      layoutSchema: '1',
      policySha256: 'f'.repeat(64),
    },
  },
};
export async function ownedRun(root: string, signal?: AbortSignal) {
  const journal = await ProcessJournal.open(root);
  const launcher = new Launcher(journal, {
    command: [process.execPath, '-e', 'process.exit(0)'],
    recheckCapacity: async () => true,
    verifyProjection: async (record, fence, attemptId) => ({
      attemptId,
      fence,
      processInstanceId: record.processInstanceId,
      sourceTreeSha256: record.source.sourceTreeSha256,
      runtime: record.projection.runtime,
      projectionManifestSha256: record.projection.manifestSha256,
      projectionTreeSha256: record.projection.treeSha256,
      installReportId: 'report',
    }),
  });
  const record = await journal.reserve(input);
  const ready = await launcher.spawnGated(record);
  const registry = await ResourceRegistry.open(root, { processJournal: journal, signal });
  await registry.registerProcess('run', record.processInstanceId, ready.startIdentity);
  await launcher.release(record, '1', 'attempt');
  await launcher.wait(record);
  return {
    journal,
    launcher,
    registry,
    close: async () => {
      await registry.close();
      await launcher.close();
      await journal.close();
    },
  };
}
