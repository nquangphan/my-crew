import type { PreflightResult } from '../isolation/preflight.ts';
import { type IsolatedWorkspace, IsolationWorkspace } from '../isolation/workspace.ts';
import { canonicalJson, hash } from '../journal/atomic-records.ts';
import type { ProbeContext } from '../models/contracts.ts';
import type { RuntimePin } from './contracts.ts';
export const requiredRuntimeSurfaces = [
  'init',
  'invocation',
  'native-read',
  'bash-script',
  'mcp',
  'child',
  'absolute',
  'dotdot',
  'symlink',
  'hardlink',
  'common-dir',
  'network',
  'whole-process-tree',
] as const;
type AdmissionObservation = {
  kind: 'test-certification';
  state: 'issued' | 'admitted';
  id: string;
  nonceSha256: string;
  attemptId: string;
  commandId: string;
  processInstanceId: string;
  fence: string;
  machineId: string;
  context: ProbeContext;
  expiresAt: string;
  maxTurns: number;
  maxTools: number;
  maxCostUsd: number;
};
type CertificateObservation = {
  id: string;
  runtime: RuntimePin['projection']['runtime'];
  machineId: string;
  context: ProbeContext;
  status: 'PASS' | 'FAIL' | 'UNVERIFIED';
  expiresAt: string;
  surfaces: { surface: string; selectedWorked: boolean; unselectedDenied: boolean; traceSha256: string }[];
};
export type IsolationObservation = {
  context: ProbeContext;
  preflight: PreflightResult;
  confinement: { processInstanceId: string; policyHash: string; evidenceDigest: string } | null;
  admission: AdmissionObservation | null;
  certificate: CertificateObservation | null;
};
export type IsolationCertificate = {
  runtime: RuntimePin['projection']['runtime'];
  binaryHash: string;
  sourceTreeSha256: string;
  projectionManifestSha256: string;
  projectionTreeSha256: string;
  derivationHash: string;
  policyHash: string;
  osVersion: string;
  surfaces: CertificateObservation['surfaces'];
  observedAt: string;
  status: 'PASS' | 'FAIL' | 'UNVERIFIED';
};
export function probeContextHash(c: ProbeContext): string {
  return hash(
    JSON.stringify({
      sourceTreeSha256: c.sourceTreeSha256,
      projectionManifestSha256: c.projectionManifestSha256,
      projectionTreeSha256: c.projectionTreeSha256,
      derivationSha256: c.derivationSha256,
      binarySha256: c.binarySha256,
      policySha256: c.policySha256,
      osVersion: c.osVersion,
    }),
  );
}
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const digest = /^[0-9a-f]{64}$/;
function fresh(expiresAt: string) {
  return Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > Date.now();
}
/** This trusted local observer must verify actual server admission and constrained descendants.
 * No production observer exists yet. Raw model/client assertions are never an implementation. */
export class RuntimeIsolation {
  private readonly observe?: (pin: RuntimePin) => Promise<IsolationObservation>;
  private readonly getWorkspace?: IsolationWorkspace['get'];
  private readonly withPrepared?: IsolationWorkspace['withPrepared'];
  constructor(
    options: {
      observe?: (pin: RuntimePin) => Promise<IsolationObservation>;
      workspaces?: IsolationWorkspace;
    } = {},
  ) {
    this.observe = options.observe;
    if (options.workspaces) {
      if (!(options.workspaces instanceof IsolationWorkspace)) throw new Error('TRUSTED_WORKSPACE_REQUIRED');
      this.getWorkspace = options.workspaces.get.bind(options.workspaces);
      this.withPrepared = options.workspaces.withPrepared.bind(options.workspaces);
    }
  }
  async assert(pin: RuntimePin): Promise<void> {
    await this.withVerified(pin, async () => {});
  }
  /** Observer runs before the producer queue; action only persists the runtime companion.
   * Fixed order runtime queue -> isolation queue -> registry read. Never re-enter isolation here. */
  async withVerified<T>(pin: RuntimePin, action: (record: IsolatedWorkspace) => Promise<T>): Promise<T> {
    pin = structuredClone(pin);
    const observed = await this.observation(pin);
    if (!this.getWorkspace || !this.withPrepared) throw new Error('WORKSPACE_NOT_BOUND');
    const expected = await this.getWorkspace(pin.attemptId);
    this.matchWorkspace(expected, pin, observed);
    return this.withPrepared(
      expected.workspace,
      expected.attemptHome,
      pin.source,
      pin.projection,
      async ({ record }) => {
        this.matchWorkspace(record, pin, observed);
        if (record.operationId !== expected.operationId || !same(record.identity, expected.identity))
          throw new Error('WORKSPACE_IDENTITY_MISMATCH');
        this.assertFresh(pin, observed);
        const result = await action(structuredClone(record));
        // A durable companion may now exist. Expiry denies release without deleting or renewing it.
        this.assertFresh(pin, observed);
        return result;
      },
    );
  }
  private assertFresh(pin: RuntimePin, observed: IsolationObservation): void {
    const certified = pin.admission.kind === 'certified',
      expiresAt = certified ? observed.certificate?.expiresAt : observed.admission?.expiresAt;
    if (!expiresAt || !fresh(expiresAt))
      throw new Error(certified ? 'CERTIFICATE_EXPIRED' : 'ADMISSION_EXPIRED');
  }
  private matchWorkspace(
    record: IsolatedWorkspace | null,
    pin: RuntimePin,
    observed: IsolationObservation,
  ): asserts record is IsolatedWorkspace {
    if (
      record?.state !== 'prepared' ||
      record.attemptId !== pin.attemptId ||
      record.ownerCommit !== pin.workspaceCommit ||
      !same(record.source, pin.source) ||
      !same(record.projection, pin.projection) ||
      record.workspace !== observed.preflight.evidence.workspace ||
      record.attemptHome !== observed.preflight.evidence.attemptHome
    )
      throw new Error('RUNTIME_WORKSPACE_MISMATCH');
  }
  private async observation(pin: RuntimePin): Promise<IsolationObservation> {
    pin = structuredClone(pin);
    if (!this.observe) throw new Error('ISOLATION_NOT_BOUND');
    const observed = structuredClone(await this.observe(structuredClone(pin))),
      c = observed.context;
    if (
      c.sourceTreeSha256 !== pin.source.sourceTreeSha256 ||
      c.projectionManifestSha256 !== pin.projection.manifestSha256 ||
      c.projectionTreeSha256 !== pin.projection.treeSha256 ||
      c.derivationSha256 !== hash(canonicalJson(pin.projection.derivation)) ||
      c.policySha256 !== pin.isolationPolicyHash ||
      !digest.test(c.binarySha256) ||
      c.binarySha256 === '0'.repeat(64) ||
      !c.osVersion ||
      probeContextHash(c) !== pin.modelChoice.probeContextSha256 ||
      !same(observed.preflight.evidence.source, pin.source) ||
      !same(observed.preflight.evidence.projection, pin.projection) ||
      observed.preflight.evidence.runtime !== pin.projection.runtime
    )
      throw new Error('CONTEXT_MISMATCH');
    if (
      observed.preflight.status === 'FAIL' ||
      observed.preflight.evidence.surfaces.some((s) => s.status === 'FAIL')
    )
      throw new Error('ISOLATION_FAILED');
    const confinement = observed.confinement;
    if (
      !confinement ||
      confinement.processInstanceId !== pin.processInstanceId ||
      confinement.policyHash !== pin.isolationPolicyHash ||
      !digest.test(confinement.evidenceDigest)
    )
      throw new Error('FULL_TREE_UNVERIFIED');
    if (pin.admission.kind === 'certified') {
      const cert = observed.certificate;
      if (
        !cert ||
        cert.id !== pin.admission.receiptId ||
        cert.id !== pin.modelChoice.certificationReceiptId ||
        cert.status !== 'PASS' ||
        cert.runtime !== pin.projection.runtime ||
        cert.machineId !== pin.modelChoice.model.machineId ||
        !same(cert.context, c) ||
        !fresh(cert.expiresAt) ||
        observed.preflight.status !== 'PASS' ||
        new Set(cert.surfaces.map((s) => s.surface)).size !== cert.surfaces.length ||
        !requiredRuntimeSurfaces.every((surface) =>
          cert.surfaces.some(
            (s) =>
              s.surface === surface && s.selectedWorked && s.unselectedDenied && digest.test(s.traceSha256),
          ),
        )
      )
        throw new Error('CERTIFICATE_UNVERIFIED');
      return observed;
    }
    if (pin.admission.kind !== 'test-certification') throw new Error('ADMISSION_MISMATCH');
    const a = observed.admission;
    if (
      a?.state !== 'admitted' ||
      a.id !== pin.admission.challengeId ||
      a.nonceSha256 !== hash(pin.admission.nonce) ||
      a.attemptId !== pin.attemptId ||
      a.commandId !== pin.commandId ||
      a.processInstanceId !== pin.processInstanceId ||
      a.fence !== pin.fence ||
      a.machineId !== pin.modelChoice.model.machineId ||
      !same(a.context, c) ||
      !Number.isInteger(a.maxTurns) ||
      a.maxTurns < 1 ||
      !Number.isInteger(a.maxTools) ||
      a.maxTools < 1 ||
      !Number.isFinite(a.maxCostUsd) ||
      a.maxCostUsd < 0
    )
      throw new Error('ADMISSION_MISMATCH');
    if (!fresh(a.expiresAt)) throw new Error('ADMISSION_EXPIRED');
    if (observed.preflight.status !== 'UNVERIFIED') throw new Error('PREFLIGHT_UNVERIFIED_REQUIRED');
    return observed;
  }
}
