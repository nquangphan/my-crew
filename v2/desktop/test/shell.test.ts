import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GatewayClient } from '../src/main/client.ts';
import { createShellHandlers, navigationAllowed, secureWindowOptions } from '../src/main/security.ts';
import preload from '../src/preload/index.cjs';

const { createPreloadApi } = preload;

test('shell: forged renderer sender and remote origin cannot invoke host RPC', async () => {
  const calls: string[] = [];
  const handlers = createShellHandlers({
    trustedWebContentsId: 17,
    trustedUrl: 'file:///private/crew/index.html',
    host: {
      getStatus: async () => {
        calls.push('status');
        return { bootId: 'host-1' };
      },
      openDashboard: async () => {
        calls.push('open');
        return 'https://crew.example/';
      },
    },
    openExternal: async () => {
      calls.push('browser');
    },
  });
  const valid = {
    sender: { id: 17, getURL: () => 'file:///private/crew/index.html' },
    senderFrame: { url: 'file:///private/crew/index.html' },
  };
  assert.deepEqual(await handlers.getStatus(valid), { bootId: 'host-1' });
  await assert.rejects(
    handlers.getStatus({ ...valid, sender: { id: 18, getURL: valid.sender.getURL } }),
    /UNTRUSTED_SENDER/,
  );
  await assert.rejects(
    handlers.openDashboard({ ...valid, senderFrame: { url: 'https://attacker.example/' } }),
    /UNTRUSTED_SENDER/,
  );
  await assert.rejects(
    handlers.openDashboard({ ...valid, sender: { id: 17, getURL: () => 'https://attacker.example/' } }),
    /UNTRUSTED_SENDER/,
  );
  assert.deepEqual(calls, ['status']);
});

test('shell: preload offers only status and browser action', async () => {
  const channels: string[] = [];
  const api = createPreloadApi({
    invoke: async (channel: string) => {
      channels.push(channel);
      return channel;
    },
  });
  assert.deepEqual(Object.keys(api).sort(), ['getStatus', 'openDashboard']);
  assert.equal(await api.getStatus(), 'crew:get-status');
  assert.equal(await api.openDashboard(), 'crew:open-dashboard');
  assert.deepEqual(channels, ['crew:get-status', 'crew:open-dashboard']);
});

test('shell: remote navigation is denied and window has no Node access', () => {
  const options = secureWindowOptions('/private/crew/preload.js');
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(navigationAllowed('file:///private/crew/index.html', 'https://attacker.example/'), false);
  assert.equal(
    navigationAllowed('file:///private/crew/index.html', 'file:///private/crew/other.html'),
    false,
  );
});

test('shell: client rejects a forged regular file in place of host socket', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crew-v2-desktop-socket-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'client-token'), '0'.repeat(64), { mode: 0o600 });
  await writeFile(join(root, 'host.sock'), 'not a socket', { mode: 0o600 });
  await assert.rejects(new GatewayClient(root).getStatus(), /UNTRUSTED_HOST_SOCKET/);
});
