import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { CredentialBroker, type SecretTransport } from '../src/models/credential-broker.ts';
import type { SecurityBridge } from '../src/models/security-bridge.ts';
import { modelFixtureRoot, removeModelFixture } from './support/model-fixture.ts';

class FakeSecurity implements SecurityBridge {
  readonly items = new Map<string, Buffer>();
  async put(service: string, account: string, value: Buffer) {
    this.items.set(`${service}/${account}`, Buffer.from(value));
  }
  async read(service: string, account: string) {
    const b = this.items.get(`${service}/${account}`);
    return b ? Buffer.from(b) : null;
  }
  async remove(service: string, account: string) {
    this.items.delete(`${service}/${account}`);
  }
}
test('credential broker scopes updates by machine/provider/operation and removes idempotently', async () => {
  const bridge = new FakeSecurity(),
    machine = randomUUID(),
    provider = randomUUID(),
    operation = randomUUID();
  const broker = new CredentialBroker(machine, bridge, []);
  const a = await broker.put(provider, Buffer.from('fixture-secret'), operation);
  assert.match(a, /^[A-Za-z0-9_-]{1,200}$/);
  assert.equal(await broker.put(provider, Buffer.from('fixture-secret'), operation), a);
  assert.equal(bridge.items.size, 1);
  const storedKey = [...bridge.items.keys()][0];
  assert.ok(storedKey);
  assert.match(storedKey, new RegExp(`^com.2pcrew.v2.${machine}.${provider}/`));
  await assert.rejects(broker.put(provider, Buffer.from('different'), operation), /CONFLICT/);
  await broker.remove(a);
  await broker.remove(a);
  assert.equal(bridge.items.size, 0);
  const other = new CredentialBroker(randomUUID(), bridge, []);
  await assert.rejects(other.remove(a), /INVALID_CREDENTIAL_REF/);
});
test('credential broker one-use channel rejects unpinned callbacks and suppresses secret errors/results', async () => {
  const bridge = new FakeSecurity();
  let received = '';
  const trusted: SecretTransport = async (channel) => {
    for await (const chunk of channel) received += chunk.toString();
    throw new Error(received);
  };
  const broker = new CredentialBroker(randomUUID(), bridge, [trusted]);
  const ref = await broker.put(randomUUID(), Buffer.from('no-log-fixture'));
  await assert.rejects(
    broker.withSecret(ref, async () => {}),
    /UNTRUSTED_TRANSPORT/,
  );
  await assert.rejects(
    broker.withSecret(ref, trusted),
    (e) => e instanceof Error && e.message === 'CREDENTIAL_TRANSPORT_FAILED',
  );
  assert.equal(received, 'no-log-fixture');
});

export { FakeSecurity };

import { SecurityFrameworkBridge } from '../src/models/security-bridge.ts';

test('credential broker native bridge rejects unverified helper before any keychain access', async () => {
  const native = new SecurityFrameworkBridge({
    path: '/nonexistent/crew-owned-helper',
    sha256: '0'.repeat(64),
  });
  await assert.rejects(
    native.put('com.2pcrew.v2.machine.provider', 'operation', Buffer.from('no-keychain-fixture')),
    (e) => e instanceof Error && e.message === 'SECURITY_BRIDGE_UNVERIFIED',
  );
});
test('credential broker serializes conflicting local writes and never returns bridge secret errors', async () => {
  const bridge = new FakeSecurity(),
    broker = new CredentialBroker(randomUUID(), bridge, []),
    provider = randomUUID(),
    operation = randomUUID();
  const results = await Promise.allSettled([
    broker.put(provider, Buffer.from('first'), operation),
    broker.put(provider, Buffer.from('second'), operation),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  const bad: SecurityBridge = {
    read: async () => {
      throw new Error('plaintext fixture secret');
    },
    put: async () => {},
    remove: async () => {
      throw new Error('plaintext fixture secret');
    },
  };
  const denied = new CredentialBroker(randomUUID(), bad, []);
  await assert.rejects(
    denied.put(provider, Buffer.from('fixture')),
    (e) => e instanceof Error && e.message === 'CREDENTIAL_STORE_FAILED',
  );
});

import { execFile } from 'node:child_process';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { hash } from '../src/journal/atomic-records.ts';

test('credential broker native FD framing runs only against unsigned owned fake helper', {
  skip: process.platform !== 'darwin',
}, async () => {
  const root = await modelFixtureRoot('credential-broker');
  const helper = join(root, 'fake-security-channel');
  try {
    await promisify(execFile)('/usr/bin/clang', [
      '-Wall',
      '-Wextra',
      '-Werror',
      new URL('./fixtures/models/security-channel.c', import.meta.url).pathname,
      '-o',
      helper,
    ]);
    await chmod(helper, 0o700);
    const pids: number[] = [];
    const sha256 = hash(await readFile(helper)),
      native = new SecurityFrameworkBridge({
        path: helper,
        sha256,
        signedAclVerified: async (input) => {
          assert.equal(input.sha256, sha256);
          assert.ok(input.pid > 0);
          pids.push(input.pid);
          console.log(
            JSON.stringify({
              type: 'task2-owned-process',
              action: 'fake-helper-created',
              pid: input.pid,
              helper,
            }),
          );
          return true;
        },
      });
    await native.put('com.2pcrew.v2.fixture.provider', 'fixture-operation', Buffer.from('channel-fixture'));
    const bytes = await native.read('com.2pcrew.v2.fixture.provider', 'fixture-operation');
    assert.equal(bytes?.toString(), 'channel-fixture');
    bytes?.fill(0);
    await native.remove('com.2pcrew.v2.fixture.provider', 'fixture-operation');
    await native.remove('com.2pcrew.v2.fixture.provider', 'fixture-operation');
    for (const pid of pids) {
      assert.throws(
        () => process.kill(pid, 0),
        (e) => (e as NodeJS.ErrnoException).code === 'ESRCH',
      );
      console.log(JSON.stringify({ type: 'task2-owned-process', action: 'fake-helper-reaped', pid, helper }));
    }
    await assert.rejects(
      new SecurityFrameworkBridge({
        path: helper,
        sha256: '0'.repeat(64),
        signedAclVerified: async () => true,
      }).read('com.2pcrew.v2.fixture.provider', 'fixture-operation'),
      /UNVERIFIED/,
    );
  } finally {
    await removeModelFixture(root);
  }
});
test('credential broker failed read-back cannot yield a stored ref', async () => {
  const broker = new CredentialBroker(
    randomUUID(),
    { read: async () => null, put: async () => {}, remove: async () => {} },
    [],
  );
  await assert.rejects(
    broker.put(randomUUID(), Buffer.from('readback-fixture')),
    /CREDENTIAL_READBACK_FAILED/,
  );
});
