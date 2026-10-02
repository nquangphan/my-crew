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
