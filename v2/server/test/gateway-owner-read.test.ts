import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { ConfigInput, WorkflowCatalogue, WorkflowRetryResult } from '../src/gateway/contracts.ts';
import { canonicalJson } from '../src/journal/canonical.ts';
import { databaseFixture } from './support/db.ts';
import { gatewayFixture, heartbeat, nextConfig, projection, report, source } from './support/gateway.ts';

const skills = [{ path: 'skills/brainstorming/SKILL.md', sha256: 'a1'.repeat(32) }];
function definitionFor(workflow: 'bmad' | 'superpowers') {
  const customizationSha256 = 'c3'.repeat(32);
  const pinned = { source: source(workflow), projection: projection(workflow) };
  return {
    sha256: createHash('sha256')
      .update(canonicalJson({ ...pinned, skills, customizationSha256, render: null }))
      .digest('hex'),
    skills,
    customizationSha256,
  };
}
const code = (response: { json: <T>() => T }) => response.json<{ error: { code: string } }>().error.code;

test('gateway status owner đọc appVersion/hostVersion/telemetry của boot hiện tại, null khi chưa có heartbeat', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const path = `/v2/gateway/machines/${f.machineId}/status`;
      const bootId = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId, previousGeneration: '0' });
      const empty = (await f.owner.get(path)).json<Record<string, unknown>>();
      assert.deepEqual(
        [empty.hostVersion, empty.appVersion, empty.observedAt, empty.telemetry, empty.lastTelemetryAt],
        [null, null, null, null, null],
      );
      const beat = heartbeat(bootId, '1', '1', { hostVersion: '2.3.4', appVersion: '9.8.7' });
      assert.equal((await f.machine.post('/v2/gateway/heartbeat', beat)).statusCode, 200);
      const live = (await f.owner.get(path)).json<Record<string, unknown>>();
      assert.equal(live.hostVersion, '2.3.4');
      assert.equal(live.appVersion, '9.8.7');
      assert.equal(live.observedAt, beat.observedAt);
      assert.deepEqual(live.telemetry, beat.telemetry);
      assert.equal(typeof live.lastTelemetryAt, 'string');
      // Boot mới chưa heartbeat không thừa hưởng telemetry của boot cũ.
      await f.machine.post('/v2/gateway/boots', { bootId: randomUUID(), previousGeneration: '1' });
      const next = (await f.owner.get(path)).json<Record<string, unknown>>();
      assert.deepEqual(
        [next.hostVersion, next.appVersion, next.telemetry, next.lastTelemetryAt],
        [null, null, null, null],
      );
      const none = await f.machine.get(path);
      assert.equal(none.statusCode, 403, 'machine bearer không đọc route owner');
    } finally {
      await f.close();
    }
  }));

test('catalogue workflow: chưa cấu hình thì missing, có official source, 404 máy lạ, machine bị từ chối', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const path = `/v2/gateway/machines/${f.machineId}/workflows`;
      const response = await f.owner.get(path);
      assert.equal(response.statusCode, 200, response.text);
      const body = response.json<WorkflowCatalogue>();
      assert.equal(body.desiredConfigRevision, null);
      assert.equal(body.latestReport, null);
      assert.equal(body.workflows.bmad.source.verdict, 'not_desired');
      assert.equal(body.workflows.bmad.projections.codex.definition, null);
      assert.equal(body.official.superpowers.version, '6.4.2');
      assert.ok(
        body.official.bmad.allowedSourceUrls.some((url) => url.startsWith('https://registry.npmjs.org/')),
      );
      assert.equal((await f.owner.get(`/v2/gateway/machines/${randomUUID()}/workflows`)).statusCode, 404);
      assert.equal((await f.machine.get(path)).statusCode, 403);
      assert.equal((await f.request(path)).statusCode, 401);
    } finally {
      await f.close();
    }
  }));

test('catalogue workflow: desired chưa cài, partial, rồi match kèm definition tin cậy chỉ khi khớp pin hiện tại', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const path = `/v2/gateway/machines/${f.machineId}/workflows`;
      const bootId = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId, previousGeneration: '0' });
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      const pending = (await f.owner.get(path)).json<WorkflowCatalogue>();
      assert.equal(pending.desiredConfigRevision, 1);
      assert.equal(pending.appliedConfigRevision, null);
      assert.equal(pending.workflows.superpowers.source.verdict, 'not_installed');
      assert.equal(pending.workflows.superpowers.projections.codex.verdict, 'not_installed');
      assert.equal(pending.workflows.superpowers.projections.claude.verdict, 'not_desired');

      // Partial: superpowers đã cài, bmad lỗi. Verdict theo từng slot, không gộp.
      const partial = report(bootId, '1');
      partial.results.bmad.source = {
        state: 'error',
        installed: null,
        lastError: { code: 'SOURCE_INSTALL_FAILED', message: 'x' },
        observedAt: null,
      };
      const definition = definitionFor('superpowers');
      (partial.results.superpowers.projections.codex as { definition?: unknown }).definition = definition;
      assert.equal((await f.machine.post('/v2/gateway/install-reports', partial)).statusCode, 200);
      const mixed = (await f.owner.get(path)).json<WorkflowCatalogue>();
      assert.equal(mixed.latestReport?.accepted, false);
      assert.equal(mixed.appliedConfigRevision, 0);
      assert.equal(mixed.workflows.bmad.source.verdict, 'error');
      assert.equal(mixed.workflows.superpowers.source.verdict, 'match');
      assert.equal(mixed.workflows.superpowers.projections.codex.verdict, 'match');
      assert.deepEqual(mixed.workflows.superpowers.projections.codex.definition, definition);
      assert.equal(mixed.workflows.bmad.projections.codex.definition, null);

      // Desired đổi sang pin khác: appliedRevision cũ không được dùng để suy ra readiness, definition cũ bị ẩn.
      const changed = structuredClone(nextConfig) as ConfigInput;
      changed.expectedRevision = 1;
      const other = projection('superpowers');
      other.treeSha256 = '9'.repeat(64);
      changed.desired.superpowers.projections.codex = other;
      assert.equal(
        (await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, changed)).statusCode,
        200,
      );
      const stale = (await f.owner.get(path)).json<WorkflowCatalogue>();
      assert.equal(stale.desiredConfigRevision, 2);
      assert.equal(stale.workflows.superpowers.source.verdict, 'match');
      assert.equal(stale.workflows.superpowers.projections.codex.verdict, 'mismatch');
      assert.equal(stale.workflows.superpowers.projections.codex.installed?.treeSha256, '1'.repeat(64));
      assert.equal(stale.workflows.superpowers.projections.codex.definition, null);
    } finally {
      await f.close();
    }
  }));

test('catalogue workflow: source version lệch desired được đánh dấu versionMismatch', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const bootId = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId, previousGeneration: '0' });
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      assert.equal(
        (await f.machine.post('/v2/gateway/install-reports', report(bootId, '1'))).statusCode,
        200,
      );
      // Cấu hình hiện hành không thể mang version cũ qua owner API (allowlist), nên đặt lệch trực tiếp ở dữ liệu
      // đã báo để chứng minh phép so sánh: installed 6.4.1 so với desired 6.4.2.
      const [row] = await db`select workflow_status from gateway_applied`;
      const status = row?.workflow_status as { superpowers: { source: { installed: { version: string } } } };
      status.superpowers.source.installed.version = '6.4.1';
      await db`update gateway_applied set workflow_status=${db.json(status)}`;
      const body = (
        await f.owner.get(`/v2/gateway/machines/${f.machineId}/workflows`)
      ).json<WorkflowCatalogue>();
      assert.equal(body.workflows.superpowers.source.versionMismatch, true);
      assert.equal(body.workflows.superpowers.source.verdict, 'mismatch');
      assert.equal(body.workflows.bmad.source.versionMismatch, false);
    } finally {
      await f.close();
    }
  }));

test('retry workflow: owner cần CSRF/idempotency, CAS revision, không xếp chồng, tạo command mới khi desired không đổi', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const retry = `/v2/gateway/machines/${f.machineId}/workflows/retry`;
      assert.equal(code(await f.owner.post(retry, { expectedRevision: 1 })), 'CONFIG_NOT_CONFIGURED');
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      assert.equal(
        (
          await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, {
            ...nextConfig,
            expectedRevision: 1,
          })
        ).statusCode,
        200,
      );
      const [before] = await db`select count(*)::int as n from gateway_commands`;
      assert.equal(before?.n, 1, 'PUT no-op không tạo command mới (khoảng trống đã biết)');

      // Thiếu CSRF/idempotency, body thừa, revision sai.
      assert.equal(
        (
          await f.request(
            retry,
            'POST',
            { expectedRevision: 1 },
            { cookie: f.identity.cookie, 'idempotency-key': randomUUID() },
          )
        ).statusCode,
        403,
      );
      assert.equal((await f.machine.post(retry, { expectedRevision: 1 })).statusCode, 403);
      assert.equal((await f.owner.post(retry, { expectedRevision: 1, extra: true })).statusCode, 400);
      assert.equal((await f.owner.post(retry, {})).statusCode, 400);
      assert.equal(code(await f.owner.post(retry, { expectedRevision: 7 })), 'CONFIG_REVISION_CONFLICT');

      // Command sync còn mở cho revision hiện hành: trả lại, không tạo thêm.
      const open = await f.owner.post(retry, { expectedRevision: 1 });
      assert.equal(open.statusCode, 200, open.text);
      assert.equal(open.json<WorkflowRetryResult>().created, false);
      const [still] = await db`select count(*)::int as n from gateway_commands`;
      assert.equal(still?.n, 1);

      // Sau khi command hoàn tất, retry xếp command mới đúng revision; cùng key replay không nhân đôi.
      const bootId = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId, previousGeneration: '0' });
      const first = (await f.machine.get('/v2/gateway/commands')).json<{ items: { id: string }[] }>()
        .items[0];
      assert.ok(first);
      assert.equal(
        (
          await f.machine.post(`/v2/gateway/commands/${first.id}/ack`, {
            phase: 'completed',
            result: { ok: true },
          })
        ).statusCode,
        200,
      );
      const key = randomUUID();
      const created = await f.owner.post(retry, { expectedRevision: 1 }, key);
      const body = created.json<WorkflowRetryResult>();
      assert.equal(body.created, true);
      assert.equal(body.configRevision, 1);
      assert.equal(body.command.type, 'sync_workflows');
      assert.deepEqual(body.command.payload, { configRevision: 1 });
      assert.equal(body.command.state, 'queued');
      assert.deepEqual((await f.owner.post(retry, { expectedRevision: 1 }, key)).json(), body);
      const [after] = await db`select count(*)::int as n from gateway_commands`;
      assert.equal(after?.n, 2);
      const [events] = await db`select count(*)::int as n from events where type='gateway.command.created'`;
      assert.equal(events?.n, 2);
      assert.equal(
        (await f.machine.get('/v2/gateway/commands')).json<{ items: unknown[] }>().items.length,
        2,
      );
    } finally {
      await f.close();
    }
  }));

test('owner đọc lịch sử command máy kèm result, mới nhất trước, phân trang before, machine bị từ chối', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const bootId = randomUUID();
      await f.machine.post('/v2/gateway/boots', { bootId, previousGeneration: '0' });
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      const retry = `/v2/gateway/machines/${f.machineId}/workflows/retry`;
      for (let i = 0; i < 2; i++) {
        const list = (await f.machine.get('/v2/gateway/commands')).json<{
          items: { id: string; state: string }[];
        }>();
        const open = list.items.find((item) => item.state !== 'completed');
        assert.ok(open);
        await f.machine.post(`/v2/gateway/commands/${open.id}/ack`, {
          phase: 'completed',
          result: { ok: i === 0, code: i === 0 ? undefined : 'SUPERSEDED' },
        });
        assert.equal(
          (await f.owner.post(retry, { expectedRevision: 1 })).json<WorkflowRetryResult>().created,
          true,
        );
      }
      const path = `/v2/gateway/machines/${f.machineId}/commands`;
      const page1 = (await f.owner.get(`${path}?limit=2`)).json<{
        items: { cursor: string; state: string; result: unknown }[];
        nextBefore: string | null;
      }>();
      assert.equal(page1.items.length, 2);
      assert.ok(BigInt(page1.items[0]?.cursor ?? 0) > BigInt(page1.items[1]?.cursor ?? 0));
      assert.equal(page1.items[0]?.state, 'queued');
      assert.equal(page1.nextBefore, page1.items[1]?.cursor);
      const page2 = (await f.owner.get(`${path}?limit=2&before=${page1.nextBefore}`)).json<{
        items: { state: string; result: { ok: boolean } | null }[];
        nextBefore: string | null;
      }>();
      assert.equal(page2.items.length, 1);
      assert.equal(page2.items[0]?.state, 'completed');
      assert.deepEqual(page2.items[0]?.result, { ok: true });
      assert.equal(page2.nextBefore, null);
      assert.equal((await f.owner.get(`${path}?limit=0`)).statusCode, 400);
      assert.equal((await f.owner.get(`${path}?before=x`)).statusCode, 400);
      assert.equal((await f.owner.get(`/v2/gateway/machines/${randomUUID()}/commands`)).statusCode, 404);
      assert.equal((await f.machine.get(path)).statusCode, 403);
    } finally {
      await f.close();
    }
  }));

test('retry workflow: command received quá hạn không chặn retry, còn trẻ thì vẫn trả lại command đang chạy', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const retry = `/v2/gateway/machines/${f.machineId}/workflows/retry`;
      await f.machine.post('/v2/gateway/boots', { bootId: randomUUID(), previousGeneration: '0' });
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      const first = (await f.machine.get('/v2/gateway/commands')).json<{ items: { id: string }[] }>()
        .items[0];
      assert.ok(first);
      assert.equal(
        (await f.machine.post(`/v2/gateway/commands/${first.id}/ack`, { phase: 'received' })).statusCode,
        200,
      );
      const young = (await f.owner.post(retry, { expectedRevision: 1 })).json<WorkflowRetryResult>();
      assert.equal(young.created, false);
      assert.equal(young.command.id, first.id);
      await db`update gateway_commands set received_at=now()-interval '10 minutes' where id=${first.id}`;
      const stale = await f.owner.post(retry, { expectedRevision: 1 });
      assert.equal(stale.statusCode, 200, stale.text);
      const body = stale.json<WorkflowRetryResult>();
      assert.equal(body.created, true);
      assert.notEqual(body.command.id, first.id);
      const [count] = await db`select count(*)::int as n from gateway_commands`;
      assert.equal(count?.n, 2);
    } finally {
      await f.close();
    }
  }));

test('retry workflow: config enabled=false bị từ chối CONFIG_DISABLED và không xếp command', async () =>
  databaseFixture(7)(async (db) => {
    const f = await gatewayFixture(db);
    try {
      const retry = `/v2/gateway/machines/${f.machineId}/workflows/retry`;
      await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, nextConfig);
      const off = await f.owner.put(`/v2/gateway/machines/${f.machineId}/config`, {
        ...nextConfig,
        expectedRevision: 1,
        enabled: false,
      });
      assert.equal(off.statusCode, 200, off.text);
      const [before] = await db`select count(*)::int as n from gateway_commands`;
      const denied = await f.owner.post(retry, { expectedRevision: 2 });
      assert.equal(denied.statusCode, 409);
      assert.equal(code(denied), 'CONFIG_DISABLED');
      const [after] = await db`select count(*)::int as n from gateway_commands`;
      assert.equal(after?.n, before?.n);
    } finally {
      await f.close();
    }
  }));
