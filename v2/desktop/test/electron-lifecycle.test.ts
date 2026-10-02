import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { rpc } from '../../gateway/test/support/host.ts';

const electronPath = createRequire(import.meta.url)('electron') as string;

async function waitReady(child: ChildProcess): Promise<string> {
  return new Promise<string>((resolveReady, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error(`Electron window did not report ready: ${output}`)),
      8000,
    );
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
      const ready = output.match(/CREW_V2_TEST_WINDOW_READY:([0-9a-f-]{36})/);
      if (ready) {
        clearTimeout(timer);
        resolveReady(ready[1]);
      }
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Electron main exited before window ready (${code}): ${output}`));
    });
  });
}

test('electron lifecycle: real window close, main crash and fresh reopen keep host boot', {
  skip: process.platform !== 'darwin' ? 'macOS Electron window requires Darwin' : false,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crew-v2-electron-'));
  const socket = join(root, 'host.sock');
  const gatewayDir = resolve('..', 'gateway');
  const host = spawn(process.execPath, ['dist/src/host/main.js', root], { cwd: gatewayDir, stdio: 'ignore' });
  const children: ChildProcess[] = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null) {
        const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
        child.kill('SIGKILL');
        await Promise.race([exited, delay(2000)]);
      }
    }
    if (host.exitCode === null) {
      const exited = new Promise((resolveExit) => host.once('exit', resolveExit));
      host.kill('SIGTERM');
      await Promise.race([exited, delay(2000)]);
    }
    await rm(root, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !existsSync(socket); i++) await delay(25);
  const boot = await rpc(socket, 'GET', 'status');
  const launch = async () => {
    const child = spawn(electronPath, ['.'], {
      cwd: resolve('.'),
      env: { ...process.env, CREW_V2_GATEWAY_ROOT: root, CREW_V2_TEST_LIFECYCLE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    const observedBoot = await waitReady(child);
    assert.equal(observedBoot, boot.bootId, 'real renderer must read host through preload and main IPC');
    return child;
  };
  const closed = await launch();
  const closedExit = new Promise((resolveExit) => closed.once('exit', resolveExit));
  closed.kill('SIGUSR2');
  await Promise.race([
    closedExit,
    delay(5000).then(() => {
      throw new Error('Electron main did not exit after BrowserWindow.close()');
    }),
  ]);
  assert.equal((await rpc(socket, 'GET', 'status')).bootId, boot.bootId);
  const hostPid = host.pid;
  assert.ok(hostPid);
  assert.doesNotThrow(() => process.kill(hostPid, 0));
  const crashed = await launch();
  const crashExit = new Promise((resolveExit) => crashed.once('exit', resolveExit));
  crashed.kill('SIGKILL');
  await Promise.race([
    crashExit,
    delay(5000).then(() => {
      throw new Error('Electron main did not exit after SIGKILL');
    }),
  ]);
  const reopened = await launch();
  assert.equal((await rpc(socket, 'GET', 'status')).bootId, boot.bootId);
  assert.equal(reopened.exitCode, null);
});
