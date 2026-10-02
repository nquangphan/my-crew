import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Launcher } from '../src/journal/process-journal.ts';
import { bridgeRoot, workflowFixture } from './support/bridge-fixture.ts';

test('terminal pin retirement defaults deny and keeps historical references without actual STOP', async () => {
  const owned = await bridgeRoot(),
    f = await workflowFixture(owned.root);
  await f.install();
  const source = f.sources[1].source,
    projection = f.projections[3].expected;
  const record = await f.journal.reserve({
    commandId: randomUUID(),
    ticketId: randomUUID(),
    processInstanceId: randomUUID(),
    source,
    projection,
  });
  try {
    assert.equal(typeof f.journal.retirePinReference, 'function');
    await assert.rejects(f.journal.retirePinReference(record), /PIN_RETIREMENT_NOT_CONFIGURED/);
    await f.journal.bindPinRetirementAuthority(async () => ({ attemptId: randomUUID() }) as any);
    await assert.rejects(f.journal.retirePinReference(record), /EXACT_EXIT_PROOF_REQUIRED/);
    assert.equal((await f.registry.retained()).filter((r) => r.authority === 'process-journal').length, 1);
  } finally {
    await f.close();
    await owned.cleanup();
  }
});

test('terminal pin retirement fsyncs exact receipt, filters refs and denies resurrection', async () => {
  const owned = await bridgeRoot(),
    f = await workflowFixture(owned.root);
  await f.install();
  const source = f.sources[1].source,
    projection = f.projections[3].expected;
  const record = await f.journal.reserve({
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
  const launcher = new Launcher(f.journal, {
    command: ['/usr/bin/true'],
    recheckCapacity: async () => true,
    verifyProjection: async () => pin,
  });
  try {
    await launcher.spawnGated(record);
    await launcher.release(record, pin.fence, pin.attemptId);
    await launcher.wait(record);
    assert.equal(await f.journal.observe(record), 'stopped');
    assert.equal(typeof f.journal.bindPinRetirementAuthority, 'function');
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
    await f.journal.bindPinRetirementAuthority(async () => authority);
    const receipt = await f.journal.retirePinReference(record);
    assert.deepEqual(await f.journal.retirePinReference(record), receipt);
    assert.equal((await f.journal.processes()).length, 1);
    assert.equal((await f.registry.retained()).filter((r) => r.authority === 'process-journal').length, 0);
    assert.equal((await f.journal.pendingPinAdmissions()).length, 0);
    await assert.rejects(
      f.journal.reserve({
        commandId: record.commandId,
        ticketId: record.ticketId,
        processInstanceId: record.processInstanceId,
        source,
        projection,
      }),
      /PIN_REFERENCE_RETIRED/,
    );
    await assert.rejects(launcher.spawnGated(record), /PIN_REFERENCE_RETIRED/);
    await f.journal.bindPinRetirementAuthority(async () => ({ ...authority, fence: '2' }));
    await assert.rejects(f.journal.retirePinReference(record), /FINALIZATION_MISMATCH/);
    await f.registry.retain('independent-ref', source, projection);
    assert.equal((await f.registry.collectPublished()).failed.length, 0);
    await f.registry.resolve(source, projection);
    await f.registry.release('independent-ref', source, projection);
    assert.equal((await f.registry.collectPublished()).failed.length, 0);
    await assert.rejects(f.registry.resolve(source, projection), /CHECKSUM_MISMATCH/);
    assert.deepEqual(await f.journal.pinRetirement(record), receipt);
  } finally {
    await launcher.close();
    await f.close();
    await owned.cleanup();
  }
});
