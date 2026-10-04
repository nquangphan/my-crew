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

const csrfInvalid = () => json(403, { error: { code: 'CSRF_INVALID', message: 'Mã bảo vệ không hợp lệ' } });
const freshCsrf = 'c'.repeat(64);

test('403 CSRF_INVALID trên operation ambiguous không nhả key; làm mới CSRF rồi replay đúng key/body', async () => {
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    csrfInvalid,
    () => json(200, { owner: { id: 'owner' }, csrfToken: freshCsrf }),
    () => json(201, { id: 'p1' }),
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const operation = pending.begin({
    intentId: 'a',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  pending.markAmbiguous(operation.id);
  assert.deepEqual(await client.mutate(operation), { id: 'p1' });
  const [, stale, refresh, replay] = server.calls;
  assert.equal(stale?.headers.get('x-csrf-token'), csrf);
  assert.equal(refresh?.url, '/v2/auth/session');
  assert.equal(refresh?.init.method, 'GET');
  assert.equal(replay?.headers.get('x-csrf-token'), freshCsrf);
  assert.equal(replay?.headers.get('idempotency-key'), operation.id);
  assert.equal(replay?.init.body, operation.bodyJson);
  assert.equal(session.csrf(), freshCsrf);
  assert.equal(pending.get(operation.id), undefined, 'chỉ clear sau khi accepted');
});

test('403 CSRF_INVALID mà làm mới phiên nhận 401 → expired, operation suspended giữ key', async () => {
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    csrfInvalid,
    () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Cần đăng nhập' } }),
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const operation = pending.begin({
    intentId: 'a',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  pending.markAmbiguous(operation.id);
  await assert.rejects(
    client.mutate(operation),
    (error: unknown) => error instanceof ApiFailure && error.status === 401,
  );
  assert.equal(session.snapshot().state, 'expired');
  assert.equal(pending.get(operation.id)?.state, 'suspended');
  assert.equal(pending.get(operation.id)?.bodyJson, operation.bodyJson);
  assert.throws(
    () =>
      pending.begin({
        intentId: 'a',
        method: 'POST',
        path: '/v2/projects',
        body: { key: 'AB' },
        storage: 'tab',
      }),
    IntentUnresolvedError,
  );
});

test('403 ORIGIN_INVALID lặp lại sau một lần làm mới → dừng, operation suspended giữ key', async () => {
  const originInvalid = () =>
    json(403, { error: { code: 'ORIGIN_INVALID', message: 'Nguồn yêu cầu không hợp lệ' } });
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    originInvalid,
    () => json(200, { owner: { id: 'owner' }, csrfToken: freshCsrf }),
    originInvalid,
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const operation = pending.begin({
    intentId: 'a',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  await assert.rejects(
    client.mutate(operation),
    (error: unknown) => error instanceof ApiFailure && error.code === 'ORIGIN_INVALID',
  );
  assert.equal(server.calls.length, 4, 'chỉ làm mới một lần, không vòng lặp');
  assert.equal(pending.get(operation.id)?.state, 'suspended');
  assert.equal(session.snapshot().state, 'authenticated');
});

test('4xx phụ thuộc trạng thái sau lần gửi chưa chắc chắn không nhả key; 400 theo body vẫn là terminal', async () => {
  const notFound = () => json(404, { error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } });
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    notFound,
    () => {
      throw new TypeError('fetch failed');
    },
    () => json(409, { error: { code: 'REVISION_CONFLICT', message: 'Đã thay đổi' } }),
    () => json(400, { error: { code: 'INVALID_INPUT', message: 'Dữ liệu không hợp lệ' } }),
    notFound,
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const path = `/v2/projects/${'2'.repeat(8)}-2222-4222-8222-${'2'.repeat(12)}/binding`;
  const ambiguous = pending.begin({
    intentId: 'a',
    method: 'PUT',
    path,
    body: { expectedRevision: 1 },
    storage: 'tab',
  });
  pending.markAmbiguous(ambiguous.id);
  await assert.rejects(
    client.mutate(ambiguous),
    (error: unknown) => error instanceof ApiFailure && error.code === 'NOT_FOUND',
  );
  assert.equal(
    pending.get(ambiguous.id)?.state,
    'ambiguous',
    '404 từ authorize không chứng minh chưa commit',
  );
  const inCall = pending.begin({
    intentId: 'b',
    method: 'PUT',
    path,
    body: { expectedRevision: 2 },
    storage: 'tab',
  });
  await assert.rejects(
    client.mutate(inCall),
    (error: unknown) => error instanceof ApiFailure && error.code === 'REVISION_CONFLICT',
  );
  assert.equal(pending.get(inCall.id)?.state, 'ambiguous', 'lần gửi trước trong cùng lượt có thể đã commit');
  await assert.rejects(
    client.mutate(pending.get(ambiguous.id) ?? ambiguous),
    (error: unknown) => error instanceof ApiFailure && error.status === 400,
  );
  assert.equal(pending.get(ambiguous.id), undefined, '400 theo body là terminal');
  const fresh = pending.begin({
    intentId: 'c',
    method: 'PUT',
    path,
    body: { expectedRevision: 3 },
    storage: 'tab',
  });
  await assert.rejects(
    client.mutate(fresh),
    (error: unknown) => error instanceof ApiFailure && error.code === 'NOT_FOUND',
  );
  assert.equal(pending.get(fresh.id), undefined, 'operation chưa từng gửi được trả lời rõ ràng thì terminal');
});

test('payload nhập lại cho tombstone bị 400/413/404 → trở về tombstone, không nhả key cũ', async () => {
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => json(400, { error: { code: 'INVALID_INPUT', message: 'Dữ liệu không hợp lệ' } }),
    () => json(413, { error: { code: 'BODY_TOO_LARGE', message: 'Dữ liệu vượt giới hạn' } }),
    () => json(404, { error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } }),
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const original = pending.begin({
    intentId: 'a',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  pending.markAmbiguous(original.id);
  pending.tombstoneAll();
  for (const [body, status] of [
    [{ key: '' }, 400],
    [{ key: 'AB', name: 'x'.repeat(10) }, 413],
    [{ key: 'AB', name: 'y' }, 404],
  ] as const) {
    const resumed = pending.resume(original.id, body, 'tab');
    await assert.rejects(
      client.mutate(resumed),
      (error: unknown) => error instanceof ApiFailure && error.status === status,
    );
    assert.equal(pending.get(original.id), undefined, 'payload sai không được giữ');
    assert.deepEqual(
      pending.tombstones().map((item) => item.id),
      [original.id],
      `${status}: tombstone giữ key cũ`,
    );
    assert.throws(
      () =>
        pending.begin({
          intentId: 'a',
          method: 'POST',
          path: '/v2/projects',
          body: { key: 'AB' },
          storage: 'tab',
        }),
      IntentUnresolvedError,
    );
  }
});

test('hai lượt mutate song song trên cùng operation: lượt sau bị chặn, không gửi request', async () => {
  let release: (response: Response) => void = () => undefined;
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => new Promise<Response>((resolve) => (release = resolve)),
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: noSleep });
  const operation = pending.begin({
    intentId: 'a',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  const first = client.mutate(operation);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    client.mutate(operation),
    (error: unknown) => error instanceof ApiFailure && error.code === 'OPERATION_IN_FLIGHT',
  );
  assert.equal(server.calls.length, 2, 'lượt trùng không được gửi');
  release(json(201, { id: 'p1' }));
  assert.deepEqual(await first, { id: 'p1' });
  assert.equal(pending.get(operation.id), undefined);
});

test('caller abort trước khi làm mới CSRF hoặc trong lúc làm mới → không replay, giữ key', async () => {
  const before = new AbortController();
  const during = new AbortController();
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => {
      before.abort();
      return csrfInvalid();
    },
    csrfInvalid,
    () => {
      during.abort();
      return json(200, { owner: { id: 'owner' }, csrfToken: freshCsrf });
    },
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
  pending.markAmbiguous(first.id);
  await assert.rejects(
    client.mutate(first, { signal: before.signal }),
    (error: unknown) => error instanceof ApiFailure && error.kind === 'aborted',
  );
  assert.equal(server.calls.length, 2, 'không làm mới, không replay');
  assert.equal(pending.get(first.id)?.state, 'ambiguous');
  const second = pending.begin({
    intentId: 'b',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'CD' },
    storage: 'tab',
  });
  await assert.rejects(
    client.mutate(second, { signal: during.signal }),
    (error: unknown) => error instanceof ApiFailure && error.kind === 'aborted',
  );
  assert.equal(server.calls.length, 4, 'đã làm mới nhưng không replay');
  assert.equal(session.csrf(), freshCsrf);
  assert.equal(pending.get(second.id)?.id, second.id);
});

const notConfigured = (code: string, status = 503) =>
  json(status, { error: { code, message: 'Chưa cấu hình xử lý tệp trên máy chủ' } });

test('503 *_NOT_CONFIGURED: một request, giữ key, đánh dấu lỗi cấu hình máy chủ, không phải chưa xác nhận', async () => {
  const waits: number[] = [];
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => notConfigured('EXTRACTION_NOT_CONFIGURED'),
    () => json(201, { id: 'p1' }),
  );
  const session = await authenticated(server.fetch);
  const pending = new PendingStore(null);
  const client = createOwnerClient({
    session,
    pending,
    fetch: server.fetch,
    sleep: async (ms) => void waits.push(ms),
  });
  const operation = pending.begin({
    intentId: 'a',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  await assert.rejects(client.mutate(operation), (error: unknown) => {
    assert.ok(error instanceof ApiFailure);
    assert.equal(error.status, 503);
    assert.equal(error.code, 'EXTRACTION_NOT_CONFIGURED');
    assert.equal(error.kind, 'configuration');
    assert.equal(error.message, 'Chưa cấu hình xử lý tệp trên máy chủ');
    return true;
  });
  assert.equal(server.calls.length, 2, 'không auto-retry');
  assert.deepEqual(waits, []);
  assert.equal(pending.get(operation.id)?.id, operation.id, 'giữ key');
  assert.equal(pending.configurationError(operation.id), 'EXTRACTION_NOT_CONFIGURED');
  assert.throws(
    () =>
      pending.begin({
        intentId: 'a',
        method: 'POST',
        path: '/v2/projects',
        body: { key: 'AB' },
        storage: 'tab',
      }),
    IntentUnresolvedError,
  );
  // Explicit resend after the server is configured uses the same key and clears the marker.
  assert.deepEqual(await client.mutate(operation), { id: 'p1' });
  assert.equal(server.calls[2]?.headers.get('idempotency-key'), operation.id);
  assert.equal(pending.configurationError(operation.id), null);
});

test('409 INPUT_SERVICES_NOT_CONFIGURED trên operation mới cũng giữ key; 503 khác vẫn retry', async () => {
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => notConfigured('INPUT_SERVICES_NOT_CONFIGURED', 409),
    () => json(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } }),
    () => json(201, { id: 'p2' }),
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
    (error: unknown) => error instanceof ApiFailure && error.kind === 'configuration',
  );
  assert.equal(pending.configurationError(first.id), 'INPUT_SERVICES_NOT_CONFIGURED');
  const second = pending.begin({
    intentId: 'b',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'CD' },
    storage: 'tab',
  });
  assert.deepEqual(await client.mutate(second), { id: 'p2' });
  assert.equal(server.calls.length, 4, '503 không phải cấu hình vẫn thử lại');
});

test('GET 503 lỗi cấu hình không thử lại', async () => {
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => notConfigured('ATTACHMENT_STORAGE_NOT_CONFIGURED'),
  );
  const session = await authenticated(server.fetch);
  const client = createOwnerClient({
    session,
    pending: new PendingStore(null),
    fetch: server.fetch,
    sleep: noSleep,
  });
  await assert.rejects(client.get('/v2/attachment-policy'), (error: unknown) => {
    return (
      error instanceof ApiFailure &&
      error.code === 'ATTACHMENT_STORAGE_NOT_CONFIGURED' &&
      error.kind === 'configuration'
    );
  });
  assert.equal(server.calls.length, 2);
});

test('lastServerDate theo header Date của response gần nhất, bỏ qua header hỏng', async () => {
  const dated = (status: number, body: unknown, date: string) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', date } });
  const server = scripted(
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    () => dated(200, { ok: 1 }, 'Sun, 05 Oct 2026 01:00:00 GMT'),
    () => dated(404, { error: { code: 'NOT_FOUND', message: 'x' } }, 'Sun, 05 Oct 2026 01:00:05 GMT'),
    () => dated(200, { ok: 2 }, 'not-a-date'),
  );
  const session = await authenticated(server.fetch);
  const client = createOwnerClient({
    session,
    pending: new PendingStore(null),
    fetch: server.fetch,
    sleep: noSleep,
  });
  assert.equal(client.lastServerDate?.(), null);
  await client.get('/v2/a');
  assert.equal(client.lastServerDate?.()?.toISOString(), '2026-10-05T01:00:00.000Z');
  await assert.rejects(client.get('/v2/b'));
  assert.equal(
    client.lastServerDate?.()?.toISOString(),
    '2026-10-05T01:00:05.000Z',
    'response lỗi vẫn mang giờ server',
  );
  await client.get('/v2/c');
  assert.equal(
    client.lastServerDate?.()?.toISOString(),
    '2026-10-05T01:00:05.000Z',
    'header hỏng không ghi đè',
  );
});
