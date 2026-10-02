import { type ChildProcess, spawn } from 'node:child_process';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_HOLDER =
  'process.stdout.write("READY\\n"); process.stdin.resume(); process.stdin.on("end", () => process.exit(0));';

export class ProcessLock {
  readonly path: string;
  private child: ChildProcess | null = null;
  private releasing = false;
  private readonly onLost: () => void;

  constructor(root: string, onLost: () => void) {
    this.path = join(root, 'host.guard');
    this.onLost = onLost;
  }

  async acquire(): Promise<void> {
    try {
      const handle = await open(this.path, 'wx', 0o600);
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stats = await lstat(this.path);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.uid !== process.getuid?.() ||
      (stats.mode & 0o077) !== 0 ||
      stats.nlink !== 1
    )
      throw new Error('Unsafe host guard');

    const command = process.platform === 'darwin' ? '/usr/bin/lockf' : '/usr/bin/flock';
    const args =
      process.platform === 'darwin'
        ? ['-k', '-n', '-t', '0', this.path, process.execPath, '-e', LOCK_HOLDER]
        : ['-n', this.path, process.execPath, '-e', LOCK_HOLDER];
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error('Host guard acquisition timed out')), 1500);
        let output = '';
        const cleanup = () => {
          clearTimeout(timer);
          child.off('error', fail);
          child.off('exit', onExit);
          child.stdout?.off('data', onData);
        };
        const fail = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onExit = (code: number | null) => fail(new Error(`Host guard unavailable (${code})`));
        const onData = (chunk: Buffer) => {
          output += chunk.toString();
          if (output.length > 64) return fail(new Error('Invalid host guard response'));
          if (output.includes('READY\n')) {
            cleanup();
            resolve();
          }
        };
        child.once('error', fail);
        child.once('exit', onExit);
        child.stdout?.on('data', onData);
      });
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('Host guard lost during acquisition');
      child.once('exit', () => {
        if (!this.releasing) this.onLost();
      });
    } catch (error) {
      this.releasing = true;
      child.stdin?.end();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      this.child = null;
      this.releasing = false;
      throw error;
    }
  }

  async release(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.releasing = true;
    this.child = null;
    if (child.exitCode === null && child.signalCode === null) {
      const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.stdin?.end();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const graceful = await Promise.race([
        ended.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 500);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (!graceful) {
        child.kill('SIGKILL');
        await ended;
      }
    }
    this.releasing = false;
  }
}
