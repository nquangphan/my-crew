import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { canonicalJson } from '../src/journal/canonical.ts';
import { appendEvent, ownerOnlyEventScope, readEvents } from '../src/journal/events.ts';
import { createMutator, mutate } from '../src/journal/mutation.ts';
import { registerEventRoutes } from '../src/journal/routes.ts';
import type { Actor, Db, Event, ServerOptions, Tx } from '../src/platform/contracts.ts';
import { ApiError } from '../src/platform/errors.ts';
import { databaseFixture } from './support/db.ts';

const withDatabase = databaseFixture(2);
const owner: Actor = { kind: 'owner', id: 'owner' };
const event = { type: 'probe', projectId: null, ticketId: null, audienceMachineId: null, data: { ok: true } };

test('canonical JSON ổn định theo thứ tự key và từ chối dữ liệu không phải JSON', () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.throws(() => canonicalJson({ value: Number.NaN }), /JSON_CANONICAL_INVALID/);
  assert.throws(() => canonicalJson({ value: undefined }), /JSON_CANONICAL_INVALID/);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), /JSON_CANONICAL_INVALID/);
});

test('retry concurrent chỉ ghi một event và trả cùng body', async () =>
  withDatabase(async (db) => {
    let calls = 0;
    const c = { actor: owner, route: 'POST:/probe', key: 'request-1', body: { b: 2, a: 1 } };
    const work = async (tx: Tx) => {
      calls++;
      const recorded = await appendEvent(tx, event);
      return { status: 201, body: { cursor: recorded.cursor } };
    };
    const [first, second] = await Promise.all([mutate(db, c, work), mutate(db, c, work)]);
    assert.deepEqual(first, second);
    assert.equal(calls, 1);
    await assert.rejects(() => mutate(db, { ...c, body: { a: 2 } }, work), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.equal((await readEvents(db, owner, '0', 50, ownerOnlyEventScope)).length, 1);
  }));

test('rollback không để lại response hoặc cursor đã tiêu thụ', async () =>
  withDatabase(async (db) => {
    const c = { actor: owner, route: 'POST:/probe', key: 'rollback', body: {} };
    await assert.rejects(() =>
      mutate(db, c, async (tx) => {
        await appendEvent(tx, event);
        throw new Error('crash');
      }),
    );
    assert.equal((await readEvents(db, owner, '0', 50, ownerOnlyEventScope)).length, 0);
    assert.equal((await db`select value from event_cursor`)[0]?.value, '0');
    const result = await mutate(db, c, async (tx) => {
      const recorded = await appendEvent(tx, event);
      return { status: 201, body: { cursor: recorded.cursor } };
    });
    assert.equal(result.body.cursor, '1');
  }));

test('cursor được phát theo thứ tự commit của hai kết nối', async () =>
  withDatabase(async (db) => {
    let releaseFirst: (() => void) | undefined;
    let signalFirst: (() => void) | undefined;
    const firstInside = new Promise<void>((resolve) => (signalFirst = resolve));
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const first = mutate(db, { actor: owner, route: 'POST:/probe', key: 'first', body: {} }, async (tx) => {
      const recorded = await appendEvent(tx, event);
      signalFirst?.();
      await gate;
      return { status: 201, body: { cursor: recorded.cursor } };
    });
    await firstInside;
    const second = mutate(db, { actor: owner, route: 'POST:/probe', key: 'second', body: {} }, async (tx) => {
      const recorded = await appendEvent(tx, event);
      return { status: 201, body: { cursor: recorded.cursor } };
    });
    releaseFirst?.();
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual([a.body.cursor, b.body.cursor], ['1', '2']);
    assert.deepEqual(
      (await readEvents(db, owner, '0', 50, ownerOnlyEventScope)).map((row) => row.cursor),
      ['1', '2'],
    );
  }));

test('scope máy chỉ nhận audience riêng, không nhận global hay project lạ', async () =>
  withDatabase(async (db) => {
    const machineId = randomUUID();
    const projectId = randomUUID();
    await mutate(db, { actor: owner, route: 'POST:/probe', key: 'scope', body: {} }, async (tx) => {
      await appendEvent(tx, event);
      await appendEvent(tx, { ...event, projectId });
      await appendEvent(tx, { ...event, audienceMachineId: machineId });
      return { status: 201, body: {} };
    });
    const rows = await readEvents(db, { kind: 'machine', id: machineId }, '0', 50, ownerOnlyEventScope);
    assert.deepEqual(
      rows.map((row) => row.cursor),
      ['3'],
    );
    assert.equal((await readEvents(db, owner, '2', 50, ownerOnlyEventScope))[0]?.cursor, '3');
  }));

test('journal từ chối token/password lồng trong dữ liệu và event type lạ', async () =>
  withDatabase(async (db) => {
    await assert.rejects(() =>
      mutate(db, { actor: owner, route: 'POST:/probe', key: 'secret', body: {} }, async (tx) => {
        await appendEvent(tx, { ...event, data: { nested: [{ token: 'leak' }] } });
        return { status: 201, body: {} };
      }),
    );
    await assert.rejects(() =>
      mutate(db, { actor: owner, route: 'POST:/probe', key: 'unknown', body: {} }, async (tx) => {
        await appendEvent(tx, { ...event, type: 'unknown' });
        return { status: 201, body: {} };
      }),
    );
    assert.equal((await readEvents(db, owner, '0', 50, ownerOnlyEventScope)).length, 0);
  }));

test('response codec quyết định dữ liệu được lưu và giải mã khi replay', async () =>
  withDatabase(async (db) => {
    const codec = {
      encode: <T>(_c: unknown, result: { status: number; body: T }): unknown => ({
        sealed: JSON.stringify(result.body),
      }),
      decode: <T>(_c: unknown, status: number, response: unknown) => {
        assert.ok(response && typeof response === 'object' && 'sealed' in response);
        return { status, body: JSON.parse(String(response.sealed)) as T };
      },
    };
    const mutator = createMutator(db, codec);
    const c = { actor: owner, route: 'POST:/v2/machines', key: 'create', body: {} };
    const first = await mutator(c, async () => ({ status: 201, body: { marker: 'sensitive' } }));
    const replay = await mutator(c, async () => {
      throw new Error('should not run');
    });
    assert.deepEqual(replay, first);
    const stored = await db`select response from idempotency`;
    assert.deepEqual(Object.keys(stored[0]?.response ?? {}), ['sealed']);
  }));

function eventApp(db: Db) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError)
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống' } });
  });
  const options: ServerOptions = {
    db,
    publicOrigin: 'http://127.0.0.1',
    secureCookies: false,
    sessionEncryptionKey: randomBytes(32),
    now: () => new Date(),
    authorizeDispatch: async () => {
      throw new Error('not configured');
    },
    verifyFinalResult: async () => {
      throw new Error('not configured');
    },
  };
  registerEventRoutes(
    app,
    options,
    {
      mutator: createMutator(db),
      auth: {
        authenticate: async (request) => {
          if (request.headers.authorization !== 'Bearer owner')
            throw new ApiError('UNAUTHENTICATED', 401, 'Cần đăng nhập');
          return owner;
        },
        requireOwner: async () => owner,
      },
    },
    ownerOnlyEventScope,
  );
  return app;
}

async function firstSseEvent(response: Response): Promise<Event> {
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false, 'SSE kết thúc trước sự kiện');
    text += decoder.decode(chunk.value, { stream: true });
    const match = /^data: (.*)$/m.exec(text);
    if (match) return JSON.parse(match[1] ?? '') as Event;
  }
}

test('SSE xác thực trước stream và nối lại sau restart từ Last-Event-ID', async () =>
  withDatabase(async (db) => {
    await mutate(db, { actor: owner, route: 'POST:/probe', key: 'sse-one', body: {} }, async (tx) => {
      await appendEvent(tx, event);
      return { status: 201, body: {} };
    });
    const firstApp = eventApp(db);
    const firstAddress = await firstApp.listen({ host: '127.0.0.1', port: 0 });
    try {
      const unauthorized = await fetch(`${firstAddress}/v2/events/stream`, {
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(unauthorized.status, 401);
      const controller = new AbortController();
      try {
        const response = await fetch(`${firstAddress}/v2/events/stream`, {
          headers: { authorization: 'Bearer owner' },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
        assert.equal((await firstSseEvent(response)).cursor, '1');
      } finally {
        controller.abort();
      }
    } finally {
      await firstApp.close();
    }
    await mutate(db, { actor: owner, route: 'POST:/probe', key: 'sse-two', body: {} }, async (tx) => {
      await appendEvent(tx, event);
      return { status: 201, body: {} };
    });
    const secondApp = eventApp(db);
    const secondAddress = await secondApp.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(`${secondAddress}/v2/events/stream`, {
        headers: { authorization: 'Bearer owner', 'last-event-id': '1' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      assert.equal((await firstSseEvent(response)).cursor, '2');
    } finally {
      controller.abort();
      await secondApp.close();
    }
  }));

test('event read từ chối query lạ và cursor không hợp lệ', async () =>
  withDatabase(async (db) => {
    const app = eventApp(db);
    try {
      const unknown = await app.inject({
        method: 'GET',
        url: '/v2/events?after=0&extra=1',
        headers: { authorization: 'Bearer owner' },
      });
      assert.equal(unknown.statusCode, 400);
      const fractional = await app.inject({
        method: 'GET',
        url: '/v2/events?after=1.5',
        headers: { authorization: 'Bearer owner' },
      });
      assert.equal(fractional.statusCode, 400);
    } finally {
      await app.close();
    }
  }));

test('event read trả items và cursor cuối cùng của trang', async () =>
  withDatabase(async (db) => {
    await mutate(db, { actor: owner, route: 'POST:/probe', key: 'page', body: {} }, async (tx) => {
      await appendEvent(tx, event);
      await appendEvent(tx, event);
      return { status: 201, body: {} };
    });
    const app = eventApp(db);
    try {
      const first = await app.inject({
        method: 'GET',
        url: '/v2/events?after=0&limit=1',
        headers: { authorization: 'Bearer owner' },
      });
      assert.equal(first.statusCode, 200);
      assert.deepEqual(Object.keys(first.json()), ['items', 'cursor']);
      assert.deepEqual(
        first.json().items.map((item: Event) => item.cursor),
        ['1'],
      );
      assert.equal(first.json().cursor, '1');
      const empty = await app.inject({
        method: 'GET',
        url: '/v2/events?after=2',
        headers: { authorization: 'Bearer owner' },
      });
      assert.deepEqual(empty.json(), { items: [], cursor: '2' });
    } finally {
      await app.close();
    }
  }));
