import assert from 'node:assert/strict';
import {
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomUUID,
} from 'node:crypto';
import test from 'node:test';
import { canonicalJson } from '../src/journal/canonical.ts';
import type { SecretEnvelope } from '../src/models/contracts.ts';
import { databaseFixture } from './support/db.ts';
import { modelFixture } from './support/model-http.ts';

const path = '/v2/machine/api-credential-bindings';
type Bindings = {
  machineId: string;
  configRevision: number | null;
  apiEnabled: boolean;
  providers: {
    providerId: string;
    endpoint: string;
    protocol: string;
    status: string;
    credentialRef: string | null;
    currentOperationId: string | null;
  }[];
};
async function fixture(db: Parameters<Parameters<ReturnType<typeof databaseFixture>>[0]>[0]) {
  const f = await modelFixture(db),
    providerId = randomUUID();
  await db`insert into projects(id,name,key,machine_id,checkout_path) values(${randomUUID()},'fixture','CURRENTCRED',${f.machineId},'/tmp/current-credential-fixture')`;
  const config = {
    expectedRevision: 0,
    enabled: { claude: false, codex: false, api: true },
    apiProviders: [
      {
        id: providerId,
        endpoint: 'https://example.com/v1/',
        protocol: 'responses',
        models: [{ id: 'chosen', declared: ['text'] }],
        localHttp: null,
      },
    ],
  };
  assert.equal((await f.owner.put(`/v2/machines/${f.machineId}/model-sources`, config)).statusCode, 200);
  const keys = generateKeyPairSync('x25519'),
    keyId = randomUUID();
  const reg = await f.machine.post('/v2/machine/credential-keys', {
    keyId,
    publicKeyX25519: keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  });
  assert.equal(reg.statusCode, 200, reg.text);
  const ch = reg.json<{
    challengeId: string;
    expiresAt: string;
    encryptedChallenge: Pick<SecretEnvelope, 'ephemeralPublicKey' | 'nonce' | 'ciphertext' | 'tag'>;
  }>();
  const nonce = Buffer.from(ch.encryptedChallenge.nonce, 'base64'),
    shared = diffieHellman({
      privateKey: keys.privateKey,
      publicKey: createPublicKey({
        key: Buffer.from(ch.encryptedChallenge.ephemeralPublicKey, 'base64'),
        format: 'der',
        type: 'spki',
      }),
    });
  const aes = Buffer.from(hkdfSync('sha256', shared, nonce, 'crew-v2-secret-envelope-v1', 32)),
    d = createDecipheriv('aes-256-gcm', aes, nonce);
  d.setAAD(
    Buffer.from(
      canonicalJson({ machineId: f.machineId, keyId, challengeId: ch.challengeId, expiresAt: ch.expiresAt }),
    ),
  );
  d.setAuthTag(Buffer.from(ch.encryptedChallenge.tag, 'base64'));
  const proof = Buffer.concat([d.update(Buffer.from(ch.encryptedChallenge.ciphertext, 'base64')), d.final()]);
  assert.equal(
    (
      await f.machine.post(`/v2/machine/credential-keys/${keyId}/confirm`, {
        challengeId: ch.challengeId,
        challengeSha256: createHash('sha256').update(proof).digest('hex'),
      })
    ).statusCode,
    200,
  );
  proof.fill(0);
  shared.fill(0);
  aes.fill(0);
  const provision = async (operationId: string = randomUUID(), revision = 1) => {
    const response = await f.owner.post(`/v2/machines/${f.machineId}/api-providers/${providerId}/secret`, {
      expectedRevision: revision,
      keyId,
      operationId,
      secret: 'current-credential-fixture-only',
    });
    assert.equal(response.statusCode, 200, response.text);
    const e = (await f.machine.get('/v2/machine/api-secret-envelopes'))
      .json<{ items: SecretEnvelope[] }>()
      .items.find((e) => e.operationId === operationId);
    assert.ok(e);
    return e;
  };
  const ack = (e: SecretEnvelope, ref: string) =>
    f.machine.post(`/v2/machine/api-secret-envelopes/${e.id}/ack`, {
      operationId: e.operationId,
      keyId: e.keyId,
      ciphertextSha256: e.ciphertextSha256,
      credentialRef: ref,
    });
  const get = async () => {
    const r = await f.machine.get(path);
    assert.equal(r.statusCode, 200, r.text);
    return r.json<Bindings>();
  };
  return { f, providerId, keyId, config, provision, ack, get };
}
test('current credential machine-own read exposes metadata only and never selects by UUID or late historical ACK', async () => {
  await databaseFixture(8)(async (db) => {
    const s = await fixture(db);
    try {
      const a = await s.provision('ffffffff-ffff-4fff-8fff-ffffffffffff'),
        b = await s.provision('00000000-0000-4000-8000-000000000001');
      assert.equal((await s.ack(b, 'current-ref-b')).statusCode, 200);
      const before = await s.get();
      assert.deepEqual(before, {
        machineId: s.f.machineId,
        configRevision: 1,
        apiEnabled: true,
        providers: [
          {
            providerId: s.providerId,
            endpoint: 'https://example.com/v1/',
            protocol: 'responses',
            status: 'stored',
            credentialRef: 'current-ref-b',
            currentOperationId: b.operationId,
          },
        ],
      });
      assert.equal((await s.ack(a, 'historical-ref-a')).statusCode, 200);
      assert.deepEqual(await s.get(), before);
      assert.equal((await s.ack(a, 'historical-ref-a')).statusCode, 200);
      assert.deepEqual(await s.get(), before);
      const response = (await s.f.machine.get(path)).text;
      for (const value of [
        'current-credential-fixture-only',
        a.ciphertext,
        b.ciphertext,
        'ephemeralPublicKey',
        'ciphertext',
        'secret',
        'privateKey',
      ])
        assert.equal(response.includes(value), false);
      const reconnect = await modelFixture(db, { prior: s.f.prior });
      try {
        assert.deepEqual((await reconnect.machine.get(path)).json(), before);
      } finally {
        await reconnect.close();
      }
    } finally {
      await s.f.close();
    }
  });
});
test('current credential retained stored ref legitimately has null operation after same endpoint revision; pending/loss/OFF/removal stay exact', async () => {
  await databaseFixture(8)(async (db) => {
    const s = await fixture(db);
    try {
      const a = await s.provision();
      assert.equal((await s.ack(a, 'retained-ref')).statusCode, 200);
      assert.equal(
        (
          await s.f.owner.put(`/v2/machines/${s.f.machineId}/model-sources`, {
            ...s.config,
            expectedRevision: 1,
            enabled: { claude: true, codex: false, api: true },
          })
        ).statusCode,
        200,
      );
      const kept = await s.get();
      assert.equal(kept.configRevision, 2);
      assert.equal(kept.providers[0]?.credentialRef, 'retained-ref');
      assert.equal(kept.providers[0]?.currentOperationId, null);
      const b = await s.provision(randomUUID(), 2);
      const pending = await s.get();
      assert.equal(pending.providers[0]?.status, 'pending');
      assert.equal(pending.providers[0]?.credentialRef, null);
      assert.equal(pending.providers[0]?.currentOperationId, b.operationId);
      assert.equal(
        (await s.f.machine.post(`/v2/machine/api-secret-envelopes/${b.id}/key-lost`, {})).statusCode,
        200,
      );
      const lost = await s.get();
      assert.equal(lost.providers[0]?.status, 'missing');
      assert.equal(lost.providers[0]?.credentialRef, null);
      assert.equal((await s.ack(a, 'retained-ref')).statusCode, 200);
      assert.deepEqual(await s.get(), lost);
      assert.equal(
        (
          await s.f.owner.put(`/v2/machines/${s.f.machineId}/model-sources`, {
            ...s.config,
            expectedRevision: 2,
            enabled: { claude: false, codex: false, api: false },
          })
        ).statusCode,
        200,
      );
      assert.equal((await s.get()).apiEnabled, false);
      assert.equal(
        (
          await s.f.owner.put(`/v2/machines/${s.f.machineId}/model-sources`, {
            expectedRevision: 3,
            enabled: { claude: false, codex: false, api: false },
            apiProviders: [],
          })
        ).statusCode,
        200,
      );
      assert.deepEqual((await s.get()).providers, []);
    } finally {
      await s.f.close();
    }
  });
});
test('current credential endpoint/protocol change detaches credential and read cannot cross machine or owner session', async () => {
  await databaseFixture(8)(async (db) => {
    const s = await fixture(db);
    try {
      const a = await s.provision();
      assert.equal((await s.ack(a, 'old-origin-ref')).statusCode, 200);
      assert.equal(
        (
          await s.f.owner.put(`/v2/machines/${s.f.machineId}/model-sources`, {
            ...s.config,
            expectedRevision: 1,
            apiProviders: [
              {
                ...s.config.apiProviders[0],
                endpoint: 'https://other.example/v1/',
                protocol: 'chat-completions',
              },
            ],
          })
        ).statusCode,
        200,
      );
      const changed = await s.get();
      assert.equal(changed.configRevision, 2);
      assert.equal(changed.providers[0]?.status, 'missing');
      assert.equal(changed.providers[0]?.credentialRef, null);
      assert.equal(changed.providers[0]?.endpoint, 'https://other.example/v1/');
      assert.equal(changed.providers[0]?.protocol, 'chat-completions');
      const foreign = (await s.f.owner.post('/v2/machines', { name: 'foreign' })).json<{
        machine: { id: string };
        token: string;
      }>();
      const response = await s.f.request(path, 'GET', undefined, {
        authorization: `Bearer ${foreign.token}`,
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        machineId: foreign.machine.id,
        configRevision: null,
        apiEnabled: false,
        providers: [],
      });
      assert.equal(
        (
          await s.f.request(`${path}?machineId=${s.f.machineId}`, 'GET', undefined, {
            authorization: `Bearer ${foreign.token}`,
          })
        ).statusCode,
        400,
      );
      assert.equal((await s.f.owner.get(path)).statusCode, 403);
      await db`update machines set revoked_at=now() where id=${s.f.machineId}`;
      assert.equal((await s.f.machine.get(path)).statusCode, 401);
    } finally {
      await s.f.close();
    }
  });
});
test('current credential read reauthenticates actual credential after preflight in existing repeatable-read snapshot', async () => {
  await databaseFixture(8)(async (db) => {
    const f = await modelFixture(db, {
      configure: async (_app, _options, deps) => {
        const actual = deps.auth.authenticate;
        deps.auth.authenticate = async (request) => {
          const actor = await actual(request);
          if (request.url === path && actor.kind === 'machine')
            await db`update machines set revoked_at=now() where id=${actor.id}`;
          return actor;
        };
      },
    });
    try {
      assert.equal((await f.machine.get(path)).statusCode, 401);
    } finally {
      await f.close();
    }
  });
});
