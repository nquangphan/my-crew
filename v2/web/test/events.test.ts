import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JournalEvent } from '../src/contracts/http.ts';
import {
  compareCursor,
  EventSync,
  invalidations,
  type SseFrame,
  SseParser,
  SseProtocolError,
} from '../src/lib/events.ts';

const project = '22222222-2222-4222-8222-222222222222';
const ticket = '11111111-1111-4111-8111-111111111111';
const machine = '33333333-3333-4333-8333-333333333333';
const encoder = new TextEncoder();

function event(cursor: string, type = 'ticket.changed', extra: Partial<JournalEvent> = {}): JournalEvent {
  return {
    cursor,
    type,
    projectId: project,
    ticketId: ticket,
    audienceMachineId: null,
    occurredAt: '2026-10-04T02:00:00.000Z',
    data: { revision: 2 },
    ...extra,
  };
}

function frame(value: JournalEvent): string {
  return `id: ${value.cursor}\nevent: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Stream response that stays open until the test closes it or the request signal aborts. */
function liveStream(signal: AbortSignal | null | undefined) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  signal?.addEventListener('abort', () => {
    try {
      controller.error(new DOMException('aborted', 'AbortError'));
    } catch {
      // already closed
    }
  });
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push: (text: string | Uint8Array) =>
      controller.enqueue(typeof text === 'string' ? encoder.encode(text) : text),
    close: () => controller.close(),
  };
}

type Call = { url: string; headers: Headers; signal: AbortSignal | null | undefined };

function scripted(...handlers: ((call: Call) => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const call = { url, headers: new Headers(init.headers), signal: init.signal };
    calls.push(call);
    const handler = handlers.shift();
    if (!handler) throw new TypeError('NO_MORE_RESPONSES');
    return handler(call);
  };
  return { calls, fetch };
}

function fakeSession() {
  let controller = new AbortController();
  let expired = 0;
  return {
    signal: () => controller.signal,
    expire: () => {
      expired++;
      controller.abort();
    },
    get expired() {
      return expired;
    },
    renew: () => {
      controller = new AbortController();
    },
  };
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let index = 0; index < 500; index++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timeout: ${label}`);
}

test('cursor bigint không bị làm tròn', () => {
  assert.equal(compareCursor('9007199254740993', '9007199254740992'), 1);
  assert.equal(compareCursor('9007199254740992', '9007199254740993'), -1);
  assert.equal(compareCursor('9223372036854775807', '9223372036854775807'), 0);
  assert.equal(compareCursor('10', '9'), 1);
  assert.throws(() => compareCursor('01', '1'), /CURSOR_INVALID/);
  assert.throws(() => compareCursor('9223372036854775808', '1'), /CURSOR_INVALID/);
});

test('SSE parser: CRLF/CR/LF, multiline, comment, tách chunk giữa UTF-8 và CRLF', () => {
  const frames: SseFrame[] = [];
  const parser = new SseParser((value) => frames.push(value));
  const bytes = encoder.encode(
    ': connected\r\n\r\nid: 1\r\nevent: ticket.changed\r\ndata: {"a":\r\ndata: "Tiếng Việt"}\r\n\r\nid: 2\revent: x\rdata: một\r\r: heartbeat\n\nid: 3\nevent: y\ndata:hai\n\n',
  );
  for (const size of [1, 2, 3, 5, 7]) {
    frames.length = 0;
    const local = new SseParser((value) => frames.push(value));
    for (let offset = 0; offset < bytes.length; offset += size)
      local.push(bytes.subarray(offset, offset + size));
    local.end();
    assert.deepEqual(
      frames,
      [
        { id: '1', event: 'ticket.changed', data: '{"a":\n"Tiếng Việt"}' },
        { id: '2', event: 'x', data: 'một' },
        { id: '3', event: 'y', data: 'hai' },
      ],
      `chunk ${size}`,
    );
  }
  parser.end();
});

test('SSE parser đóng khi frame vượt 1MiB hoặc UTF-8 hỏng', () => {
  const parser = new SseParser(() => assert.fail('không được phát frame'));
  const big = `data: ${'x'.repeat(1024 * 1024)}\n`;
  assert.throws(
    () => parser.push(encoder.encode(big)),
    (error: unknown) => error instanceof SseProtocolError && error.code === 'FRAME_TOO_LARGE',
  );
  const noNewline = new SseParser(() => undefined);
  assert.throws(
    () => {
      for (let index = 0; index < 20; index++) noNewline.push(encoder.encode('y'.repeat(64 * 1024)));
    },
    (error: unknown) => error instanceof SseProtocolError && error.code === 'FRAME_TOO_LARGE',
  );
  const broken = new SseParser(() => undefined);
  assert.throws(
    () => broken.push(new Uint8Array([0x64, 0x61, 0x74, 0x61, 0x3a, 0xff, 0x0a, 0x0a])),
    (error: unknown) => error instanceof SseProtocolError && error.code === 'UTF8_INVALID',
  );
});

test('invalidations: ticket đánh stale detail/graph/list/attention; type lạ invalidation rộng trong scope', () => {
  const keys = invalidations(event('5')).map((key) => JSON.stringify(key));
  for (const expected of [
    ['v2', 'ticket', ticket],
    ['v2', 'graph'],
    ['v2', 'tickets'],
    ['v2', 'attention'],
  ]) {
    assert.ok(keys.includes(JSON.stringify(expected)), JSON.stringify(expected));
  }
  const unknownProject = invalidations(event('6', 'future.thing', { ticketId: null })).map((key) =>
    JSON.stringify(key),
  );
  assert.ok(unknownProject.includes(JSON.stringify(['v2', 'project', project])));
  assert.ok(unknownProject.includes(JSON.stringify(['v2', 'docs', project])));
  assert.ok(unknownProject.includes(JSON.stringify(['v2', 'tickets'])));
  assert.deepEqual(invalidations(event('7', 'future.global', { projectId: null, ticketId: null })), [['v2']]);
  const gateway = invalidations(
    event('8', 'gateway.config.changed', { projectId: null, ticketId: null, audienceMachineId: machine }),
  );
  assert.ok(gateway.some((key) => JSON.stringify(key) === JSON.stringify(['v2', 'gateway-status', machine])));
  assert.ok(invalidations(event('9', 'comment.created')).length > 0);
});

test('catch-up đọc /v2/events?after=&limit=100 tới rỗng rồi stream với Last-Event-ID; dedup trùng/out-of-order', async () => {
  let live: ReturnType<typeof liveStream> | undefined;
  const server = scripted(
    () => json(200, { items: [event('6'), event('7')], cursor: '7' }),
    () => json(200, { items: [], cursor: '7' }),
    (call) => {
      live = liveStream(call.signal);
      return live.response;
    },
  );
  const writes: string[] = [];
  const invalidated: string[] = [];
  const session = fakeSession();
  const sync: EventSync = new EventSync({
    fetch: server.fetch,
    session,
    invalidate: async (keys) => void invalidated.push(...keys.map((key) => JSON.stringify(key))),
    cursorStore: {
      read: () => '5',
      write: (value) => {
        assert.ok(sync.pendingInvalidations() > 0, 'cursor chỉ persist sau khi invalidation đã enqueue');
        writes.push(value);
      },
    },
    sleep: async () => undefined,
  });
  sync.start();
  sync.start();
  await until(() => sync.status() === 'live' && live !== undefined, 'live');
  assert.equal(server.calls[0]?.url, '/v2/events?after=5&limit=100');
  assert.equal(server.calls[1]?.url, '/v2/events?after=7&limit=100');
  assert.equal(server.calls[2]?.url, '/v2/events/stream');
  assert.equal(server.calls[2]?.headers.get('last-event-id'), '7');
  assert.equal(server.calls.length, 3, 'một app/session chỉ một stream');
  live?.push(frame(event('7')) + frame(event('9007199254740993')) + frame(event('9007199254740992')));
  await until(() => writes.includes('9007199254740993'), 'apply 9007199254740993');
  await until(() => sync.pendingInvalidations() === 0, 'flush');
  assert.deepEqual(writes, ['6', '7', '9007199254740993']);
  assert.equal(sync.applied(), '9007199254740993');
  assert.ok(invalidated.includes(JSON.stringify(['v2', 'ticket', ticket])));
  sync.stop();
  assert.equal(sync.status(), 'stopped');
});

test('frame hỏng đóng stream, resync qua GET và dừng sau số lần giới hạn', async () => {
  const handlers: ((call: Call) => Response)[] = [];
  for (let index = 0; index < 3; index++) {
    handlers.push(() => json(200, { items: [], cursor: '1' }));
    handlers.push(
      () =>
        new Response(encoder.encode('id: 2\nevent: ticket.changed\ndata: {not json\n\n'), { status: 200 }),
    );
  }
  const server = scripted(...handlers);
  const waits: number[] = [];
  const sync = new EventSync({
    fetch: server.fetch,
    session: fakeSession(),
    invalidate: async () => undefined,
    cursorStore: { read: () => '1', write: () => undefined },
    sleep: async (ms) => void waits.push(ms),
    maxFailures: 3,
  });
  sync.start();
  await until(() => sync.status() === 'failed', 'failed');
  assert.equal(server.calls.length, 6, 'không loop vô hạn');
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(sync.applied(), '1');
});

test('frame có event name khác type trong data bị coi là hỏng', async () => {
  const server = scripted(
    () => json(200, { items: [], cursor: '1' }),
    () =>
      new Response(encoder.encode(`id: 2\nevent: other\ndata: ${JSON.stringify(event('2'))}\n\n`), {
        status: 200,
      }),
  );
  const sync = new EventSync({
    fetch: server.fetch,
    session: fakeSession(),
    invalidate: async () => undefined,
    cursorStore: { read: () => '1', write: () => undefined },
    sleep: async () => undefined,
    maxFailures: 1,
  });
  sync.start();
  await until(() => sync.status() === 'failed', 'failed');
  assert.equal(sync.applied(), '1');
});

test('phiên hết hạn (401) đóng stream và báo session expire', async () => {
  let live: ReturnType<typeof liveStream> | undefined;
  const session = fakeSession();
  const server = scripted(
    () => json(200, { items: [], cursor: '1' }),
    (call) => {
      live = liveStream(call.signal);
      return live.response;
    },
    () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Cần đăng nhập' } }),
  );
  const sync = new EventSync({
    fetch: server.fetch,
    session,
    invalidate: async () => undefined,
    cursorStore: { read: () => '1', write: () => undefined },
    sleep: async () => undefined,
  });
  sync.start();
  await until(() => sync.status() === 'live', 'live');
  const streamSignal = server.calls[1]?.signal;
  live?.close();
  await until(() => sync.status() === 'stopped', 'stopped after 401');
  assert.equal(session.expired, 1);
  assert.equal(server.calls.length, 3);
  assert.ok(streamSignal?.aborted, 'request stream phải bị hủy');
});

test('reconnect invalidation rộng; invalidation lỗi khi mất kết nối vẫn chờ và thử lại', async () => {
  let live: ReturnType<typeof liveStream> | undefined;
  const server = scripted(
    () => json(200, { items: [event('2')], cursor: '2' }),
    () => json(200, { items: [], cursor: '2' }),
    (call) => {
      live = liveStream(call.signal);
      return live.response;
    },
    () => json(200, { items: [], cursor: '2' }),
    (call) => {
      live = liveStream(call.signal);
      return live.response;
    },
  );
  let failNext = true;
  const delivered: string[] = [];
  const sync = new EventSync({
    fetch: server.fetch,
    session: fakeSession(),
    invalidate: async (keys) => {
      if (failNext) {
        failNext = false;
        throw new Error('refetch failed');
      }
      delivered.push(...keys.map((key) => JSON.stringify(key)));
    },
    cursorStore: { read: () => '1', write: () => undefined },
    sleep: async () => undefined,
  });
  sync.start();
  await until(() => sync.status() === 'live', 'live');
  assert.ok(sync.pendingInvalidations() > 0 || delivered.length > 0);
  live?.close();
  await until(() => server.calls.length === 5 && sync.status() === 'live', 'reconnected');
  await until(() => sync.pendingInvalidations() === 0, 'flushed');
  assert.ok(delivered.includes(JSON.stringify(['v2', 'ticket', ticket])), 'invalidation lỗi không bị mất');
  assert.ok(delivered.includes(JSON.stringify(['v2'])), 'reconnect refetch view hiện tại');
  assert.equal(server.calls[4]?.headers.get('last-event-id'), '2');
  sync.stop();
});
