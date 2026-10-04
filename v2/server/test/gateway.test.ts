import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';
import { connectDb } from '../src/db/client.ts';
import { captureMigrations, migrate } from '../src/db/migrate.ts';
import { canonicalJson } from '../src/journal/canonical.ts';
import { validateEventInput } from '../src/journal/event-contracts.ts';
import { databaseFixture } from './support/db.ts';
import { openPeerDb } from './support/execution.ts';
import {
  bootId,
  countExecutionRows,
  gatewayFixture,
  heartbeat,
  inventory,
  nextConfig,
  prepareSelection,
  projection,
  report,
  selectionAuthorityFixture,
  source,
} from './support/gateway.ts';

test('gateway migration 007 có prefix riêng và checksum replay', async () =>
  databaseFixture(6)(async (db) => {
    await migrate(db, await captureMigrations(7));
    await migrate(db, await captureMigrations(7));
    const [row] = await db`select checksum from schema_migrations where version=7`;
    assert.match(String(row?.checksum), /^[0-9a-f]{64}$/);
    const tables = await db`select tablename from pg_tables where tablename like 'gateway_%'`;
    assert.equal(tables.length, 9);
  }));

test('gateway boot và heartbeat dùng auth thật, giữ execution namespace bất biến', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const before = await countExecutionRows(db);
      const boot = await f.machine.post('/v2/gateway/boots', { bootId, previousGeneration: '0' });
      assert.equal(boot.statusCode, 200, boot.text);
      assert.equal(boot.json().bootGeneration, '1');
      const config = await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      assert.equal(config.statusCode, 200, config.text);
      const first = await f.machine.post('/v2/gateway/heartbeat', heartbeat(bootId, '1', '1'));
      assert.equal(first.statusCode, 200, first.text);
      assert.notEqual(first.json().serverTime, '2000-01-01T00:00:00.000Z');
      assert.equal(
        (await f.machine.post('/v2/gateway/heartbeat', heartbeat(bootId, '1', '2'))).statusCode,
        200,
      );
      assert.deepEqual(
        (await f.machine.post('/v2/gateway/heartbeat', heartbeat(bootId, '1', '1'))).json(),
        first.json(),
      );
      assert.equal(
        (
          await f.machine.post(
            '/v2/gateway/heartbeat',
            heartbeat(bootId, '1', '1', { hostVersion: 'changed' }),
          )
        ).statusCode,
        409,
      );
      assert.deepEqual(await countExecutionRows(db), before);
      const nextBoot = randomUUID();
      assert.equal(
        (await f.machine.post('/v2/gateway/boots', { bootId: nextBoot, previousGeneration: '1' })).json()
          .bootGeneration,
        '2',
      );
      assert.equal(
        (await f.machine.post('/v2/gateway/heartbeat', heartbeat(bootId, '1', '999'))).json<{
          error: { code: string };
        }>().error.code,
        'BOOT_RETIRED',
      );
    } finally {
      await f.close();
    }
  }));

test('gateway config CAS, URL allowlist, CSRF và schema đóng', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const path = `/v2/gateway/machines/${f.machineId}/config`;
      assert.equal(
        (
          await f.request(path, 'PUT', nextConfig, {
            cookie: f.identity.cookie,
            'idempotency-key': randomUUID(),
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (await f.machine.post('/v2/gateway/boots', { bootId, previousGeneration: '0', secret: 'hidden' }))
          .statusCode,
        400,
      );
      for (const url of [
        'https://github.com.evil.test/obra/superpowers/archive/refs/tags/v6.4.2.tar.gz',
        'https://github.com/obra/superpowers/archive/refs/tags/v6.4.2.tar.gz?token=x',
        'https://github.com/obra/superpowers/archive/refs/tags/v6.4.1.tar.gz',
        'http://github.com/obra/superpowers/archive/refs/tags/v6.4.2.tar.gz',
      ]) {
        const bad = structuredClone(nextConfig);
        bad.desired.superpowers.source.sourceUrl = url;
        assert.equal((await f.owner.put(path, bad)).statusCode, 400);
      }
      const results = await Promise.all([f.owner.put(path, nextConfig), f.owner.put(path, nextConfig)]);
      assert.deepEqual(results.map((x) => x.statusCode).sort(), [200, 409]);
      assert.equal((await f.machine.get('/v2/gateway/config')).json<{ revision: number }>().revision, 1);
      const [counts] = await db`select count(*)::int as n from gateway_commands`;
      assert.equal(counts?.n, 1);
    } finally {
      await f.close();
    }
  }));

test('gateway boot CAS giữ lịch sử, receipt bất biến và trạng thái hiện tại', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const a = randomUUID(),
        b = randomUUID();
      const ba = await f.machine.post('/v2/gateway/boots', { bootId: a, previousGeneration: '0' });
      assert.equal(ba.statusCode, 200, ba.text);
      const h = heartbeat(a, '1', '1');
      const first = await f.machine.post('/v2/gateway/heartbeat', h);
      assert.equal(first.statusCode, 200, first.text);
      const boots = await Promise.all([
        f.machine.post('/v2/gateway/boots', { bootId: b, previousGeneration: '1' }),
        f.machine.post('/v2/gateway/boots', { bootId: randomUUID(), previousGeneration: '1' }),
      ]);
      assert.deepEqual(boots.map((x) => x.statusCode).sort(), [200, 409]);
      const [current] = await db`select boot_id from gateway_boots where retired_at is null`;
      const cb = String(current?.boot_id);
      assert.equal(
        (await f.machine.post('/v2/gateway/boots', { bootId: cb, previousGeneration: '1' })).json()
          .bootGeneration,
        '2',
      );
      assert.equal(
        (await f.machine.post('/v2/gateway/boots', { bootId: a, previousGeneration: '0' })).json<{
          error: { code: string };
        }>().error.code,
        'BOOT_RETIRED',
      );
      assert.equal((await f.machine.post('/v2/gateway/heartbeat', heartbeat(cb, '2', '1'))).statusCode, 200);
      assert.deepEqual((await f.machine.post('/v2/gateway/heartbeat', h)).json(), first.json());
      assert.equal(
        (await f.machine.post('/v2/gateway/heartbeat', heartbeat(a, '1', '2'))).json<{
          error: { code: string };
        }>().error.code,
        'BOOT_RETIRED',
      );
      const [state] = await db`select boot_id,sequence from gateway_heartbeats`;
      assert.equal(state?.boot_id, cb);
      assert.equal(String(state?.sequence), '1');
      await assert.rejects(db`update gateway_heartbeat_receipts set response='{}'`, /GATEWAY_IMMUTABLE/);
    } finally {
      await f.close();
    }
  }));

test('gateway install report xác nhận exact source/projection và giữ applied qua partial, retired replay', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const a = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId: a, previousGeneration: '0' });
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      const before = await countExecutionRows(db);
      const good = report(a, '1');
      const first = await f.machine.post('/v2/gateway/install-reports', good);
      assert.equal(first.statusCode, 200, first.text);
      assert.equal(first.json().accepted, true);
      assert.equal(first.json().appliedRevision, 1);
      const bad = report(a, '1');
      assert.ok(bad.results.superpowers.projections.codex.installed);
      bad.results.superpowers.projections.codex.installed.treeSha256 = '9'.repeat(64);
      const mismatch = await f.machine.post('/v2/gateway/install-reports', bad);
      assert.equal(mismatch.statusCode, 200, mismatch.text);
      assert.equal(mismatch.json().accepted, false);
      assert.equal(mismatch.json().appliedRevision, 1);
      const partial = report(a, '1', 1, false);
      const failed = await f.machine.post('/v2/gateway/install-reports', partial);
      assert.equal(failed.statusCode, 200);
      assert.equal(failed.json().appliedRevision, 1);
      const b = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId: b, previousGeneration: '1' });
      assert.equal(
        (await f.machine.post('/v2/gateway/install-reports', report(a, '1'))).json<{
          error: { code: string };
        }>().error.code,
        'BOOT_RETIRED',
      );
      const prior = await db`select * from gateway_applied`;
      assert.deepEqual((await f.machine.post('/v2/gateway/install-reports', good)).json(), first.json());
      assert.deepEqual(await db`select * from gateway_applied`, prior);
      const changed = { ...nextConfig, expectedRevision: 1, maxJobs: 3 };
      assert.equal(
        (await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, changed)).statusCode,
        200,
      );
      assert.equal(
        (await f.machine.post('/v2/gateway/install-reports', report(b, '2', 1))).json<{
          error: { code: string };
        }>().error.code,
        'CONFIG_REVISION_CONFLICT',
      );
      assert.deepEqual(await countExecutionRows(db), before);
      await assert.rejects(db`delete from gateway_install_reports`, /GATEWAY_IMMUTABLE/);
    } finally {
      await f.close();
    }
  }));

const skills = [
  { path: 'skills/brainstorming/SKILL.md', sha256: 'a1'.repeat(32) },
  { path: 'skills/writing-plans/SKILL.md', sha256: 'b2'.repeat(32) },
];
// Mirrors the gateway definition identity: SHA-256 over the canonical pinned context.
function definitionFor(workflow: 'bmad' | 'superpowers', render?: Record<string, unknown>) {
  const customizationSha256 = 'c3'.repeat(32);
  const pinned = { source: source(workflow), projection: projection(workflow) };
  return {
    sha256: createHash('sha256')
      .update(canonicalJson({ ...pinned, skills, customizationSha256, render: render ?? null }))
      .digest('hex'),
    skills,
    customizationSha256,
    ...(render ? { render } : {}),
  };
}
type ReportedSlot = { state: string; definition?: unknown };
const slotOf = (inventory: unknown, workflow: string, runtime: string): ReportedSlot => {
  const status = (inventory as Record<string, { projections: Record<string, ReportedSlot> }>)[workflow];
  assert.ok(status, workflow);
  const slot = status.projections[runtime];
  assert.ok(slot, runtime);
  return slot;
};
const withDefinition = (bootId: string, definition: unknown) => {
  const next = report(bootId, '1');
  (next.results.superpowers.projections.codex as { definition?: unknown }).definition = definition;
  return next;
};

test('gateway install report lưu definition cộng thêm nguyên bản, thiếu definition vẫn được nhận', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const a = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId: a, previousGeneration: '0' });
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      const plain = await f.machine.post('/v2/gateway/install-reports', report(a, '1'));
      assert.equal(plain.json().accepted, true, plain.text);
      const [stored] = await db`select workflow_status from gateway_applied`;
      assert.equal(
        'definition' in slotOf(stored?.workflow_status, 'superpowers', 'codex'),
        false,
        'báo cáo không có definition không được thêm trường nào',
      );

      const definition = definitionFor('superpowers');
      const withDef = withDefinition(a, definition);
      const first = await f.machine.post('/v2/gateway/install-reports', withDef);
      assert.equal(first.statusCode, 200, first.text);
      assert.equal(first.json().accepted, true);
      assert.equal(first.json().appliedRevision, 1);
      const [applied] = await db`select workflow_status,inventory from gateway_applied`;
      const slot = slotOf(applied?.workflow_status, 'superpowers', 'codex');
      assert.deepEqual(slot.definition, definition);
      assert.equal(slot.state, 'current');
      assert.equal('definition' in slotOf(applied?.workflow_status, 'bmad', 'codex'), false);
      const [row] = await db`select report from gateway_install_reports where id=${withDef.reportId}`;
      assert.deepEqual(
        slotOf((row?.report as { results: unknown } | undefined)?.results, 'superpowers', 'codex').definition,
        definition,
      );

      // body_hash vẫn phủ toàn bộ body: cùng reportId nhưng thiếu definition là xung đột, replay đúng giữ response.
      const stripped = structuredClone(withDef);
      delete (stripped.results.superpowers.projections.codex as { definition?: unknown }).definition;
      const conflict = await f.machine.post('/v2/gateway/install-reports', stripped);
      assert.equal(conflict.json<{ error: { code: string } }>().error.code, 'INSTALL_REPORT_CONFLICT');
      assert.deepEqual((await f.machine.post('/v2/gateway/install-reports', withDef)).json(), first.json());
    } finally {
      await f.close();
    }
  }));

test('gateway install report từ chối definition lệch pin đã cài và không lưu definition đó', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const a = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId: a, previousGeneration: '0' });
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      assert.equal(
        (await f.machine.post('/v2/gateway/install-reports', report(a, '1'))).json().accepted,
        true,
      );
      const good = definitionFor('superpowers');
      const cases: Record<string, unknown> = {
        'sha256 lệch': { ...good, sha256: '9'.repeat(64) },
        'skills bị đổi sau khi băm': {
          ...good,
          skills: [{ ...skills[0], sha256: '8'.repeat(64) }, skills[1]],
        },
        'customization bị đổi sau khi băm': { ...good, customizationSha256: '7'.repeat(64) },
        'render thuộc pin khác': (() => {
          const render = {
            source: source('bmad'),
            projection: projection('superpowers'),
            selectedProjectionSha256: {},
            layers: {},
          };
          return definitionFor('superpowers', render);
        })(),
      };
      for (const [name, definition] of Object.entries(cases)) {
        const result = await f.machine.post('/v2/gateway/install-reports', withDefinition(a, definition));
        assert.equal(result.statusCode, 200, `${name}: ${result.text}`);
        const body = result.json<{ accepted: boolean; appliedRevision: number; workflows: unknown }>();
        assert.equal(body.accepted, false, name);
        assert.equal(body.appliedRevision, 1, name);
        const slot = slotOf(body.workflows, 'superpowers', 'codex');
        assert.equal(slot.state, 'mismatch', name);
        assert.equal('definition' in slot, false, name);
        const [applied] = await db`select workflow_status from gateway_applied`;
        assert.equal('definition' in slotOf(applied?.workflow_status, 'superpowers', 'codex'), false, name);
      }
    } finally {
      await f.close();
    }
  }));

test('gateway install report: definition không thay đổi so khớp pin và schema vẫn đóng', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const a = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId: a, previousGeneration: '0' });
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      // Definition hợp lệ không cứu được projection lệch pin.
      const drift = withDefinition(a, definitionFor('superpowers'));
      assert.ok(drift.results.superpowers.projections.codex.installed);
      drift.results.superpowers.projections.codex.installed.treeSha256 = '9'.repeat(64);
      const drifted = await f.machine.post('/v2/gateway/install-reports', drift);
      const driftBody = drifted.json<{ accepted: boolean; workflows: unknown }>();
      assert.equal(driftBody.accepted, false);
      assert.equal(slotOf(driftBody.workflows, 'superpowers', 'codex').state, 'mismatch');
      // Definition trên slot không có pin cài (installed=null) không được nhận.
      const orphan = report(a, '1');
      (orphan.results.superpowers.projections.api as { definition?: unknown }).definition =
        definitionFor('superpowers');
      assert.equal((await f.machine.post('/v2/gateway/install-reports', orphan)).json().accepted, false);
      // Schema đóng: trường lạ hoặc digest sai là 400; heartbeat vẫn không nhận definition.
      for (const bad of [
        { ...definitionFor('superpowers'), extra: 1 },
        { ...definitionFor('superpowers'), sha256: 'xyz' },
        { sha256: '1'.repeat(64) },
      ])
        assert.equal(
          (await f.machine.post('/v2/gateway/install-reports', withDefinition(a, bad))).statusCode,
          400,
        );
      const beat = heartbeat(a, '1', '1');
      (beat.inventory.superpowers.projections.codex as { definition?: unknown }).definition =
        definitionFor('superpowers');
      assert.equal((await f.machine.post('/v2/gateway/heartbeat', beat)).statusCode, 400);
    } finally {
      await f.close();
    }
  }));

test('gateway management command cursor, ACK mất phản hồi/gửi lại không hạ trạng thái completed', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      const first = await f.machine.get('/v2/gateway/commands?after=0');
      assert.equal(first.statusCode, 200, first.text);
      const command = first.json<{ items: { id: string; cursor: string }[]; nextCursor: string }>().items[0];
      assert.ok(command);
      assert.equal(command.cursor, '1');
      const path = `/v2/gateway/commands/${command.id}/ack`;
      const completion = { phase: 'completed', result: { ok: true, code: 'SYNCED' } };
      assert.equal((await f.machine.post(path, completion)).json().state, 'completed');
      assert.equal((await f.machine.post(path, { phase: 'received' })).json().state, 'completed');
      assert.equal((await f.machine.post(path, completion)).statusCode, 200);
      assert.equal(
        (await f.machine.post(path, { phase: 'completed', result: { ok: false } })).json<{
          error: { code: string };
        }>().error.code,
        'COMMAND_ACK_CONFLICT',
      );
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, {
        ...nextConfig,
        expectedRevision: 1,
        maxJobs: 3,
      });
      const second = await f.machine.get('/v2/gateway/commands?after=1');
      assert.deepEqual(
        second.json<{ items: { cursor: string }[] }>().items.map((x) => x.cursor),
        ['2'],
      );
      assert.equal((await f.machine.get('/v2/gateway/commands?after=9223372036854775808')).statusCode, 400);
      assert.equal((await f.machine.get('/v2/gateway/commands?extra=1')).statusCode, 400);
    } finally {
      await f.close();
    }
  }));

async function readyGateway(
  db: Parameters<Parameters<ReturnType<typeof databaseFixture>>[0]>[0],
  defaultProjection = false,
) {
  const authority = await selectionAuthorityFixture(db);
  const f = await gatewayFixture(db, {
    authorizeDispatch: authority.authorizeDispatch,
    ...(defaultProjection ? {} : { projectionPolicy: authority.projectionPolicy }),
  });
  const id = randomUUID();
  assert.equal(
    (await f.machine.post('/v2/gateway/boots', { bootId: id, previousGeneration: '0' })).statusCode,
    200,
  );
  assert.equal((await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig)).statusCode, 200);
  const installation = report(id, '1');
  assert.equal((await f.machine.post('/v2/gateway/install-reports', installation)).json().accepted, true);
  return { f, id, installation };
}
function companion(
  attempt: { id: string; fence: string; processInstanceId: string },
  selection: {
    sourceTreeSha256: string;
    runtime: string;
    projectionManifestSha256: string;
    projectionTreeSha256: string;
    installReportId: string;
  },
) {
  return {
    fence: attempt.fence,
    processInstanceId: attempt.processInstanceId,
    sourceTreeSha256: selection.sourceTreeSha256,
    runtime: selection.runtime,
    projectionManifestSha256: selection.projectionManifestSha256,
    projectionTreeSha256: selection.projectionTreeSha256,
    installReportId: selection.installReportId,
  };
}

test('gateway projection production fail-closed trước khi tạo companion', async () =>
  databaseFixture(7)(async (db) => {
    const { f } = await readyGateway(db, true);
    try {
      const p = await prepareSelection(f, db);
      const claim = await p.claim();
      assert.equal(claim.statusCode, 201, claim.text);
      const attempt = claim.json<{ id: string; fence: string; processInstanceId: string }>();
      const response = await f.machine.post(
        `/v2/gateway/attempts/${attempt.id}/projection`,
        companion(attempt, p.selected),
      );
      assert.equal(response.statusCode, 503, response.text);
      assert.equal(response.json<{ error: { code: string } }>().error.code, 'SELECTION_NOT_CONFIGURED');
      assert.equal((await db`select * from gateway_attempt_projections`).length, 0);
    } finally {
      await f.close();
    }
  }));

test('gateway projection server selection bắt buộc, row bất biến, replay cùng pin sau update', async () =>
  databaseFixture(7)(async (db) => {
    const { f } = await readyGateway(db);
    try {
      const p = await prepareSelection(f, db);
      const claim = await p.claim();
      assert.equal(claim.statusCode, 201, claim.text);
      const attempt = claim.json<{ id: string; fence: string; processInstanceId: string }>();
      const path = `/v2/gateway/attempts/${attempt.id}/projection`,
        body = companion(attempt, p.selected);
      assert.equal(
        (await f.machine.post(path, { ...body, projectionTreeSha256: '9'.repeat(64) })).json<{
          error: { code: string };
        }>().error.code,
        'SELECTION_MISMATCH',
      );
      const first = await f.machine.post(path, body);
      assert.equal(first.statusCode, 200, first.text);
      assert.equal(first.json().attemptId, attempt.id);
      assert.equal(
        (
          await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, {
            ...nextConfig,
            expectedRevision: 1,
            maxJobs: 3,
            enabled: false,
          })
        ).statusCode,
        200,
      );
      assert.deepEqual((await f.machine.post(path, body)).json(), first.json());
      assert.equal((await f.machine.post(path, { ...body, installReportId: randomUUID() })).statusCode, 409);
      assert.equal(
        (await f.machine.post(path, { ...body, fence: '99' })).json<{ error: { code: string } }>().error.code,
        'STALE_FENCE',
      );
      await assert.rejects(db`update gateway_attempt_projections set runtime='claude'`, /GATEWAY_IMMUTABLE/);
    } finally {
      await f.close();
    }
  }));

test('gateway fresh claim từ chối report cũ, config tắt, thiếu decision, payload đổi trước RELEASE', async () =>
  databaseFixture(7)(async (db) => {
    const { f, id, installation } = await readyGateway(db);
    try {
      await f.machine.post('/v2/gateway/install-reports', report(id, '1'));
      const old = await prepareSelection(f, db, { installReportId: installation.reportId });
      assert.equal((await old.claim()).statusCode, 409);
      const noDecision = await prepareSelection(f, db);
      await db`update decisions set scope='{}' where id=${noDecision.decisionId}`;
      assert.equal((await noDecision.claim()).statusCode, 409);
      const changed = await prepareSelection(f, db);
      await db`update commands set payload=${db.json({ selection: { ...changed.selected, projectionTreeSha256: '9'.repeat(64) } })} where id=${changed.commandId}`;
      assert.equal((await changed.claim()).statusCode, 409);
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, {
        ...nextConfig,
        expectedRevision: 1,
        enabled: false,
      });
      const disabled = await prepareSelection(f, db);
      assert.equal((await disabled.claim()).statusCode, 409);
      assert.equal((await db`select * from attempts`).length, 0);
      assert.equal((await db`select * from gateway_attempt_projections`).length, 0);
    } finally {
      await f.close();
    }
  }));

test('gateway receipt tồn tại qua close/reopen pool, auth revoked/rotated không đọc cached response', async () =>
  databaseFixture(7)(async (db) => {
    let f = await gatewayFixture(db);
    let peer: Awaited<ReturnType<typeof openPeerDb>> | undefined;
    try {
      const id = randomUUID(),
        key = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId: id, previousGeneration: '0' });
      const h = heartbeat(id, '1', '1'),
        first = await f.machine.post('/v2/gateway/heartbeat', h, key);
      const prior = f.prior;
      await f.close();
      peer = await openPeerDb(db);
      f = await gatewayFixture(peer, { prior });
      assert.deepEqual((await f.machine.post('/v2/gateway/heartbeat', h)).json(), first.json());
      assert.deepEqual((await f.machine.post('/v2/gateway/heartbeat', h, key)).json(), first.json());
      await db`update machines set token_hash=${'9'.repeat(64)} where id=${f.machineId}`;
      assert.equal((await f.machine.post('/v2/gateway/heartbeat', h, key)).statusCode, 401);
      assert.equal((await f.machine.get('/v2/gateway/config')).statusCode, 401);
      await db`update machines set revoked_at=now() where id=${f.machineId}`;
      assert.equal(
        (await f.machine.post('/v2/gateway/boots', { bootId: randomUUID(), previousGeneration: '1' }))
          .statusCode,
        401,
      );
    } finally {
      await f.close();
      await peer?.end();
    }
  }));

test('gateway machine scope không làm lỏng project ACL, status offline không nhả execution guard', async () =>
  databaseFixture(7)(async (db) => {
    const { f } = await readyGateway(db);
    try {
      const p = await prepareSelection(f, db),
        claimed = await p.claim();
      assert.equal(claimed.statusCode, 201, claimed.text);
      const attempt = claimed.json<{ id: string; fence: string; processInstanceId: string }>();
      const before = await countExecutionRows(db);
      const hb = heartbeat(f.prior.machineId, '1', '1'); // Replace boot ID with the actual persisted boot below.
      const [boot] =
        await db`select boot_id from gateway_boots where machine_id=${f.machineId} and retired_at is null`;
      hb.bootId = String(boot?.boot_id);
      hb.processes = [
        {
          attemptId: attempt.id,
          processInstanceId: attempt.processInstanceId,
          fence: attempt.fence,
          observation: 'stopped',
        },
      ];
      assert.equal((await f.machine.post('/v2/gateway/heartbeat', hb)).statusCode, 200);
      await db`update gateway_heartbeats set received_at=now()-interval '2 minutes' where machine_id=${f.machineId}`;
      const status = await f.owner.get(`/v2/gateway/machines/${f.machineId}/status`);
      assert.equal(status.statusCode, 200, status.text);
      assert.equal(status.json().serverConnection, 'offline');
      assert.deepEqual(await countExecutionRows(db), before);
      const [guard] =
        await db`select active_attempt_id from execution_guards where ticket_id=${p.tickets.a.id}`;
      assert.equal(guard?.active_attempt_id, attempt.id);
      const second = await f.owner.post('/v2/machines', { name: 'foreign' });
      const foreign = second.json<{ machine: { id: string }; token: string }>();
      const command = (await f.machine.get('/v2/gateway/commands')).json<{ items: { id: string }[] }>()
        .items[0];
      assert.ok(command);
      assert.equal(
        (await f.machineWrite(`/v2/gateway/commands/${command.id}/ack`, foreign.token, { phase: 'received' }))
          .statusCode,
        404,
      );
      assert.equal(
        (
          await f.machineWrite(
            `/v2/gateway/attempts/${attempt.id}/projection`,
            foreign.token,
            companion(attempt, p.selected),
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (await f.machine.get(`/v2/gateway/machines/${foreign.machine.id}/status`)).statusCode,
        403,
      );
      assert.equal(
        (
          await f.machineWrite('/v2/gateway/boots', foreign.token, {
            bootId: randomUUID(),
            previousGeneration: '0',
          })
        ).statusCode,
        200,
      );
      const r = await f.request(`/v2/tickets/${p.tickets.a.id}`, 'GET', undefined, {
        authorization: `Bearer ${foreign.token}`,
      });
      assert.equal(r.statusCode, 404);
    } finally {
      await f.close();
    }
  }));

test('gateway install report exact derivation/source payload, partial runtime, stale config và sanitization', async () =>
  databaseFixture(7)(async (db) => {
    const { f, id } = await readyGateway(db);
    try {
      const badSource = report(id, '1');
      assert.ok(badSource.results.bmad.source.installed);
      badSource.results.bmad.source.installed.payloadSha256 = '9'.repeat(64);
      const sourceResult = await f.machine.post('/v2/gateway/install-reports', badSource);
      assert.equal(sourceResult.json().accepted, false);
      const derivation = report(id, '1');
      assert.ok(derivation.results.superpowers.projections.codex.installed);
      derivation.results.superpowers.projections.codex.installed.derivation.options = ['changed'];
      assert.equal((await f.machine.post('/v2/gateway/install-reports', derivation)).json().accepted, false);
      const partial = report(id, '1');
      partial.results.bmad.projections.codex.state = 'installing';
      partial.results.bmad.projections.codex.lastError = {
        code: 'BAD_PATH',
        message: '/Users/private token=secret-value',
      };
      const result = await f.machine.post('/v2/gateway/install-reports', partial);
      assert.equal(result.json().accepted, false);
      assert.equal(result.json().appliedRevision, 1);
      assert.ok(!result.text.includes('/Users/private'));
      assert.ok(!result.text.includes('secret-value'));
      const [stored] = await db`select report from gateway_install_reports where id=${partial.reportId}`;
      assert.ok(!JSON.stringify(stored?.report).includes('secret-value'));
      const fully = report(id, '1'),
        receipt = await f.machine.post('/v2/gateway/install-reports', fully);
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, {
        ...nextConfig,
        expectedRevision: 1,
        maxJobs: 3,
      });
      const prior = await db`select * from gateway_applied`;
      assert.deepEqual((await f.machine.post('/v2/gateway/install-reports', fully)).json(), receipt.json());
      assert.deepEqual(await db`select * from gateway_applied`, prior);
      assert.equal(
        (
          await f.machine.post('/v2/gateway/install-reports', {
            ...fully,
            reportedAt: '2026-10-02T00:00:00.000Z',
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (await f.machine.post('/v2/gateway/heartbeat', heartbeat(id, '1', '9223372036854775808'))).statusCode,
        400,
      );
    } finally {
      await f.close();
    }
  }));

test('gateway migration007 FK/CHECK/UNIQUE và backup6→restore→migrate7→restore receipts', async () =>
  databaseFixture(6)(async (db) => {
    const containerId = process.env.CREW_V2_TEST_CONTAINER_ID;
    assert.ok(containerId);
    assert.match(containerId, /^[0-9a-f]{64}$/);
    const base = process.env.CREW_V2_TEST_DATABASE_URL;
    assert.ok(base);
    const [name] = await db`select current_database() as name`;
    const source = String(name?.name);
    console.info('gateway-owned-fixture', JSON.stringify({ containerId, port: new URL(base).port, source }));
    const dump = () => {
      const result = spawnSync('docker', ['exec', containerId, 'pg_dump', '-Fc', '-U', 'postgres', source], {
        maxBuffer: 8 * 1024 * 1024,
      });
      assert.equal(result.status, 0, result.stderr.toString());
      return result.stdout;
    };
    const beforeDump = dump();
    const admin = postgres(base, { max: 1 });
    const restoredName = `crew_v2_test_${randomUUID().replaceAll('-', '')}`;
    await admin`create database ${admin(restoredName)}`;
    const url = new URL(base);
    url.pathname = `/${restoredName}`;
    let restored: ReturnType<typeof connectDb> | undefined;
    try {
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
          { input: bytes, maxBuffer: 8 * 1024 * 1024 },
        );
        assert.equal(r.status, 0, r.stderr.toString());
      };
      restore(beforeDump);
      restored = connectDb(url.toString());
      assert.equal((await restored`select version from schema_migrations`).length, 6);
      await restored.end();
      restored = undefined;
      await migrate(db, await captureMigrations(7));
      const f = await gatewayFixture(db);
      try {
        const id = randomUUID();
        await f.machine.post('/v2/gateway/boots', { bootId: id, previousGeneration: '0' });
        await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
        const hb = heartbeat(id, '1', '1'),
          response = await f.machine.post('/v2/gateway/heartbeat', hb);
        assert.equal(response.statusCode, 200);
        await f.machine.post('/v2/gateway/install-reports', report(id, '1'));
        await assert.rejects(
          db`insert into gateway_configs(machine_id,revision,desired,max_jobs,enabled,updated_at) values(${randomUUID()},1,'{"bmad":{},"superpowers":{}}',2,true,now())`,
          (e) => (e as { code: string }).code === '23503',
        );
        await assert.rejects(
          db`update gateway_configs set max_jobs=0 where machine_id=${f.machineId}`,
          (e) => (e as { code: string }).code === '23514',
        );
        await assert.rejects(
          db`insert into gateway_boots(machine_id,boot_id,boot_generation,previous_generation,created_at) values(${f.machineId},${randomUUID()},1,0,now())`,
          (e) => (e as { code: string }).code === '23505',
        );
        await assert.rejects(
          db`insert into gateway_commands(id,machine_id,type,payload,state,created_at,cursor) values(${randomUUID()},${f.machineId},'start','{}','queued',now(),9)`,
          (e) => (e as { code: string }).code === '23514',
        );
        const sourceRows =
          await db`select * from gateway_heartbeat_receipts order by machine_id,boot_generation,sequence`;
        restore(dump());
        restored = connectDb(url.toString());
        await migrate(restored, await captureMigrations(7));
        assert.equal(
          JSON.stringify(
            await restored`select * from gateway_heartbeat_receipts order by machine_id,boot_generation,sequence`,
          ),
          JSON.stringify(sourceRows),
        );
        const reopened = await gatewayFixture(restored, { prior: f.prior });
        try {
          assert.deepEqual(
            (await reopened.machine.post('/v2/gateway/heartbeat', hb)).json(),
            response.json(),
          );
        } finally {
          await reopened.close();
        }
      } finally {
        await f.close();
      }
    } finally {
      await restored?.end();
      await admin`drop database ${admin(restoredName)} with (force)`;
      await admin.end();
    }
  }));

test('gateway event metadata từ chối secrets, trường dư và audience sai', () => {
  const valid = {
    type: 'gateway.config.changed',
    projectId: null,
    ticketId: null,
    audienceMachineId: randomUUID(),
    data: { revision: 1 },
  };
  assert.doesNotThrow(() => validateEventInput(valid));
  for (const value of [
    { ...valid, data: { revision: 1, token: 'hidden' } },
    { ...valid, data: { revision: 1, url: 'https://private' } },
    { ...valid, audienceMachineId: null },
    { ...valid, projectId: randomUUID() },
  ])
    assert.throws(() => validateEventInput(value));
});

test('gateway inventory từ chối URL có credential trước khi lưu', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const id = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId: id, previousGeneration: '0' });
      const state = inventory(true);
      assert.ok(state.superpowers.source.installed);
      state.superpowers.source.installed.sourceUrl =
        'https://github.com/obra/superpowers/archive/refs/tags/v6.4.2.tar.gz?token=leak';
      const result = await f.machine.post(
        '/v2/gateway/heartbeat',
        heartbeat(id, '1', '1', { inventory: state }),
      );
      assert.equal(result.statusCode, 400, result.text);
      assert.equal((await db`select * from gateway_heartbeat_receipts`).length, 0);
    } finally {
      await f.close();
    }
  }));

async function waitCursorBlocked(
  db: Parameters<Parameters<ReturnType<typeof databaseFixture>>[0]>[0],
  count: number,
) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const [row] =
      await db`select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%event_cursor%'`;
    if (Number(row?.n) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Không có mutation chờ event_cursor trong 3 giây');
}

test('gateway cùng transaction recheck actual token trước cached boots/heartbeat/report/ack/projection', async () =>
  databaseFixture(7)(async (db) => {
    const { f, id, installation } = await readyGateway(db);
    const peer = await openPeerDb(db);
    let release: () => void = () => {};
    let locked: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
        locked = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    let blocker: Promise<unknown> | undefined;
    try {
      const p = await prepareSelection(f, db),
        claim = await p.claim();
      assert.equal(claim.statusCode, 201, claim.text);
      const a = claim.json<{ id: string; fence: string; processInstanceId: string }>();
      const bootBody = { bootId: id, previousGeneration: '0' },
        h = heartbeat(id, '1', '1'),
        projectionBody = companion(a, p.selected);
      const command = (await f.machine.get('/v2/gateway/commands')).json<{ items: { id: string }[] }>()
        .items[0];
      assert.ok(command);
      const calls = [
        { path: '/v2/gateway/boots', body: bootBody, key: randomUUID() },
        { path: '/v2/gateway/heartbeat', body: h, key: randomUUID() },
        { path: '/v2/gateway/install-reports', body: installation, key: randomUUID() },
        { path: `/v2/gateway/commands/${command.id}/ack`, body: { phase: 'received' }, key: randomUUID() },
        { path: `/v2/gateway/attempts/${a.id}/projection`, body: projectionBody, key: randomUUID() },
      ];
      for (const call of calls)
        assert.equal((await f.machine.post(call.path, call.body, call.key)).statusCode, 200);
      const before = await countExecutionRows(db);
      blocker = peer.begin(async (tx) => {
        await tx`select value from event_cursor where singleton for update`;
        locked();
        await gate;
        await tx`update machines set token_hash=${'9'.repeat(64)} where id=${f.machineId}`;
      });
      await ready;
      const pending = calls.map((call) => f.machine.post(call.path, call.body, call.key));
      await waitCursorBlocked(db, 5);
      release();
      await blocker;
      assert.deepEqual(
        (await Promise.all(pending)).map((x) => x.statusCode),
        [401, 401, 401, 401, 401],
      );
      assert.deepEqual(await countExecutionRows(db), before);
    } finally {
      release();
      await blocker;
      await f.close();
      await peer.end();
    }
  }));

test('gateway owner session expire giữa prehandler và cached config vẫn từ chối', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db),
      peer = await openPeerDb(db);
    let release: () => void = () => {},
      locked: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
        locked = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    let blocker: Promise<unknown> | undefined;
    try {
      const path = `/v2/gateway/machines/${f.machineId}/config`,
        key = randomUUID();
      assert.equal((await f.owner.put(path, nextConfig, key)).statusCode, 200);
      blocker = peer.begin(async (tx) => {
        await tx`select value from event_cursor where singleton for update`;
        locked();
        await gate;
        await tx`update sessions set expires_at=now()-interval '1 second'`;
      });
      await ready;
      const pending = f.owner.put(path, nextConfig, key);
      await waitCursorBlocked(db, 1);
      release();
      await blocker;
      assert.equal((await pending).statusCode, 401);
      const [config] = await db`select revision from gateway_configs`;
      assert.equal(config?.revision, 1);
    } finally {
      release();
      await blocker;
      await f.close();
      await peer.end();
    }
  }));

test('gateway authorization tại claim giữ pair khi update xảy ra trước insert companion', async () =>
  databaseFixture(7)(async (db) => {
    const { f } = await readyGateway(db);
    try {
      const p = await prepareSelection(f, db),
        claim = await p.claim();
      assert.equal(claim.statusCode, 201, claim.text);
      const attempt = claim.json<{ id: string; fence: string; processInstanceId: string }>();
      assert.equal(
        (
          await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, {
            ...nextConfig,
            expectedRevision: 1,
            enabled: false,
          })
        ).statusCode,
        200,
      );
      const response = await f.machine.post(
        `/v2/gateway/attempts/${attempt.id}/projection`,
        companion(attempt, p.selected),
      );
      assert.equal(response.statusCode, 200, response.text);
    } finally {
      await f.close();
    }
  }));

test('gateway heartbeat ngoài thứ tự và replay đồng thời', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const id = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId: id, previousGeneration: '0' });
      const current = heartbeat(id, '1', '3');
      const responses = await Promise.all([
        f.machine.post('/v2/gateway/heartbeat', current),
        f.machine.post('/v2/gateway/heartbeat', current),
      ]);
      assert.deepEqual(
        responses.map((x) => x.statusCode),
        [200, 200],
      );
      assert.deepEqual(responses[0]?.json(), responses[1]?.json());
      assert.equal(
        (await f.machine.post('/v2/gateway/heartbeat', heartbeat(id, '1', '2'))).json<{
          error: { code: string };
        }>().error.code,
        'HEARTBEAT_SEQUENCE_CONFLICT',
      );
      assert.equal((await db`select * from gateway_heartbeat_receipts`).length, 1);
    } finally {
      await f.close();
    }
  }));

test('gateway fresh claim từ chối projection null và report partial mới nhất dù có applied cũ', async () =>
  databaseFixture(7)(async (db) => {
    const { f, id } = await readyGateway(db);
    try {
      const partial = report(id, '1', 1, false);
      await f.machine.post('/v2/gateway/install-reports', partial);
      const p = await prepareSelection(f, db);
      assert.equal((await p.claim()).statusCode, 409);
      const desired = structuredClone(nextConfig.desired);
      desired.superpowers.projections.codex = null;
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, {
        ...nextConfig,
        expectedRevision: 1,
        desired,
      });
      const applied = await f.machine.post('/v2/gateway/install-reports', report(id, '1', 2));
      assert.equal(applied.json().accepted, true);
      const disabled = await prepareSelection(f, db, { configRevision: 2 });
      assert.equal((await disabled.claim()).statusCode, 409);
      assert.equal((await db`select * from attempts`).length, 0);
    } finally {
      await f.close();
    }
  }));

test('gateway ACK nhận nested/string details, từ chối secret/path', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      const command = (await f.machine.get('/v2/gateway/commands')).json<{ items: { id: string }[] }>()
        .items[0];
      assert.ok(command);
      const path = `/v2/gateway/commands/${command.id}/ack`;
      const result = {
        ok: true,
        code: 'SYNCED',
        details: { stage: 'registry', workflows: ['bmad', 'superpowers'], metrics: { attempts: 1 } },
      };
      const good = await f.machine.post(path, { phase: 'completed', result });
      assert.equal(good.statusCode, 200, good.text);
      assert.deepEqual(good.json().result, result);
      assert.equal(
        (
          await f.machine.post(path, {
            phase: 'completed',
            result: { ok: true, details: { path: '/Users/private' } },
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await f.machine.post(path, {
            phase: 'completed',
            result: { ok: true, details: { nested: { token: 'hidden' } } },
          })
        ).statusCode,
        400,
      );
    } finally {
      await f.close();
    }
  }));

test('gateway mọi desired runtime khác null đều bắt buộc trước advance applied', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const id = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId: id, previousGeneration: '0' });
      const desired = structuredClone(nextConfig.desired);
      desired.bmad.projections.claude = projection('bmad', 'claude');
      desired.superpowers.projections.api = projection('superpowers', 'api');
      assert.equal(
        (await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, { ...nextConfig, desired }))
          .statusCode,
        200,
      );
      const partial = report(id, '1'),
        incomplete = await f.machine.post('/v2/gateway/install-reports', partial);
      assert.equal(incomplete.json().accepted, false);
      assert.equal(incomplete.json().appliedRevision, 0);
      const complete = report(id, '1');
      complete.results.bmad.projections.claude = {
        state: 'current',
        installed: projection('bmad', 'claude'),
        lastError: null,
        observedAt: '2026-10-01T00:00:00.000Z',
      };
      complete.results.superpowers.projections.api = {
        state: 'current',
        installed: projection('superpowers', 'api'),
        lastError: null,
        observedAt: '2026-10-01T00:00:00.000Z',
      };
      const current = await f.machine.post('/v2/gateway/install-reports', complete);
      assert.equal(current.json().accepted, true);
      assert.equal(current.json().appliedRevision, 1);
      assert.deepEqual(
        (await f.machine.post('/v2/gateway/install-reports', partial)).json(),
        incomplete.json(),
      );
      const [actual] = await db`select revision from gateway_applied`;
      assert.equal(actual?.revision, 1);
    } finally {
      await f.close();
    }
  }));
