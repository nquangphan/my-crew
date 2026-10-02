import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ProcessLock } from '../src/host/process-lock.ts';
import { initialStatus } from '../src/host/status.ts';
import { GatewayRpcServer } from '../src/ipc/server.ts';
import { rpc } from './support/host.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'crew-v2-host-failure-'));
  const socket = join(root, 'host.sock');
  const children: ChildProcess[] = [];
  const spawnHost = () => {
    const child = spawn(process.execPath, ['dist/src/host/main.js', root], {
      cwd: new URL('..', import.meta.url),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    children.push(child);
    return child;
  };
  const waitForHost = async (child: ChildProcess) => {
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error(`host exited ${child.exitCode}`);
      if (existsSync(socket)) {
        try {
          return await rpc(socket, 'GET', 'status');
        } catch {
          /* startup */
        }
      }
      await delay(25);
    }
    throw new Error('host did not answer RPC');
  };
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGKILL');
        await ended;
      }
    }
    await rm(root, { recursive: true, force: true });
  });
  return { root, socket, spawnHost, waitForHost };
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`deadline ${ms}ms exceeded`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test('oversized second frame cannot crash host or replace boot', async (t) => {
  const f = await fixture(t);
  const host = f.spawnHost();
  const boot = await f.waitForHost(host);
  const client = connect({ path: f.socket, allowHalfOpen: true });
  client.on('error', () => {});
  t.after(() => client.destroy());
  await new Promise<void>((resolve) => client.once('connect', () => resolve()));
  client.write('a'.repeat(9000));
  await within(new Promise<void>((resolve) => client.once('data', () => resolve())), 1000);
  client.write('b'.repeat(9000));
  await delay(100);
  assert.equal(host.exitCode, null);
  assert.equal((await rpc(f.socket, 'GET', 'status')).bootId, boot.bootId);
});

test('absolute frame deadline closes a drip client despite continuing bytes', async (t) => {
  const f = await fixture(t);
  const host = f.spawnHost();
  await f.waitForHost(host);
  const client = connect(f.socket);
  client.on('error', () => {});
  t.after(() => client.destroy());
  await new Promise<void>((resolve) => client.once('connect', () => resolve()));
  const tick = setInterval(() => {
    if (!client.destroyed) client.write('x');
  }, 100);
  t.after(() => clearInterval(tick));
  await within(new Promise<void>((resolve) => client.once('close', () => resolve())), 2000);
});

test('SIGTERM stops with an unfinished frame and a new host binds', async (t) => {
  const f = await fixture(t);
  const first = f.spawnHost();
  const boot = await f.waitForHost(first);
  const client = connect(f.socket);
  client.on('error', () => {});
  t.after(() => client.destroy());
  await new Promise<void>((resolve) => client.once('connect', () => resolve()));
  const tick = setInterval(() => {
    if (!client.destroyed) client.write('x');
  }, 100);
  t.after(() => clearInterval(tick));
  const exited = new Promise((resolve) => first.once('exit', resolve));
  first.kill('SIGTERM');
  await within(exited, 1200);
  assert.equal(existsSync(f.socket), false);
  assert.equal(existsSync(join(f.root, 'client-token')), false);
  const second = f.spawnHost();
  assert.notEqual((await f.waitForHost(second)).bootId, boot.bootId);
});

test('crash residue in recovery and empty init lock does not wedge reboot', async (t) => {
  const f = await fixture(t);
  const first = f.spawnHost();
  const boot = await f.waitForHost(first);
  const guardBeforeCrash = await lstat(join(f.root, 'host.guard'));
  const exited = new Promise((resolve) => first.once('exit', resolve));
  first.kill('SIGKILL');
  await exited;
  const guardAfterCrash = await lstat(join(f.root, 'host.guard'));
  assert.equal(guardAfterCrash.dev, guardBeforeCrash.dev);
  assert.equal(guardAfterCrash.ino, guardBeforeCrash.ino);
  await writeFile(join(f.root, 'host-recovery.lock'), '', { mode: 0o600 });
  const second = f.spawnHost();
  assert.notEqual((await f.waitForHost(second)).bootId, boot.bootId);
  const guardAfterReboot = await lstat(join(f.root, 'host.guard'));
  assert.equal(guardAfterReboot.dev, guardBeforeCrash.dev);
  assert.equal(guardAfterReboot.ino, guardBeforeCrash.ino);
});

test('empty host lock from interrupted initialization is recoverable', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'host.lock'), '', { mode: 0o600 });
  const host = f.spawnHost();
  assert.ok((await f.waitForHost(host)).bootId);
});

test('live contender cannot take over host or change its socket', async (t) => {
  const f = await fixture(t);
  const owner = f.spawnHost();
  const boot = await f.waitForHost(owner);
  const contender = f.spawnHost();
  await within(new Promise((resolve) => contender.once('exit', resolve)), 1200);
  assert.notEqual(contender.exitCode, 0);
  assert.equal((await rpc(f.socket, 'GET', 'status')).bootId, boot.bootId);
});

test('unknown symlink recovery residue is not deleted or followed', async (t) => {
  const f = await fixture(t);
  const marker = join(f.root, 'marker');
  await writeFile(marker, 'untouched');
  await symlink(marker, join(f.root, 'host-recovery.lock'));
  await writeFile(join(f.root, 'host.lock'), '', { mode: 0o600 });
  const host = f.spawnHost();
  await within(new Promise((resolve) => host.once('exit', resolve)), 1200);
  assert.notEqual(host.exitCode, 0);
  assert.equal(await readFile(marker, 'utf8'), 'untouched');
  assert.equal((await lstat(join(f.root, 'host-recovery.lock'))).isSymbolicLink(), true);
});

test('stop drains a stalled dispatch only until its bounded deadline', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crew-v2-host-drain-'));
  const server = new GatewayRpcServer({
    root,
    getStatus: initialStatus,
    openUi: () => new Promise<string>(() => {}),
  });
  t.after(async () => {
    await server.stop({ drain: false });
    await rm(root, { recursive: true, force: true });
  });
  await server.start();
  const client = connect(server.socketPath);
  client.on('error', () => {});
  t.after(() => client.destroy());
  await new Promise<void>((resolve) => client.once('connect', resolve));
  const token = (await readFile(server.tokenPath, 'utf8')).trim();
  client.write(
    `${JSON.stringify({ method: 'POST', route: 'open-ui', token, nonce: crypto.randomUUID() })}\n`,
  );
  await delay(30);
  const started = performance.now();
  await within(server.stop({ drain: true }), 1000);
  assert.ok(performance.now() - started < 700);
  assert.equal(existsSync(server.socketPath), false);
  assert.equal(existsSync(server.tokenPath), false);
});

test('macOS guard retains one inode across release and old-fd contender ordering', {
  skip: process.platform !== 'darwin' ? 'macOS lockf semantics' : false,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crew-v2-lockf-inode-'));
  const first = new ProcessLock(root, () => {});
  const next = new ProcessLock(root, () => {});
  let holder: ChildProcess | undefined;
  await first.acquire();
  const oldFd = await open(first.path, 'r');
  t.after(async () => {
    await first.release();
    await next.release();
    if (holder && holder.exitCode === null && holder.signalCode === null) {
      const exited = new Promise((resolve) => holder?.once('exit', resolve));
      holder.stdin?.end();
      await within(exited, 1000);
    }
    await oldFd.close();
    await rm(root, { recursive: true, force: true });
  });
  const original = await lstat(first.path);
  assert.equal((await oldFd.stat()).ino, original.ino);
  await first.release();
  const afterRelease = await lstat(first.path);
  assert.equal(afterRelease.dev, original.dev);
  assert.equal(afterRelease.ino, original.ino);

  holder = spawn(
    '/usr/bin/lockf',
    [
      '-t',
      '0',
      '/dev/fd/3',
      process.execPath,
      '-e',
      'process.stdout.write("READY\\n");process.stdin.resume();process.stdin.on("end",()=>process.exit(0));',
    ],
    { stdio: ['pipe', 'pipe', 'pipe', oldFd.fd] },
  );
  await within(
    new Promise<void>((resolve, reject) => {
      holder?.once('error', reject);
      holder?.once('exit', (code) => reject(new Error(`old-fd holder exited ${code}`)));
      holder?.stdout?.once('data', (data: Buffer) => {
        if (data.toString().includes('READY\n')) resolve();
        else reject(new Error('old-fd holder did not signal READY'));
      });
    }),
    1000,
  );

  await assert.rejects(within(next.acquire(), 1000), /Host guard unavailable/);
  assert.equal(holder.exitCode, null);
  assert.equal((await lstat(first.path)).ino, original.ino);
  const holderExited = new Promise((resolve) => holder?.once('exit', resolve));
  holder.stdin?.end();
  await within(holderExited, 1000);
  await next.acquire();
  const afterReacquire = await lstat(first.path);
  assert.equal(afterReacquire.dev, original.dev);
  assert.equal(afterReacquire.ino, original.ino);
});
