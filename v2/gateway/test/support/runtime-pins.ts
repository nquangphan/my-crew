import { randomUUID } from 'node:crypto';
import { canonicalJson, hash } from '../../src/journal/atomic-records.ts';
import type { RuntimePin } from '../../src/runtime/contracts.ts';
import { type IsolationObservation, probeContextHash } from '../../src/runtime/isolation.ts';

const h = 'a'.repeat(64);
export function runtimePinFixture(): RuntimePin {
  const source = {
    name: 'superpowers' as const,
    version: 'fixture',
    sourceRevision: 'a'.repeat(40),
    sourceUrl: 'https://example.test/source',
    payloadSha256: h,
    packageIntegrity: 'sha512-fixture',
    sourceManifestSha256: h,
    sourceTreeSha256: h,
  };
  const projection = {
    runtime: 'codex' as const,
    sourceTreeSha256: h,
    manifestSha256: h,
    treeSha256: h,
    derivation: { kind: 'fixture', policySha256: h },
  } as unknown as RuntimePin['projection'];
  const context = {
    sourceTreeSha256: h,
    projectionManifestSha256: h,
    projectionTreeSha256: h,
    derivationSha256: hash(canonicalJson(projection.derivation)),
    binarySha256: h,
    policySha256: h,
    osVersion: 'fixture-os',
  };
  const attemptId = randomUUID(),
    processInstanceId = randomUUID(),
    installReportId = randomUUID();
  return {
    runId: randomUUID(),
    attemptId,
    commandId: randomUUID(),
    processInstanceId,
    fence: '1',
    source,
    projection,
    attemptProjection: {
      attemptId,
      processInstanceId,
      fence: '1',
      sourceTreeSha256: h,
      runtime: 'codex',
      projectionManifestSha256: h,
      projectionTreeSha256: h,
      installReportId,
    },
    selection: {
      runtime: 'codex',
      sourceTreeSha256: h,
      projectionManifestSha256: h,
      projectionTreeSha256: h,
      installReportId,
      configRevision: 1,
      decisionId: randomUUID(),
    },
    modelChoice: {
      model: { machineId: randomUUID(), runtime: 'codex', providerId: 'fixture', modelId: 'no-model' },
      modelConfigRevision: 1,
      probeReceiptId: randomUUID(),
      probeContextSha256: probeContextHash(context),
      certificationReceiptId: null,
      required: [],
    },
    admission: { kind: 'test-certification', challengeId: randomUUID(), nonce: randomUUID() },
    isolationPolicyHash: h,
    workspaceCommit: 'a'.repeat(40),
    credentialRef: null,
  };
}
/** Protocol observation ONLY; never passed to production composition or reported as native PASS. */
export function isolationObservation(pin: RuntimePin): IsolationObservation {
  const context = {
    sourceTreeSha256: pin.source.sourceTreeSha256,
    projectionManifestSha256: pin.projection.manifestSha256,
    projectionTreeSha256: pin.projection.treeSha256,
    derivationSha256: hash(canonicalJson(pin.projection.derivation)),
    binarySha256: h,
    policySha256: pin.isolationPolicyHash,
    osVersion: 'fixture-os',
  };
  return {
    context,
    preflight: {
      status: 'UNVERIFIED',
      blockers: ['native-unmeasured'],
      evidence: {
        surfaces: [],
        source: pin.source,
        projection: pin.projection,
        runtime: pin.projection.runtime,
      } as unknown as IsolationObservation['preflight']['evidence'],
    },
    confinement: {
      processInstanceId: pin.processInstanceId,
      policyHash: pin.isolationPolicyHash,
      evidenceDigest: h,
    },
    admission: {
      kind: 'test-certification',
      state: 'admitted',
      id: pin.admission.kind === 'test-certification' ? pin.admission.challengeId : '',
      nonceSha256: pin.admission.kind === 'test-certification' ? hash(pin.admission.nonce) : '',
      attemptId: pin.attemptId,
      commandId: pin.commandId,
      processInstanceId: pin.processInstanceId,
      fence: pin.fence,
      machineId: pin.modelChoice.model.machineId,
      context,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      maxTurns: 1,
      maxTools: 1,
      maxCostUsd: 0,
    },
    certificate: null,
  };
}
