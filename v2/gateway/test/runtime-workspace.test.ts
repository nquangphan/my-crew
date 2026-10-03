import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { atomicWrite, hash } from '../src/journal/atomic-records.ts';
import { probeContextHash, RuntimeIsolation } from '../src/runtime/isolation.ts';
import { workflowFixture } from './support/bridge-fixture.ts';
import { runtimeRoot } from './support/runtime-fixture.ts';
import { isolationObservation, runtimePinFixture } from './support/runtime-pins.ts';
import { runtimeWorkspaceFixture } from './support/runtime-workspace.ts';

test('runtime workspace actual prepared record rejects wrong commit attempt pins state and observed paths', async () => {
  const owned = await runtimeRoot(),
    w = await workflowFixture(owned.root);
  await w.install();
  const source = w.sources[1].source,
    audit = w.projections.find((p) => p.sourceTreeSha256 === source.sourceTreeSha256 && p.runtime === 'api');
  assert(audit);
  const fixture = await runtimeWorkspaceFixture(owned.root, w.registry, source, audit.expected);
  const pin = runtimePinFixture();
  pin.source = source;
  pin.projection = audit.expected;
  pin.modelChoice.model.runtime = 'api';
  pin.isolationPolicyHash = audit.expected.derivation.policySha256;
  pin.workspaceCommit = fixture.commit;
  pin.modelChoice.probeContextSha256 = probeContextHash(isolationObservation(pin).context);
  const prepared = await fixture.prepare(pin.attemptId);
  let wrongPath = false,
    wrongHome = false;
  const isolation = new RuntimeIsolation({
    workspaces: fixture.service,
    observe: async (value) => {
      const observation = await fixture.observe(value);
      if (wrongPath) observation.preflight.evidence.workspace = join(owned.root, 'unprepared');
      if (wrongHome) observation.preflight.evidence.attemptHome = join(owned.root, 'wrong-home');
      return observation;
    },
  });
  try {
    await isolation.assert(pin);
    await assert.rejects(
      isolation.assert({ ...pin, workspaceCommit: '0'.repeat(40) }),
      /RUNTIME_WORKSPACE_MISMATCH/,
    );
    await assert.rejects(isolation.assert({ ...pin, attemptId: randomUUID() }), /RUNTIME_WORKSPACE_MISMATCH/);
    await assert.rejects(
      isolation.assert({ ...pin, source: { ...pin.source, version: 'different' } }),
      /RUNTIME_WORKSPACE_MISMATCH/,
    );
    const wrongProjection = structuredClone(pin);
    wrongProjection.projection.derivation.version = 'different';
    wrongProjection.modelChoice.probeContextSha256 = probeContextHash(
      isolationObservation(wrongProjection).context,
    );
    await assert.rejects(isolation.assert(wrongProjection), /RUNTIME_WORKSPACE_MISMATCH/);
    wrongPath = true;
    await assert.rejects(isolation.assert(pin), /RUNTIME_WORKSPACE_MISMATCH/);
    wrongPath = false;
    wrongHome = true;
    await assert.rejects(isolation.assert(pin), /RUNTIME_WORKSPACE_MISMATCH/);
    wrongHome = false;
    // Corrupt only the owned fixture's durable state, then restore bytes before cleanup. The real producer reads it.
    const recordPath = join(
      fixture.service.root,
      'journal',
      `${hash(`isolation-workspace-${hash(pin.attemptId)}`)}.json`,
    );
    try {
      for (const state of ['preparing', 'retained', 'deleted'] as const) {
        await atomicWrite(recordPath, { ...prepared, state });
        await assert.rejects(isolation.assert(pin), /RUNTIME_WORKSPACE_MISMATCH/);
      }
    } finally {
      await atomicWrite(recordPath, prepared);
    }
    await isolation.assert(pin);
    let enter: () => void = () => {},
      release: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const continueWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = isolation.withVerified(pin, async (actual) => {
      assert.equal(actual.ownerCommit, fixture.commit);
      assert.deepEqual(actual.identity, prepared.identity);
      enter();
      await continueWrite;
    });
    await entered;
    let cleanupFinished = false;
    const cleanup = fixture.service.cleanup(pin.attemptId).then((result) => {
      cleanupFinished = true;
      return result;
    });
    await nextTurn();
    assert.equal(cleanupFinished, false);
    release();
    await write;
    assert.equal(await cleanup, 'deleted');
    await assert.rejects(isolation.assert(pin), /RUNTIME_WORKSPACE_MISMATCH/);
  } finally {
    await fixture.close();
    await w.close();
    await owned.cleanup();
  }
});
