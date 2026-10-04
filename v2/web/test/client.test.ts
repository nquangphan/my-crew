import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContractError, decodeSession, int, obj, str } from '../src/contracts/http.ts';
import { decodeTicket, newerTicket, type Ticket } from '../src/contracts/tickets.ts';
import { ApiFailure, assertOwnerPath, createOwnerClient, LatestRequest } from '../src/lib/api.ts';
import { IntentUnresolvedError, PendingStore } from '../src/lib/pending-operation.ts';
import { SessionController } from '../src/lib/session.ts';

const csrf = 'a'.repeat(64);
type Call = { url: string; init: RequestInit; headers: Headers };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Scripted fetch: each handler answers one request in order; unexpected calls fail the test. */
function scripted(...handlers: ((call: Call) => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const call = { url, init, headers: new Headers(init.headers) };
    calls.push(call);
    const handler = handlers.shift();
    if (!handler) throw new Error(`UNEXPECTED_FETCH ${init.method ?? 'GET'} ${url}`);
    return handler(call);
  };
  return { calls, fetch };
}

async function authenticated(fetch: (url: string, init?: RequestInit) => Promise<Response>) {
  const session = new SessionController({ fetch });
  await session.bootstrap();
  return session;
}

const noSleep = async () => undefined;

test('GET chỉ gọi same-origin /v2/ kèm cookie và từ chối path ngoài', async () => {
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => json(200, { ok: true }),
  );
  const session = await authenticated(server.fetch);
  const client = createOwnerClient({
    session,
    pending: new PendingStore(null),
    fetch: server.fetch,
    sleep: noSleep,
  });
  assert.deepEqual(await client.get('/v2/projects?limit=1'), { ok: true });
  const get = server.calls[1];
  assert.equal(get?.url, '/v2/projects?limit=1');
  assert.equal(get?.init.credentials, 'same-origin');
  assert.equal(get?.headers.get('x-csrf-token'), null, 'GET không gửi CSRF');
  assert.ok(get?.init.signal instanceof AbortSignal, 'GET phải có AbortSignal');
  for (const path of [
    'https://evil.example/v2/x',
    '//evil.example/v2/x',
    '/v1/projects',
    '/v2/../v1',
    '/v2\\x',
    'v2/x',
  ]) {
    assert.throws(() => assertOwnerPath(path), /PATH_NOT_SAME_ORIGIN_V2/, path);
    await assert.rejects(client.get(path), /PATH_NOT_SAME_ORIGIN_V2/);
  }
  assert.equal(server.calls.length, 2, 'path ngoài không được gọi fetch');
});

test('không mutation hoặc upload trước khi có phiên', async () => {
  const server = scripted(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Cần đăng nhập' } }));
  const session = new SessionController({ fetch: server.fetch });
  await session.bootstrap();
  assert.equal(session.snapshot().state, 'guest');
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const operation = pending.begin({
    intentId: 'intent-1',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  await assert.rejects(
    client.mutate(operation),
    (error: unknown) => error instanceof ApiFailure && error.code === 'SESSION_REQUIRED',
  );
  const file = new File(['x'], 'a.txt');
  await assert.rejects(
    client.upload('7d4c2d1e-5b8f-4f7e-9d0a-2b9b8c7d6e5f', file, new AbortController().signal),
    (error: unknown) => error instanceof ApiFailure && error.code === 'SESSION_REQUIRED',
  );
  assert.equal(server.calls.length, 1, 'chỉ GET session, không gửi write');
});

test('mutation JSON gửi CSRF, Idempotency-Key = operation.id và đúng bodyJson đã freeze', async () => {
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => json(201, { id: 'p1' }),
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const body = { key: 'AB', name: 'Dự án', repositoryUrl: null };
  const operation = pending.begin({
    intentId: 'intent-1',
    method: 'POST',
    path: '/v2/projects',
    body,
    storage: 'tab',
  });
  body.name = 'đã sửa sau khi tạo';
  assert.equal(operation.bodyJson, JSON.stringify({ key: 'AB', name: 'Dự án', repositoryUrl: null }));
  assert.ok(Object.isFrozen(operation));
  assert.deepEqual(await client.mutate(operation), { id: 'p1' });
  const write = server.calls[1];
  assert.equal(write?.init.method, 'POST');
  assert.equal(write?.init.credentials, 'same-origin');
  assert.equal(write?.headers.get('content-type'), 'application/json');
  assert.equal(write?.headers.get('x-csrf-token'), csrf);
  assert.equal(write?.headers.get('idempotency-key'), operation.id);
  assert.equal(write?.init.body, operation.bodyJson);
  assert.equal(pending.get(operation.id), undefined, 'accepted → operation được xóa');
});

test('upload bytes thô gửi CSRF, octet-stream, không Idempotency-Key', async () => {
  const attachment = '7d4c2d1e-5b8f-4f7e-9d0a-2b9b8c7d6e5f';
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => json(201, { attachmentId: attachment }),
  );
  const session = await authenticated(server.fetch);
  const client = createOwnerClient({
    session,
    pending: new PendingStore(null),
    fetch: server.fetch,
    sleep: noSleep,
  });
  const file = new File([new Uint8Array([1, 2, 3])], 'a.bin');
  await client.upload(attachment, file, new AbortController().signal);
  const put = server.calls[1];
  assert.equal(put?.url, `/v2/attachment-uploads/${attachment}/content`);
  assert.equal(put?.init.method, 'PUT');
  assert.equal(put?.headers.get('content-type'), 'application/octet-stream');
  assert.equal(put?.headers.get('x-csrf-token'), csrf);
  assert.equal(put?.headers.get('idempotency-key'), null);
  assert.equal(put?.init.body, file);
  await assert.rejects(client.upload('../x', file, new AbortController().signal), /UPLOAD_ID_INVALID/);
});

test('503 không phải JSON thành ApiFailure, GET thử lại tối đa 3 lần', async () => {
  const plain = () => new Response('Bad gateway', { status: 503, headers: { 'content-type': 'text/plain' } });
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    plain,
    plain,
    plain,
    plain,
  );
  const waits: number[] = [];
  const session = await authenticated(server.fetch);
  const client = createOwnerClient({
    session,
    pending: new PendingStore(null),
    fetch: server.fetch,
    sleep: async (ms) => void waits.push(ms),
  });
  await assert.rejects(client.get('/v2/projects'), (error: unknown) => {
    assert.ok(error instanceof ApiFailure, String(error));
    assert.equal(error.status, 503);
    assert.equal(error.code, 'SERVICE_UNAVAILABLE');
    return true;
  });
  assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(server.calls.length, 5);
});

test('AbortError khi mutation đang gửi → ambiguous, không đổi key, không tự gửi lại', async () => {
  const controller = new AbortController();
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => {
      controller.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    },
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const operation = pending.begin({
    intentId: 'intent-1',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  await assert.rejects(client.mutate(operation, { signal: controller.signal }), (error: unknown) => {
    assert.ok(error instanceof ApiFailure);
    assert.equal(error.kind, 'aborted');
    return true;
  });
  assert.equal(pending.get(operation.id)?.state, 'ambiguous');
  assert.equal(pending.get(operation.id)?.bodyJson, operation.bodyJson);
  assert.equal(server.calls.length, 2);
  assert.throws(
    () =>
      pending.begin({
        intentId: 'intent-1',
        method: 'POST',
        path: '/v2/projects',
        body: { key: 'CD' },
        storage: 'tab',
      }),
    IntentUnresolvedError,
  );
});

test('hai lần thử lại sau lỗi transport/503 giữ cùng key và cùng body', async () => {
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => {
      throw new TypeError('fetch failed');
    },
    () => new Response('<html>proxy</html>', { status: 503, headers: { 'content-type': 'text/html' } }),
    () => json(201, { id: 'p1' }),
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const operation = pending.begin({
    intentId: 'intent-1',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  assert.deepEqual(await client.mutate(operation), { id: 'p1' });
  const writes = server.calls.slice(1);
  assert.equal(writes.length, 3);
  assert.deepEqual(
    new Set(writes.map((call) => call.headers.get('idempotency-key'))),
    new Set([operation.id]),
  );
  assert.deepEqual(new Set(writes.map((call) => call.init.body)), new Set([operation.bodyJson]));
});

test('lỗi transport hết lượt → Chưa xác nhận, operation vẫn ambiguous với cùng key', async () => {
  const fail = () => {
    throw new TypeError('fetch failed');
  };
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    fail,
    fail,
    fail,
    fail,
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const operation = pending.begin({
    intentId: 'intent-1',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  await assert.rejects(
    client.mutate(operation),
    (error: unknown) => error instanceof ApiFailure && error.code === 'UNCONFIRMED',
  );
  assert.equal(pending.get(operation.id)?.state, 'ambiguous');
  assert.equal(server.calls.length, 5);
});

test('401 khi gửi → phiên expired, khóa write, operation suspended giữ nguyên key/body', async () => {
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Cần đăng nhập' } }),
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  session.onExpire(() => pending.suspendAll());
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const sessionSignal = session.signal();
  const operation = pending.begin({
    intentId: 'intent-1',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  await assert.rejects(
    client.mutate(operation),
    (error: unknown) => error instanceof ApiFailure && error.status === 401,
  );
  assert.equal(session.snapshot().state, 'expired');
  assert.equal(session.csrf(), null);
  assert.ok(sessionSignal.aborted, 'GET/stream của phiên cũ phải bị hủy');
  const kept = pending.get(operation.id);
  assert.equal(kept?.state, 'suspended');
  assert.equal(kept?.id, operation.id);
  assert.equal(kept?.bodyJson, operation.bodyJson);
  assert.ok(kept);
  await assert.rejects(
    client.mutate(kept),
    (error: unknown) => error instanceof ApiFailure && error.code === 'SESSION_REQUIRED',
  );
  assert.equal(server.calls.length, 2);
});

test('IDEMPOTENCY_CONFLICT giữ operation; lỗi 400 là từ chối cuối cho phép key mới', async () => {
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => json(409, { error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Khóa gửi lại có nội dung khác' } }),
    () => json(400, { error: { code: 'INVALID_INPUT', message: 'Dữ liệu không hợp lệ' } }),
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const first = pending.begin({
    intentId: 'a',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  await assert.rejects(
    client.mutate(first),
    (error: unknown) => error instanceof ApiFailure && error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.ok(pending.get(first.id), 'không xóa hoặc đổi key để thoát conflict');
  const second = pending.begin({
    intentId: 'b',
    method: 'POST',
    path: '/v2/projects',
    body: { key: '1' },
    storage: 'tab',
  });
  await assert.rejects(
    client.mutate(second),
    (error: unknown) => error instanceof ApiFailure && error.status === 400,
  );
  assert.equal(pending.get(second.id), undefined);
  const retry = pending.begin({
    intentId: 'b',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  assert.notEqual(retry.id, second.id, 'sau rejection mới cấp key mới');
});

test('GET cũ bị hủy khi GET mới bắt đầu, kết quả trễ bị bỏ qua', async () => {
  const latest = new LatestRequest();
  const older = latest.next();
  const newer = latest.next();
  assert.ok(older.aborted, 'request cũ bị abort');
  assert.equal(latest.isCurrent(older), false);
  assert.equal(latest.isCurrent(newer), true);
  const base = decodeTicket({
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    parentId: null,
    rootId: '11111111-1111-4111-8111-111111111111',
    level: 'request',
    kind: 'code',
    title: 't',
    description: '',
    mandatory: true,
    criteria: {},
    inputs: {},
    outputs: {},
    skill: null,
    workflowPin: null,
    status: 'ready',
    revision: 3,
    waitReason: null,
    repairCycles: 0,
    mergedCommit: null,
  });
  const stale: Ticket = { ...base, revision: 2, status: 'pending' };
  assert.equal(newerTicket(base, stale), base, 'revision guard từ chối row cũ');
  assert.equal(newerTicket(stale, base), base);
});

test('decoder từ chối thiếu field, sai primitive và field lạ chưa review', () => {
  assert.throws(() => decodeSession({ owner: { id: 'owner' } }), ContractError);
  assert.throws(() => decodeSession({ owner: { id: 'owner' }, csrfToken: 1 }), ContractError);
  assert.throws(() => decodeSession({ owner: { id: 'other' }, csrfToken: csrf }), ContractError);
  assert.throws(() => decodeSession({ owner: { id: 'owner' }, csrfToken: csrf, extra: true }), ContractError);
  const additive = obj({ id: str }, { additive: ['reviewedNew'] });
  assert.deepEqual(additive({ id: 'x', reviewedNew: 1 }), { id: 'x' });
  assert.throws(() => obj({ n: int })({ n: 1.5 }), ContractError);
});
