import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { probeContextHash, RuntimeIsolation } from '../src/runtime/isolation.ts';
import { ToolPolicy } from '../src/runtime/tool-policy.ts';
import { isolationObservation, runtimePinFixture } from './support/runtime-pins.ts';

test('isolation runtime missing authority and incomplete full-tree evidence deny', async () => {
  const pin = runtimePinFixture();
  await assert.rejects(new RuntimeIsolation().assert(pin), /ISOLATION_NOT_BOUND/);
  const observation = isolationObservation(pin);
  observation.confinement = null;
  await assert.rejects(
    new RuntimeIsolation({ observe: async () => observation }).assert(pin),
    /FULL_TREE_UNVERIFIED/,
  );
});
test('isolation runtime test admission is exact admitted claim and never synthetic PASS', async () => {
  const pin = runtimePinFixture();
  const observation = isolationObservation(pin);
  const isolation = new RuntimeIsolation({ observe: async () => structuredClone(observation) });
  assert(observation.admission);
  await assert.rejects(isolation.assert(pin), /WORKSPACE_NOT_BOUND/);
  observation.admission.attemptId = 'foreign';
  await assert.rejects(isolation.assert(pin), /ADMISSION_MISMATCH/);
  observation.admission.attemptId = pin.attemptId;
  observation.preflight.status = 'PASS';
  await assert.rejects(isolation.assert(pin), /PREFLIGHT_UNVERIFIED_REQUIRED/);
});
test('isolation runtime context, expiry, measured failures and missing surfaces deny certified', async () => {
  const pin = runtimePinFixture();
  const observation = isolationObservation(pin);
  const isolation = new RuntimeIsolation({ observe: async () => structuredClone(observation) });
  assert(observation.admission);
  observation.context.binarySha256 = 'b'.repeat(64);
  await assert.rejects(isolation.assert(pin), /CONTEXT_MISMATCH/);
  observation.context.binarySha256 = 'a'.repeat(64);
  observation.preflight.evidence.surfaces.push({
    surface: 'cross-source',
    status: 'FAIL',
    measured: true,
    reason: 'escape',
  });
  await assert.rejects(isolation.assert(pin), /ISOLATION_FAILED/);
  observation.preflight.evidence.surfaces = [];
  observation.admission.expiresAt = new Date(0).toISOString();
  await assert.rejects(isolation.assert(pin), /ADMISSION_EXPIRED/);
  observation.admission.expiresAt = new Date(Date.now() + 60000).toISOString();
  pin.admission = { kind: 'certified', receiptId: pin.modelChoice.probeReceiptId };
  await assert.rejects(isolation.assert(pin), /CERTIFICATE_UNVERIFIED/);
});
test('runtime boundary tool policy denies before effects and waits without logical authority', async () => {
  const policy = new ToolPolicy();
  assert.deepEqual(await policy.authorize({ name: 'write', effectful: true }), {
    kind: 'deny',
    reason: 'TOOL_NOT_ALLOWED',
  });
  const allowed = new ToolPolicy({ allowedTools: ['write', 'read'], readOnlyTools: ['read'] });
  assert.deepEqual(await allowed.authorize({ name: 'read', effectful: false }), { kind: 'allow' });
  assert.deepEqual(await allowed.authorize({ name: 'write', effectful: true }), {
    kind: 'wait',
    reason: 'LOGICAL_OPERATION_REQUIRED',
  });
});
test('isolation runtime context hash uses accepted server fixed field order', () => {
  const pin = runtimePinFixture();
  const observation = isolationObservation(pin);
  const c = observation.context;
  const expected = createHash('sha256')
    .update(
      JSON.stringify({
        sourceTreeSha256: c.sourceTreeSha256,
        projectionManifestSha256: c.projectionManifestSha256,
        projectionTreeSha256: c.projectionTreeSha256,
        derivationSha256: c.derivationSha256,
        binarySha256: c.binarySha256,
        policySha256: c.policySha256,
        osVersion: c.osVersion,
      }),
    )
    .digest('hex');
  assert.equal(probeContextHash(c), expected);
});
test('runtime boundary tool cannot relabel allowed write as readonly', async () => {
  const policy = new ToolPolicy({ allowedTools: ['write'] });
  assert.deepEqual(await policy.authorize({ name: 'write', effectful: false }), {
    kind: 'deny',
    reason: 'TOOL_EFFECT_MISMATCH',
  });
});
