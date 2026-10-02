import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { HttpOperationJournal } from '../src/journal/http-operations.ts';
import { GatewaySync } from '../src/sync/gateway-sync.ts';
import { bridgeRoot, workflowFixture } from './support/bridge-fixture.ts';

test('sync persists partial report and retries same command only missing slot after reconnect/lost ACK', async () => {
  const owned = await bridgeRoot(),
    f = await workflowFixture(owned.root);
  let clock = 0,
    fail = true,
    drop = true;
  const command = {
    id: randomUUID(),
    machineId: randomUUID(),
    type: 'sync_workflows',
    payload: { configRevision: 1 },
    state: 'queued',
    result: null,
    cursor: '1',
  };
  const config = { revision: 1, desired: f.desired, maxJobs: 2, enabled: true };
  const requests: any[] = [];
  const receipts = new Map<string, any>();
  let appliedRevision = 0;
  const read = async (route: string) =>
    route === '/v2/gateway/config' ? { ...config, applied: null } : { items: [command], nextCursor: '1' };
  const http = await HttpOperationJournal.open(owned.root, async (req) => {
    requests.push(structuredClone(req));
    if (receipts.has(req.idempotencyKey)) return receipts.get(req.idempotencyKey);
    const body = req.canonicalBody as any;
    let result: import('../src/journal/http-operations.ts').HttpResponse;
    if (req.route.endsWith('/ack')) {
      if (body.phase === 'completed') {
        command.state = 'completed';
        command.result = body.result;
      } else if (command.state !== 'completed') command.state = 'received';
      result = { status: 200, body: command };
    } else {
      const accepted = Object.values(body.results).every(
        (w: any) =>
          w.source.state === 'current' &&
          Object.values(w.projections).every((s: any) => s.state === 'current'),
      );
      if (accepted) appliedRevision = 1;
      result = { status: 200, body: { accepted, appliedRevision, workflows: body.results } };
    }
    receipts.set(req.idempotencyKey, structuredClone(result));
    if (req.route.endsWith('/ack') && body.phase === 'completed' && drop) {
      drop = false;
      throw new Error('LOST_REPLY');
    }
    return result;
  });
  const base = {
    machineId: command.machineId,
    bootId: randomUUID(),
    bootGeneration: '1',
    registry: f.registry,
    http,
    read,
    recipes: f.projections,
    now: () => clock,
    random: () => 0,
    archive: async (source: any) => {
      if (source.name === 'bmad' && fail) throw new Error('DOWNLOAD_FAILED');
      return f.sources.find((x) => x.source.name === source.name)!.stream();
    },
  };
  let sync = await GatewaySync.open(owned.root, base);
  try {
    await sync.reconcile();
    assert.equal(command.state, 'received');
    assert.equal(appliedRevision, 0);
    assert.equal(
      (await f.registry.current('superpowers'))?.sourceTreeSha256,
      config.desired.superpowers.source.sourceTreeSha256,
    );
    const count = requests.filter((r) => r.route.includes('install-reports')).length;
    await sync.reconcile();
    assert.equal(requests.filter((r) => r.route.includes('install-reports')).length, count);
    fail = false;
    clock = 100000;
    await assert.rejects(sync.reconcile(), /LOST_REPLY/);
    const completed = requests.at(-1);
    assert.equal(command.state, 'completed');
    await sync.close();
    sync = await GatewaySync.open(owned.root, base);
    await sync.reconcile();
    assert.equal(appliedRevision, 1);
    assert.equal(requests.at(-1).idempotencyKey, completed.idempotencyKey);
    assert.equal(receipts.size, 4);
  } finally {
    await sync.close();
    await http.close();
    await f.close();
    await owned.cleanup();
  }
});

test('sync superseded command completes immutable failure and new command installs new revision', async () => {
  const owned = await bridgeRoot(),
    f = await workflowFixture(owned.root);
  let revision = 1;
  const commands = [
    {
      id: randomUUID(),
      machineId: randomUUID(),
      type: 'sync_workflows',
      payload: { configRevision: 1 },
      state: 'queued',
      cursor: '1',
      result: null,
    },
  ];
  const reports: any[] = [];
  const read = async (route: string) =>
    route === '/v2/gateway/config'
      ? { revision, desired: f.desired, maxJobs: 1, enabled: true, applied: null }
      : { items: commands, nextCursor: String(commands.length) };
  const http = await HttpOperationJournal.open(owned.root, async (req) => {
    const b = req.canonicalBody as any;
    if (req.route.endsWith('install-reports')) {
      reports.push(b);
      if (b.configRevision === 1) {
        revision = 2;
        return { status: 409, body: { error: { code: 'CONFIG_REVISION_CONFLICT' } } };
      }
      return { status: 200, body: { accepted: true, appliedRevision: 2 } };
    }
    const c = commands.find((c) => req.route.includes(c.id))!;
    if (b.phase === 'completed') {
      c.state = 'completed';
      c.result = b.result;
    } else if (c.state !== 'completed') c.state = 'received';
    return { status: 200, body: c };
  });
  const sync = await GatewaySync.open(owned.root, {
    machineId: commands[0].machineId,
    bootId: randomUUID(),
    bootGeneration: '1',
    registry: f.registry,
    http,
    read,
    recipes: f.projections,
    archive: async (s) => f.sources.find((f) => f.source.name === s.name)!.stream(),
  });
  try {
    await sync.reconcile();
    assert.deepEqual(commands[0].result, { ok: false, code: 'SUPERSEDED' });
    assert.equal(reports.length, 1);
    await sync.reconcile();
    assert.equal(reports.length, 1);
    commands.push({
      ...commands[0],
      id: randomUUID(),
      payload: { configRevision: 2 },
      cursor: '2',
      state: 'queued',
      result: null,
    });
    await sync.reconcile();
    assert.deepEqual(commands[0].result, { ok: false, code: 'SUPERSEDED' });
    assert.deepEqual(commands[1].result, { ok: true });
    assert.equal(reports.length, 2);
  } finally {
    await sync.close();
    await http.close();
    await f.close();
    await owned.cleanup();
  }
});

test('sync lost report/reopen preserves report key and retries only unavailable declared projection', async () => {
  const owned = await bridgeRoot(),
    f = await workflowFixture(owned.root);
  let clock = 0,
    drop = true,
    downloads = 0;
  const command = {
    id: randomUUID(),
    machineId: randomUUID(),
    type: 'sync_workflows',
    payload: { configRevision: 1 },
    state: 'queued',
    result: null,
    cursor: '1',
  };
  const recipes = f.projections.filter(
    (a) => !(a.runtime === 'api' && a.sourceTreeSha256 === f.sources[0].source.sourceTreeSha256),
  );
  const sent: import('../src/journal/http-operations.ts').HttpRequest[] = [];
  const responses = new Map<string, import('../src/journal/http-operations.ts').HttpResponse>();
  const write: import('../src/journal/http-operations.ts').HttpTransport = async (req) => {
    sent.push(structuredClone(req));
    const old = responses.get(req.idempotencyKey);
    if (old) return old;
    if (req.phase === 'install-report') {
      const report = req.canonicalBody as import('../src/commands/contracts.ts').InstallReport;
      const accepted = Object.values(report.results).every(
        (w) =>
          w.source.state === 'current' && Object.values(w.projections).every((p) => p.state === 'current'),
      );
      const response = { status: 200, body: { accepted, appliedRevision: accepted ? 1 : 0 } };
      responses.set(req.idempotencyKey, response);
      if (drop) {
        drop = false;
        throw new Error('LOST_REPORT_REPLY');
      }
      return response;
    }
    const ack = req.canonicalBody as { phase: string };
    command.state = ack.phase;
    return { status: 200, body: command };
  };
  let http = await HttpOperationJournal.open(owned.root, write);
  const options = {
    machineId: command.machineId,
    bootId: randomUUID(),
    bootGeneration: '1',
    registry: f.registry,
    http,
    read: async (route: string) =>
      route === '/v2/gateway/config'
        ? { revision: 1, desired: f.desired, maxJobs: 1, enabled: true }
        : { items: [command], nextCursor: '1' },
    recipes,
    now: () => clock,
    archive: async (source: import('../src/host/status.ts').SourcePin) => {
      downloads++;
      const fixture = f.sources.find((s) => s.source.name === source.name);
      assert(fixture);
      return fixture.stream();
    },
  };
  let sync = await GatewaySync.open(owned.root, options);
  try {
    await assert.rejects(sync.reconcile(), /LOST_REPORT_REPLY/);
    const original = sent.find((r) => r.phase === 'install-report');
    assert(original);
    const report = original.canonicalBody as import('../src/commands/contracts.ts').InstallReport;
    assert.equal(report.results.bmad.source.state, 'current');
    assert.equal(report.results.bmad.projections.api.state, 'error');
    assert.equal(report.results.bmad.projections.codex.state, 'current');
    await sync.close();
    await http.close();
    http = await HttpOperationJournal.open(owned.root, write);
    sync = await GatewaySync.open(owned.root, { ...options, http });
    await sync.reconcile();
    assert.deepEqual(sent.filter((r) => r.phase === 'install-report')[1], original);
    assert.equal(command.state, 'received');
    recipes.push(
      ...f.projections.filter(
        (a) => a.runtime === 'api' && a.sourceTreeSha256 === f.sources[0].source.sourceTreeSha256,
      ),
    );
    clock = 100000;
    await sync.reconcile();
    assert.equal(command.state, 'completed');
    assert.equal(downloads, 2);
    const reports = sent.filter((r) => r.phase === 'install-report');
    assert.notEqual(reports[2].idempotencyKey, original.idempotencyKey);
  } finally {
    await sync.close();
    await http.close();
    await f.close();
    await owned.cleanup();
  }
});

test('sync verifies cached source bytes even when every desired projection is null', async () => {
  const { chmod, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const owned = await bridgeRoot(),
    w = await workflowFixture(owned.root);
  await w.install();
  const source = w.sources[0],
    projection = w.projections[0].expected;
  const resolved = await w.registry.resolve(source.source, projection);
  const entry = source.entries.find((e) => e.type === 'file');
  assert(entry);
  const target = join(resolved.sourceRoot, entry.path);
  await chmod(target, 0o600);
  await writeFile(target, 'corrupt cached source');
  const desired = structuredClone(
    w.desired,
  ) as import('../src/commands/contracts.ts').GatewayConfig['desired'];
  for (const name of ['bmad', 'superpowers'] as const)
    desired[name].projections = { claude: null, codex: null, api: null };
  const command = {
    id: randomUUID(),
    machineId: randomUUID(),
    type: 'sync_workflows',
    payload: { configRevision: 1 },
    state: 'queued',
    result: null,
    cursor: '1',
  };
  let report: import('../src/commands/contracts.ts').InstallReport | undefined;
  const http = await HttpOperationJournal.open(owned.root, async (req) => {
    if (req.phase === 'install-report') {
      report = req.canonicalBody as typeof report;
      return { status: 200, body: { accepted: false, appliedRevision: 0 } };
    }
    return { status: 200, body: command };
  });
  const sync = await GatewaySync.open(owned.root, {
    machineId: command.machineId,
    bootId: randomUUID(),
    bootGeneration: '1',
    registry: w.registry,
    http,
    recipes: w.projections,
    read: async (route) =>
      route === '/v2/gateway/config'
        ? { revision: 1, desired, maxJobs: 1, enabled: true }
        : { items: [command], nextCursor: '1' },
    archive: async () => {
      throw new Error('HEALTHY_CACHE_MUST_NOT_DOWNLOAD');
    },
  });
  try {
    await sync.reconcile();
    assert(report);
    assert.equal(report.results.bmad.source.state, 'error');
    assert.equal(report.results.superpowers.source.state, 'current');
  } finally {
    await sync.close();
    await http.close();
    await w.close();
    await owned.cleanup();
  }
});
