import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicWrite } from '../../src/journal/atomic-records.ts';
import { Launcher } from '../../src/journal/process-journal.ts';
import { workflowFixture } from './bridge-fixture.ts';

const [root, target] = process.argv.slice(2);
const w = await workflowFixture(root);
await w.install();
const source = w.sources[1].source,
  projection = w.projections[3].expected;
const record = await w.journal.reserve({
  commandId: randomUUID(),
  ticketId: randomUUID(),
  processInstanceId: randomUUID(),
  source,
  projection,
});
const pin = {
  attemptId: randomUUID(),
  fence: '1',
  processInstanceId: record.processInstanceId,
  sourceTreeSha256: source.sourceTreeSha256,
  runtime: projection.runtime,
  projectionManifestSha256: projection.manifestSha256,
  projectionTreeSha256: projection.treeSha256,
  installReportId: randomUUID(),
};
const launcher = new Launcher(w.journal, {
  command: ['/usr/bin/true'],
  verifyProjection: async () => pin,
  recheckCapacity: async () => true,
});
await launcher.spawnGated(record);
await launcher.release(record, pin.fence, pin.attemptId);
await launcher.wait(record);
const authority = {
  attemptId: pin.attemptId,
  commandId: record.commandId,
  ticketId: record.ticketId,
  fence: pin.fence,
  processInstanceId: record.processInstanceId,
  workflowPin: {
    workflow: source.name,
    version: source.version,
    revision: source.sourceRevision,
    checksum: source.sourceTreeSha256,
  },
  state: 'stopped' as const,
  finalizedAt: new Date().toISOString(),
  projection: pin,
};
await atomicWrite(join(root, 'fixture-authority.json'), { formatVersion: 1, authority });
const pause = async (stage: string) => {
  if (stage !== target) return;
  process.send?.({ stage });
  await new Promise(() => {});
};
await w.journal.bindPinRetirementAuthority(async () => {
  await pause('before-write');
  return authority;
});
await w.journal.retirePinReference(record);
await pause('after-write');
await w.journal.activePinReferences();
await pause('after-filter');
throw new Error('RETIREMENT_STAGE_NOT_REACHED');
