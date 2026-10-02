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
