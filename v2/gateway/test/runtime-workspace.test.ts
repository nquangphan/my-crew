import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { atomicWrite, hash, readRecord, writeExclusiveRecord } from '../src/journal/atomic-records.ts';
import { probeContextHash, RuntimeIsolation, requiredRuntimeSurfaces } from '../src/runtime/isolation.ts';
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

test('runtime workspace captured authority deadline survives neither queue wait nor companion fsync', async (t) => {
  const owned = await runtimeRoot(),
    w = await workflowFixture(owned.root);
  await w.install();
  const source = w.sources[1].source,
    audit = w.projections.find((p) => p.sourceTreeSha256 === source.sourceTreeSha256 && p.runtime === 'api');
  assert(audit);
  const fixture = await runtimeWorkspaceFixture(owned.root, w.registry, source, audit.expected);
  const base = runtimePinFixture();
  base.source = source;
  base.projection = audit.expected;
  base.modelChoice.model.runtime = 'api';
  base.isolationPolicyHash = audit.expected.derivation.policySha256;
  base.workspaceCommit = fixture.commit;
  base.modelChoice.probeContextSha256 = probeContextHash(isolationObservation(base).context);
  const prepared = await fixture.prepare(base.attemptId);
  const start = Date.now();
  let now = start;
  const clock = t.mock.method(Date, 'now', () => now);
  try {
    for (const kind of ['test-certification', 'certified'] as const) {
      for (const stage of ['queue', 'fsync'] as const) {
        await t.test(`${kind} expires during ${stage}`, async () => {
          now = start;
          const pin = structuredClone(base),
            deadline = start + 60000;
          if (kind === 'certified') {
            const receiptId = randomUUID();
            pin.admission = { kind, receiptId };
            pin.modelChoice.certificationReceiptId = receiptId;
          }
          let observed: () => void = () => {};
          const observationCaptured = new Promise<void>((resolve) => {
            observed = resolve;
          });
          let observations = 0;
          const isolation = new RuntimeIsolation({
            workspaces: fixture.service,
            observe: async (value) => {
              observations++;
              const result = await fixture.observe(value);
              if (pin.admission.kind === 'certified') {
                // Protocol-only receipt exercises the consumer branch; it is not native certification.
                result.preflight.status = 'PASS';
                result.certificate = {
                  id: pin.admission.receiptId,
                  runtime: pin.projection.runtime,
                  machineId: pin.modelChoice.model.machineId,
                  context: result.context,
                  status: 'PASS',
                  expiresAt: new Date(deadline).toISOString(),
                  surfaces: requiredRuntimeSurfaces.map((surface) => ({
                    surface,
                    selectedWorked: true,
                    unselectedDenied: true,
                    traceSha256: 'a'.repeat(64),
                  })),
                };
              } else {
                assert(result.admission);
                result.admission.expiresAt = new Date(deadline).toISOString();
              }
              observed();
              return result;
            },
          });
          const error = kind === 'certified' ? /CERTIFICATE_EXPIRED/ : /ADMISSION_EXPIRED/;
          let actions = 0;
          if (stage === 'queue') {
            let entered: () => void = () => {},
              release: () => void = () => {};
            const holding = new Promise<void>((resolve) => {
                entered = resolve;
              }),
              held = new Promise<void>((resolve) => {
                release = resolve;
              });
            const barrier = fixture.service.withPrepared(
              prepared.workspace,
              prepared.attemptHome,
              source,
              audit.expected,
              async () => {
                entered();
                await held;
              },
            );
            await holding;
            try {
              const pending = isolation.withVerified(pin, async () => {
                actions++;
              });
              const rejection = assert.rejects(pending, error);
              void rejection.catch(() => {});
              await observationCaptured;
              // Drain observation validation before advancing the clock; only the actual producer queue remains held.
              await nextTurn();
              now = deadline;
              release();
              await barrier;
              await rejection;
              assert.equal(actions, 0);
            } finally {
              release();
              await barrier;
            }
          } else {
            const companion = join(owned.root, `${kind}-expired-companion.json`),
              value = { formatVersion: 1, pin, workspace: prepared.identity };
            const pending = isolation.withVerified(pin, async () => {
              actions++;
              await writeExclusiveRecord(companion, value);
              now = deadline;
            });
            try {
              await assert.rejects(pending, error);
            } finally {
              // Expiry after durable write must leave the exclusive companion intact for recovery.
              assert.deepEqual(await readRecord(companion), value);
              assert.equal(actions, 1);
            }
          }
          assert.equal(observations, 1, 'deadline recheck must not renew authority or re-enter observer');
        });
      }
    }
  } finally {
    clock.mock.restore();
    await fixture.close();
    await w.close();
    await owned.cleanup();
  }
});
