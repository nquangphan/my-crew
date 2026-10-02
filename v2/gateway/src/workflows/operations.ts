import { constants } from 'node:fs';
import { access, lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AtomicRecords, privateDirectory, readRecord } from '../journal/atomic-records.ts';
import { NativeHelper } from '../journal/native.ts';
export type OwnedIdentity = {
  device: string;
  inode: string;
  ownerUid: number;
  kind: 'directory';
  linkCount: number;
  bytes?: number;
};
type Layout = {
  formatVersion: 1;
  root: OwnedIdentity;
  parents: Record<'stages' | 'sources' | 'projections' | 'quarantine' | 'receipts', OwnedIdentity>;
};
async function identity(path: string): Promise<OwnedIdentity> {
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.() || (s.mode & 0o077) !== 0)
    throw new Error('OPERATION_IDENTITY_MISMATCH');
  return {
    device: String(s.dev),
    inode: String(s.ino),
    ownerUid: s.uid,
    kind: 'directory',
    linkCount: s.nlink,
  };
}
export class OwnedOperations {
  readonly root: string;
  private helper: NativeHelper;
  private layout: Layout;
  private constructor(root: string, helper: NativeHelper, layout: Layout) {
    this.root = root;
    this.helper = helper;
    this.layout = layout;
  }
  static async open(root: string, store: AtomicRecords): Promise<OwnedOperations> {
    for (const p of ['stages', 'sources', 'projections', 'quarantine', 'receipts'])
      await privateDirectory(join(root, p));
    const current: Layout = {
      formatVersion: 1,
      root: await identity(root),
      parents: {
        stages: await identity(join(root, 'stages')),
        sources: await identity(join(root, 'sources')),
        projections: await identity(join(root, 'projections')),
        quarantine: await identity(join(root, 'quarantine')),
        receipts: await identity(join(root, 'receipts')),
      },
    };
    const old = await store.get<Layout>('operation-layout');
    const comparable = (x: OwnedIdentity) => [x.device, x.inode, x.ownerUid, x.kind].join(':');
    if (
      old &&
      (comparable(old.root) !== comparable(current.root) ||
        Object.keys(current.parents).some(
          (p) =>
            comparable(current.parents[p as keyof Layout['parents']]) !==
            comparable(old.parents[p as keyof Layout['parents']]),
        ))
    )
      throw new Error('OPERATION_PARENT_MISMATCH');
    if (!old) await store.put('operation-layout', current);
    let source = fileURLToPath(new URL('./operation-native.c', import.meta.url));
    try {
      await access(source);
    } catch {
      source = fileURLToPath(new URL('../../../src/workflows/operation-native.c', import.meta.url));
    }
    const helper = await NativeHelper.build(root, source);
    return new OwnedOperations(root, helper, current);
  }
  private args(action: string, parent: keyof Layout['parents'], name: string, object?: OwnedIdentity) {
    const r = this.layout.root,
      p = this.layout.parents[parent];
    const result = [action, this.root, r.device, r.inode, parent, p.device, p.inode, name];
    if (object) result.push(object.device, object.inode, String(object.linkCount));
    return result;
  }
  async absent(parent: keyof Layout['parents'], id: string): Promise<void> {
    await this.helper.run(this.args('absent', parent, id));
  }
  async create(id: string): Promise<OwnedIdentity> {
    return JSON.parse(await this.helper.run(this.args('create', 'stages', id)));
  }
  async attest(parent: keyof Layout['parents'], name: string, ownerId: string): Promise<OwnedIdentity> {
    const i = await identity(join(this.root, parent, name));
    const fd = await open(
      join(this.root, parent, name, '.operation-owner'),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let marker: string;
    try {
      const stat = await fd.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
        throw new Error('OPERATION_OWNERSHIP_UNPROVEN');
      marker = await fd.readFile('utf8');
    } finally {
      await fd.close();
    }
    if (marker !== `${ownerId} ${i.device} ${i.inode}\n`) throw new Error('OPERATION_OWNERSHIP_UNPROVEN');
    return i;
  }
  async inspect(parent: keyof Layout['parents'], name: string, object: OwnedIdentity): Promise<number> {
    const x = JSON.parse(await this.helper.run(this.args('inspect', parent, name, object))) as OwnedIdentity;
    return x.bytes ?? 0;
  }
  async remove(
    parent: keyof Layout['parents'],
    name: string,
    object: OwnedIdentity,
    onQuarantine?: () => Promise<void>,
  ): Promise<void> {
    const q = this.layout.parents.quarantine;
    const args = this.args('quarantine', parent, name, object);
    args.push(q.device, q.inode);
    await this.helper.run(args);
    await onQuarantine?.();
    await this.helper.run(this.args('delete', 'quarantine', name, object));
  }
  async execute(
    id: string,
    object: OwnedIdentity,
    cwd: string,
    command: string[],
    timeoutSeconds = 90,
  ): Promise<ExecutionReceipt> {
    const child = await this.helper.spawn([
      ...this.args('execute', 'stages', id, object),
      this.layout.parents.receipts.device,
      this.layout.parents.receipts.inode,
      cwd,
      String(timeoutSeconds),
      ...command,
    ]);
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => (code === 0 ? resolve() : reject(new Error('EXECUTOR_RECEIPT_MISSING'))));
    });
    const receipt = await readRecord<ExecutionReceipt>(join(this.root, 'receipts', `${id}.json`));
    if (
      !receipt ||
      receipt.operationId !== id ||
      receipt.device !== object.device ||
      receipt.inode !== object.inode ||
      !receipt.treeEmpty ||
      receipt.forkObserved
    )
      throw new Error('EXECUTOR_LIFETIME_UNKNOWN');
    return receipt;
  }
  async deleteQuarantined(name: string, object: OwnedIdentity): Promise<void> {
    await this.helper.run(this.args('delete', 'quarantine', name, object));
  }
}

export type ExecutionReceipt = {
  formatVersion: 1;
  operationId: string;
  device: string;
  inode: string;
  treeEmpty: boolean;
  forkObserved: boolean;
  exitCode: number;
  timedOut: boolean;
};
