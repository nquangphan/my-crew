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
