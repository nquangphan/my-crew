import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ProcessLock } from '../host/process-lock.ts';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  throw new Error('INVALID_CANONICAL_BODY');
}
export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0 ||
    (await realpath(path)) !== resolve(path)
  )
    throw new Error('UNSAFE_PRIVATE_ROOT');
}
export async function syncDirectory(path: string): Promise<void> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
export async function writeExclusiveRecord(path: string, value: unknown): Promise<void> {
  const fd = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await fd.writeFile(canonicalJson(value));
    await fd.sync();
  } finally {
    await fd.close();
  }
  await syncDirectory(dirname(path));
}
export async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temp = join(dirname(path), `.pending-${randomUUID()}`);
  const fd = await open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await fd.writeFile(canonicalJson(value));
    await fd.sync();
  } finally {
    await fd.close();
  }
  try {
    await rename(temp, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
export async function readRecord<T>(path: string): Promise<T | null> {
  let fd: Awaited<ReturnType<typeof open>>;
  try {
    fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0)
      throw new Error('UNSAFE_RECORD');
    const value = JSON.parse(await fd.readFile('utf8'));
    if (value.formatVersion !== 1) throw new Error('UNSUPPORTED_JOURNAL_VERSION');
    return value as T;
  } finally {
    await fd.close();
  }
}
export class AtomicRecords {
  readonly root: string;
  private readonly lock: ProcessLock;
  private lost = false;
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(root: string, lock: ProcessLock) {
    this.root = root;
    this.lock = lock;
  }
  static async open(root: string): Promise<AtomicRecords> {
    await privateDirectory(root);
    const guard = join(root, '.writer');
    await privateDirectory(guard);
    let store: AtomicRecords;
    const lock = new ProcessLock(guard, () => {
      if (store) store.lost = true;
    });
    await lock.acquire();
    store = new AtomicRecords(root, lock);
    return store;
  }
  path(id: string): string {
    return join(this.root, `${hash(id)}.json`);
  }
  get<T>(id: string): Promise<T | null> {
    return readRecord(this.path(id));
  }
  async all<T>(): Promise<T[]> {
    const items: T[] = [];
    for (const name of await readdir(this.root)) {
      if (/^[0-9a-f]{64}\.json$/.test(name)) {
        const record = await readRecord<T>(join(this.root, name));
        if (record) items.push(record);
      }
    }
    return items;
  }
  transaction<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => {
      if (this.lost) throw new Error('JOURNAL_LOCK_LOST');
      return action();
    });
    this.tail = next.catch(() => {});
    return next;
  }
  async put(id: string, value: unknown): Promise<void> {
    if (this.lost) throw new Error('JOURNAL_LOCK_LOST');
    await atomicWrite(this.path(id), value);
  }
  async close(): Promise<void> {
    await this.tail;
    this.lost = true;
    await this.lock.release();
  }
}
