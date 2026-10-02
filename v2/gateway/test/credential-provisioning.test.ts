import assert from 'node:assert/strict';
import {
  createCipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import test from 'node:test';
import { canonicalJson } from '../src/journal/atomic-records.ts';
import { HttpOperationJournal, type HttpRequest } from '../src/journal/http-operations.ts';
import type { SecretEnvelope } from '../src/models/contracts.ts';
import { CredentialBroker } from '../src/models/credential-broker.ts';
import { CredentialProvisioning, ServerReceiptClock } from '../src/models/credential-provisioning.ts';
import type { SecurityBridge } from '../src/models/security-bridge.ts';
import { modelFixtureRoot, removeModelFixture } from './support/model-fixture.ts';

function seal(pub: string, text: string, aad: unknown) {
  const ephemeral = generateKeyPairSync('x25519'),
    nonce = randomBytes(12);
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: createPublicKey({ key: Buffer.from(pub, 'base64'), format: 'der', type: 'spki' }),
  });
  const aes = Buffer.from(hkdfSync('sha256', shared, nonce, 'crew-v2-secret-envelope-v1', 32));
  const c = createCipheriv('aes-256-gcm', aes, nonce);
  c.setAAD(Buffer.from(canonicalJson(aad)));
  const ciphertext = Buffer.concat([c.update(text), c.final()]);
  shared.fill(0);
  aes.fill(0);
  return {
    ephemeralPublicKey: ephemeral.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    ciphertextSha256: createHash('sha256').update(ciphertext).digest('hex'),
  };
}
test('credential broker provisioning persists private key and exact ACK across lost reply; rejects stale/AAD/key loss', async () => {
  const root = await modelFixtureRoot('credential-provisioning');
  const items = new Map<string, Buffer>();
  const bridge: SecurityBridge = {
    put: async (s, a, b) => {
      items.set(`${s}/${a}`, Buffer.from(b));
    },
    read: async (s, a) => {
      const b = items.get(`${s}/${a}`);
      return b ? Buffer.from(b) : null;
    },
    remove: async (s, a) => {
      items.delete(`${s}/${a}`);
    },
  };
  const machineId = randomUUID(),
    providerId = randomUUID(),
    broker = new CredentialBroker(machineId, bridge, []);
  let mono = 0;
  const clock = new ServerReceiptClock(() => mono);
  clock.observe('2026-10-02T07:00:00.000Z');
  const sent: HttpRequest[] = [];
  let publicKey = '',
    keyId = '',
    lose = true;
  const transport = async (request: Readonly<HttpRequest>) => {
    sent.push(request);
    if (request.route === '/v2/machine/credential-keys') {
      const b = request.canonicalBody as { keyId: string; publicKeyX25519: string };
      publicKey = b.publicKeyX25519;
      keyId = b.keyId;
      const challengeId = randomUUID(),
        expiresAt = '2026-10-02T07:05:00.000Z';
      return {
        status: 200,
        body: {
          challengeId,
          expiresAt,
          encryptedChallenge: seal(publicKey, 'challenge-fixture', {
            machineId,
            keyId,
            challengeId,
            expiresAt,
          }),
        },
      };
    }
    if (request.route.endsWith('/confirm'))
      assert.equal(
        (request.canonicalBody as { challengeSha256: string }).challengeSha256,
        createHash('sha256').update('challenge-fixture').digest('hex'),
      );
    if (request.route.endsWith('/ack') && lose) throw new Error('lost ACK');
    return { status: 200, body: { status: request.route.endsWith('/confirm') ? 'active' : 'acked' } };
  };
  let http = await HttpOperationJournal.open(root, transport);
  let provisioning = await CredentialProvisioning.open(root, machineId, bridge, broker, http, clock);
  try {
    assert.equal(await provisioning.registerKey(), keyId);
    assert.match(publicKey, /^[A-Za-z0-9+/]+=*$/);
    const base = {
      id: randomUUID(),
      machineId,
      providerId,
      keyId,
      configRevision: 2,
      operationId: randomUUID(),
      expiresAt: '2026-10-02T07:05:00.000Z',
    };
    const aad = {
      machineId,
      providerId,
      keyId,
      configRevision: 2,
      operationId: base.operationId,
      expiresAt: base.expiresAt,
    };
    const envelope: SecretEnvelope = { ...base, ...seal(publicKey, 'crypto-fixture-secret', aad) };
    await assert.rejects(provisioning.accept(envelope, 2, [providerId]), /lost ACK/);
    assert.equal([...items.values()].filter((b) => b.toString() === 'crypto-fixture-secret').length, 1);
    const first = sent.at(-1);
    assert.ok(first);
    assert.equal(JSON.stringify(sent).includes('crypto-fixture-secret'), false);
    await provisioning.close();
    await http.close();
    lose = false;
    http = await HttpOperationJournal.open(root, transport);
    provisioning = await CredentialProvisioning.open(root, machineId, bridge, broker, http, clock);
    await provisioning.accept(envelope, 2, [providerId]);
    assert.deepEqual(sent.at(-1), first);
    await assert.rejects(
      provisioning.accept({ ...envelope, id: randomUUID(), operationId: randomUUID() }, 2, [providerId]),
      /ENVELOPE_INVALID/,
    );
    await assert.rejects(
      provisioning.accept({ ...envelope, id: randomUUID() }, 3, [providerId]),
      /CONFIG_REVISION/,
    );
    mono = 300001;
    await assert.rejects(provisioning.accept({ ...envelope, id: randomUUID() }, 2, [providerId]), /EXPIRED/);
    for (const key of [...items.keys()]) if (key.includes('.credential-keys/')) items.delete(key);
    assert.equal(
      await provisioning.replayAck(envelope.id),
      (first.canonicalBody as { credentialRef: string }).credentialRef,
    );
    const attemptsBefore = sent.length;
    for (const [name, value] of items) if (value.toString() === 'crypto-fixture-secret') items.delete(name);
    await assert.rejects(provisioning.replayAck(envelope.id), /CREDENTIAL_MISSING/);
    assert.equal(sent.length, attemptsBefore);
    mono = 0;
    await assert.rejects(provisioning.accept({ ...envelope, id: randomUUID() }, 2, [providerId]), /KEY_LOST/);
    assert.equal(sent.at(-1)?.route.endsWith('/key-lost'), true);
  } finally {
    await provisioning.close();
    await http.close();
    await removeModelFixture(root);
  }
});
test('credential broker expiry needs bounded server receipt clock and ignores host wall clock', () => {
  let mono = 10;
  const clock = new ServerReceiptClock(() => mono);
  assert.throws(() => clock.assertFresh('2026-10-02T07:05:00.000Z'), /SERVER_TIME_REQUIRED/);
  clock.observe('2026-10-02T07:00:00.000Z');
  mono += 300000;
  assert.throws(() => clock.assertFresh('2026-10-02T07:05:00.000Z'), /EXPIRED/);
});
test('credential broker reconnect gets own desired/serverTime before secret envelopes and rejects disabled source', async () => {
  const root = await modelFixtureRoot('credential-provisioning');
  const bridge: SecurityBridge = { read: async () => null, put: async () => {}, remove: async () => {} };
  const broker = new CredentialBroker(randomUUID(), bridge, []),
    clock = new ServerReceiptClock();
  const http = await HttpOperationJournal.open(root, async () => ({ status: 200, body: {} }));
  const provisioning = await CredentialProvisioning.open(root, randomUUID(), bridge, broker, http, clock);
  const routes: string[] = [];
  try {
    const result = await provisioning.syncPending(async (route) => {
      routes.push(route);
      return route === '/v2/machine/model-sources'
        ? { revision: 4, enabled: { api: false, claude: false, codex: false }, apiProviders: [] }
        : { items: [], nextCursor: '0', serverTime: '2026-10-02T07:00:00.000Z' };
    });
    assert.deepEqual(routes, ['/v2/machine/model-sources']);
    assert.equal(result.state, 'disabled');
  } finally {
    await provisioning.close();
    await http.close();
    await removeModelFixture(root);
  }
});

test('FIX1 R1 registration TTL upper bound uses estimated current server time without extending expired receipts', () => {
  let mono = 0;
  const clock = new ServerReceiptClock(() => mono);
  const base = Date.parse('2026-10-02T07:00:00.000Z');
  clock.observe(new Date(base).toISOString());
  mono = 50;
  assert.doesNotThrow(() => clock.assertFresh(new Date(base + 300050).toISOString()));
  assert.throws(() => clock.assertFresh(new Date(base + 300051).toISOString()), /EXPIRED/);
  clock.observe(new Date(base - 60000).toISOString());
  assert.throws(() => clock.assertFresh(new Date(base + 49).toISOString()), /EXPIRED/);
  mono = 300051;
  assert.throws(() => clock.assertFresh(new Date(base + 300050).toISOString()), /EXPIRED/);
  assert.throws(() => clock.assertFresh(new Date(base + 600000).toISOString()), /EXPIRED/);
});

test('FIX1 R2 public reconnect replays committed lost ACK after expiry and revision change without rewriting secret', async () => {
  const root = await modelFixtureRoot('fix1-ack-reconnect');
  const machineId = randomUUID(),
    providerId = randomUUID(),
    values = new Map<string, Buffer>();
  let writes = 0,
    mono = 0,
    keyId = '',
    publicKey = '',
    lose = true,
    revision = 1,
    batches = 0,
    currentStored = false;
  const base = Date.parse('2026-10-02T07:00:00Z');
  const bridge: SecurityBridge = {
    read: async (s, a) => {
      const b = values.get(s + a);
      return b ? Buffer.from(b) : null;
    },
    put: async (s, a, b) => {
      writes++;
      values.set(s + a, Buffer.from(b));
    },
    remove: async (s, a) => {
      values.delete(s + a);
    },
  };
  const broker = new CredentialBroker(machineId, bridge, []),
    clock = new ServerReceiptClock(() => mono);
  clock.observe(new Date(base).toISOString());
  const acks: HttpRequest[] = [];
  let committed: Readonly<HttpRequest> | undefined;
  const wire = async (request: Readonly<HttpRequest>) => {
    if (request.route === '/v2/machine/credential-keys') {
      const b = request.canonicalBody as { keyId: string; publicKeyX25519: string };
      keyId = b.keyId;
      publicKey = b.publicKeyX25519;
      mono += 50; // Registration response was created after the preceding receipt.
      const challengeId = randomUUID(),
        expiresAt = new Date(base + mono + 300000).toISOString();
      return {
        status: 200,
        body: {
          challengeId,
          expiresAt,
          encryptedChallenge: seal(publicKey, 'fixture-challenge', {
            machineId,
            keyId,
            challengeId,
            expiresAt,
          }),
        },
      };
    }
    if (request.route.endsWith('/ack')) {
      acks.push(structuredClone(request));
      if (committed) assert.deepEqual(request, committed);
      else committed = structuredClone(request);
      if (lose) throw new Error('lost committed receipt');
      return { status: 200, body: { status: 'acked' } };
    }
    return { status: 200, body: { status: 'active' } };
  };
  let http = await HttpOperationJournal.open(root, wire);
  let provisioning = await CredentialProvisioning.open(root, machineId, bridge, broker, http, clock);
  try {
    await provisioning.registerKey();
    const meta = {
      id: randomUUID(),
      machineId,
      providerId,
      keyId,
      configRevision: 1,
      operationId: randomUUID(),
      expiresAt: new Date(base + 300000).toISOString(),
    };
    const envelope = {
      ...meta,
      ...seal(publicKey, 'fixture-reconnect-secret', {
        machineId,
        providerId,
        keyId,
        configRevision: 1,
        operationId: meta.operationId,
        expiresAt: meta.expiresAt,
      }),
    };
    const read = async (route: string) =>
      route === '/v2/machine/model-sources'
        ? {
            revision,
            enabled: { api: true, claude: false, codex: false },
            apiProviders: [{ id: providerId, credentialStatus: currentStored ? 'stored' : 'pending' }],
          }
        : {
            items: batches++ === 0 ? [envelope] : [],
            nextCursor: '1',
            serverTime: new Date(base + mono).toISOString(),
          };
    assert.equal((await provisioning.syncPending(read)).state, 'pending');
    assert.equal(acks.length, 1);
    const storedWrites = writes;
    await provisioning.close();
    await http.close();
    mono = 300001;
    revision = 2;
    lose = false;
    http = await HttpOperationJournal.open(root, wire);
    provisioning = await CredentialProvisioning.open(root, machineId, bridge, broker, http, clock);
    assert.equal((await provisioning.syncPending(read)).state, 'pending'); // Historical ACK cannot promote the newer desired credential.
    currentStored = true;
    assert.equal((await provisioning.syncPending(read)).state, 'stored');
    assert.equal(acks.length, 2);
    assert.deepEqual(acks[0], acks[1]);
    assert.equal(writes, storedWrites);
    await assert.rejects(
      provisioning.accept({ ...envelope, ciphertextSha256: '0'.repeat(64) }, 2, [providerId]),
      /ENVELOPE_INVALID/,
    );
    const firstAck = acks[0];
    assert.ok(firstAck);
    const ref = (firstAck.canonicalBody as { credentialRef: string }).credentialRef;
    await broker.remove(ref);
    await assert.rejects(provisioning.accept(envelope, 2, [providerId]), /CREDENTIAL_MISSING/);
    assert.equal(acks.length, 2);
    await assert.rejects(
      provisioning.accept({ ...envelope, id: randomUUID() }, 2, [providerId]),
      /CONFIG_REVISION_CONFLICT/,
    );
    assert.equal(writes, storedWrites);
  } finally {
    await provisioning.close();
    await http.close();
    await removeModelFixture(root);
  }
});
