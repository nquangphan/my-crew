import { join } from 'node:path';
import { Launcher, type LaunchInput, ProcessJournal } from '../../src/journal/process-journal.ts';

const root = process.argv[2];
const target = process.argv[3];
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
const projection = {
  runtime: 'api' as const,
  sourceTreeSha256: source.sourceTreeSha256,
  manifestSha256: 'd'.repeat(64),
  treeSha256: 'e'.repeat(64),
  derivation: { tool: 'fixture', version: '1', options: [], layoutSchema: '1', policySha256: 'f'.repeat(64) },
};
const input: LaunchInput = {
  commandId: 'command',
  ticketId: 'ticket',
  processInstanceId: 'instance',
  source,
  projection,
};
const journal = await ProcessJournal.open(root);
const record = await journal.reserve(input);
const pause = async (stage: string) => {
  if (stage !== target) return;
  process.send?.({ stage, record });
  await new Promise(() => {});
};
await pause('reserved');
const launcher = new Launcher(journal, {
  command: [
    process.execPath,
    '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'side-effect'))},'authorized');setTimeout(()=>{},30000)`,
  ],
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
  onDurableStage: async (stage) => pause(stage),
});
await launcher.spawnGated(record);
await pause('claim_request');
await pause('claim_reply');
await launcher.release(record, '1', 'attempt');
await launcher.wait(record);
await journal.close();
