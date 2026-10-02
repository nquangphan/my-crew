import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { bootHostViaLaunchd, isAlive, launchUiFromFreshProcess, quitUi, rpc } from './support/host.ts';

test('host lifecycle: UI main exit and reopen preserve independent host boot', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crew-v2-gateway-test-'));
  const socket = join(root, 'host.sock');
  const launchMarker = join(root, 'launch-record.json');
  await import('node:fs/promises').then((fs) => fs.writeFile(launchMarker, '{"launch":"kept"}'));
  let host = spawn(process.execPath, ['dist/src/host/main.js', root], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stop = async () => {
    const pid = host.pid;
    if (pid && (await isAlive(pid))) {
      const exit = new Promise((resolve) => host.once('exit', resolve));
      host.kill('SIGTERM');
      await exit;
    }
  };
  t.after(async () => {
    await stop();
    await rm(root, { recursive: true, force: true });
  });
  for (let i = 0; i < 100; i++) {
    if (await import('node:fs').then((fs) => fs.existsSync(socket))) break;
    await delay(25);
  }
  const boot = await rpc(socket, 'GET', 'status');
  assert.equal(boot.serverConnection, 'unconfigured');
  assert.equal(boot.bootGeneration, null);
  assert.equal(boot.appliedConfigRevision, null);
  assert.equal((await lstat(socket)).mode & 0o777, 0o600);
  assert.equal((await lstat(join(root, 'client-token'))).mode & 0o777, 0o600);
  await assert.rejects(rpc(socket, 'POST', 'open-ui'), /NOT_CONFIGURED/);
  const ui = await launchUiFromFreshProcess(socket);
  await quitUi(ui.process);
  assert.equal((await rpc(socket, 'GET', 'status')).bootId, boot.bootId);
  assert.ok(host.pid);
  assert.equal(await isAlive(host.pid), true);
  const reopened = await launchUiFromFreshProcess(socket);
  assert.equal((await reopened.getStatus()).bootId, boot.bootId);
  await quitUi(reopened.process);
  await stop();
  host = spawn(process.execPath, ['dist/src/host/main.js', root], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 100; i++) {
    if (await import('node:fs').then((fs) => fs.existsSync(socket))) break;
    await delay(25);
  }
  const newBoot = await rpc(socket, 'GET', 'status');
  assert.notEqual(newBoot.bootId, boot.bootId);
  assert.equal(await readFile(launchMarker, 'utf8'), '{"launch":"kept"}');
});

test('host lifecycle: preexisting token symlink cannot overwrite another file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crew-v2-gateway-symlink-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, 'marker');
  await writeFile(marker, 'untouched');
  await symlink(marker, join(root, 'client-token'));
  const host = spawn(process.execPath, ['dist/src/host/main.js', root], {
    cwd: new URL('..', import.meta.url),
    stdio: 'ignore',
  });
  t.after(() => {
    if (host.exitCode === null) host.kill('SIGKILL');
  });
  await Promise.race([new Promise((resolve) => host.once('exit', resolve)), delay(500)]);
  assert.equal(await readFile(marker, 'utf8'), 'untouched');
});

test('host lifecycle: unauthenticated socket client cannot read status', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crew-v2-gateway-auth-'));
  const host = spawn(process.execPath, ['dist/src/host/main.js', root], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    host.kill('SIGTERM');
    await rm(root, { recursive: true, force: true });
  });
  const socket = join(root, 'host.sock');
  for (let i = 0; i < 100; i++) {
    if (await import('node:fs').then((fs) => fs.existsSync(socket))) break;
    await delay(25);
  }
  const reply = await new Promise<string>((resolve, reject) => {
    const client = connect(socket);
    let text = '';
    client.on('connect', () =>
      client.write('{"method":"GET","route":"status","token":"forged","nonce":"test"}\n'),
    );
    client.on('data', (chunk) => {
      text += chunk;
    });
    client.on('end', () => resolve(text));
    client.on('error', reject);
  });
  assert.equal(JSON.parse(reply).error, 'UNAUTHORIZED');
});

test('host lifecycle: crash leaves recoverable lock and a new boot can bind the socket', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crew-v2-gateway-crash-'));
  let host = spawn(process.execPath, ['dist/src/host/main.js', root], {
    cwd: new URL('..', import.meta.url),
    stdio: 'ignore',
  });
  t.after(async () => {
    host.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  });
  const socket = join(root, 'host.sock');
  for (let i = 0; i < 100; i++) {
    if (await import('node:fs').then((fs) => fs.existsSync(socket))) break;
    await delay(25);
  }
  const first = await rpc(socket, 'GET', 'status');
  const exited = new Promise((resolve) => host.once('exit', resolve));
  host.kill('SIGKILL');
  await exited;
  host = spawn(process.execPath, ['dist/src/host/main.js', root], {
    cwd: new URL('..', import.meta.url),
    stdio: 'ignore',
  });
  let next: { bootId: string } | undefined;
  for (let i = 0; i < 100; i++) {
    try {
      next = await rpc(socket, 'GET', 'status');
      break;
    } catch {
      await delay(25);
    }
  }
  assert.ok(next, 'restarted host must answer RPC');
  assert.notEqual(next.bootId, first.bootId);
  assert.ok(host.pid);
  assert.equal(await isAlive(host.pid), true);
});

test('host lifecycle: transient macOS user agent owns host after client exits', {
  skip: process.platform !== 'darwin' ? 'launchctl user agent requires macOS' : false,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crew-v2-launchd-'));
  const label = `com.2pcrew.v2.test.${crypto.randomUUID()}`;
  let agent: Awaited<ReturnType<typeof bootHostViaLaunchd>> | undefined;
  t.after(async () => {
    await agent?.bootout();
    await rm(root, { recursive: true, force: true });
  });
  agent = await bootHostViaLaunchd(root, label);
  const socket = join(root, 'host.sock');
  const before = await rpc(socket, 'GET', 'status');
  const ui = await launchUiFromFreshProcess(socket);
  await quitUi(ui.process);
  assert.equal((await rpc(socket, 'GET', 'status')).bootId, before.bootId);
  assert.equal(await agent.isRegistered(), true);
});
