import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelCommand, PoolEntry, Source } from '../src/models/contracts.ts';
import { databaseFixture } from './support/db.ts';

test('model pool migration creates separate config and immutable report authority', async () => {
  await databaseFixture(8)(async (db) => {
    const [row] = await db`select to_regclass('model_source_configs') is not null as present`;
    assert.equal(row?.present, true);
  });
});

import { randomUUID } from 'node:crypto';
import { modelFixture } from './support/model-http.ts';

const enabled = { claude: true, codex: true, api: true };
const provider = {
  id: randomUUID(),
  endpoint: 'https://example.com/v1',
  protocol: 'responses',
  models: [{ id: 'model-x', declared: ['text', 'tools'] }],
  localHttp: null,
};
const input = (expectedRevision = 0) => ({ expectedRevision, enabled, apiProviders: [provider] });
test('model pool owner CAS sync and machine desired config are real authenticated HTTP', async () => {
  await databaseFixture(8)(async (db) => {
    console.log(
      'model owned fixture',
      process.env.CREW_V2_TEST_CONTAINER_ID,
      process.env.CREW_V2_TEST_DATABASE_URL,
    );
    const f = await modelFixture(db);
    try {
      const p = `/v2/machines/${f.machineId}/model-sources`;
      const r = await f.owner.put(p, input());
      assert.equal(r.statusCode, 200, r.text);
      assert.equal(r.json().revision, 1);
      const desired = await f.machine.get('/v2/machine/model-sources');
      assert.equal(desired.statusCode, 200, desired.text);
      assert.equal(desired.json().revision, 1);
      assert.deepEqual(desired.json().enabled, enabled);
      assert.equal(
        desired.json<{ apiProviders: { credentialStatus: string }[] }>().apiProviders[0].credentialStatus,
        'missing',
      );
      const commands = await f.machine.get('/v2/gateway/commands');
      assert.equal(commands.json<{ items: ModelCommand[] }>().items[0].type, 'sync_models');
      const race = await Promise.all([
        f.owner.put(p, { ...input(1), enabled: { ...enabled, claude: false } }),
        f.owner.put(p, { ...input(1), enabled: { ...enabled, codex: false } }),
      ]);
      assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 409]);
      const [old] = await db`select state,result from gateway_commands where payload->>'configRevision'='1'`;
      assert.equal(old?.state, 'completed');
      assert.equal((old?.result as { code?: string } | undefined)?.code, 'SUPERSEDED');
      assert.equal((await f.request(p, 'PUT', input(2), { cookie: f.identity.cookie })).statusCode, 403);
    } finally {
      await f.close();
    }
  });
});
test('api provider explicit nonempty unique models and canonical endpoint policy reject unsafe inputs', async () => {
  await databaseFixture(8)(async (db) => {
    const f = await modelFixture(db);
    try {
      const p = `/v2/machines/${f.machineId}/model-sources`;
      for (const bad of [
        { ...provider, models: [] },
        { ...provider, models: [provider.models[0], provider.models[0]] },
        { ...provider, endpoint: 'http://localhost:8080/v1' },
        { ...provider, endpoint: 'https://user:password@example.com/v1' },
        { ...provider, endpoint: 'https://169.254.169.254/v1' },
        {
          ...provider,
          endpoint: 'http://127.0.0.1:8080/v1',
          localHttp: { enabled: true, allowedOrigin: 'http://127.0.0.1:8081' },
        },
      ]) {
        const r = await f.owner.put(p, { ...input(), apiProviders: [bad] });
        assert.equal(r.statusCode, 400, r.text);
      }
      const r = await f.owner.put(p, {
        ...input(),
        apiProviders: [
          {
            ...provider,
            endpoint: 'http://[::1]:8080/v1',
            localHttp: { enabled: true, allowedOrigin: 'http://[::1]:8080' },
          },
        ],
      });
      assert.equal(r.statusCode, 200, r.text);
    } finally {
      await f.close();
    }
  });
});

import { createHash } from 'node:crypto';
import { canonicalJson } from '../src/journal/canonical.ts';
import { nextConfig, projection, report } from './support/gateway.ts';

const digest = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');
const context = {
  sourceTreeSha256: 'e'.repeat(64),
  projectionManifestSha256: 'f'.repeat(64),
  projectionTreeSha256: '1'.repeat(64),
  derivationSha256: digest(projection('superpowers').derivation),
  binarySha256: '3'.repeat(64),
  policySha256: '2'.repeat(64),
  osVersion: 'macOS-test',
};
const inventoryReport = (
  machineId: string,
  bootId: string,
  sequence: string,
  status = 'pass',
  configRevision = 1,
) => ({
  reportId: randomUUID(),
  bootId,
  bootGeneration: '1',
  sequence,
  configRevision,
  body: {
    entries: [
      {
        key: { machineId, runtime: 'codex', providerId: 'codex', modelId: 'shared' },
        context,
        observedAt: '2099-01-01T00:00:00.000Z',
        status,
        capabilities: ['text', 'tools'],
        evidenceDigest: '4'.repeat(64),
        errorCode: status === 'fail' ? 'AUTH' : null,
        runtimeVersion: 'same-version',
      },
    ],
  },
});
async function setup(f: Awaited<ReturnType<typeof modelFixture>>) {
  const boot = randomUUID();
  assert.equal((await f.owner.put(`/v2/machines/${f.machineId}/model-sources`, input())).statusCode, 200);
  assert.equal((await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig)).statusCode, 200);
  assert.equal(
    (await f.machine.post('/v2/gateway/boots', { bootId: boot, previousGeneration: '0' })).statusCode,
    200,
  );
  assert.equal((await f.machine.post('/v2/gateway/install-reports', report(boot, '1'))).statusCode, 200);
  return boot;
}
test('model report shared order historical immutable replay and production host PASS stays unverified', async () => {
  await databaseFixture(8)(async (db) => {
    const f = await modelFixture(db);
    try {
      const boot = await setup(f),
        r = inventoryReport(f.machineId, boot, '1');
      const first = await f.machine.post('/v2/machine/models/inventory', r);
      assert.equal(first.statusCode, 200, first.text);
      const [probe] = await db`select * from model_probe_receipts`;
      assert.equal(probe?.status, 'unverified');
      assert.deepEqual(probe?.capabilities, []);
      const originalReceived = (probe?.received_at as Date | undefined)?.getTime();
      assert.ok(((probe?.expires_at as Date | undefined)?.getTime() ?? 0) < Date.parse('2099-01-01'));
      const replay = await f.machine.post('/v2/machine/models/inventory', r);
      assert.deepEqual(replay.json(), first.json());
      assert.equal(
        (await f.machine.post('/v2/machine/models/inventory', { ...r, body: { entries: [] } })).statusCode,
        409,
      );
      const auth = inventoryReport(f.machineId, boot, '3', 'fail');
      assert.equal((await f.machine.post('/v2/machine/models/inventory', auth)).statusCode, 200);
      assert.equal(
        (await f.machine.post('/v2/machine/models/inventory', inventoryReport(f.machineId, boot, '2')))
          .statusCode,
        409,
      );
      const status = {
        claude: { state: 'error', errorCode: 'UNVERIFIED' },
        codex: { state: 'error', errorCode: 'AUTH' },
        api: { state: 'error', errorCode: 'UNVERIFIED' },
      };
      const applied = (inventoryId: string, seq: string) => ({
        reportId: randomUUID(),
        bootId: boot,
        bootGeneration: '1',
        sequence: seq,
        configRevision: 1,
        body: {
          inventoryReportId: inventoryId,
          sourceStatus: structuredClone(status),
          observationDigest: digest(auth.body),
        },
      });
      assert.equal(
        (await f.machine.post('/v2/machine/models/applied', applied(r.reportId, '4'))).statusCode,
        409,
      );
      const partial = applied(auth.reportId, '4');
      delete (
        partial.body.sourceStatus as Partial<Record<Source, { state: string; errorCode: string | null }>>
      ).api;
      const pr = await f.machine.post('/v2/machine/models/applied', partial);
      assert.equal(pr.statusCode, 200, pr.text);
      assert.equal(pr.json().applied, false);
      const full = await f.machine.post('/v2/machine/models/applied', applied(auth.reportId, '5'));
      assert.equal(full.statusCode, 200, full.text);
      assert.equal(full.json().applied, true);
      const [a] = await db`select revision from model_source_applied`;
      assert.equal(a?.revision, 1);
      const errorPool = await f.owner.get(`/v2/machines/${f.machineId}/models?workflow=superpowers`);
      const failedEntry = errorPool.json<{ items: PoolEntry[] }>().items.find((p) => p.runtime === 'codex');
      assert.equal(failedEntry?.sourceApplied, true);
      assert.equal(failedEntry?.reason, 'AUTH');
      const b = randomUUID();
      assert.equal(
        (await f.machine.post('/v2/gateway/boots', { bootId: b, previousGeneration: '1' })).statusCode,
        200,
      );
      assert.equal(
        (await f.machine.post('/v2/machine/models/inventory', inventoryReport(f.machineId, boot, '6')))
          .statusCode,
        409,
      );
      assert.deepEqual((await f.machine.post('/v2/machine/models/inventory', r)).json(), first.json());
      const [after] =
        await db`select received_at from model_probe_receipts where inventory_report_id=${r.reportId}`;
      assert.equal((after?.received_at as Date | undefined)?.getTime(), originalReceived);
      await db`update machines set revoked_at=now() where id=${f.machineId}`;
      assert.equal((await f.machine.post('/v2/machine/models/inventory', r)).statusCode, 401);
    } finally {
      await f.close();
    }
  });
});
test('model pool requires accepted exact workflow pair and rejects cross-machine inventory declaration', async () => {
  await databaseFixture(8)(async (db) => {
    const f = await modelFixture(db);
    try {
      const boot = await setup(f);
      const bad = inventoryReport(randomUUID(), boot, '1');
      assert.equal((await f.machine.post('/v2/machine/models/inventory', bad)).statusCode, 409);
      const r = inventoryReport(f.machineId, boot, '1');
      assert.equal((await f.machine.post('/v2/machine/models/inventory', r)).statusCode, 200);
      const pool = await f.owner.get(`/v2/machines/${f.machineId}/models?workflow=superpowers`);
      assert.equal(pool.statusCode, 200, pool.text);
      assert.equal(pool.json<{ items: PoolEntry[] }>().items[0].available, false);
      assert.equal(pool.json<{ items: PoolEntry[] }>().items[0].reason, 'MODEL_CONFIG_PENDING');
      assert.equal(
        (
          await f.owner.put(`/v2/machines/${f.machineId}/model-sources`, {
            ...input(1),
            enabled: { claude: false, codex: false, api: false },
          })
        ).statusCode,
        200,
      );
      const off = await f.owner.get(`/v2/machines/${f.machineId}/models?workflow=superpowers`);
      assert.equal(off.json().reason, 'NO_SOURCE_ENABLED');
    } finally {
      await f.close();
    }
  });
});

test('sync_models completion requires accepted exact applied revision and cannot bypass through generic 007 ACK', async () => {
  await databaseFixture(8)(async (db) => {
    const f = await modelFixture(db);
    try {
      const boot = await setup(f);
      const list = await f.machine.get('/v2/gateway/commands'),
        command = list.json<{ items: ModelCommand[] }>().items.find((c) => c.type === 'sync_models');
      assert.ok(command);
      const [beforeAck] =
        await db`select (select count(*)::int from events) as events,(select count(*)::int from idempotency) as mutations`;
      const r = await f.machine.post(`/v2/machine/model-commands/${command.id}/ack`, {
        phase: 'completed',
        result: { ok: true },
      });
      assert.equal(r.statusCode, 409, r.text);
      const bypass = await f.machine.post(`/v2/gateway/commands/${command.id}/ack`, {
        phase: 'completed',
        result: { ok: true },
      });
      assert.notEqual(bypass.statusCode, 200);
      const [afterAck] =
        await db`select (select count(*)::int from events) as events,(select count(*)::int from idempotency) as mutations`;
      assert.deepEqual(afterAck, beforeAck);
      assert.equal((await db`select state from gateway_commands where id=${command.id}`)[0]?.state, 'queued');
      assert.equal(
        (await f.machine.post(`/v2/machine/model-commands/${command.id}/ack`, { phase: 'received' }))
          .statusCode,
        200,
      );
      const inv = inventoryReport(f.machineId, boot, '1', 'fail');
      assert.equal((await f.machine.post('/v2/machine/models/inventory', inv)).statusCode, 200);
      const applied = {
        reportId: randomUUID(),
        bootId: boot,
        bootGeneration: '1',
        sequence: '2',
        configRevision: 1,
        body: {
          inventoryReportId: inv.reportId,
          sourceStatus: {
            claude: { state: 'error', errorCode: 'UNVERIFIED' },
            codex: { state: 'error', errorCode: 'AUTH' },
            api: { state: 'error', errorCode: 'UNVERIFIED' },
          },
          observationDigest: digest(inv.body),
        },
      };
      assert.equal((await f.machine.post('/v2/machine/models/applied', applied)).statusCode, 200);
      const completed = await f.machine.post(`/v2/machine/model-commands/${command.id}/ack`, {
        phase: 'completed',
        result: { ok: false, code: 'SOURCE_ERROR', details: { codex: 'AUTH' } },
      });
      assert.equal(completed.statusCode, 200, completed.text);
      assert.equal(
        (
          await f.machine.post(`/v2/machine/model-commands/${command.id}/ack`, {
            phase: 'completed',
            result: { ok: true },
          })
        ).statusCode,
        409,
      );
    } finally {
      await f.close();
    }
  });
});

import { validateEventInput } from '../src/journal/event-contracts.ts';

test('model source events reject secret metadata and wrong audience without leaking inventory', () => {
  const audience = randomUUID(),
    id = randomUUID();
  for (const type of ['source.desired', 'source.applied']) {
    const data = type === 'source.desired' ? { revision: 1 } : { revision: 1, reportId: id };
    const event = { type, projectId: null, ticketId: null, audienceMachineId: audience, data };
    assert.doesNotThrow(() => validateEventInput(event));
    for (const invalid of [
      { ...event, audienceMachineId: null },
      { ...event, projectId: randomUUID() },
      { ...event, data: { ...data, secret: 'fixture' } },
      { ...event, data: { ...data, inventory: [] } },
      { ...event, data: { ...data, revision: 0 } },
    ])
      assert.throws(() => validateEventInput(invalid));
  }
});
test('model HTTP cached mutation rechecks actual token after authentication before journal cache', async () => {
  await databaseFixture(8)(async (db) => {
    let pause = false,
      enteredResolve: () => void = () => {},
      releaseResolve: () => void = () => {};
    let entered = Promise.resolve(),
      release = Promise.resolve();
    const f = await modelFixture(db, {
      configure: async (_app, _options, deps) => {
        const original = deps.mutator;
        deps.mutator = async (c, w) => {
          if (pause && c.route === 'POST:/v2/machine/models/inventory') {
            enteredResolve();
            await release;
          }
          return original(c, w);
        };
      },
    });
    try {
      const boot = await setup(f),
        r = inventoryReport(f.machineId, boot, '1'),
        key = randomUUID();
      const first = await f.machine.post('/v2/machine/models/inventory', r, key);
      assert.equal(first.statusCode, 200);
      entered = new Promise<void>((resolve) => {
        enteredResolve = resolve;
      });
      release = new Promise<void>((resolve) => {
        releaseResolve = resolve;
      });
      pause = true;
      const pending = f.machine.post('/v2/machine/models/inventory', r, key);
      await entered;
      await db`update machines set token_hash=${'9'.repeat(64)} where id=${f.machineId}`;
      releaseResolve();
      const denied = await pending;
      assert.equal(denied.statusCode, 401, denied.text);
      const [count] = await db`select count(*)::int as n from model_report_receipts`;
      assert.equal(count?.n, 1);
    } finally {
      releaseResolve();
      await f.close();
    }
  });
});

import type { ProbeResult } from '../src/models/contracts.ts';
import { modelObserverFixture } from './support/model-observer.ts';

test('fake provider HTTP observer can prove only probe protocol; pool remains unavailable without isolation certificate', async () => {
  await databaseFixture(8)(async (db) => {
    let observed: ProbeResult;
    const observer = await modelObserverFixture(() => observed);
    const f = await modelFixture(db, { modelPorts: { probeVerifier: observer.verifier } });
    try {
      const boot = await setup(f);
      await f.owner.put(`/v2/machines/${f.machineId}/model-sources`, {
        expectedRevision: 1,
        enabled: { claude: false, codex: true, api: false },
        apiProviders: [],
      });
      const r = inventoryReport(f.machineId, boot, '1', 'pass', 2);
      r.body.entries[0].capabilities.push('vision');
      observed = r.body.entries[0] as ProbeResult;
      const accepted = await f.machine.post('/v2/machine/models/inventory', r);
      assert.equal(accepted.statusCode, 200, accepted.text);
      const [probe] = await db`select status,capabilities from model_probe_receipts`;
      assert.equal(probe?.status, 'pass');
      assert.deepEqual(probe?.capabilities, ['text', 'tools']);
      const applied = {
        reportId: randomUUID(),
        bootId: boot,
        bootGeneration: '1',
        sequence: '2',
        configRevision: 2,
        body: {
          inventoryReportId: r.reportId,
          sourceStatus: {
            claude: { state: 'disabled', errorCode: null },
            codex: { state: 'ready', errorCode: null },
            api: { state: 'disabled', errorCode: null },
          },
          observationDigest: digest(r.body),
        },
      };
      assert.equal((await f.machine.post('/v2/machine/models/applied', applied)).statusCode, 200);
      const pool = await f.owner.get(`/v2/machines/${f.machineId}/models?workflow=superpowers`);
      assert.equal(pool.json<{ items: PoolEntry[] }>().items[0].reason, 'CERTIFICATION_UNVERIFIED');
      assert.equal(pool.json<{ items: PoolEntry[] }>().items[0].available, false);
    } finally {
      await f.close();
      await observer.close();
    }
  });
});

import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { connectDb } from '../src/db/client.ts';
import { captureMigrations, migrate } from '../src/db/migrate.ts';

test('model pool prefix7 backup restore migrate8 restores immutable reports and rejects checksum or FK drift', async () => {
  await databaseFixture(7)(async (db) => {
    const containerId = process.env.CREW_V2_TEST_CONTAINER_ID,
      base = process.env.CREW_V2_TEST_DATABASE_URL;
    assert.ok(containerId);
    assert.match(containerId, /^[0-9a-f]{64}$/);
    assert.ok(base);
    const [name] = await db`select current_database() as name`;
    const sourceDb = String(name?.name);
    const restoredName = `crew_v2_test_${randomUUID().replaceAll('-', '')}`;
    console.info(
      'model-backup-owned',
      JSON.stringify({ containerId, port: new URL(base).port, sourceDb, restoredName }),
    );
    const dump = () => {
      const r = spawnSync('docker', ['exec', containerId, 'pg_dump', '-Fc', '-U', 'postgres', sourceDb], {
        maxBuffer: 16 * 1024 * 1024,
      });
      assert.equal(r.status, 0, r.stderr.toString());
      return r.stdout;
    };
    const admin = postgres(base, { max: 1 });
    await admin`create database ${admin(restoredName)}`;
    const restoredUrl = new URL(base);
    restoredUrl.pathname = `/${restoredName}`;
    let restored: ReturnType<typeof connectDb> | undefined;
    const restore = (bytes: Buffer) => {
      const r = spawnSync(
        'docker',
        [
          'exec',
          '-i',
          containerId,
          'pg_restore',
          '--clean',
          '--if-exists',
          '-U',
          'postgres',
          '-d',
          restoredName,
        ],
        { input: bytes, maxBuffer: 16 * 1024 * 1024 },
      );
      assert.equal(r.status, 0, r.stderr.toString());
    };
    try {
      restore(dump());
      restored = connectDb(restoredUrl.toString());
      assert.equal((await restored`select version from schema_migrations`).length, 7);
      await restored.end();
      restored = undefined;
      const set = await captureMigrations(8);
      await migrate(db, set);
      await migrate(db, set);
      const f = await modelFixture(db);
      try {
        const boot = await setup(f),
          r = inventoryReport(f.machineId, boot, '1');
        const response = await f.machine.post('/v2/machine/models/inventory', r);
        assert.equal(response.statusCode, 200);
        await assert.rejects(
          db`update model_report_receipts set sequence=99`,
          (e) => (e as { code: string }).code === '23514',
        );
        await assert.rejects(
          db`delete from model_probe_receipts`,
          (e) => (e as { code: string }).code === '23514',
        );
        await assert.rejects(
          db`update model_source_configs set enabled='{"claude":1,"codex":true,"api":false}'`,
          (e) => (e as { code: string }).code === '23514',
        );
        await assert.rejects(
          db`insert into model_source_applied(machine_id,revision,report_id,boot_generation,sequence,inventory_report_id,reported_at,source_status) values(${f.machineId},1,${randomUUID()},1,2,${randomUUID()},now(),'{}')`,
          (e) => (e as { code: string }).code === '23503',
        );
        const before = await db`select * from model_report_receipts`;
        restore(dump());
        restored = connectDb(restoredUrl.toString());
        await migrate(restored, set);
        assert.deepEqual(await restored`select * from model_report_receipts`, before);
        const reopened = await modelFixture(restored, { prior: f.prior });
        try {
          assert.deepEqual(
            (await reopened.machine.post('/v2/machine/models/inventory', r)).json(),
            response.json(),
          );
        } finally {
          await reopened.close();
        }
        const altered = set.files.map((m) =>
          m.version === 8
            ? {
                ...m,
                sql: `${m.sql}\n-- test drift\n`,
                sha256: createHash('sha256').update(`${m.sql}\n-- test drift\n`).digest('hex'),
              }
            : m,
        );
        await assert.rejects(migrate(restored, { through: 8, files: altered }), /MIGRATION_DRIFT/);
      } finally {
        await f.close();
      }
    } finally {
      await restored?.end();
      await admin`drop database ${admin(restoredName)} with (force)`;
      await admin.end();
      console.info('model-backup-cleaned', JSON.stringify({ sourceDb, restoredName }));
    }
  });
});
