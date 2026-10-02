import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { HttpOperationJournal } from '../src/journal/http-operations.ts';
import { GatewayConnection } from '../src/sync/connection.ts';
import { bridgeRoot } from './support/bridge-fixture.ts';

test('sync boot and heartbeat preserve immutable operations through lost reply/reopen', async () => {
  const owned = await bridgeRoot();
  let drop = true;
  const sent: any[] = [];
  const http = await HttpOperationJournal.open(owned.root, async (req) => {
    sent.push(req);
    if (drop) {
      drop = false;
      throw new Error('LOST_REPLY');
    }
    return {
      status: 200,
      body: req.phase === 'boot' ? { bootGeneration: '1' } : { serverTime: '2026-10-02T00:00:00Z' },
    };
  });
  let connection = await GatewayConnection.open(owned.root, http);
  try {
    await assert.rejects(connection.boot(randomUUID(), '0'), /LOST_REPLY/);
    await connection.close();
    connection = await GatewayConnection.open(owned.root, http);
    const boot = await connection.boot();
    assert.equal(boot.bootGeneration, '1');
    assert.deepEqual(sent[0], sent[1]);
    drop = true;
    await assert.rejects(connection.heartbeat({ hostVersion: 'test' }), /LOST_REPLY/);
    await connection.close();
    connection = await GatewayConnection.open(owned.root, http);
    await connection.heartbeat({ hostVersion: 'changed' });
    assert.deepEqual(sent[2], sent[3]);
    assert.notEqual(sent[0].idempotencyKey, sent[2].idempotencyKey);
    await connection.heartbeat({ hostVersion: 'next' });
    assert.notEqual(sent[3].idempotencyKey, sent[4].idempotencyKey);
  } finally {
    await connection.close();
    await http.close();
    await owned.cleanup();
  }
});

test('controlled boot transition requires actual bound reconciliation and retains prior history through lost reply', async () => {
  const { workflowFixture } = await import('./support/bridge-fixture.ts');
  const { TicketCommandBridge } = await import('../src/execution/ticket-command-bridge.ts');
  const owned = await bridgeRoot(),
    w = await workflowFixture(owned.root);
  const a = randomUUID(),
    b = randomUUID(),
    machineId = randomUUID();
  const sent: import('../src/journal/http-operations.ts').HttpRequest[] = [];
  let lost = true;
  const http = await HttpOperationJournal.open(owned.root, async (request) => {
    sent.push(request);
    const body = request.canonicalBody as { bootId: string };
    if (request.phase === 'boot' && body.bootId === b && lost) {
      lost = false;
      throw new Error('LOST_B_REPLY');
    }
    return {
      status: 200,
      body: request.phase === 'boot' ? { bootGeneration: body.bootId === a ? '1' : '2' } : {},
    };
  });
  const bridge = await TicketCommandBridge.open(owned.root, {
    machineId,
    journal: w.journal,
    registry: w.registry,
    http,
    read: async () => {
      throw new Error('NO_LAUNCH_READ_EXPECTED');
    },
  });
  let connection = await GatewayConnection.open(owned.root, http);
  try {
    await connection.boot(a);
    await assert.rejects(connection.advanceBoot(b), /NOT_BOUND/);
    await connection.close();
    connection = await GatewayConnection.open(owned.root, http, bridge);
    await assert.rejects(connection.advanceBoot(b), /LOST_B_REPLY/);
    await connection.close();
    connection = await GatewayConnection.open(owned.root, http, bridge);
    assert.deepEqual(await connection.boot(), { bootId: b, bootGeneration: '2' });
    assert.deepEqual(sent[1], sent[2]);
    await connection.heartbeat({ hostVersion: 'B' });
    assert.equal((sent[3].canonicalBody as { sequence: string }).sequence, '1');
    await assert.rejects(connection.advanceBoot(a), /BOOT_RETIRED/);
    assert.equal((await http.replay(`boot:${a}`)).body && sent.length, 4);
  } finally {
    await connection.close();
    await bridge.close();
    await http.close();
    await w.close();
    await owned.cleanup();
  }
});

test('boot transition rejects an unaccounted admitted launch and current-set races without clearing pins', async () => {
  const { workflowFixture } = await import('./support/bridge-fixture.ts');
  const { TicketCommandBridge } = await import('../src/execution/ticket-command-bridge.ts');
  const owned = await bridgeRoot(),
    w = await workflowFixture(owned.root);
  const http = await HttpOperationJournal.open(owned.root, async () => ({
    status: 200,
    body: { bootGeneration: '1' },
  }));
  const bridge = await TicketCommandBridge.open(owned.root, {
    machineId: randomUUID(),
    journal: w.journal,
    registry: w.registry,
    http,
    read: async () => {
      throw new Error('NO_SCOPED_LAUNCH');
    },
  });
  const connection = await GatewayConnection.open(owned.root, http, bridge);
  try {
    await connection.boot(randomUUID());
    await w.install();
    const source = w.sources[0].source,
      projection = w.projections[0].expected;
    const before = w.journal.withPinAdmissionBarrier.bind(w.journal);
    let inject = true;
    w.journal.withPinAdmissionBarrier = async (root, action) => {
      if (inject) {
        inject = false;
        await w.journal.reserve({
          commandId: randomUUID(),
          ticketId: randomUUID(),
          processInstanceId: randomUUID(),
          source,
          projection,
        });
      }
      return before(root, action);
    };
    await assert.rejects(connection.advanceBoot(randomUUID()), /BOOT_RECONCILIATION_CHANGED/);
    w.journal.withPinAdmissionBarrier = before;
    await assert.rejects(connection.advanceBoot(randomUUID()), /UNKNOWN_COMMAND|BOOT_UNACCOUNTED/);
    assert.equal(
      (await w.registry.retained()).filter((ref) => ref.authority === 'process-journal').length,
      1,
    );
  } finally {
    await connection.close();
    await bridge.close();
    await http.close();
    await w.close();
    await owned.cleanup();
  }
});
