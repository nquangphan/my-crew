import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWorkflowManifest } from '../src/assistant/workflow-manifest.ts';
import { HttpOperationJournal } from '../src/journal/http-operations.ts';
import { GatewaySync } from '../src/sync/gateway-sync.ts';
import { type ProjectionPin, projectionTreeHash, type SourcePin } from '../src/workflows/pins.ts';
import type { WorkflowRegistry } from '../src/workflows/registry.ts';
import {
  manifest,
  manifestHash,
  parseArchive,
  type TreeFile,
  validateFiles,
  writeTree,
} from '../src/workflows/stage.ts';
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

test('sync defers command ahead of desired snapshot, then applies after reopen without false supersession', async () => {
  const owned = await bridgeRoot(),
    f = await workflowFixture(owned.root);
  const command = {
    id: randomUUID(),
    machineId: randomUUID(),
    type: 'sync_workflows',
    payload: { configRevision: 2 },
    state: 'queued',
    result: null,
    cursor: '2',
  };
  let revision = 1;
  const sent: import('../src/journal/http-operations.ts').HttpRequest[] = [];
  const http = await HttpOperationJournal.open(owned.root, async (request) => {
    sent.push(request);
    return {
      status: 200,
      body: request.phase === 'install-report' ? { accepted: true, appliedRevision: 2 } : {},
    };
  });
  const options = {
    machineId: command.machineId,
    bootId: randomUUID(),
    bootGeneration: '1',
    registry: f.registry,
    http,
    recipes: f.projections,
    read: async (route: string) =>
      route === '/v2/gateway/config'
        ? { revision, desired: f.desired, maxJobs: 1, enabled: true }
        : { items: [command], nextCursor: '2' },
    archive: async (source: import('../src/host/status.ts').SourcePin) =>
      f.sources.find((item) => item.source.name === source.name)!.stream(),
  };
  let sync = await GatewaySync.open(owned.root, options);
  try {
    await sync.reconcile();
    assert.equal(sent.filter((item) => item.phase === 'gateway-completed').length, 0);
    await sync.close();
    revision = 2;
    sync = await GatewaySync.open(owned.root, options);
    await sync.reconcile();
    await sync.reconcile();
    assert.equal(sent.filter((item) => item.phase === 'install-report').length, 1);
    assert.deepEqual(sent.find((item) => item.phase === 'gateway-completed')?.canonicalBody, {
      phase: 'completed',
      result: { ok: true },
    });
  } finally {
    await sync.close();
    await http.close();
    await f.close();
    await owned.cleanup();
  }
});

test('sync carries the workflow definition on current projections only, and omits it when unavailable', async () => {
  const owned = await bridgeRoot(),
    w = await workflowFixture(owned.root);
  await w.install();
  const command = {
    id: randomUUID(),
    machineId: randomUUID(),
    type: 'sync_workflows',
    payload: { configRevision: 1 },
    state: 'queued',
    result: null,
    cursor: '1',
  };
  const loaded: string[] = [];
  const definitions = {
    async loadDefinition(
      source: import('../src/host/status.ts').SourcePin,
      projection: import('../src/host/status.ts').ProjectionPin,
    ) {
      loaded.push(`${source.name}:${projection.runtime}`);
      // BMAD definitions exist only for the claude projection.
      if (source.name === 'bmad' && projection.runtime !== 'claude')
        throw new Error('WORKFLOW_DEFINITION_UNAVAILABLE');
      return {
        sha256: projection.treeSha256,
        skills: [{ path: 'skills/x/SKILL.md', sha256: source.sourceTreeSha256 }],
        customizationSha256: projection.manifestSha256,
      };
    },
  };
  const run = async (withDefinitions: boolean) => {
    const reports: import('../src/commands/contracts.ts').InstallReport[] = [];
    const home = await bridgeRoot();
    const http = await HttpOperationJournal.open(home.root, async (req) => {
      if (req.phase === 'install-report') {
        reports.push(req.canonicalBody as (typeof reports)[number]);
        return { status: 200, body: { accepted: true, appliedRevision: 1 } };
      }
      return { status: 200, body: command };
    });
    const sync = await GatewaySync.open(home.root, {
      machineId: command.machineId,
      bootId: randomUUID(),
      bootGeneration: '1',
      registry: w.registry,
      http,
      recipes: w.projections,
      ...(withDefinitions ? { definitions } : {}),
      read: async (route) =>
        route === '/v2/gateway/config'
          ? { revision: 1, desired: w.desired, maxJobs: 1, enabled: true }
          : { items: [command], nextCursor: '1' },
      archive: async () => {
        throw new Error('HEALTHY_CACHE_MUST_NOT_DOWNLOAD');
      },
    });
    try {
      await sync.reconcile();
    } finally {
      await sync.close();
      await http.close();
      await home.cleanup();
    }
    assert.equal(reports.length, 1);
    return reports[0].results as unknown as Record<
      string,
      { source: object; projections: Record<string, { state: string; definition?: unknown }> }
    >;
  };
  try {
    const plain = await run(false);
    assert.deepEqual(loaded, []);
    for (const name of ['bmad', 'superpowers'])
      for (const slot of Object.values(plain[name].projections))
        assert.equal('definition' in slot, false, 'no loader means no definition field');

    const results = await run(true);
    for (const runtime of ['claude', 'codex', 'api']) {
      const pin = w.desired.superpowers.projections[runtime];
      assert.deepEqual(results.superpowers.projections[runtime].definition, {
        sha256: pin.treeSha256,
        skills: [{ path: 'skills/x/SKILL.md', sha256: w.desired.superpowers.source.sourceTreeSha256 }],
        customizationSha256: pin.manifestSha256,
      });
    }
    assert.ok(results.bmad.projections.claude.definition);
    for (const runtime of ['codex', 'api']) {
      assert.equal(results.bmad.projections[runtime].state, 'current');
      assert.equal('definition' in results.bmad.projections[runtime], false);
    }
    assert.equal('definition' in results.superpowers.source, false);
  } finally {
    await w.close();
    await owned.cleanup();
  }
});

// Shared golden vector: the server install-report test reads this exact file, so a definition produced
// by the real gateway adapter is proven acceptable to the server digest check (and vice versa).
const vectorUrl = new URL('./fixtures/workflow-definitions/install-report-vector.json', import.meta.url);
const fixtureUrl = new URL('./fixtures/', import.meta.url);

async function realDefinitionVectors() {
  const audits = JSON.parse(await readFile(new URL('workflows/official-audits.json', fixtureUrl), 'utf8'));
  const builds = JSON.parse(
    await readFile(new URL('workflow-builder/real-projections.json', fixtureUrl), 'utf8'),
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-sync-vector-')));
  try {
    // Superpowers: official archive bytes with the audited claude projection layout.
    const spSource = audits.superpowers.source.pin as SourcePin;
    const spAudit = audits.superpowers.projections.claude;
    const spFiles = await parseArchive(
      await readFile(new URL('workflows/superpowers-6.4.2.tgz', fixtureUrl)),
      audits.superpowers.source.executables,
    );
    const spProjected = validateFiles(
      spAudit.mappings.flatMap((mapping: { from: string; to: string }) =>
        spFiles
          .filter((file) => file.path === mapping.from || file.path.startsWith(`${mapping.from}/`))
          .map((file) => ({
            ...file,
            path: `${mapping.to}${file.path.slice(mapping.from.length)}`,
            body: Buffer.from(file.body),
          })),
      ),
    );
    await writeTree(join(root, 'sp-source'), spFiles);
    await writeTree(join(root, 'sp-projection'), spProjected);
    const spResolver: Pick<WorkflowRegistry, 'resolve'> = {
      resolve: async () => ({
        sourceRoot: join(root, 'sp-source'),
        projectionRoot: join(root, 'sp-projection'),
        manifest: { source: manifest(spFiles), projection: manifest(spProjected) },
      }),
    };
    const spProjection = spAudit.expected as ProjectionPin;

    // BMAD: official bytes plus the generated config layers; definition carries the render tier.
    const bmadSource = audits.bmad.source.pin as SourcePin;
    const bmadFixture = JSON.parse(
      await readFile(new URL('workflow-definitions/bmad-claude-projection.json', fixtureUrl), 'utf8'),
    ) as {
      official: { path: string; from: string; mode: number }[];
      generated: { path: string; body: string }[];
    };
    const bmadArchive = await parseArchive(
      await readFile(new URL('workflows/bmad-6.12.0.tgz', fixtureUrl)),
      audits.bmad.source.executables,
    );
    const byPath = new Map(bmadArchive.map((file) => [file.path, file]));
    const bmadFiles: TreeFile[] = validateFiles([
      ...bmadFixture.official.map((entry) => {
        const file = byPath.get(entry.from);
        assert(file && file.type === 'file', `missing official ${entry.from}`);
        return {
          path: entry.path,
          type: 'file' as const,
          mode: entry.mode === 0o755 ? (0o755 as const) : (0o644 as const),
          body: Buffer.from(file.body),
        };
      }),
      ...bmadFixture.generated.map((entry) => ({
        path: entry.path,
        type: 'file' as const,
        mode: 0o644 as const,
        body: Buffer.from(entry.body),
      })),
    ]);
    const bmadManifest = manifest(bmadFiles);
    const base = {
      runtime: 'claude' as const,
      sourceTreeSha256: bmadSource.sourceTreeSha256,
      manifestSha256: manifestHash(bmadManifest),
      derivation: builds.bmad.claude.expected.derivation as ProjectionPin['derivation'],
    };
    const bmadProjection: ProjectionPin = { ...base, treeSha256: projectionTreeHash(base) };
    await writeTree(join(root, 'bmad-projection'), bmadFiles);
    const bmadResolver: Pick<WorkflowRegistry, 'resolve'> = {
      resolve: async () => ({
        sourceRoot: join(root, 'bmad-source-not-materialized'),
        projectionRoot: join(root, 'bmad-projection'),
        manifest: { source: manifest(bmadArchive), projection: bmadManifest },
      }),
    };
    return {
      superpowers: {
        source: spSource,
        projection: spProjection,
        definition: await createWorkflowManifest(spResolver).loadDefinition(spSource, spProjection),
      },
      bmad: {
        source: bmadSource,
        projection: bmadProjection,
        definition: await createWorkflowManifest(bmadResolver).loadDefinition(bmadSource, bmadProjection),
      },
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('gateway definition adapter output matches the committed golden vector the server verifies', async () => {
  const vector = await realDefinitionVectors();
  assert.ok(vector.bmad.definition.render, 'BMAD claude vector carries the render tier');
  assert.equal(vector.superpowers.definition.render, undefined);
  const text = `${JSON.stringify(vector, null, 2)}\n`;
  if (process.env.CREW_UPDATE_DEFINITION_VECTOR === '1') await writeFile(vectorUrl, text);
  assert.equal(
    await readFile(vectorUrl, 'utf8'),
    text,
    'definition vector drifted from loadDefinition output',
  );
});

test('sync reports an integrity failure of the definition loader as an error slot, never silently current', async () => {
  const owned = await bridgeRoot(),
    w = await workflowFixture(owned.root);
  await w.install();
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
    definitions: {
      async loadDefinition(source, projection) {
        if (source.name === 'superpowers' && projection.runtime === 'claude')
          throw new Error('WORKFLOW_SKILL_MISMATCH');
        if (source.name === 'bmad' && projection.runtime === 'claude') throw new Error('boom: /secret/path');
        throw new Error('WORKFLOW_DEFINITION_UNAVAILABLE');
      },
    },
    read: async (route) =>
      route === '/v2/gateway/config'
        ? { revision: 1, desired: w.desired, maxJobs: 1, enabled: true }
        : { items: [command], nextCursor: '1' },
    archive: async () => {
      throw new Error('HEALTHY_CACHE_MUST_NOT_DOWNLOAD');
    },
  });
  try {
    await sync.reconcile();
    assert.ok(report);
    const sp = report.results.superpowers.projections;
    assert.equal(sp.claude.state, 'error');
    assert.equal(sp.claude.installed, null);
    assert.equal(sp.claude.lastError?.code, 'DEFINITION_FAILED');
    assert.match(sp.claude.lastError?.message ?? '', /WORKFLOW_SKILL_MISMATCH/);
    assert.equal('definition' in sp.claude, false);
    // Unknown error text is never echoed (could carry paths); it is reported as UNKNOWN.
    const bmad = report.results.bmad.projections.claude;
    assert.equal(bmad.state, 'error');
    assert.match(bmad.lastError?.message ?? '', /UNKNOWN/);
    assert.doesNotMatch(bmad.lastError?.message ?? '', /secret/);
    // Explicitly unavailable definitions stay current without the field.
    assert.equal(sp.codex.state, 'current');
    assert.equal('definition' in sp.codex, false);
  } finally {
    await sync.close();
    await http.close();
    await w.close();
    await owned.cleanup();
  }
});
