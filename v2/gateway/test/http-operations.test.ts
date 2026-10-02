import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HttpOperationJournal } from '../src/journal/http-operations.ts';

test('journal HTTP restart preserves exact route/body/key for lost replies and distinct mutation phases', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-http-'));
  const sent: unknown[] = [];
  const transport = async (request: unknown) => {
    sent.push(request);
    throw new Error('lost reply');
  };
  let journal = await HttpOperationJournal.open(root, transport);
  try {
    const keys = new Set<string>();
    for (const phase of [
      'boot',
      'heartbeat',
      'claim',
      'checkpoint',
      'reconcile',
      'result',
      'finalize',
      'ack_received',
      'ack_completed',
      'install_report',
    ]) {
      const operationId = `operation-${phase}`;
      const prepared = await journal.prepare({
        operationId,
        method: 'POST',
        route: `/v2/${phase}`,
        phase,
        canonicalBody: { z: phase, a: 1 },
      });
      keys.add(prepared.idempotencyKey);
      await assert.rejects(journal.replay(operationId), /lost reply/);
    }
    assert.equal(keys.size, 10);
    await journal.close();
    journal = await HttpOperationJournal.open(root, transport);
    for (const phase of [
      'boot',
      'heartbeat',
      'claim',
      'checkpoint',
      'reconcile',
      'result',
      'finalize',
      'ack_received',
      'ack_completed',
      'install_report',
    ])
      await assert.rejects(journal.replay(`operation-${phase}`));
    assert.deepEqual(sent.slice(0, 10), sent.slice(10));
    await assert.rejects(
      journal.prepare({
        operationId: 'operation-result',
        method: 'POST',
        route: '/v2/other',
        phase: 'result',
        canonicalBody: {},
      }),
      /CONFLICT/,
    );
    await journal.recordResponse('operation-result', 200, { accepted: true });
    await journal.close();
    journal = await HttpOperationJournal.open(root, async () => {
      throw new Error('must not send');
    });
    assert.deepEqual(await journal.replay('operation-result'), { status: 200, body: { accepted: true } });
  } finally {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('journal HTTP rejects credential fields and transport cannot mutate the durable replay body', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-http-secret-'));
  const journal = await HttpOperationJournal.open(root, async (request) => {
    assert.throws(() => {
      (request.canonicalBody as { nested: { value: number } }).nested.value = 2;
    });
    return { status: 200, body: { ok: true } };
  });
  try {
    await assert.rejects(
      journal.prepare({
        operationId: 'secret',
        method: 'POST',
        route: '/v2/claim',
        phase: 'claim',
        canonicalBody: { nested: { token: 'credential' } },
      }),
      /SECRET/,
    );
    await journal.prepare({
      operationId: 'safe',
      method: 'POST',
      route: '/v2/claim',
      phase: 'claim',
      canonicalBody: { nested: { value: 1 } },
    });
    await journal.replay('safe');
  } finally {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('journal HTTP real socket lost replies replay every mutation with identical persisted body and key', async () => {
  const { createServer } = await import('node:http');
  const { canonicalJson } = await import('../src/journal/atomic-records.ts');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-http-wire-'));
  const requests: { route: string; key: string; body: string }[] = [];
  let drop = true;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ route: request.url ?? '', key: String(request.headers['idempotency-key']), body });
    if (drop) {
      request.socket.destroy();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end('{"accepted":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const transport = async (request: import('../src/journal/http-operations.ts').HttpRequest) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${request.route}`, {
      method: request.method,
      headers: { 'content-type': 'application/json', 'idempotency-key': request.idempotencyKey },
      body: canonicalJson(request.canonicalBody),
    });
    return { status: response.status, body: await response.json() };
  };
  let journal = await HttpOperationJournal.open(root, transport);
  try {
    for (const phase of [
      'claim',
      'checkpoint',
      'reconcile',
      'result',
      'finalize',
      'ack_received',
      'ack_completed',
      'install_report',
    ]) {
      await journal.prepare({
        operationId: phase,
        method: 'POST',
        route: `/v2/${phase}`,
        phase,
        canonicalBody: { fence: '1', phase },
      });
      await assert.rejects(journal.replay(phase));
    }
    await journal.close();
    journal = await HttpOperationJournal.open(root, transport);
    drop = false;
    for (const phase of [
      'claim',
      'checkpoint',
      'reconcile',
      'result',
      'finalize',
      'ack_received',
      'ack_completed',
      'install_report',
    ])
      assert.equal((await journal.replay(phase)).status, 200);
    assert.deepEqual(requests.slice(0, 8), requests.slice(8));
    assert.notEqual(requests[3].key, requests[4].key);
  } finally {
    await journal.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('transient recovery keeps original response and key, backoff, pending ambiguity and settled retry across reopen', async () => {
  const { mkdtemp, realpath, lstat, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-task5-http-retry-'))),
    identity = await lstat(root);
  console.log(
    'Task5 owned root',
    JSON.stringify({ root, device: String(identity.dev), inode: String(identity.ino), uid: identity.uid }),
  );
  let now = 0,
    calls = 0;
  const requests: unknown[] = [];
  const transport: import('../src/journal/http-operations.ts').HttpTransport = async (request) => {
    requests.push(request);
    calls++;
    if (calls === 1) return { status: 503, body: { error: { code: 'UNAVAILABLE' } } };
    if (calls === 2) throw new Error('LOST_RETRY_REPLY');
    return { status: 200, body: { effect: 'same-server-receipt' } };
  };
  let http = await HttpOperationJournal.open(root, transport, { now: () => now });
  try {
    await http.prepare({
      operationId: 'one',
      method: 'POST',
      route: '/v2/test',
      phase: 'test',
      canonicalBody: { x: 1 },
    });
    assert.equal((await http.retryTransient('one')).status, 503);
    assert.equal((await http.retryTransient('one')).status, 503);
    assert.equal(calls, 1);
    now = 1000;
    await assert.rejects(http.retryTransient('one'), /LOST_RETRY_REPLY/);
    await http.close();
    http = await HttpOperationJournal.open(root, transport, { now: () => now });
    now = 3000;
    const results = await Promise.all([http.retryTransient('one'), http.retryTransient('one')]);
    assert.equal(results[0].status, 200);
    assert.deepEqual(results[0], results[1]);
    assert.equal(calls, 3);
    assert.deepEqual(requests[0], requests[1]);
    assert.deepEqual(requests[1], requests[2]);
    assert.equal((await http.replay('one')).status, 503);
    await http.close();
    http = await HttpOperationJournal.open(root, transport, { now: () => now });
    assert.equal((await http.retryTransient('one')).status, 200);
    assert.equal(calls, 3);
  } finally {
    await http.close();
    const current = await lstat(root);
    assert.equal(current.ino, identity.ino);
    assert.equal(current.dev, identity.dev);
    assert.equal(current.uid, identity.uid);
    await rm(root, { recursive: true });
    console.log(
      'Task5 owned cleanup',
      JSON.stringify({
        root,
        device: String(identity.dev),
        inode: String(identity.ino),
        uid: identity.uid,
        deleted: true,
      }),
    );
  }
});
