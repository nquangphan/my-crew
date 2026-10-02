import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { GatewayRpcServer } from '../ipc/server.ts';
import { ProcessLock } from './process-lock.ts';
import { type GatewayStatus, initialStatus } from './status.ts';

const execute = promisify(execFile);
type Identity = { dev: number; ino: number; uid: number };

export class GatewayHost {
  readonly root: string;
  readonly rpc: GatewayRpcServer;
  private readonly status: GatewayStatus = initialStatus();
  private readonly lock: ProcessLock;
  private rootIdentity: Identity | null = null;

  constructor(root = join(homedir(), 'Library', 'Application Support', '2PCrewV2', 'gateway')) {
    this.root = root;
    this.rpc = new GatewayRpcServer({ root, getStatus: () => this.getStatus() });
    this.lock = new ProcessLock(root, () => {
      void this.rpc.stop({ drain: false }).finally(() => process.exit(1));
    });
  }

  getStatus(): GatewayStatus {
    return structuredClone(this.status);
  }

  async start(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.root);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      stats.uid !== process.getuid?.() ||
      (stats.mode & 0o077) !== 0
    )
      throw new Error('Unsafe gateway state directory');
    this.rootIdentity = { dev: stats.dev, ino: stats.ino, uid: stats.uid };
    await this.lock.acquire();
    try {
      await this.assertRootIdentity();
      await this.removeProvenLegacyResidue();
      await this.rpc.start();
    } catch (error) {
      await this.lock.release();
      throw error;
    }
  }

  async stop(options: { drain: boolean }): Promise<void> {
    await this.assertRootIdentity();
    await this.rpc.stop(options);
    await this.assertRootIdentity();
    await this.lock.release();
  }

  private async assertRootIdentity(): Promise<void> {
    const stats = await lstat(this.root);
    const original = this.rootIdentity;
    if (
      !original ||
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      stats.dev !== original.dev ||
      stats.ino !== original.ino ||
      stats.uid !== original.uid ||
      (stats.mode & 0o077) !== 0
    )
      throw new Error('Gateway root identity changed');
  }

  private async noOpenHandles(path: string): Promise<void> {
    const command = process.platform === 'darwin' ? '/usr/sbin/lsof' : '/usr/bin/lsof';
    try {
      const { stdout } = await execute(command, ['-t', '--', path], { timeout: 1000 });
      if (stdout.trim()) throw new Error('Legacy host resource still open');
      throw new Error('Cannot prove legacy resource is unused');
    } catch (error) {
      const result = error as { code?: string | number; stdout?: string; stderr?: string };
      if (result.code === 1 && !result.stdout?.trim() && !result.stderr?.trim()) return;
      throw error;
    }
  }

  private async removeProvenLegacyResidue(): Promise<void> {
    const names = ['host.lock', 'host-recovery.lock', 'host.sock', 'client-token'] as const;
    const present: { path: string; dev: number; ino: number }[] = [];
    for (const name of names) {
      await this.assertRootIdentity();
      const path = join(this.root, name);
      const stats = await lstat(path).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!stats) continue;
      const expectedKind = name === 'host.sock' ? stats.isSocket() : stats.isFile();
      if (
        !expectedKind ||
        stats.isSymbolicLink() ||
        stats.uid !== process.getuid?.() ||
        (stats.mode & 0o077) !== 0 ||
        stats.nlink !== 1
      )
        throw new Error(`Unsafe legacy host resource: ${name}`);
      if (name === 'host.lock') {
        const body = (await readFile(path, 'utf8')).trim();
        if (body) {
          const pid = Number(body);
          if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Unknown legacy host PID');
          try {
            process.kill(pid, 0);
            throw new Error('Legacy gateway host may still be running');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          }
        }
      }
      await this.noOpenHandles(path);
      present.push({ path, dev: stats.dev, ino: stats.ino });
    }
    for (const item of present) {
      await this.assertRootIdentity();
      const current = await lstat(item.path);
      if (current.dev !== item.dev || current.ino !== item.ino)
        throw new Error('Legacy resource identity changed');
      await unlink(item.path);
    }
  }
}
