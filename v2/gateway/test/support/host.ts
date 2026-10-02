import assert from 'node:assert/strict';
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
type TestHostStatus = {
  bootId: string;
  serverConnection: string;
  bootGeneration: string | null;
  appliedConfigRevision: number | null;
};

export async function rpc<T = TestHostStatus>(
  socket: string,
  method: 'GET' | 'POST',
  route: 'status' | 'open-ui',
  credentialPath = join(socket, '..', 'client-token'),
): Promise<T> {
  const token = (await readFile(credentialPath, 'utf8')).trim();
  return new Promise<T>((resolve, reject) => {
    const client = connect(socket);
    client.setTimeout(1500, () => client.destroy(new Error('RPC timeout')));
    let response = '';
    client.on('connect', () =>
      client.write(`${JSON.stringify({ method, route, token, nonce: crypto.randomUUID() })}\n`),
    );
    client.on('data', (chunk) => {
      response += chunk;
    });
    client.on('end', () => {
      try {
        const value = JSON.parse(response);
        value.ok ? resolve(value.data) : reject(new Error(value.error));
      } catch (error) {
        reject(error);
      }
    });
    client.on('error', reject);
  });
}

export async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function quitUi(ui: ChildProcess): Promise<void> {
  if (ui.exitCode !== null) return;
  const ended = new Promise<void>((resolve) => ui.once('exit', () => resolve()));
  ui.kill('SIGKILL');
  await ended;
}

export async function launchUiFromFreshProcess(
  socket: string,
): Promise<{ process: ChildProcess; getStatus: () => Promise<TestHostStatus> }> {
  const child = spawn(process.execPath, ['test/support/ui-client.ts', socket], {
    cwd: new URL('../..', import.meta.url),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await delay(50);
  assert.ok(child.pid);
  assert.equal(await isAlive(child.pid), true);
  return { process: child, getStatus: () => rpc(socket, 'GET', 'status') };
}

export async function bootHostViaLaunchd(
  root: string,
  label: string,
): Promise<{ bootout: () => Promise<void>; isRegistered: () => Promise<boolean> }> {
  if (process.platform !== 'darwin' || !/^com\.2pcrew\.v2\.test\.[0-9a-f-]{36}$/.test(label))
    throw new Error('Unsafe launchd test label');
  const escapePlist = (value: string) =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const plist = join(root, 'test-agent.plist');
  const entry = fileURLToPath(new URL('../../dist/src/host/main.js', import.meta.url));
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${escapePlist(label)}</string><key>ProgramArguments</key><array><string>${escapePlist(process.execPath)}</string><string>${escapePlist(entry)}</string><string>${escapePlist(root)}</string></array><key>RunAtLoad</key><true/><key>StandardOutPath</key><string>${escapePlist(join(root, 'host.stdout'))}</string><key>StandardErrorPath</key><string>${escapePlist(join(root, 'host.stderr'))}</string></dict></plist>`;
  await writeFile(plist, body, { mode: 0o600, flag: 'wx' });
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('Missing process UID');
  const target = `gui/${uid}/${label}`;
  let booted = false;
  const bootout = async () => {
    if (!booted) return;
    await execute('launchctl', ['bootout', target]);
    booted = false;
    await unlink(plist);
  };
  try {
    await execute('launchctl', ['bootstrap', `gui/${uid}`, plist]);
    booted = true;
    for (let i = 0; i < 100; i++) {
      if (existsSync(join(root, 'host.sock')))
        return {
          bootout,
          isRegistered: async () =>
            execute('launchctl', ['print', target]).then(
              () => true,
              () => false,
            ),
        };
      await delay(50);
    }
    throw new Error(
      `LaunchAgent did not bind socket: ${await readFile(join(root, 'host.stderr'), 'utf8').catch(() => '')}`,
    );
  } catch (error) {
    await bootout();
    throw error;
  }
}
