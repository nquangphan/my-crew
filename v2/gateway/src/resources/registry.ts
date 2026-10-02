import { randomUUID } from 'node:crypto';
import { access, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtomicRecords, privateDirectory } from '../journal/atomic-records.ts';
import { NativeHelper } from '../journal/native.ts';
import type { ProcessJournal } from '../journal/process-journal.ts';
export type ResourceKind = 'scratch' | 'fixture' | 'temp_upload' | 'cache';
export type ResourceIdentity = {
  device: string;
  inode: string;
  ownerUid: number;
  kind: string;
  linkCount: number;
};
type Resource = {
  formatVersion: 1;
  resourceId: string;
  runId: string;
  kind: ResourceKind;
  name: string;
  identity: ResourceIdentity | null;
  state: 'reserved' | 'attested' | 'quarantined' | 'deleted';
  retention: string[];
  references: string[];
  lastError: string | null;
};
type ProcessOwner = { formatVersion: 1; runId: string; processInstanceId: string; startIdentity: string };
export type ResourceRegistryOptions = {
  processJournal?: ProcessJournal;
  signal?: AbortSignal;
  onDurableCleanup?: (stage: 'quarantined', resourceId: string) => Promise<void>;
};
async function identity(path: string): Promise<ResourceIdentity> {
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error('RESOURCE_IDENTITY_MISMATCH');
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    ownerUid: stat.uid,
    kind: 'directory',
    linkCount: stat.nlink,
  };
}
export class ResourceRegistry {
  private readonly store: AtomicRecords;
  private readonly root: string;
  private readonly helper: NativeHelper;
  private readonly rootIdentity: ResourceIdentity;
  private readonly parents: Record<'objects' | 'quarantine', ResourceIdentity>;
  private readonly options: ResourceRegistryOptions;
  private constructor(
    store: AtomicRecords,
    root: string,
    helper: NativeHelper,
    rootIdentity: ResourceIdentity,
    parents: Record<'objects' | 'quarantine', ResourceIdentity>,
    options: ResourceRegistryOptions,
  ) {
    this.store = store;
    this.root = root;
    this.helper = helper;
    this.rootIdentity = rootIdentity;
    this.parents = parents;
    this.options = options;
  }
  static async open(root: string, options: ResourceRegistryOptions = {}): Promise<ResourceRegistry> {
    await privateDirectory(root);
    const path = join(root, 'resources');
    const store = await AtomicRecords.open(path);
    try {
      await privateDirectory(join(path, 'objects'));
      await privateDirectory(join(path, 'quarantine'));
      let source = fileURLToPath(new URL('./native-resources.c', import.meta.url));
      try {
        await access(source);
      } catch {
        source = fileURLToPath(new URL('../../../src/resources/native-resources.c', import.meta.url));
      }
      const helper = await NativeHelper.build(path, source);
      const rootIdentity = await identity(path);
      const parents = {
        objects: await identity(join(path, 'objects')),
        quarantine: await identity(join(path, 'quarantine')),
      };
      const layout = { formatVersion: 1 as const, rootIdentity, parents };
      const old = await store.get<typeof layout>('layout');
      const same = (a: ResourceIdentity, b: ResourceIdentity) =>
        a.device === b.device && a.inode === b.inode && a.ownerUid === b.ownerUid && a.kind === b.kind;
      if (
        old &&
        (!same(old.rootIdentity, rootIdentity) ||
          !same(old.parents.objects, parents.objects) ||
          !same(old.parents.quarantine, parents.quarantine))
      )
        throw new Error('RESOURCE_PARENT_IDENTITY_MISMATCH');
      if (!old) await store.put('layout', layout);
      return new ResourceRegistry(store, path, helper, rootIdentity, parents, options);
    } catch (error) {
      await store.close();
      throw error;
    }
  }
  private args(mode: string, parent: 'objects' | 'quarantine', record: Resource): string[] {
    const p = this.parents[parent];
    const args = [
      mode,
      this.root,
      this.rootIdentity.device,
      this.rootIdentity.inode,
      parent,
      p.device,
      p.inode,
      record.name,
    ];
    if (record.identity)
      args.push(record.identity.device, record.identity.inode, String(record.identity.linkCount));
    return args;
  }
  async reserveOwnedPath(input: {
    runId: string;
    kind: ResourceKind;
  }): Promise<{ resourceId: string; path: string }> {
    if (!input.runId || !['scratch', 'fixture', 'temp_upload', 'cache'].includes(input.kind))
      throw new Error('INVALID_RESOURCE');
    return this.store.transaction(async () => {
      const resourceId = randomUUID();
      const record: Resource = {
        formatVersion: 1,
        resourceId,
        ...input,
        name: resourceId,
        identity: null,
        state: 'reserved',
        retention: [],
        references: [input.runId],
        lastError: null,
      };
      await this.store.put(resourceId, record);
      return { resourceId, path: join(this.root, 'objects', resourceId) };
    });
  }
  async createAndAttest(
    resourceId: string,
    create: (path: string) => Promise<void>,
  ): Promise<ResourceIdentity> {
    return this.store.transaction(async () => {
      const record = await this.resource(resourceId);
      if (record.state !== 'reserved' || record.identity) throw new Error('RESOURCE_ALREADY_CREATED');
      const created: ResourceIdentity = JSON.parse(
        await this.helper.run(this.args('create', 'objects', record)),
      );
      const path = join(this.root, 'objects', record.name);
      await create(path);
      const current = await identity(path);
      if (
        current.device !== created.device ||
        current.inode !== created.inode ||
        current.ownerUid !== created.ownerUid
      )
        throw new Error('RESOURCE_IDENTITY_MISMATCH');
      record.identity = current;
      await this.helper.run(this.args('attest', 'objects', record));
      record.state = 'attested';
      await this.store.put(resourceId, record);
      return current;
    });
  }
  async registerProcess(runId: string, processInstanceId: string, startIdentity: string): Promise<void> {
    const journal = this.options.processJournal;
    if (!journal) throw new Error('PROCESS_JOURNAL_REQUIRED');
    const record = await journal.byInstance(processInstanceId);
    const ready = record && (await journal.ready(record));
    if (!ready || ready.startIdentity !== startIdentity) throw new Error('PROCESS_OWNERSHIP_UNKNOWN');
    await this.store.transaction(async () => {
      const id = `process:${runId}:${processInstanceId}`;
      const old = await this.store.get<ProcessOwner>(id);
      if (old && old.startIdentity !== startIdentity) throw new Error('PROCESS_OWNERSHIP_CONFLICT');
      await this.store.put(id, { formatVersion: 1, runId, processInstanceId, startIdentity });
    });
  }
  async retain(id: string, reason: string): Promise<void> {
    await this.store.transaction(async () => {
      const record = await this.resource(id);
      if (!record.retention.includes(reason)) record.retention.push(reason);
      await this.store.put(id, record);
    });
  }
  async reference(id: string, runId: string): Promise<void> {
    await this.store.transaction(async () => {
      const record = await this.resource(id);
      if (!record.references.includes(runId)) record.references.push(runId);
      await this.store.put(id, record);
    });
  }
  private async resource(id: string): Promise<Resource> {
    const record = await this.store.get<Resource>(id);
    if (!record?.resourceId) throw new Error('UNKNOWN_RESOURCE');
    return record;
  }
  private async stopped(runId: string): Promise<boolean> {
    const journal = this.options.processJournal;
    if (!journal) return false;
    const owners = (await this.store.all<ProcessOwner>()).filter(
      (record) => record.runId === runId && record.processInstanceId,
    );
    if (!owners.length) return false;
    for (const owner of owners) {
      const launch = await journal.byInstance(owner.processInstanceId);
      const ready = launch && (await journal.ready(launch));
      if (
        !launch ||
        !ready ||
        ready.startIdentity !== owner.startIdentity ||
        (await journal.observe(launch)) !== 'stopped'
      )
        return false;
    }
    return true;
  }
  async cleanup(runId: string): Promise<{ deleted: string[]; retained: string[]; failed: string[] }> {
    return this.store.transaction(async () => {
      const result = { deleted: [] as string[], retained: [] as string[], failed: [] as string[] };
      const stopped = await this.stopped(runId);
      for (const record of await this.store.all<Resource>()) {
        if (!record.resourceId || record.runId !== runId) continue;
        if (record.state === 'deleted') {
          result.deleted.push(record.resourceId);
          continue;
        }
        if (
          !stopped ||
          !record.identity ||
          record.retention.length ||
          record.references.some((ref) => ref !== runId) ||
          this.options.signal?.aborted
        ) {
          const reason = !stopped
            ? 'PROCESS_EXIT_UNPROVEN'
            : !record.identity
              ? 'RESOURCE_OWNERSHIP_UNPROVEN'
              : record.retention.length
                ? 'RETAINED_ARTIFACT'
                : record.references.some((ref) => ref !== runId)
                  ? 'RESOURCE_REFERENCED'
                  : 'CLEANUP_CANCELLED';
          if (record.lastError !== reason) {
            record.lastError = reason;
            await this.store.put(record.resourceId, record);
          }
          result.retained.push(record.resourceId);
          continue;
        }
        try {
          if (record.state === 'attested') {
            const q = this.parents.quarantine;
            try {
              await this.helper.run(
                [...this.args('quarantine', 'objects', record), q.device, q.inode],
                this.options.signal,
              );
            } catch {
              const p = this.parents.objects;
              await this.helper.run([...this.args('recover', 'quarantine', record), p.device, p.inode]);
            }
            record.state = 'quarantined';
            await this.store.put(record.resourceId, record);
            await this.options.onDurableCleanup?.('quarantined', record.resourceId);
          }
          if (this.options.signal?.aborted || !(await this.stopped(runId))) {
            record.lastError = this.options.signal?.aborted ? 'CLEANUP_CANCELLED' : 'PROCESS_EXIT_UNPROVEN';
            await this.store.put(record.resourceId, record);
            result.retained.push(record.resourceId);
            continue;
          }
          await this.helper.run(this.args('delete', 'quarantine', record), this.options.signal);
          record.state = 'deleted';
          record.lastError = null;
          await this.store.put(record.resourceId, record);
          result.deleted.push(record.resourceId);
        } catch {
          record.lastError = 'CLEANUP_IDENTITY_OR_IO_FAILURE';
          await this.store.put(record.resourceId, record);
          result.retained.push(record.resourceId);
          result.failed.push(record.resourceId);
        }
      }
      return result;
    });
  }
  close(): Promise<void> {
    return this.store.close();
  }
}
