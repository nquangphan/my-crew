import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  AtomicRecords,
  hash,
  privateDirectory,
  readRecord,
  syncDirectory,
  writeExclusiveRecord,
} from '../journal/atomic-records.ts';
import type { ProcessJournal } from '../journal/process-journal.ts';
import { suppliedArchive, verifyPayload } from './fetch.ts';
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
  state: 'reserved' | 'owned' | 'failed' | 'published';
  payloadBytes: number;
  bytes: number | null;
  reason: string;
  deletionEligible: false;
  device?: string;
  inode?: string;
  ownerUid?: number;
};
type Reference = {
  runId: string;
  source: SourcePin;
  projection: ProjectionPin;
  authority: 'registry' | 'process-journal';
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
      return new WorkflowRegistry(path, store, options);
    } catch (error) {
      await store.close();
      throw error;
    }
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
    const id = randomUUID();
    const path = join(this.root, 'stages', id);
    const record: StageRecord = {
      formatVersion: 1,
      kind: 'stage',
      id,
      operationKind: kind,
      state: 'reserved',
      payloadBytes,
      bytes: null,
      reason: 'operation-unresolved',
      deletionEligible: false,
    };
    await this.store.put(`stage-${id}`, record);
    await mkdir(path, { mode: 0o700 });
    const stat = await lstat(path);
    await this.store.put(`stage-${id}`, {
      ...record,
      state: 'owned',
      device: String(stat.dev),
      inode: String(stat.ino),
      ownerUid: stat.uid,
    });
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
      await rename(stage, final);
      await syncDirectory(dirname(final));
      await syncDirectory(join(this.root, 'stages'));
      await this.store.put(key, { ...record, state: 'published', bytes, reason: 'immutable-published' });
    } catch (error) {
      await this.store.put(key, {
        ...record,
        state: 'failed',
        reason: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INSTALL_FAILED',
      });
      throw error;
    }
  }
  async stagingInventory(): Promise<StageRecord[]> {
    return (await this.store.all<StageRecord>()).filter((r) => r.kind === 'stage');
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
  async installSource(input: SourcePin, archive: Readable): Promise<SourcePin> {
    const pin = structuredClone(input);
    const audit = this.audit(pin);
    const bytes = await suppliedArchive(pin, archive);
    return this.store.transaction(async () => {
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
    this.projectionAudit(source, pin);
    const path = this.projectionPath(source, pin);
    const r = await readRecord<{ formatVersion: 1; pin: ProjectionPin }>(join(path, 'pin.json'));
    if (!r || !same(r.pin, pin) || manifestHash(await scanTree(join(path, 'tree'))) !== pin.manifestSha256)
      throw new Error('CHECKSUM_MISMATCH');
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
  async deriveProjection(
    input: SourcePin,
    target: Runtime,
    inputRecipe: AuditedDerivation,
  ): Promise<ProjectionPin> {
    const source = structuredClone(input);
    const recipe = structuredClone(inputRecipe);
    this.audit(source);
    const audit = this.options.projections.find(
      (a) => a.sourceTreeSha256 === source.sourceTreeSha256 && a.runtime === target && same(a.recipe, recipe),
    );
    if (!audit) throw new Error('PROJECTION_UNAVAILABLE');
    this.projectionAudit(source, audit.expected);
    return this.store.transaction(async () => {
      await this.sourceVerified(source);
      const sourceFiles = await readTree(join(this.sourcePath(source), 'tree'));
      const files = this.project(sourceFiles, audit);
      const second = this.project(sourceFiles, audit);
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
          return entries.reduce((sum, e) => sum + e.bytes, 0);
        });
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
      authority: 'registry' | 'process-journal';
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
    if (this.options.processJournal)
      for (const process of await this.options.processJournal.processes())
        refs.push({
          runId: process.authorization?.attemptId ?? process.launchId,
          source: process.source,
          projection: process.projection,
          authority: 'process-journal',
        });
    return refs;
  }
  async exists(source: SourcePin, projection: ProjectionPin): Promise<boolean> {
    try {
      await this.resolve(source, projection);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  }
  async close(): Promise<void> {
    await this.store.close();
  }
}
