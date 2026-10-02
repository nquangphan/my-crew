import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { atomicWrite, hash, privateDirectory, readRecord, syncDirectory } from './atomic-records.ts';

const execute = promisify(execFile);
type Attestation = {
  formatVersion: 1;
  sourceHash: string;
  binaryHash: string;
  device: string;
  inode: string;
  uid: number;
  parentDevice: string;
  parentInode: string;
};
export class NativeHelper {
  private readonly path: string;
  private readonly attestation: Attestation;
  private constructor(path: string, attestation: Attestation) {
    this.path = path;
    this.attestation = attestation;
  }
  static async build(root: string, sourcePath: string): Promise<NativeHelper> {
    if (process.platform !== 'darwin') throw new Error('NATIVE_HELPER_UNAVAILABLE');
    await privateDirectory(root);
    const sourceBytes = await readFile(sourcePath);
    const sourceHash = hash(sourceBytes);
    const cache = join(root, 'native', sourceHash);
    await privateDirectory(cache);
    const path = join(cache, 'helper');
    const metadata = join(cache, 'attestation.json');
    let attestation = await readRecord<Attestation>(metadata);
    if (!attestation) {
      const snapshot = join(cache, `source-${randomUUID()}.c`);
      const sourceHandle = await open(
        snapshot,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await sourceHandle.writeFile(sourceBytes);
        await sourceHandle.sync();
      } finally {
        await sourceHandle.close();
      }
      const temp = join(cache, `build-${randomUUID()}`);
      await execute('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-O2', snapshot, '-o', temp], {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      await chmod(temp, 0o700);
      const fd = await open(temp, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await fd.sync();
      } finally {
        await fd.close();
      }
      await rename(temp, path);
      await syncDirectory(cache);
      const stat = await lstat(path);
      attestation = {
        formatVersion: 1,
        sourceHash,
        binaryHash: hash(await readFile(path)),
        device: String(stat.dev),
        inode: String(stat.ino),
        uid: stat.uid,
        parentDevice: String((await lstat(cache)).dev),
        parentInode: String((await lstat(cache)).ino),
      };
      await atomicWrite(metadata, attestation);
    }
    if (attestation.sourceHash !== sourceHash) throw new Error('NATIVE_SOURCE_MISMATCH');
    const helper = new NativeHelper(path, attestation);
    await helper.verify();
    return helper;
  }
  private async verify(): Promise<void> {
    await privateDirectory(dirname(this.path));
    const parent = await lstat(dirname(this.path));
    if (
      String(parent.dev) !== this.attestation.parentDevice ||
      String(parent.ino) !== this.attestation.parentInode
    )
      throw new Error('NATIVE_ROOT_MISMATCH');
    const fd = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0 ||
        String(stat.dev) !== this.attestation.device ||
        String(stat.ino) !== this.attestation.inode ||
        stat.uid !== this.attestation.uid ||
        hash(await fd.readFile()) !== this.attestation.binaryHash
      )
        throw new Error('NATIVE_BINARY_MISMATCH');
    } finally {
      await fd.close();
    }
  }
  async spawn(args: string[]): Promise<ChildProcess> {
    await this.verify();
    return spawn(this.path, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  }
  async run(args: string[], signal?: AbortSignal): Promise<string> {
    await this.verify();
    const result = await execute(this.path, args, { timeout: 10000, maxBuffer: 1024 * 1024, signal });
    await this.verify();
    return result.stdout.trim();
  }
}
export type NativeProcessIdentity = { pid: number; uid: number; processGroupId: number; birth: string };
export class ProcessIdentity {
  private readonly helper: NativeHelper;
  private constructor(helper: NativeHelper) {
    this.helper = helper;
  }
  static async open(root: string, sourcePath: string): Promise<ProcessIdentity> {
    return new ProcessIdentity(await NativeHelper.build(root, sourcePath));
  }
  async supervise(command: string[]): Promise<ChildProcess> {
    return this.helper.spawn(['supervise', ...command]);
  }
  async probe(pid: number): Promise<NativeProcessIdentity | null> {
    try {
      return JSON.parse(await this.helper.run(['identity', String(pid)]));
    } catch {
      return null;
    }
  }
  async groupEmpty(group: number): Promise<boolean> {
    try {
      return (await this.helper.run(['group', String(group)])) === '0';
    } catch {
      return false;
    }
  }
}
