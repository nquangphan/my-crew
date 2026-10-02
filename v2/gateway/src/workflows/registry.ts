import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  AtomicRecords,
  canonicalJson,
  hash,
  privateDirectory,
  readRecord,
  syncDirectory,
  writeExclusiveRecord,
} from '../journal/atomic-records.ts';
import { type ProcessJournal, pinAdmissionMarkerPath } from '../journal/process-journal.ts';
import { type BmadBuild, bmadBuildPolicy, runBmadInstaller } from './builder.ts';
import { suppliedArchive, verifyPayload } from './fetch.ts';
import { nativeFiles, verifyNativeGeometry } from './native-projection.ts';
import { type ExecutionReceipt, type OwnedIdentity, OwnedOperations } from './operations.ts';
import {
  type AuditedDerivation,
  type ProjectionPin,
  projectionTreeHash,
  type Runtime,
  type SourcePin,
  same,
  validateProjectionPin,
  validateSourcePin,
  type Workflow,
  type WorkflowManifest,
} from './pins.ts';
import type { RetentionInventory } from './retention.ts';
import {
  manifest,
  manifestHash,
  parseArchive,
  readTree,
  safeRelative,
  scanTree,
  type TreeFile,
  validateFiles,
  writeTree,
} from './stage.ts';
export type SourceAudit = { pin: SourcePin; executables: string[] };
export type ProjectionAudit = {
  sourceTreeSha256: string;
  runtime: Runtime;
  recipe: AuditedDerivation;
  expected: ProjectionPin;
  mappings: { from: string; to: string }[];
  policy?: string;
  build?: BmadBuild;
  native?: 'superpowers-codex-native-skills-v1';
};
export type RegistryOptions = {
  sources: SourceAudit[];
  projections: ProjectionAudit[];
  processJournal?: ProcessJournal;
  signal?: AbortSignal;
};
type SourceRecord = { formatVersion: 1; pin: SourcePin };
export type StageRecord = {
  formatVersion: 1;
  kind: 'stage';
  id: string;
  operationKind: 'source' | 'projection';
  state: 'reserved' | 'owned' | 'failed' | 'published' | 'quarantined' | 'deleted';
  lifetime: 'pure' | 'subprocess';
  complete: boolean;
  location: string;
  identity?: OwnedIdentity;
  quarantineName?: string;
  publication?: { parent: 'sources' | 'projections'; name: string };
  payloadBytes: number;
  bytes: number | null;
  reason: string;
  deletionEligible: boolean;
  device?: string;
  inode?: string;
  ownerUid?: number;
};
type Reference = {
  runId: string;
  source: SourcePin;
  projection: ProjectionPin;
  authority: 'registry' | 'process-journal' | 'pin-admission';
};
async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

export class WorkflowRegistry {
  readonly root: string;
  private readonly store: AtomicRecords;
  private readonly options: RegistryOptions;
  private operations!: OwnedOperations;
  private closed = false;
  private constructor(root: string, store: AtomicRecords, options: RegistryOptions) {
    this.root = root;
    this.store = store;
    this.options = structuredClone({ ...options, processJournal: undefined, signal: undefined });
    this.options.processJournal = options.processJournal;
    this.options.signal = options.signal;
  }
  static async open(root: string, options: RegistryOptions): Promise<WorkflowRegistry> {
    await privateDirectory(root);
    const path = join(root, 'workflows');
    const store = await AtomicRecords.open(path);
    try {
      for (const key of ['sources', 'projections', 'stages']) await privateDirectory(join(path, key));
      for (const audit of options.sources) {
        validateSourcePin(audit.pin);
      }
      const registry = new WorkflowRegistry(path, store, options);
      const markerPath = pinAdmissionMarkerPath(root);
      const marker = await readRecord<{ formatVersion: 1; registryRoot: string }>(markerPath);
      if (marker && marker.registryRoot !== path) throw new Error('PIN_ADMISSION_BINDING_CONFLICT');
      if (!marker) await writeExclusiveRecord(markerPath, { formatVersion: 1, registryRoot: path });
      registry.operations = await OwnedOperations.open(path, store);
      await registry.reconcile();
      if (options.processJournal) {
        await store.put('pin-admission-journal', {
          formatVersion: 1,
          journalRoot: options.processJournal.root,
        });
        await options.processJournal.bindPinAdmission({
          registryRoot: path,
          verify: async (input) => {
            if (registry.closed) throw new Error('PIN_ADMISSION_NOT_BOUND');
            await registry.resolve(input.source, input.projection);
          },
        });
      }
      return registry;
    } catch (error) {
      await store.close();
      throw error;
    }
  }
  private async missingJournalAuthority(): Promise<boolean> {
    return (
      !this.options.processJournal &&
      !!(
        (await this.store.get('pin-admission-journal')) ||
        (await present(join(dirname(this.root), 'process-journal')))
      )
    );
  }
  private async referenceBarrier<T>(action: () => Promise<T>, published: boolean): Promise<T> {
    if (this.options.processJournal)
      return this.options.processJournal.withPinAdmissionBarrier(this.root, action);
    if (published && (await this.missingJournalAuthority())) throw new Error('PIN_ADMISSION_NOT_BOUND');
    return action();
  }
  private projectionPath(source: SourcePin, pin: ProjectionPin) {
    return join(
      this.root,
      'projections',
      `${source.name}-${source.sourceTreeSha256}-${pin.runtime}-${pin.treeSha256}`,
    );
  }
  private sourcePath(pin: SourcePin) {
    return join(this.root, 'sources', `${pin.name}-${pin.sourceTreeSha256}`);
  }
  private audit(pin: SourcePin): SourceAudit {
    validateSourcePin(pin);
    const a = this.options.sources.find((a) => same(a.pin, pin));
    if (!a) throw new Error('SOURCE_NOT_AUDITED');
    return a;
  }
  private async stage(kind: 'source' | 'projection', payloadBytes: number): Promise<string> {
    this.options.signal?.throwIfAborted();
    for (const old of await this.stagingInventory())
      if (old.state === 'failed' && old.complete && old.deletionEligible && old.identity)
        await this.removeStage(old);
    const pending = (await this.stagingInventory()).filter(
      (r) => r.state !== 'published' && r.state !== 'deleted',
    );
    if (pending.length >= 8) throw new Error('STAGING_RETRY_LIMIT');
    const id = randomUUID();
    const path = join(this.root, 'stages', id);
    const record: StageRecord = {
      formatVersion: 1,
      kind: 'stage',
      id,
      operationKind: kind,
      state: 'reserved',
      lifetime: 'pure',
      complete: false,
      location: path,
      payloadBytes,
      bytes: null,
      reason: 'operation-unresolved',
      deletionEligible: false,
    };
    await this.store.put(`stage-${id}`, record);
    const identity = await this.operations.create(id);
    await this.store.put(`stage-${id}`, { ...record, state: 'owned', identity });
    return path;
  }
  private async publish(
    kind: 'source' | 'projection',
    final: string,
    payloadBytes: number,
    write: (stage: string) => Promise<number>,
  ): Promise<void> {
    for (const key of ['sources', 'projections', 'stages']) await privateDirectory(join(this.root, key));
    const stage = await this.stage(kind, payloadBytes);
    const key = `stage-${basename(stage)}`;
    const record = await this.store.get<StageRecord>(key);
    if (!record) throw new Error('STAGE_RECORD_MISSING');
    try {
      this.options.signal?.throwIfAborted();
      const bytes = await write(stage);
      this.options.signal?.throwIfAborted();
      await syncDirectory(stage);
      if (await present(final)) throw new Error('IMMUTABLE_PUBLISH_CONFLICT');
      record.publication = { parent: kind === 'source' ? 'sources' : 'projections', name: basename(final) };
      await this.store.put(key, record);
      await rename(stage, final);
      await syncDirectory(dirname(final));
      await syncDirectory(join(this.root, 'stages'));
      await this.store.put(key, {
        ...record,
        state: 'published',
        complete: true,
        bytes: record.identity
          ? await this.operations.inspect(
              kind === 'source' ? 'sources' : 'projections',
              basename(final),
              record.identity,
            )
          : bytes,
        location: final,
        reason: 'immutable-published',
      });
    } catch (error) {
      await this.store.put(key, {
        ...record,
        state: 'failed',
        complete: true,
        deletionEligible: true,
        bytes: record.identity
          ? await this.operations.inspect('stages', record.id, record.identity).catch(() => null)
          : null,
        reason: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INSTALL_FAILED',
      });
      throw error;
    }
  }
  async stagingInventory(): Promise<StageRecord[]> {
    return (await this.store.all<StageRecord>()).filter((r) => r.kind === 'stage');
  }
  private async reconcile(): Promise<void> {
    for (const record of await this.stagingInventory()) {
      if (record.state === 'deleted' || (record.state === 'published' && (await present(record.location))))
        continue;
      try {
        const stagePresent = await present(join(this.root, 'stages', record.id));
        const quarantineName = record.quarantineName ?? record.publication?.name ?? record.id;
        const quarantined = await present(join(this.root, 'quarantine', quarantineName));
        if (!stagePresent && quarantined) {
          const recovered = await this.operations.attest('quarantine', quarantineName, record.id);
          if (
            record.identity &&
            (record.identity.device !== recovered.device || record.identity.inode !== recovered.inode)
          )
            throw new Error('OPERATION_IDENTITY_MISMATCH');
          record.identity = recovered;
          record.state = 'quarantined';
          record.quarantineName = quarantineName;
        } else if (!stagePresent && record.publication) {
          const recovered = await this.operations.attest(
            record.publication.parent,
            record.publication.name,
            record.id,
          );
          if (
            !record.identity ||
            record.identity.device !== recovered.device ||
            record.identity.inode !== recovered.inode
          )
            throw new Error('OPERATION_IDENTITY_MISMATCH');
          record.state = 'published';
          record.complete = true;
          record.deletionEligible = false;
          record.location = join(this.root, record.publication.parent, record.publication.name);
          record.bytes = await this.operations.inspect(
            record.publication.parent,
            record.publication.name,
            record.identity,
          );
          record.reason = 'PUBLISH_RENAME_RECOVERED';
          await this.store.put(`stage-${record.id}`, record);
          continue;
        } else if (!stagePresent) {
          await this.operations.absent('stages', record.id);
          if (record.state === 'reserved' && !record.identity) {
            await this.store.put(`stage-${record.id}`, {
              ...record,
              state: 'deleted',
              complete: true,
              bytes: 0,
              location: '',
              reason: 'RESERVATION_RECOVERED_ABSENT',
            });
            continue;
          }
          throw new Error('OPERATION_LOCATION_UNKNOWN');
        }
        if (!record.identity) record.identity = await this.operations.attest('stages', record.id, record.id);
        const receipt =
          record.lifetime === 'subprocess'
            ? await readRecord<ExecutionReceipt>(join(this.root, 'receipts', `${record.id}.json`))
            : null;
        if (
          record.lifetime === 'pure' ||
          (receipt?.treeEmpty &&
            !receipt.forkObserved &&
            receipt.operationId === record.id &&
            receipt.device === record.identity?.device &&
            receipt.inode === record.identity?.inode)
        ) {
          record.complete = true; // Exclusive writer lease was reacquired; pure operations never spawn a writer.
          record.deletionEligible = true;
          record.state = record.state === 'quarantined' ? 'quarantined' : 'failed';
          record.reason = record.lifetime === 'pure' ? 'PURE_OPERATION_RECOVERED' : 'EXECUTOR_STOP_RECOVERED';
        }
        record.bytes = await this.operations.inspect(
          record.state === 'quarantined' ? 'quarantine' : 'stages',
          record.state === 'quarantined' ? (record.quarantineName ?? record.id) : record.id,
          record.identity,
        );
        await this.store.put(`stage-${record.id}`, record);
      } catch {
        await this.store.put(`stage-${record.id}`, {
          ...record,
          deletionEligible: false,
          reason: 'OPERATION_IDENTITY_OR_LIFETIME_UNKNOWN',
        });
      }
    }
  }
  private async recoveredReferenceProtects(record: StageRecord): Promise<boolean> {
    if (!record.publication) return false;
    if (await this.missingJournalAuthority()) return true;
    const metadata = await readRecord<{ formatVersion: 1; pin: SourcePin | ProjectionPin }>(
      join(this.root, 'quarantine', record.quarantineName ?? record.publication.name, 'pin.json'),
    );
    if (!metadata) return true;
    const refs = await this.retained();
    if (record.operationKind === 'projection') return refs.some((r) => same(r.projection, metadata.pin));
    const source = metadata.pin as SourcePin;
    if (same(await this.current(source.name), source) || refs.some((r) => same(r.source, source)))
      return true;
    for (const projection of (await this.stagingInventory()).filter(
      (r) => r.state === 'published' && r.operationKind === 'projection',
    )) {
      const pin = await readRecord<{ formatVersion: 1; pin: ProjectionPin }>(
        join(projection.location, 'pin.json'),
      );
      if (!pin || pin.pin.sourceTreeSha256 === source.sourceTreeSha256) return true;
    }
    return false;
  }
  async reclaim(): Promise<{ deleted: string[]; retained: string[]; failed: string[] }> {
    return this.store.transaction(() =>
      this.referenceBarrier(async () => {
        await this.reconcile();
        const out = { deleted: [] as string[], retained: [] as string[], failed: [] as string[] };
        for (const record of await this.stagingInventory()) {
          if (record.state === 'deleted' || record.state === 'published') continue;
          if (!record.complete || !record.deletionEligible || !record.identity) {
            out.retained.push(record.id);
            continue;
          }
          try {
            if (record.state === 'quarantined' && (await this.recoveredReferenceProtects(record))) {
              out.retained.push(record.id);
              continue;
            }
            if (record.state === 'quarantined')
              await this.operations.deleteQuarantined(record.quarantineName ?? record.id, record.identity);
            else
              await this.operations.remove('stages', record.id, record.identity, async () => {
                await this.store.put(`stage-${record.id}`, { ...record, state: 'quarantined' });
              });
            await this.store.put(`stage-${record.id}`, {
              ...record,
              state: 'deleted',
              bytes: 0,
              location: '',
              reason: 'OWNED_OPERATION_RECLAIMED',
            });
            out.deleted.push(record.id);
          } catch {
            out.failed.push(record.id);
          }
        }
        return out;
      }, false),
    );
  }
  private async sourceVerified(pin: SourcePin): Promise<void> {
    this.audit(pin);
    const path = this.sourcePath(pin);
    const record = await readRecord<SourceRecord>(join(path, 'pin.json'));
    if (!record || !same(record.pin, pin)) throw new Error('CHECKSUM_MISMATCH');
    const fd = await open(join(path, 'payload.tgz'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        stat.size > 32 * 1024 * 1024
      )
        throw new Error('UNSAFE_TREE');
      verifyPayload(pin, await fd.readFile());
    } finally {
      await fd.close();
    }
    if (manifestHash(await scanTree(join(path, 'tree'))) !== pin.sourceManifestSha256)
      throw new Error('CHECKSUM_MISMATCH');
  }
  /** Verify cached immutable source bytes without fetching or changing current pointers. */
  async verifySource(pin: SourcePin): Promise<void> {
    await this.sourceVerified(structuredClone(pin));
  }
  async installSource(input: SourcePin, archive: Readable): Promise<SourcePin> {
    this.options.signal?.throwIfAborted();
    const pin = structuredClone(input);
    const audit = this.audit(pin);
    const bytes = await suppliedArchive(pin, archive);
    return this.store.transaction(async () => {
      this.options.signal?.throwIfAborted();
      const final = this.sourcePath(pin);
      if (await present(final)) await this.sourceVerified(pin);
      else
        await this.publish('source', final, bytes.length, async (stage) => {
          const files = await parseArchive(bytes, audit.executables);
          await writeTree(join(stage, 'tree'), files);
          const entries = await scanTree(join(stage, 'tree'));
          if (manifestHash(entries) !== pin.sourceManifestSha256) throw new Error('CHECKSUM_MISMATCH');
          const fd = await open(
            join(stage, 'payload.tgz'),
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o600,
          );
          try {
            await fd.writeFile(bytes);
            await fd.sync();
          } finally {
            await fd.close();
          }
          await writeExclusiveRecord(join(stage, 'pin.json'), { formatVersion: 1, pin });
          await writeExclusiveRecord(join(stage, 'manifest.json'), { formatVersion: 1, entries });
          return bytes.length + entries.reduce((sum, e) => sum + e.bytes, 0);
        });
      this.options.signal?.throwIfAborted();
      await this.store.put(`current-${pin.name}`, { formatVersion: 1, pin });
      return structuredClone(pin);
    });
  }
  async current(name: Workflow): Promise<SourcePin | null> {
    const record = await this.store.get<SourceRecord>(`current-${name}`);
    return record?.pin ?? null;
  }
  private projectionAudit(source: SourcePin, pin: ProjectionPin): ProjectionAudit {
    validateProjectionPin(pin);
    if (source.sourceTreeSha256 !== pin.sourceTreeSha256) throw new Error('SOURCE_PROJECTION_MISMATCH');
    const a = this.options.projections.find(
      (a) =>
        a.sourceTreeSha256 === source.sourceTreeSha256 && a.runtime === pin.runtime && same(a.expected, pin),
    );
    if (!a) throw new Error('PROJECTION_UNAVAILABLE');
    return a;
  }
  private async projectionVerified(source: SourcePin, pin: ProjectionPin): Promise<void> {
    const audit = this.projectionAudit(source, pin);
    const path = this.projectionPath(source, pin);
    const r = await readRecord<{ formatVersion: 1; pin: ProjectionPin }>(join(path, 'pin.json'));
    if (!r || !same(r.pin, pin) || manifestHash(await scanTree(join(path, 'tree'))) !== pin.manifestSha256)
      throw new Error('CHECKSUM_MISMATCH');
    if (audit.native) {
      const policy = await readRecord<{ formatVersion: 1; policy: unknown }>(join(path, 'policy.json'));
      if (!policy || hash(canonicalJson(policy.policy)) !== pin.derivation.policySha256)
        throw new Error('CHECKSUM_MISMATCH');
      await verifyNativeGeometry(join(path, 'tree'));
    }
  }
  private project(files: TreeFile[], audit: ProjectionAudit): TreeFile[] {
    for (const entry of audit.recipe.officialEntrypoints)
      if (!files.some((f) => f.path === entry && f.type === 'file'))
        throw new Error('OFFICIAL_ENTRYPOINT_MISSING');
    if (!audit.recipe.officialEntrypoints.length || !audit.mappings.length)
      throw new Error('PROJECTION_UNAVAILABLE');
    const out: TreeFile[] = [];
    for (const mapping of audit.mappings) {
      const from = safeRelative(mapping.from);
      const to = safeRelative(mapping.to);
      let found = false;
      for (const file of files) {
        if (file.path === from || file.path.startsWith(`${from}/`)) {
          found = true;
          out.push({ ...file, path: `${to}${file.path.slice(from.length)}`, body: Buffer.from(file.body) });
        }
      }
      if (!found) throw new Error('OFFICIAL_ENTRYPOINT_MISSING');
    }
    if (audit.policy !== undefined) {
      if (hash(audit.policy) !== audit.recipe.policySha256) throw new Error('CHECKSUM_MISMATCH');
      out.push({ path: 'adapter-policy.json', type: 'file', mode: 0o644, body: Buffer.from(audit.policy) });
    }
    if (audit.runtime === 'api' && audit.policy === undefined) throw new Error('API_POLICY_UNAVAILABLE');
    return validateFiles(out);
  }
  private async builtFiles(sourceFiles: TreeFile[], audit: ProjectionAudit): Promise<TreeFile[]> {
    if (!audit.build && !audit.native) return this.project(sourceFiles, audit);
    const stage = await this.stage('projection', audit.build?.dependencies.length ?? 0);
    const key = `stage-${basename(stage)}`;
    const initial = await this.store.get<StageRecord>(key);
    if (!initial?.identity) throw new Error('STAGE_RECORD_MISSING');
    let record: StageRecord = initial;
    const identity = initial.identity;
    try {
      if (audit.native) {
        if (!audit.policy || hash(audit.policy) !== audit.recipe.policySha256)
          throw new Error('CHECKSUM_MISMATCH');
        await writeTree(join(stage, 'tree'), nativeFiles(sourceFiles));
        await verifyNativeGeometry(join(stage, 'tree'));
        return await readTree(join(stage, 'tree'));
      }
      if (!audit.build) throw new Error('PROJECTION_UNAVAILABLE');
      const files = await runBmadInstaller(
        stage,
        identity,
        this.operations,
        sourceFiles,
        audit.build,
        async () => {
          this.options.signal?.throwIfAborted();
          record = { ...record, lifetime: 'subprocess', complete: false, deletionEligible: false };
          await this.store.put(key, record);
        },
      );
      if (audit.policy !== undefined) {
        if (hash(audit.policy) !== audit.recipe.policySha256) throw new Error('CHECKSUM_MISMATCH');
        files.push({
          path: 'adapter-policy.json',
          type: 'file',
          mode: 0o644,
          body: Buffer.from(audit.policy),
        });
      }
      return validateFiles(files);
    } finally {
      const receipt = await readRecord<ExecutionReceipt>(join(this.root, 'receipts', `${record.id}.json`));
      const complete =
        record.lifetime === 'pure' ||
        !!(
          receipt?.treeEmpty &&
          !receipt.forkObserved &&
          receipt.operationId === record.id &&
          receipt.device === record.identity?.device &&
          receipt.inode === record.identity?.inode
        );
      record = {
        ...record,
        state: 'failed',
        complete,
        deletionEligible: complete,
        bytes: await this.operations.inspect('stages', record.id, identity).catch(() => null),
        reason: complete ? 'BUILD_OPERATION_COMPLETE' : 'EXECUTOR_LIFETIME_UNKNOWN',
      };
      await this.store.put(key, record);
      if (complete) await this.removeStage(record);
    }
  }
  private async removeStage(record: StageRecord): Promise<void> {
    if (!record.identity || !record.complete || !record.deletionEligible)
      throw new Error('OPERATION_LIFETIME_UNKNOWN');
    if (record.state === 'quarantined')
      await this.operations.deleteQuarantined(record.quarantineName ?? record.id, record.identity);
    else
      await this.operations.remove('stages', record.id, record.identity, async () => {
        await this.store.put(`stage-${record.id}`, { ...record, state: 'quarantined' });
      });
    await this.store.put(`stage-${record.id}`, {
      ...record,
      state: 'deleted',
      bytes: 0,
      location: '',
      reason: 'OWNED_OPERATION_RECLAIMED',
    });
  }
  async deriveProjection(
    input: SourcePin,
    target: Runtime,
    inputRecipe: AuditedDerivation,
  ): Promise<ProjectionPin> {
    this.options.signal?.throwIfAborted();
    const source = structuredClone(input);
    const recipe = structuredClone(inputRecipe);
    this.audit(source);
    const audit = this.options.projections.find(
      (a) => a.sourceTreeSha256 === source.sourceTreeSha256 && a.runtime === target && same(a.recipe, recipe),
    );
    if (!audit) throw new Error('PROJECTION_UNAVAILABLE');
    this.projectionAudit(source, audit.expected);
    if (audit.build) {
      const policy = JSON.parse(audit.policy ?? 'null');
      if (!policy || !same(policy.buildInputs ?? policy, bmadBuildPolicy(audit.build)))
        throw new Error('BUILDER_POLICY_MISMATCH');
    }
    return this.store.transaction(async () => {
      this.options.signal?.throwIfAborted();
      await this.sourceVerified(source);
      if (await present(this.projectionPath(source, audit.expected))) {
        await this.projectionVerified(source, audit.expected);
        this.options.signal?.throwIfAborted();
        return structuredClone(audit.expected);
      }
      const sourceFiles = await readTree(join(this.sourcePath(source), 'tree'));
      const files = await this.builtFiles(sourceFiles, audit);
      const second = await this.builtFiles(sourceFiles, audit);
      const manifestSha256 = manifestHash(manifest(files));
      if (manifestSha256 !== manifestHash(manifest(second))) throw new Error('NONDETERMINISTIC_PROJECTION');
      const { officialEntrypoints: _entries, ...derivation } = recipe;
      const base = { runtime: target, sourceTreeSha256: source.sourceTreeSha256, manifestSha256, derivation };
      const pin: ProjectionPin = { ...base, treeSha256: projectionTreeHash(base) };
      if (!same(pin, audit.expected)) throw new Error('CHECKSUM_MISMATCH');
      const final = this.projectionPath(source, pin);
      if (await present(final)) await this.projectionVerified(source, pin);
      else
        await this.publish('projection', final, 0, async (stage) => {
          await writeTree(join(stage, 'tree'), files);
          const entries = await scanTree(join(stage, 'tree'));
          if (manifestHash(entries) !== pin.manifestSha256) throw new Error('CHECKSUM_MISMATCH');
          await writeExclusiveRecord(join(stage, 'pin.json'), { formatVersion: 1, pin });
          await writeExclusiveRecord(join(stage, 'manifest.json'), { formatVersion: 1, entries });
          if (audit.native)
            await writeExclusiveRecord(join(stage, 'policy.json'), {
              formatVersion: 1,
              policy: JSON.parse(audit.policy ?? 'null'),
            });
          return entries.reduce((sum, e) => sum + e.bytes, 0);
        });
      this.options.signal?.throwIfAborted();
      return structuredClone(pin);
    });
  }
  async resolve(
    input: SourcePin,
    inputProjection: ProjectionPin,
  ): Promise<{ sourceRoot: string; projectionRoot: string; manifest: WorkflowManifest }> {
    const source = structuredClone(input);
    const projection = structuredClone(inputProjection);
    await this.sourceVerified(source);
    await this.projectionVerified(source, projection);
    return {
      sourceRoot: join(this.sourcePath(source), 'tree'),
      projectionRoot: join(this.projectionPath(source, projection), 'tree'),
      manifest: {
        source: await scanTree(join(this.sourcePath(source), 'tree')),
        projection: await scanTree(join(this.projectionPath(source, projection), 'tree')),
      },
    };
  }
  async retain(runId: string, input: SourcePin, inputProjection: ProjectionPin): Promise<void> {
    if (!runId || runId.length > 200) throw new Error('INVALID_RUN_REFERENCE');
    const source = structuredClone(input);
    const projection = structuredClone(inputProjection);
    await this.store.transaction(async () => {
      await this.resolve(source, projection);
      await this.store.put(
        `ref-${hash(runId + source.sourceTreeSha256 + projection.treeSha256 + projection.runtime)}`,
        { formatVersion: 1, kind: 'reference', runId, source, projection, state: 'retained' },
      );
    });
  }
  async release(runId: string, source: SourcePin, projection: ProjectionPin): Promise<void> {
    validateSourcePin(source);
    validateProjectionPin(projection);
    if (source.sourceTreeSha256 !== projection.sourceTreeSha256)
      throw new Error('SOURCE_PROJECTION_MISMATCH');
    await this.store.transaction(async () => {
      const id = `ref-${hash(runId + source.sourceTreeSha256 + projection.treeSha256 + projection.runtime)}`;
      const old = await this.store.get<{
        formatVersion: 1;
        runId: string;
        source: SourcePin;
        projection: ProjectionPin;
      }>(id);
      if (!old) return;
      if (old.runId !== runId || !same(old.source, source) || !same(old.projection, projection))
        throw new Error('RUN_REFERENCE_CONFLICT');
      await this.store.put(id, { ...old, state: 'released' });
    });
  }
  async retained(): Promise<
    {
      runId: string;
      source: SourcePin;
      projection: ProjectionPin;
      authority: 'registry' | 'process-journal' | 'pin-admission';
    }[]
  > {
    const rows = await this.store.all<{
      kind?: string;
      state?: string;
      runId: string;
      source: SourcePin;
      projection: ProjectionPin;
    }>();
    const refs: Reference[] = rows
      .filter((r) => r.kind === 'reference' && r.state === 'retained')
      .map((r) => ({
        runId: r.runId,
        source: r.source,
        projection: r.projection,
        authority: 'registry' as const,
      }));
    for (const r of refs) {
      validateSourcePin(r.source);
      validateProjectionPin(r.projection);
    }
    if (this.options.processJournal) {
      for (const process of await this.options.processJournal.activePinReferences())
        refs.push({
          runId: process.authorization?.attemptId ?? process.launchId,
          source: process.source,
          projection: process.projection,
          authority: 'process-journal',
        });
      for (const intent of await this.options.processJournal.pendingPinAdmissions()) {
        validateSourcePin(intent.source);
        validateProjectionPin(intent.projection);
        refs.push({
          runId: `admission:${intent.commandId}:${intent.processInstanceId}`,
          source: intent.source,
          projection: intent.projection,
          authority: 'pin-admission',
        });
      }
    }
    return refs;
  }
  async retentionInventory(): Promise<RetentionInventory[]> {
    const records = await this.stagingInventory();
    const processes = this.options.processJournal
      ? await this.options.processJournal.activePinReferences()
      : [];
    const bytes = async (path: string): Promise<number | null> => {
      const record = records.find((r) => r.state === 'published' && r.location === path);
      if (!record?.identity || !record.publication) return null;
      return this.operations
        .inspect(record.publication.parent, record.publication.name, record.identity)
        .catch(() => null);
    };
    return Promise.all(
      (await this.retained()).map(async (ref) => {
        const process =
          ref.authority === 'process-journal'
            ? processes.find(
                (p) =>
                  (p.authorization?.attemptId ?? p.launchId) === ref.runId &&
                  same(p.source, ref.source) &&
                  same(p.projection, ref.projection),
              )
            : undefined;
        return {
          ...ref,
          sourceBytes: await bytes(this.sourcePath(ref.source)),
          projectionBytes: await bytes(this.projectionPath(ref.source, ref.projection)),
          reason:
            ref.authority === 'process-journal'
              ? 'accepted-finalization-producer-unavailable'
              : ref.authority === 'pin-admission'
                ? 'durable-pin-admission-intent'
                : 'durable-run-reference',
          releaseRequirement: process
            ? {
                launchId: process.launchId,
                processInstanceId: process.processInstanceId,
                authorization: process.authorization,
                source: process.source,
                projection: process.projection,
                requires: [
                  'authenticated-005-finalization-same-attempt-fence-process-and-pair',
                  'actual-local-stop-proof',
                  'no-other-retained-references',
                ] as const,
              }
            : null,
        };
      }),
    );
  }
  async collectPublished(): Promise<{ deleted: string[]; retained: string[]; failed: string[] }> {
    return this.store.transaction(() =>
      this.referenceBarrier(async () => {
        const result = { deleted: [] as string[], retained: [] as string[], failed: [] as string[] };
        const refs = await this.retained();
        const records = (await this.stagingInventory())
          .filter((r) => r.state === 'published')
          .sort((a, b) =>
            a.operationKind === b.operationKind ? 0 : a.operationKind === 'projection' ? -1 : 1,
          );
        const remainingProjections = new Set<string>();
        for (const record of records.filter((r) => r.operationKind === 'projection')) {
          const metadata = await readRecord<{ formatVersion: 1; pin: ProjectionPin }>(
            join(record.location, 'pin.json'),
          );
          if (metadata) remainingProjections.add(`${metadata.pin.sourceTreeSha256}:${record.id}`);
        }
        for (const record of records) {
          try {
            if (!record.identity || !record.publication || !record.complete)
              throw new Error('PUBLICATION_AUTHORITY_UNKNOWN');
            const metadata = await readRecord<{ formatVersion: 1; pin: SourcePin | ProjectionPin }>(
              join(record.location, 'pin.json'),
            );
            if (!metadata) throw new Error('PUBLICATION_AUTHORITY_UNKNOWN');
            let protectedReference = false;
            if (record.operationKind === 'source') {
              const pin = metadata.pin as SourcePin;
              validateSourcePin(pin);
              protectedReference =
                same(await this.current(pin.name), pin) ||
                refs.some((r) => same(r.source, pin)) ||
                [...remainingProjections].some((key) => key.startsWith(`${pin.sourceTreeSha256}:`));
            } else {
              const pin = metadata.pin as ProjectionPin;
              validateProjectionPin(pin);
              protectedReference = refs.some((r) => same(r.projection, pin));
            }
            if (protectedReference) {
              result.retained.push(record.id);
              continue;
            }
            const location = record.publication;
            await this.operations.remove(location.parent, location.name, record.identity, async () => {
              await this.store.put(`stage-${record.id}`, {
                ...record,
                state: 'quarantined',
                quarantineName: location.name,
                deletionEligible: true,
              });
            });
            await this.store.put(`stage-${record.id}`, {
              ...record,
              state: 'deleted',
              bytes: 0,
              location: '',
              reason: 'NO_RECOVERED_REFERENCES',
            });
            if (record.operationKind === 'projection')
              remainingProjections.delete(`${(metadata.pin as ProjectionPin).sourceTreeSha256}:${record.id}`);
            result.deleted.push(record.id);
          } catch {
            result.failed.push(record.id);
          }
        }
        return result;
      }, true),
    );
  }
  async exists(source: SourcePin, projection: ProjectionPin): Promise<boolean> {
    try {
      if (
        !(await present(this.sourcePath(source))) ||
        !(await present(this.projectionPath(source, projection)))
      )
        return false;
      await this.resolve(source, projection);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.store.close();
  }
}
