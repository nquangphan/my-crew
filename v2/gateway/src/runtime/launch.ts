import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { BeforeReleaseContext, BridgeOptions } from '../execution/ticket-command-bridge.ts';
import type { IsolatedWorkspace } from '../isolation/workspace.ts';
import { AtomicRecords, canonicalJson, hash, writeExclusiveRecord } from '../journal/atomic-records.ts';
import type { ProcessJournal } from '../journal/process-journal.ts';
import type { WorkflowRegistry } from '../workflows/registry.ts';
import type { RuntimeInput, RuntimePin } from './contracts.ts';
import { RuntimeIsolation } from './isolation.ts';

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
type RuntimeRecord = {
  formatVersion: 1;
  launchId: string;
  pin: RuntimePin;
  input: RuntimeInput;
  entrypoint: { absolutePath: string; sha256: string };
  workspace: Pick<
    IsolatedWorkspace,
    | 'attemptId'
    | 'operationId'
    | 'identity'
    | 'workspace'
    | 'attemptHome'
    | 'ownerCommit'
    | 'source'
    | 'projection'
  >;
};
export type RuntimeEntrypoint = {
  relativePath: string;
  sha256: string;
  sourceTreeSha256: string;
  projectionManifestSha256: string;
  projectionTreeSha256: string;
  derivationSha256: string;
};
export type RuntimeLaunchOptions = {
  journal: ProcessJournal;
  registry: WorkflowRegistry;
  isolation?: RuntimeIsolation;
  /** Trusted reviewed source-to-projection mapping; registry manifests alone are not entrypoint authority. */
  entrypoint?: (pin: RuntimePin, skillName: string) => Promise<RuntimeEntrypoint | null>;
  /** Future Phase06 binding reads durable run/operation state; no production default. */
  binding?: (context: BeforeReleaseContext) => Promise<{ pin: RuntimePin; input: RuntimeInput }>;
};
export class RuntimeLaunch {
  private readonly store: AtomicRecords;
  private readonly options: Readonly<RuntimeLaunchOptions>;
  private active: BeforeReleaseContext | null = null;
  private constructor(store: AtomicRecords, options: RuntimeLaunchOptions) {
    this.store = store;
    this.options = Object.freeze({ ...options });
  }
  static async open(root: string, options: RuntimeLaunchOptions) {
    return new RuntimeLaunch(await AtomicRecords.open(join(root, 'runtime-pins')), options);
  }
  /** Pass this captured callback to the existing TicketCommandBridge. No process is launched here. */
  readonly beforeRelease: NonNullable<BridgeOptions['beforeRelease']> = async (context) => {
    await this.store.transaction(async () => {
      if (!this.options.binding) throw new Error('RUNTIME_BINDING_NOT_CONFIGURED');
      const candidate = await this.options.binding(context);
      this.active = context;
      try {
        await this.startReleased(candidate.pin, candidate.input);
      } finally {
        this.active = null;
      }
    });
  };
  async startReleased(pin: RuntimePin, input: RuntimeInput): Promise<void> {
    const context = this.active;
    if (!context) throw new Error('BRIDGE_HOOK_REQUIRED');
    pin = structuredClone(pin);
    input = structuredClone(input);
    const { record, attempt, companion, command } = context;
    if (
      pin.commandId !== record.commandId ||
      pin.commandId !== command.id ||
      pin.attemptId !== attempt.id ||
      attempt.commandId !== command.id ||
      attempt.machineId !== pin.modelChoice.model.machineId ||
      attempt.state !== 'active' ||
      pin.fence !== attempt.fence ||
      pin.processInstanceId !== record.processInstanceId ||
      pin.processInstanceId !== attempt.processInstanceId ||
      !same(pin.attemptProjection, companion) ||
      !same(pin.source, record.source) ||
      !same(pin.projection, record.projection) ||
      pin.projection.runtime !== pin.modelChoice.model.runtime ||
      pin.projection.runtime !== pin.selection.runtime ||
      !command.payload.modelChoice ||
      !same(pin.modelChoice, command.payload.modelChoice) ||
      !same(pin.selection, command.payload.selection) ||
      pin.selection.sourceTreeSha256 !== pin.source.sourceTreeSha256 ||
      pin.selection.projectionManifestSha256 !== pin.projection.manifestSha256 ||
      pin.selection.projectionTreeSha256 !== pin.projection.treeSha256 ||
      pin.selection.installReportId !== companion.installReportId ||
      !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(pin.workspaceCommit) ||
      !/^[0-9a-f-]{36}$/.test(pin.runId)
    )
      throw new Error('RUNTIME_PIN_MISMATCH');
    if (
      pin.admission.kind === 'test-certification' &&
      (!command.payload.certificationAdmission ||
        !same(command.payload.certificationAdmission, {
          challengeId: pin.admission.challengeId,
          nonce: pin.admission.nonce,
        }))
    )
      throw new Error('ADMISSION_MISMATCH');
    if (
      !input.skillName ||
      !input.skillPath ||
      input.skillPath.startsWith('/') ||
      input.skillPath.split('/').some((p) => !p || p === '.' || p === '..')
    )
      throw new Error('SKILL_PATH_INVALID');
    if (
      input.checkpoint &&
      (input.checkpoint.sourceTreeSha256 !== pin.source.sourceTreeSha256 ||
        input.checkpoint.projectionTreeSha256 !== pin.projection.treeSha256 ||
        input.checkpoint.logicalEffectIds.some((id) => !/^[0-9a-f]{64}$/.test(id)))
    )
      throw new Error('CHECKPOINT_MISMATCH');
    await this.options.journal.exact(record);
    const ready = await this.options.journal.ready(record);
    if (!ready || ready.processInstanceId !== pin.processInstanceId) throw new Error('READY_REQUIRED');
    const pair = await this.options.registry.resolve(pin.source, pin.projection);
    const catalog = await this.options.entrypoint?.(structuredClone(pin), input.skillName);
    if (!catalog) throw new Error('ENTRYPOINT_AUTHORITY_NOT_BOUND');
    if (
      catalog.relativePath !== input.skillPath ||
      catalog.sourceTreeSha256 !== pin.source.sourceTreeSha256 ||
      catalog.projectionManifestSha256 !== pin.projection.manifestSha256 ||
      catalog.projectionTreeSha256 !== pin.projection.treeSha256 ||
      catalog.derivationSha256 !== hash(canonicalJson(pin.projection.derivation))
    )
      throw new Error('ENTRYPOINT_MISMATCH');
    const absolutePath = await realpath(join(pair.projectionRoot, input.skillPath));
    const canonicalRelative = relative(await realpath(pair.projectionRoot), absolutePath);
    if (!canonicalRelative || isAbsolute(canonicalRelative) || canonicalRelative.split('/').includes('..'))
      throw new Error('ENTRYPOINT_ESCAPE');
    const entry = pair.manifest.projection.find(
      (item) => item.path === canonicalRelative && item.type === 'file',
    );
    if (!entry || entry.sha256 !== catalog.sha256) throw new Error('ENTRYPOINT_MISMATCH');
    const fd = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size !== entry.bytes ||
        hash(await fd.readFile()) !== catalog.sha256
      )
        throw new Error('ENTRYPOINT_MISMATCH');
    } finally {
      await fd.close();
    }
    await (this.options.isolation ?? new RuntimeIsolation()).withVerified(pin, async (workspace) => {
      const value: RuntimeRecord = {
          formatVersion: 1,
          launchId: record.launchId,
          pin,
          input,
          entrypoint: { absolutePath, sha256: entry.sha256 },
          workspace: {
            attemptId: workspace.attemptId,
            operationId: workspace.operationId,
            identity: workspace.identity,
            workspace: workspace.workspace,
            attemptHome: workspace.attemptHome,
            ownerCommit: workspace.ownerCommit,
            source: workspace.source,
            projection: workspace.projection,
          },
        },
        prior = await this.read(record.launchId);
      if (prior) {
        if (!same(prior, value)) throw new Error('RUNTIME_PIN_CONFLICT');
        return;
      }
      await writeExclusiveRecord(this.store.path(record.launchId), value);
    });
  }
  read(launchId: string): Promise<RuntimeRecord | null> {
    return this.store.get(launchId);
  }
  close() {
    return this.store.close();
  }
}
