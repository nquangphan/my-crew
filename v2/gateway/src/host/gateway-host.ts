import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GatewayRpcServer } from '../ipc/server.ts';
import { type GatewayStatus, initialStatus } from './status.ts';

export class GatewayHost {
  readonly root: string;
  readonly rpc: GatewayRpcServer;
  private readonly status: GatewayStatus = initialStatus();
  private lock: Awaited<ReturnType<typeof open>> | null = null;

  constructor(root = join(homedir(), 'Library', 'Application Support', '2PCrewV2', 'gateway')) {
    this.root = root;
    this.rpc = new GatewayRpcServer({ root, getStatus: () => this.getStatus() });
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
    this.lock = await this.acquireLock();
    try {
      await this.lock.writeFile(String(process.pid));
      await this.lock.sync();
      await this.rpc.start();
    } catch (error) {
      await this.stop({ drain: false });
      throw error;
    }
  }

  async stop(_options: { drain: boolean }): Promise<void> {
    await this.rpc.stop();
    if (this.lock) {
      await this.lock.close();
      this.lock = null;
      await unlink(join(this.root, 'host.lock'));
    }
  }

  private async acquireLock(): Promise<Awaited<ReturnType<typeof open>>> {
    const path = join(this.root, 'host.lock');
    try {
      return await open(path, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const recoveryPath = join(this.root, 'host-recovery.lock');
    const recovery = await open(recoveryPath, 'wx', 0o600);
    try {
      const lockStat = await lstat(path);
      if (!lockStat.isFile() || lockStat.isSymbolicLink() || lockStat.uid !== process.getuid?.())
        throw new Error('Unsafe host lock');
      const pid = Number((await readFile(path, 'utf8')).trim());
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid host lock PID');
      try {
        process.kill(pid, 0);
        throw new Error('Gateway host already running');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      for (const [name, kind] of [
        ['host.sock', 'socket'],
        ['client-token', 'file'],
      ] as const) {
        const child = join(this.root, name);
        const stats = await lstat(child).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (!stats) continue;
        if (
          stats.uid !== process.getuid?.() ||
          stats.isSymbolicLink() ||
          (kind === 'socket' ? !stats.isSocket() : !stats.isFile())
        )
          throw new Error('Unsafe stale host resource');
        await unlink(child);
      }
      await unlink(path);
      return await open(path, 'wx', 0o600);
    } finally {
      await recovery.close();
      await unlink(recoveryPath);
    }
  }
}
