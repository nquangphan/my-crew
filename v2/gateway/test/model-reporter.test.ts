import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { initialStatus } from '../src/host/status.ts';
import { canonicalJson, hash } from '../src/journal/atomic-records.ts';
import { HttpOperationJournal, type HttpRequest } from '../src/journal/http-operations.ts';
import type { ModelInventoryBody, ModelReportEnvelope } from '../src/models/contracts.ts';
import { ModelReporter } from '../src/models/model-reporter.ts';
import { modelFixtureRoot, removeModelFixture } from './support/model-fixture.ts';

test('model reporter gets current desired before reconnect and restart replays exact shared sequence', async () => {
  const root = await modelFixtureRoot('model-reporter');
  const sent: HttpRequest[] = [],
    order: string[] = [];
  let lose = true,
    revision = 2;
  const boot = { bootId: randomUUID(), bootGeneration: '2' };
  let http = await HttpOperationJournal.open(root, async (request) => {
    sent.push(request);
    if (lose) throw new Error('lost reply');
    return {
      status: 200,
      body: {
        reportId: (request.canonicalBody as ModelReportEnvelope<ModelInventoryBody>).reportId,
        accepted: true,
      },
    };
  });
  const ports = {
    currentBoot: () => boot,
    getDesired: async () => {
      order.push('GET');
      return { revision, enabled: { claude: false, codex: false, api: true }, apiProviders: [] };
    },
  };
  let reporter = await ModelReporter.open(root, http, ports);
  try {
    await assert.rejects(
      reporter.reconnect(initialStatus().workflows, async () => {
        order.push('probe');
        return [];
      }),
      /lost reply/,
    );
    assert.deepEqual(order, ['GET', 'probe']);
    const first = sent[0]?.canonicalBody as ModelReportEnvelope<ModelInventoryBody>;
    assert.equal(first.sequence, '1');
    assert.equal(first.configRevision, 2);
    await reporter.close();
    await http.close();
    lose = false;
    http = await HttpOperationJournal.open(root, async (request) => {
      sent.push(request);
      return {
        status: 200,
        body: {
          reportId: (request.canonicalBody as ModelReportEnvelope<ModelInventoryBody>).reportId,
          accepted: true,
        },
      };
    });
    reporter = await ModelReporter.open(root, http, ports);
    assert.equal(await reporter.replay(first.reportId), first.reportId);
    assert.deepEqual(sent[0], sent[1]);
    revision = 3;
    await reporter.reconnect(initialStatus().workflows, async () => []);
    const inventory = sent.at(-1)?.canonicalBody as ModelReportEnvelope<ModelInventoryBody>;
    assert.equal(inventory.sequence, '2');
    await reporter.sendApplied({
      inventoryReportId: inventory.reportId,
      sourceStatus: {
        claude: { state: 'disabled', errorCode: null },
        codex: { state: 'disabled', errorCode: null },
        api: { state: 'error', errorCode: 'AUTH' },
      },
      observationDigest: hash(canonicalJson(inventory.body)),
    });
    const last = sent.at(-1);
    assert.ok(last);
    assert.equal((last.canonicalBody as { sequence: string }).sequence, '3');
    assert.equal((last.canonicalBody as { configRevision: number }).configRevision, 3);
  } finally {
    await reporter.close();
    await http.close();
    await removeModelFixture(root);
  }
});

test('FIX1 R3 overlapping collections keep immutable config and boot instead of relabelling stale observations', async () => {
  const root = await modelFixtureRoot('fix1-reporter-race'),
    sent: HttpRequest[] = [];
  const http = await HttpOperationJournal.open(root, async (request) => {
    sent.push(structuredClone(request));
    return {
      status: 200,
      body: {
        reportId: (request.canonicalBody as ModelReportEnvelope<ModelInventoryBody>).reportId,
        accepted: true,
      },
    };
  });
  let revision = 1;
  const boot = { bootId: randomUUID(), bootGeneration: '1' },
    originalBoot = structuredClone(boot),
    providerId = randomUUID();
  const desired = () => ({
    revision,
    enabled: { api: true, claude: false, codex: false },
    apiProviders: [
      {
        id: providerId,
        endpoint: `https://revision${revision}.example/v1/`,
        protocol: 'responses' as const,
        models: [{ id: 'chosen', declared: ['text' as const] }],
        credentialStatus: 'stored' as const,
        localHttp: null,
      },
    ],
  });
  const reporter = await ModelReporter.open(root, http, {
    getDesired: async () => desired(),
    currentBoot: () => boot,
  });
  let start = () => {},
    release = () => {};
  const started = new Promise<void>((r) => {
      start = r;
    }),
    barrier = new Promise<void>((r) => {
      release = r;
    });
  const entry = (marker: string) => ({
    key: { machineId: randomUUID(), runtime: 'api' as const, providerId, modelId: 'chosen' },
    context: {
      sourceTreeSha256: 'a'.repeat(64),
      projectionManifestSha256: 'b'.repeat(64),
      projectionTreeSha256: 'c'.repeat(64),
      derivationSha256: 'd'.repeat(64),
      binarySha256: 'e'.repeat(64),
      policySha256: 'f'.repeat(64),
      osVersion: 'fixture',
    },
    observedAt: '2026-10-02T07:00:00Z',
    status: 'unverified' as const,
    capabilities: [],
    evidenceDigest: hash(marker),
    errorCode: 'OFFLINE_UNVERIFIED',
    runtimeVersion: null,
  });
  const oldEntry = entry('old'),
    newEntry = entry('new');
  try {
    const first = reporter.reconnect(initialStatus().workflows, async (config) => {
      assert.equal(config.revision, 1);
      assert.equal(config.apiProviders[0]?.endpoint, 'https://revision1.example/v1/');
      start();
      await barrier;
      return [oldEntry];
    });
    await started;
    revision = 2;
    await reporter.reconnect(initialStatus().workflows, async () => [newEntry]);
    release();
    await first;
    const old = sent.find(
      (x) =>
        (x.canonicalBody as ModelReportEnvelope<ModelInventoryBody>).body.entries[0]?.evidenceDigest ===
        oldEntry.evidenceDigest,
    )?.canonicalBody as ModelReportEnvelope<ModelInventoryBody>;
    assert.equal(old.configRevision, 1);
    assert.equal(old.bootId, originalBoot.bootId);
    assert.equal(old.sequence, '2');
    let collectStart = () => {},
      collectRelease = () => {};
    const collecting = new Promise<void>((r) => {
        collectStart = r;
      }),
      hold = new Promise<void>((r) => {
        collectRelease = r;
      });
    const changing = reporter.reconnect(initialStatus().workflows, async () => {
      collectStart();
      await hold;
      return [newEntry];
    });
    await collecting;
    boot.bootId = randomUUID();
    boot.bootGeneration = '2';
    collectRelease();
    await changing;
    const captured = sent.at(-1)?.canonicalBody as ModelReportEnvelope<ModelInventoryBody>;
    assert.equal(captured.bootId, originalBoot.bootId);
    assert.equal(captured.bootGeneration, '1');
    assert.equal(captured.sequence, '3');
    await reporter.replay(old.reportId); // immutable journal reuses original body and does not allocate sequence
    const next = await reporter.reconnect(initialStatus().workflows, async () => [newEntry]);
    const fresh = sent.find((x) => (x.canonicalBody as { reportId: string }).reportId === next)
      ?.canonicalBody as ModelReportEnvelope<ModelInventoryBody>;
    assert.equal(fresh.bootId, boot.bootId);
    assert.equal(fresh.sequence, '1');
  } finally {
    release();
    await reporter.close();
    await http.close();
    await removeModelFixture(root);
  }
});
