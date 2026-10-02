import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  randomUUID,
} from 'node:crypto';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { canonicalJson } from '../src/journal/canonical.ts';
import type { SecretEnvelope } from '../src/models/contracts.ts';
import type { Db } from '../src/platform/contracts.ts';
import { databaseFixture } from './support/db.ts';
import { modelFixture } from './support/model-http.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
type CryptoBox = Pick<SecretEnvelope, 'ephemeralPublicKey' | 'nonce' | 'ciphertext' | 'tag'>;
function decode(box: CryptoBox, key: KeyObject, aad: unknown) {
  const shared = diffieHellman({
    privateKey: key,
    publicKey: createPublicKey({
      key: Buffer.from(box.ephemeralPublicKey, 'base64'),
      format: 'der',
      type: 'spki',
    }),
  });
  const nonce = Buffer.from(box.nonce, 'base64');
  const aes = Buffer.from(hkdfSync('sha256', shared, nonce, 'crew-v2-secret-envelope-v1', 32));
  const d = createDecipheriv('aes-256-gcm', aes, nonce);
  d.setAAD(Buffer.from(canonicalJson(aad)));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.ciphertext, 'base64')), d.final()]).toString();
}
test('model secret key proof encrypted provisioning and lost ACK replay erase ciphertext exactly once', async () => {
  await databaseFixture(8)(async (db) => {
    const f = await modelFixture(db);
    try {
      const providerId = randomUUID(),
        keyId = randomUUID(),
        keys = generateKeyPairSync('x25519');
      const config = {
        expectedRevision: 0,
        enabled: { claude: false, codex: false, api: true },
        apiProviders: [
          {
            id: providerId,
            endpoint: 'https://example.com/v1',
            protocol: 'responses',
            models: [{ id: 'x', declared: ['text'] }],
            localHttp: null,
          },
        ],
      };
      await db`insert into projects(id,name,key,machine_id,checkout_path,binding_revision) values(${randomUUID()},'Secret fixture','secret-fixture',${f.machineId},'/tmp/model-secret-fixture',1)`;
      assert.equal((await f.owner.put(`/v2/machines/${f.machineId}/model-sources`, config)).statusCode, 200);
      const reg = await f.machine.post('/v2/machine/credential-keys', {
        keyId,
        publicKeyX25519: keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      });
      assert.equal(reg.statusCode, 200, reg.text);
      const ch = reg.json<{ challengeId: string; encryptedChallenge: CryptoBox; expiresAt: string }>();
      const nonce = decode(ch.encryptedChallenge, keys.privateKey, {
        machineId: f.machineId,
        keyId,
        challengeId: ch.challengeId,
        expiresAt: ch.expiresAt,
      });
      const secret = 'fixture-only-secret-never-real';
      const operationId = randomUUID();
      const body = { expectedRevision: 1, keyId, operationId, secret };
      const path = `/v2/machines/${f.machineId}/api-providers/${providerId}/secret`;
      assert.equal((await f.owner.post(path, body)).statusCode, 409);
      assert.equal(
        (
          await f.machine.post(`/v2/machine/credential-keys/${keyId}/confirm`, {
            challengeId: ch.challengeId,
            challengeSha256: 'f'.repeat(64),
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await f.machine.post(`/v2/machine/credential-keys/${keyId}/confirm`, {
            challengeId: ch.challengeId,
            challengeSha256: hash(nonce),
          })
        ).statusCode,
        200,
      );
      const sent = await f.owner.post(path, body);
      assert.equal(sent.statusCode, 200, sent.text);
      assert.equal(sent.text.includes(secret), false);
      assert.equal((await f.owner.post(path, body)).text, sent.text);
      const envelopes = await f.machine.get('/v2/machine/api-secret-envelopes');
      assert.equal(envelopes.statusCode, 200, envelopes.text);
      const e = envelopes.json<{ items: SecretEnvelope[] }>().items[0];
      assert.ok(e);
      const aad = {
        machineId: e.machineId,
        providerId: e.providerId,
        keyId: e.keyId,
        configRevision: e.configRevision,
        operationId: e.operationId,
        expiresAt: e.expiresAt,
      };
      assert.equal(decode(e, keys.privateKey, aad), secret);
      assert.throws(() => decode({ ...e, tag: Buffer.alloc(16).toString('base64') }, keys.privateKey, aad));
      assert.throws(() => decode(e, keys.privateKey, { ...aad, configRevision: 2 }));
      const ack = { operationId, keyId, ciphertextSha256: e.ciphertextSha256, credentialRef: 'fixture-ref' };
      assert.equal(
        (
          await f.machine.post(`/v2/machine/api-secret-envelopes/${e.id}/ack`, {
            ...ack,
            ciphertextSha256: 'a'.repeat(64),
          })
        ).statusCode,
        409,
      );
      const a = await f.machine.post(`/v2/machine/api-secret-envelopes/${e.id}/ack`, ack);
      assert.equal(a.statusCode, 200, a.text);
      assert.deepEqual(
        (await f.machine.post(`/v2/machine/api-secret-envelopes/${e.id}/ack`, ack)).json(),
        a.json(),
      );
      const [stored] = await db`select ciphertext,tag,state from api_secret_envelopes`;
      assert.equal(stored?.ciphertext, null);
      assert.equal(stored?.tag, null);
      assert.equal(stored?.state, 'acked');
      const [journal] = await db`select string_agg(response::text,'') as data from idempotency`;
      assert.equal(String(journal?.data).includes(secret), false);
      assert.equal(String(journal?.data).includes(e.ciphertext), false);
      assert.equal(
        (await f.owner.get(`/v2/machines/${f.machineId}/model-sources`)).text.includes(secret),
        false,
      );
      const removed = await f.owner.put(`/v2/machines/${f.machineId}/model-sources`, {
        expectedRevision: 1,
        enabled: { claude: false, codex: false, api: false },
        apiProviders: [],
      });
      assert.equal(removed.statusCode, 200, removed.text);
      assert.deepEqual(removed.json<{ apiProviders: unknown[] }>().apiProviders, []);
      assert.equal((await db`select state from api_secret_envelopes`)[0]?.state, 'acked');
    } finally {
      await f.close();
    }
  });
});

test('model secret rotation scopes pending envelopes to own machine and rejects stale key/revision ACK', async () => {
  await databaseFixture(8)(async (db) => {
    let now = new Date();
    const f = await modelFixture(db, { now: () => now });
    try {
      await db`insert into projects(id,name,key,machine_id,checkout_path) values(${randomUUID()},'fixture','MODELKEY',${f.machineId},'/tmp/model-key-fixture')`;
      const providerId = randomUUID(),
        configuration = {
          expectedRevision: 0,
          enabled: { claude: false, codex: false, api: true },
          apiProviders: [
            {
              id: providerId,
              endpoint: 'https://example.com/v1',
              protocol: 'chat-completions',
              models: [{ id: 'x', declared: ['text'] }],
              localHttp: null,
            },
          ],
        };
      await f.owner.put(`/v2/machines/${f.machineId}/model-sources`, configuration);
      const activate = async () => {
        const keys = generateKeyPairSync('x25519'),
          keyId = randomUUID();
        const reg = await f.machine.post('/v2/machine/credential-keys', {
          keyId,
          publicKeyX25519: keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
        });
        assert.equal(reg.statusCode, 200, reg.text);
        const ch = reg.json<{ challengeId: string; encryptedChallenge: CryptoBox; expiresAt: string }>();
        const nonce = decode(ch.encryptedChallenge, keys.privateKey, {
          machineId: f.machineId,
          keyId,
          challengeId: ch.challengeId,
          expiresAt: ch.expiresAt,
        });
        const confirmed = await f.machine.post(`/v2/machine/credential-keys/${keyId}/confirm`, {
          challengeId: ch.challengeId,
          challengeSha256: hash(nonce),
        });
        assert.equal(confirmed.statusCode, 200, confirmed.text);
        return keyId;
      };
      const firstKey = await activate(),
        secondKey = await activate();
      const path = `/v2/machines/${f.machineId}/api-providers/${providerId}/secret`;
      assert.equal(
        (
          await f.owner.post(path, {
            expectedRevision: 1,
            keyId: firstKey,
            operationId: randomUUID(),
            secret: 'test',
          })
        ).statusCode,
        409,
      );
      const operationId = randomUUID();
      assert.equal(
        (await f.owner.post(path, { expectedRevision: 1, keyId: secondKey, operationId, secret: 'test' }))
          .statusCode,
        200,
      );
      const foreign = await f.owner.post('/v2/machines', { name: 'foreign' });
      const t = foreign.json<{ token: string }>().token;
      assert.equal(
        (
          await f.request('/v2/machine/api-secret-envelopes', 'GET', undefined, {
            authorization: `Bearer ${t}`,
          })
        ).json<{ items: SecretEnvelope[] }>().items.length,
        0,
      );
      const e = (await f.machine.get('/v2/machine/api-secret-envelopes')).json<{ items: SecretEnvelope[] }>()
        .items[0];
      const ack = {
        operationId,
        keyId: secondKey,
        ciphertextSha256: e.ciphertextSha256,
        credentialRef: 'fixture-ref',
      };
      assert.equal(
        (await f.machineWrite(`/v2/machine/api-secret-envelopes/${e.id}/ack`, t, ack)).statusCode,
        404,
      );
      now = new Date(now.getTime() + 6 * 60_000);
      assert.equal(
        (await f.machine.post(`/v2/machine/api-secret-envelopes/${e.id}/ack`, ack)).statusCode,
        409,
      );
      assert.equal(
        (await f.machine.post(`/v2/machine/api-secret-envelopes/${e.id}/key-lost`, {})).statusCode,
        200,
      );
      const [state] = await db`select state,ciphertext from api_secret_envelopes`;
      assert.equal(state?.state, 'expired');
      assert.equal(state?.ciphertext, null);
    } finally {
      await f.close();
    }
  });
});

test('model secret envelope pagination uses a durable decimal cursor so reconnect cannot miss a new random UUID', async () => {
  await databaseFixture(8)(async (db) => {
    const f = await modelFixture(db);
    try {
      const response = await f.machine.get('/v2/machine/api-secret-envelopes?after=0');
      assert.equal(response.statusCode, 200, response.text);
      assert.equal(response.json().nextCursor, '0');
    } finally {
      await f.close();
    }
  });
});

test('production app real HTTP secret rejection and structured logger redact plaintext', async () => {
  await databaseFixture(8)(async (db) => {
    const f = await modelFixture(db);
    const providerId = randomUUID();
    try {
      assert.equal(
        (
          await f.owner.put(`/v2/machines/${f.machineId}/model-sources`, {
            expectedRevision: 0,
            enabled: { claude: false, codex: false, api: true },
            apiProviders: [
              {
                id: providerId,
                endpoint: 'https://example.com/v1',
                protocol: 'responses',
                models: [{ id: 'x', declared: ['text'] }],
                localHttp: null,
              },
            ],
          })
        ).statusCode,
        200,
      );
      const [database] = await db`select current_database() as name`;
      assert.ok(database?.name);
      const base = process.env.CREW_V2_TEST_DATABASE_URL;
      assert.ok(base);
      const url = new URL(base);
      url.pathname = `/${database.name}`;
      const input = {
        url: url.toString(),
        cookie: f.identity.cookie,
        csrf: f.identity.csrf,
        key: f.identity.key.toString('base64'),
        machineId: f.machineId,
        providerId,
      };
      const child = `
        import assert from 'node:assert/strict';
        import { randomUUID } from 'node:crypto';
        import { buildApp } from ${JSON.stringify(new URL('../src/app.ts', import.meta.url).href)};
        import { connectDb } from ${JSON.stringify(new URL('../src/db/client.ts', import.meta.url).href)};
        const i = JSON.parse(process.argv[1]);
        const db = connectDb(i.url);
        const app = await buildApp({db, publicOrigin:'http://localhost:5182', secureCookies:false, sessionEncryptionKey:Buffer.from(i.key,'base64'), now:()=>new Date()});
        try {
          const address = await app.listen({host:'127.0.0.1',port:0});
          const body = {expectedRevision:1,keyId:randomUUID(),operationId:randomUUID(),secret:'fixture-redaction-canary'};
          const response = await fetch(address+'/v2/machines/'+i.machineId+'/api-providers/'+i.providerId+'/secret',{method:'POST',headers:{'content-type':'application/json',cookie:i.cookie,origin:'http://localhost:5182','x-csrf-token':i.csrf,'idempotency-key':randomUUID()},body:JSON.stringify(body)});
          assert.equal(response.status,409);
          assert.equal((await response.text()).includes(body.secret),false);
          app.log.child({}, {serializers:{req:r=>r}}).info({req:{body}},'model-secret-redaction-proof');
        } finally { await app.close(); await db.end(); }
      `;
      const output = await promisify(execFile)(
        process.execPath,
        ['--input-type=module', '-e', child, JSON.stringify(input)],
        { timeout: 10_000, maxBuffer: 1024 * 1024 },
      );
      assert.equal(output.stdout.includes('fixture-redaction-canary'), false);
      assert.equal(output.stderr.includes('fixture-redaction-canary'), false);
      assert.match(output.stdout, /model-secret-redaction-proof/);
      assert.match(output.stdout, /\[Redacted\]/);
      const [publicRows] =
        await db`select (select coalesce(string_agg(response::text,''),'') from idempotency) || (select coalesce(string_agg(data::text,''),'') from events) as value`;
      assert.equal(String(publicRows?.value).includes('fixture-redaction-canary'), false);
      assert.equal((await db`select count(*)::int as n from api_secret_envelopes`)[0]?.n, 0);
    } finally {
      await f.close();
    }
  });
});

async function provisioningFixture(db: Db) {
  const acceptedTime = new Date();
  const f = await modelFixture(db, { now: () => acceptedTime });
  await db`insert into projects(id,name,key,machine_id,checkout_path) values(${randomUUID()},'fixture','FIX1SECRET',${f.machineId},'/tmp/fix1-secret-fixture')`;
  const providerId = randomUUID();
  const configuration = {
    expectedRevision: 0,
    enabled: { claude: false, codex: false, api: true },
    apiProviders: [
      {
        id: providerId,
        endpoint: 'https://example.com/v1',
        protocol: 'responses',
        models: [{ id: 'x', declared: ['text'] }],
        localHttp: null,
      },
    ],
  };
  assert.equal(
    (await f.owner.put(`/v2/machines/${f.machineId}/model-sources`, configuration)).statusCode,
    200,
  );
  const activate = async () => {
    const keys = generateKeyPairSync('x25519'),
      keyId = randomUUID();
    const r = await f.machine.post('/v2/machine/credential-keys', {
      keyId,
      publicKeyX25519: keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    });
    assert.equal(r.statusCode, 200, r.text);
    const ch = r.json<{ challengeId: string; encryptedChallenge: CryptoBox; expiresAt: string }>();
    const proof = {
      challengeId: ch.challengeId,
      challengeSha256: hash(
        decode(ch.encryptedChallenge, keys.privateKey, {
          machineId: f.machineId,
          keyId,
          challengeId: ch.challengeId,
          expiresAt: ch.expiresAt,
        }),
      ),
    };
    assert.equal(
      (await f.machine.post(`/v2/machine/credential-keys/${keyId}/confirm`, proof)).statusCode,
      200,
    );
    return { keyId, proof };
  };
  const provision = async (keyId: string, operationId = randomUUID()) => {
    const body = { expectedRevision: 1, keyId, operationId, secret: 'fixture-only' };
    const sent = await f.owner.post(`/v2/machines/${f.machineId}/api-providers/${providerId}/secret`, body);
    assert.equal(sent.statusCode, 200, sent.text);
    const envelope = (await f.machine.get('/v2/machine/api-secret-envelopes'))
      .json<{ items: SecretEnvelope[] }>()
      .items.find((e) => e.operationId === operationId);
    assert.ok(envelope);
    return { envelope, body };
  };
  const ack = (e: SecretEnvelope, credentialRef: string) =>
    f.machine.post(`/v2/machine/api-secret-envelopes/${e.id}/ack`, {
      operationId: e.operationId,
      keyId: e.keyId,
      ciphertextSha256: e.ciphertextSha256,
      credentialRef,
    });
  const loss = (e: SecretEnvelope) => f.machine.post(`/v2/machine/api-secret-envelopes/${e.id}/key-lost`, {});
  const provider = async () =>
    (
      await db`select status,credential_ref from api_providers where machine_id=${f.machineId} and id=${providerId}`
    )[0];
  return { f, providerId, configuration, activate, provision, ack, loss, provider };
}
for (const late of ['ack', 'loss'] as const)
  test(`FIX1 R2 older pending ${late} cannot rewind newer stored credential`, async () => {
    await databaseFixture(8)(async (db) => {
      const s = await provisioningFixture(db);
      try {
        const k = await s.activate();
        const a = await s.provision(k.keyId, 'ffffffff-ffff-4fff-8fff-ffffffffffff'),
          b = await s.provision(k.keyId, '00000000-0000-4000-8000-000000000001');
        assert.equal((await s.ack(b.envelope, 'newer-ref')).statusCode, 200);
        const before = await s.provider();
        assert.equal(before?.credential_ref, 'newer-ref');
        assert.equal(
          (await db`select current_operation_id from api_providers where id=${s.providerId}`)[0]
            ?.current_operation_id,
          b.envelope.operationId,
        );
        const created = await db`select created_at from api_secret_envelopes order by cursor`;
        assert.equal(created.length, 2);
        assert.equal((created[0].created_at as Date).getTime(), (created[1].created_at as Date).getTime());
        const response = late === 'ack' ? await s.ack(a.envelope, 'older-ref') : await s.loss(a.envelope);
        assert.equal(response.statusCode, 200, response.text);
        assert.deepEqual(await s.provider(), before);
        const replay = late === 'ack' ? await s.ack(a.envelope, 'older-ref') : await s.loss(a.envelope);
        assert.deepEqual(replay.json(), response.json());
        assert.deepEqual(await s.provider(), before);
        assert.equal((await s.ack(b.envelope, 'newer-ref')).statusCode, 200);
        assert.deepEqual(await s.provider(), before);
        const retried = await s.f.owner.post(
          `/v2/machines/${s.f.machineId}/api-providers/${s.providerId}/secret`,
          a.body,
        );
        assert.equal(retried.statusCode, 200);
        assert.deepEqual(await s.provider(), before);
        const reopened = await modelFixture(db, { prior: s.f.prior });
        try {
          assert.equal(
            (
              await reopened.machine.post(`/v2/machine/api-secret-envelopes/${b.envelope.id}/ack`, {
                operationId: b.envelope.operationId,
                keyId: b.envelope.keyId,
                ciphertextSha256: b.envelope.ciphertextSha256,
                credentialRef: 'newer-ref',
              })
            ).statusCode,
            200,
          );
          assert.equal(
            (await db`select current_operation_id from api_providers where id=${s.providerId}`)[0]
              ?.current_operation_id,
            b.envelope.operationId,
          );
          assert.deepEqual(await s.provider(), before);
        } finally {
          await reopened.close();
        }
        await assert.rejects(
          db.begin(
            (tx) =>
              tx`update api_providers set current_operation_id=${randomUUID()} where machine_id=${s.f.machineId} and id=${s.providerId}`,
          ),
          (err) => typeof err === 'object' && err !== null && 'code' in err && err.code === '23503',
        );
      } finally {
        await s.f.close();
      }
    });
  });
test('FIX1 R3 lost active key denies fresh provision and invalidates all pending while preserving ACK history', async () => {
  await databaseFixture(8)(async (db) => {
    const s = await provisioningFixture(db);
    try {
      const k = await s.activate();
      const a = await s.provision(k.keyId),
        b = await s.provision(k.keyId);
      assert.equal((await s.loss(a.envelope)).statusCode, 200);
      const path = `/v2/machines/${s.f.machineId}/api-providers/${s.providerId}/secret`;
      const denied = await s.f.owner.post(path, { ...b.body, operationId: randomUUID() });
      assert.equal(denied.statusCode, 409, denied.text);
      assert.equal(
        (await s.f.machine.get('/v2/machine/api-secret-envelopes')).json<{ items: SecretEnvelope[] }>().items
          .length,
        0,
      );
      assert.equal((await s.ack(b.envelope, 'lost-key-ref')).statusCode, 409);
      assert.equal((await s.provider())?.status, 'missing');
      const lost = await db`select state,ciphertext,tag,ack_hash from api_secret_envelopes`;
      assert.equal(lost.length, 2);
      for (const envelope of lost) {
        assert.equal(envelope.state, 'key_lost');
        assert.equal(envelope.ciphertext, null);
        assert.equal(envelope.tag, null);
        assert.equal(envelope.ack_hash, null);
      }
      assert.equal(
        (await s.f.machine.post(`/v2/machine/credential-keys/${k.keyId}/confirm`, k.proof)).statusCode,
        200,
      );
      assert.equal((await s.f.owner.post(path, { ...b.body, operationId: randomUUID() })).statusCode, 409);
      const key = await db`select state from credential_keys where key_id=${k.keyId}`;
      assert.equal(key[0]?.state, 'retired');
      const current = await s.activate(),
        c = await s.provision(current.keyId);
      assert.equal((await s.ack(c.envelope, 'reentered-ref')).statusCode, 200);
      assert.equal((await s.loss(a.envelope)).statusCode, 200);
      assert.equal((await s.provider())?.credential_ref, 'reentered-ref');
      assert.equal(
        (await db`select state from credential_keys where key_id=${current.keyId}`)[0]?.state,
        'active',
      );
      const reopened = await modelFixture(db, { prior: s.f.prior });
      try {
        assert.equal(
          (await reopened.machine.post(`/v2/machine/api-secret-envelopes/${a.envelope.id}/key-lost`, {}))
            .statusCode,
          200,
        );
        assert.equal((await s.provider())?.credential_ref, 'reentered-ref');
      } finally {
        await reopened.close();
      }
    } finally {
      await s.f.close();
    }
  });
});
test('FIX1 normal rotation retains old pending ACK authority only for history and old key loss preserves new active key', async () => {
  await databaseFixture(8)(async (db) => {
    const s = await provisioningFixture(db);
    try {
      const first = await s.activate(),
        a = await s.provision(first.keyId),
        pending = await s.provision(first.keyId);
      const second = await s.activate();
      assert.equal((await s.ack(a.envelope, 'retained-old-key-ref')).statusCode, 200);
      const b = await s.provision(second.keyId);
      assert.equal((await s.loss(pending.envelope)).statusCode, 200);
      assert.equal((await s.provider())?.status, 'pending');
      assert.equal(
        (await db`select state from credential_keys where key_id=${second.keyId}`)[0]?.state,
        'active',
      );
      assert.equal((await s.ack(b.envelope, 'current-new-key-ref')).statusCode, 200);
      assert.equal((await s.ack(a.envelope, 'retained-old-key-ref')).statusCode, 200);
      assert.equal((await s.provider())?.credential_ref, 'current-new-key-ref');
      assert.equal((await s.ack(a.envelope, 'changed-history-ref')).statusCode, 409);
    } finally {
      await s.f.close();
    }
  });
});

test('FIX1 revision invalidation detaches current operation and old receipts preserve new credential', async () => {
  await databaseFixture(8)(async (db) => {
    const s = await provisioningFixture(db);
    try {
      const first = await s.activate(),
        a = await s.provision(first.keyId),
        history = await s.provision(first.keyId);
      assert.equal((await s.ack(history.envelope, 'history-ref')).statusCode, 200);
      assert.equal(
        (
          await s.f.owner.put(`/v2/machines/${s.f.machineId}/model-sources`, {
            ...s.configuration,
            expectedRevision: 1,
            enabled: { claude: true, codex: false, api: true },
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (await db`select current_operation_id from api_providers where id=${s.providerId}`)[0]
          ?.current_operation_id,
        null,
      );
      assert.equal((await s.provider())?.credential_ref, 'history-ref');
      assert.equal((await s.ack(a.envelope, 'late-revision-ref')).statusCode, 409);
      const second = await s.activate();
      const operationId = randomUUID();
      assert.equal(
        (
          await s.f.owner.post(`/v2/machines/${s.f.machineId}/api-providers/${s.providerId}/secret`, {
            expectedRevision: 2,
            keyId: second.keyId,
            operationId,
            secret: 'fixture-only-new',
          })
        ).statusCode,
        200,
      );
      const b = (await s.f.machine.get('/v2/machine/api-secret-envelopes'))
        .json<{ items: SecretEnvelope[] }>()
        .items.find((e) => e.operationId === operationId);
      assert.ok(b);
      assert.equal((await s.ack(b, 'current-revision-ref')).statusCode, 200);
      assert.equal((await s.loss(a.envelope)).statusCode, 200);
      assert.equal((await s.ack(history.envelope, 'history-ref')).statusCode, 200);
      assert.equal((await s.provider())?.credential_ref, 'current-revision-ref');
      assert.equal(
        (await db`select state from credential_keys where key_id=${second.keyId}`)[0]?.state,
        'active',
      );
    } finally {
      await s.f.close();
    }
  });
});
