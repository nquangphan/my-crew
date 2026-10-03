import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DurableEffectLedger, deriveEffectId } from '../src/runtime/effect-ledger.ts';
import { runtimeRoot } from './support/runtime-fixture.ts';

const digest = 'a'.repeat(64);
function effect() {
  const value = {
    runId: randomUUID(),
    stepId: randomUUID(),
    stepOperationId: randomUUID(),
    actionKind: 'write',
    targetIdentity: 'scratch:file',
    preconditionSha256: digest,
  };
  return {
    ...value,
    effectId: deriveEffectId(value),
    state: 'pending' as const,
    receiptSha256: null,
    artifactIds: [],
  };
}
const call = (e: ReturnType<typeof effect>) => ({
  attemptId: randomUUID(),
  fence: '1',
  toolCallId: 'call-a',
  argsSha256: digest,
  effectId: e.effectId,
  stepOperationId: e.stepOperationId,
});
const ports = { authorizeOperation: async () => true, verifyReceipt: async () => true };
test('effect ledger default missing phase06 authority waits without durable intent', async () => {
  const owned = await runtimeRoot();
  const ledger = await DurableEffectLedger.open(owned.root);
  try {
    const e = effect();
    assert.equal(await ledger.reserve(e, call(e)), 'wait');
    assert.equal(await ledger.receipt(e.effectId), null);
  } finally {
    await ledger.close();
    await owned.cleanup();
  }
});
test('effect ledger durable receipt survives fallback with different transport identity', async () => {
  const owned = await runtimeRoot();
  let ledger = await DurableEffectLedger.open(owned.root, ports);
  const e = effect(),
    a = call(e),
    receipt = { sha256: digest, artifactIds: [randomUUID()] };
  try {
    assert.match(e.effectId, /^[0-9a-f]{64}$/);
    assert.equal(await ledger.reserve(e, a), 'execute');
    await ledger.complete(e.effectId, a, receipt);
    await ledger.close();
    ledger = await DurableEffectLedger.open(owned.root, ports);
    assert.equal(
      await ledger.reserve(e, { ...call(e), toolCallId: 'fallback-provider-id' }),
      'return-receipt',
    );
    assert.deepEqual(await ledger.receipt(e.effectId), receipt);
    const other = { ...e, stepOperationId: randomUUID() };
    other.effectId = deriveEffectId(other);
    assert.equal(await ledger.reserve(other, call(other)), 'execute');
  } finally {
    await ledger.close();
    await owned.cleanup();
  }
});
test('effect ledger rejects transport or logical metadata conflict and unverified receipt', async () => {
  const owned = await runtimeRoot();
  let valid = false;
  const ledger = await DurableEffectLedger.open(owned.root, { ...ports, verifyReceipt: async () => valid });
  try {
    const e = effect(),
      a = call(e);
    assert.equal(await ledger.reserve(e, a), 'execute');
    await assert.rejects(ledger.reserve(e, { ...a, argsSha256: 'b'.repeat(64) }), {
      code: 'EFFECT_CONFLICT',
      statusCode: 409,
    });
    await assert.rejects(
      ledger.reserve({ ...e, stepId: randomUUID() }, { ...a, toolCallId: 'new' }),
      /EFFECT_CONFLICT/,
    );
    await assert.rejects(
      ledger.complete(e.effectId, a, { sha256: digest, artifactIds: [] }),
      /RECEIPT_UNVERIFIED/,
    );
    valid = true;
    await ledger.complete(e.effectId, a, { sha256: digest, artifactIds: [] });
    valid = false;
    assert.equal(await ledger.reserve(e, { ...call(e), toolCallId: 'new' }), 'wait');
  } finally {
    await ledger.close();
    await owned.cleanup();
  }
});
test('effect ledger crash window pending never executes again without target proof', async () => {
  const owned = await runtimeRoot();
  let ledger = await DurableEffectLedger.open(owned.root, ports);
  const e = effect(),
    a = call(e);
  try {
    assert.equal(await ledger.reserve(e, a), 'execute');
    await ledger.close();
    ledger = await DurableEffectLedger.open(owned.root, ports);
    assert.equal(await ledger.reserve(e, call(e)), 'reconcile');
    assert.equal(await ledger.reconcile(e.effectId), 'uncertain');
    assert.equal(await ledger.reserve(e, call(e)), 'wait');
  } finally {
    await ledger.close();
    await owned.cleanup();
  }
});
test('effect ledger canonical encoding separates fields and invalid inputs never reserve', () => {
  const e = effect();
  assert.notEqual(
    deriveEffectId({ ...e, actionKind: 'ab', targetIdentity: 'c' }),
    deriveEffectId({ ...e, actionKind: 'a', targetIdentity: 'bc' }),
  );
  assert.throws(() => deriveEffectId({ ...e, preconditionSha256: 'A'.repeat(64) }), /INVALID_EFFECT/);
});

test('effect ledger serializes concurrent reservation and target reconciliation verifies artifact bytes', async () => {
  const { readFile, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { hash } = await import('../src/journal/atomic-records.ts');
  const owned = await runtimeRoot(),
    artifact = join(owned.root, 'artifact');
  const bytes = 'actual owned effect result',
    receipt = { sha256: hash(bytes), artifactIds: [randomUUID()] };
  const ledger = await DurableEffectLedger.open(owned.root, {
    authorizeOperation: async () => true,
    verifyReceipt: async (_effect, value) =>
      value.sha256 === hash(await readFile(artifact)) && value.artifactIds[0] === receipt.artifactIds[0],
    reconcileTarget: async () => receipt,
  });
  try {
    const e = effect(),
      a = call(e);
    const result = await Promise.all([ledger.reserve(e, a), ledger.reserve(e, a)]);
    assert.deepEqual(result, ['execute', 'reconcile']);
    await writeFile(artifact, bytes, { flag: 'wx', mode: 0o600 });
    assert.equal(await ledger.reconcile(e.effectId), 'done');
    assert.deepEqual(await ledger.receipt(e.effectId), receipt);
    await writeFile(artifact, 'tampered');
    assert.equal(await ledger.receipt(e.effectId), null);
    assert.equal(await ledger.reserve(e, call(e)), 'wait');
  } finally {
    await ledger.close();
    await owned.cleanup();
  }
});
