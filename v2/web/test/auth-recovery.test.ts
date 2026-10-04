import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiFailure, createOwnerClient } from '../src/lib/api.ts';
import {
  IntentUnresolvedError,
  PendingSerializationError,
  PendingStore,
  pendingStorageKey,
  serializePending,
} from '../src/lib/pending-operation.ts';
import { SessionController, safeReturnPath, validatePassword } from '../src/lib/session.ts';

const csrf = 'a'.repeat(64);
const nextCsrf = 'c'.repeat(64);
const projectId = '22222222-2222-4222-8222-222222222222';
type Call = { url: string; init: RequestInit; headers: Headers };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

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

const unauthenticated = () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Cần đăng nhập' } });
const sessionOk =
  (token = csrf) =>
  () =>
    json(200, { owner: { id: 'owner' }, csrfToken: token });

test('bootstrapping → authenticated / guest / bootstrap-unavailable', async () => {
  const ok = new SessionController({ fetch: scripted(sessionOk()).fetch });
  assert.equal(ok.snapshot().state, 'bootstrapping');
  await ok.bootstrap();
  assert.equal(ok.snapshot().state, 'authenticated');
  assert.equal(ok.csrf(), csrf);

  const guest = new SessionController({ fetch: scripted(unauthenticated).fetch });
  await guest.bootstrap();
  assert.deepEqual(guest.snapshot(), { state: 'guest', ownerId: null, error: null, busy: false });

  const missing = new SessionController({
    fetch: scripted(() => json(503, { error: { code: 'OWNER_NOT_BOOTSTRAPPED', message: 'x' } })).fetch,
  });
  await missing.bootstrap();
  assert.equal(missing.snapshot().state, 'guest');
  assert.equal(missing.snapshot().error, 'OWNER_NOT_BOOTSTRAPPED');
});

test('login là POST {password} không CSRF/key, mật khẩu 1–4096, 429 không tự thử lại', async () => {
  assert.equal(validatePassword(''), 'PASSWORD_INVALID');
  assert.equal(validatePassword('x'.repeat(4097)), 'PASSWORD_INVALID');
  assert.equal(validatePassword('x'.repeat(4096)), null);
  const server = scripted(
    unauthenticated,
    () => json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'sai' } }),
    () => json(429, { error: { code: 'LOGIN_THROTTLED', message: 'Thử lại sau' } }),
    () => json(200, { owner: { id: 'owner' }, csrfToken: csrf }),
    sessionOk(),
  );
  const session = new SessionController({ fetch: server.fetch });
  await session.bootstrap();
  assert.equal(await session.login(''), false);
  assert.equal(session.snapshot().error, 'PASSWORD_INVALID');
  assert.equal(server.calls.length, 1, 'mật khẩu rỗng không gửi request');
  assert.equal(await session.login('wrong'), false);
  assert.equal(session.snapshot().error, 'INVALID_CREDENTIALS');
  assert.equal(await session.login('again'), false);
  assert.equal(session.snapshot().error, 'LOGIN_THROTTLED');
  assert.equal(server.calls.length, 3, '429 không blind retry');
  assert.equal(await session.login('right'), true);
  const post = server.calls[3];
  assert.equal(post?.url, '/v2/auth/session');
  assert.equal(post?.init.method, 'POST');
  assert.equal(post?.init.body, JSON.stringify({ password: 'right' }));
  assert.equal(post?.headers.get('x-csrf-token'), null);
  assert.equal(post?.headers.get('idempotency-key'), null);
  assert.equal(server.calls[4]?.init.method ?? 'GET', 'GET', 'login xong phải GET session xác minh owner');
  assert.equal(session.snapshot().state, 'authenticated');
});

test('owner khác sau reauth không được authenticated', async () => {
  const server = scripted(
    sessionOk(),
    () => json(200, { owner: { id: 'owner' }, csrfToken: nextCsrf }),
    () => json(200, { owner: { id: 'intruder' }, csrfToken: nextCsrf }),
  );
  const session = new SessionController({ fetch: server.fetch });
  await session.bootstrap();
  session.expire();
  assert.equal(await session.login('pw'), false);
  assert.equal(session.snapshot().state, 'expired');
  assert.equal(session.csrf(), null);
});

test('mất response → 401 khi gửi lại → reauth cùng owner → replay đúng key/body với CSRF mới', async () => {
  const storage = memoryStorage();
  const pending = new PendingStore(storage);
  const server = scripted(
    sessionOk(),
    () => {
      throw new TypeError('connection reset after commit');
    },
    unauthenticated,
    () => json(200, { owner: { id: 'owner' }, csrfToken: nextCsrf }),
    sessionOk(nextCsrf),
    () => json(201, { id: projectId }),
  );
  const session = new SessionController({ fetch: server.fetch });
  session.onExpire(() => pending.suspendAll());
  await session.bootstrap();
  const client = createOwnerClient({
    session,
    pending,
    fetch: server.fetch,
    sleep: async () => undefined,
    maxRetries: 0,
  });
  const body = { key: 'AB', name: 'Dự án', repositoryUrl: null };
  const operation = pending.begin({
    intentId: 'create-project',
    method: 'POST',
    path: '/v2/projects',
    body,
    storage: 'tab',
  });
  await assert.rejects(
    client.mutate(operation),
    (error: unknown) => error instanceof ApiFailure && error.code === 'UNCONFIRMED',
  );
  assert.equal(pending.get(operation.id)?.state, 'ambiguous');
  const ambiguous = pending.get(operation.id);
  assert.ok(ambiguous);
  await assert.rejects(
    client.mutate(ambiguous),
    (error: unknown) => error instanceof ApiFailure && error.status === 401,
  );
  assert.equal(session.snapshot().state, 'expired');
  assert.equal(pending.get(operation.id)?.state, 'suspended');
  assert.ok(
    storage.data.get(pendingStorageKey)?.includes(operation.id),
    'operation unresolved vẫn trong sessionStorage của tab',
  );
  assert.equal(await session.login('pw'), true);
  const resumed = pending.get(operation.id);
  assert.ok(resumed);
  assert.deepEqual(await client.mutate(resumed), { id: projectId });
  const writes = server.calls.filter((call) => call.init.method === 'POST' && call.url === '/v2/projects');
  assert.equal(writes.length, 3);
  assert.deepEqual(
    new Set(writes.map((call) => call.headers.get('idempotency-key'))),
    new Set([operation.id]),
  );
  assert.deepEqual(new Set(writes.map((call) => call.init.body)), new Set([operation.bodyJson]));
  assert.equal(writes[2]?.headers.get('x-csrf-token'), nextCsrf, 'replay dùng CSRF mới');
  assert.equal(pending.get(operation.id), undefined, 'chỉ clear sau confirmed acceptance');
});

test('logout: DELETE kèm CSRF, đóng phiên, chỉ giữ tombstone không payload', async () => {
  const storage = memoryStorage();
  const pending = new PendingStore(storage);
  const server = scripted(sessionOk(), () => new Response(null, { status: 204 }));
  const session = new SessionController({ fetch: server.fetch });
  const cleared: string[] = [];
  session.onLogout(() => {
    pending.tombstoneAll();
    cleared.push('cache');
  });
  await session.bootstrap();
  const signal = session.signal();
  const operation = pending.begin({
    intentId: 'bind',
    method: 'PUT',
    path: `/v2/projects/${projectId}/binding`,
    body: {
      machineId: '33333333-3333-4333-8333-333333333333',
      checkoutPath: '/Users/a/riêng-tư',
      expectedRevision: 4,
    },
    storage: 'tab',
  });
  pending.markAmbiguous(operation.id);
  await session.logout();
  const remove = server.calls[1];
  assert.equal(remove?.init.method, 'DELETE');
  assert.equal(remove?.headers.get('x-csrf-token'), csrf);
  assert.equal(remove?.headers.get('idempotency-key'), null);
  assert.equal(session.snapshot().state, 'guest');
  assert.equal(session.csrf(), null);
  assert.ok(signal.aborted);
  assert.deepEqual(cleared, ['cache']);
  assert.equal(pending.list().length, 0);
  assert.deepEqual(pending.tombstones(), [
    {
      id: operation.id,
      intentId: 'bind',
      ownerId: 'owner',
      method: 'PUT',
      path: `/v2/projects/${projectId}/binding`,
      targetId: projectId,
      expectedRevision: 4,
      state: 'needs_payload',
    },
  ]);
  const persisted = storage.data.get(pendingStorageKey) ?? '';
  assert.doesNotMatch(persisted, /riêng-tư|checkoutPath|bodyJson/);
  assert.throws(
    () =>
      pending.begin({
        intentId: 'bind',
        method: 'PUT',
        path: `/v2/projects/${projectId}/binding`,
        body: {},
        storage: 'tab',
      }),
    IntentUnresolvedError,
    'tombstone chặn key mới cho cùng intent',
  );
});

test('nhập lại payload khác → 409 giữ tombstone và cùng key; payload đúng thì accepted', async () => {
  const storage = memoryStorage();
  const pending = new PendingStore(storage);
  const operation = pending.begin({
    intentId: 'create',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  pending.markAmbiguous(operation.id);
  pending.tombstoneAll();
  const server = scripted(
    sessionOk(),
    () => json(409, { error: { code: 'IDEMPOTENCY_CONFLICT', message: 'khác' } }),
    () => json(201, { id: projectId }),
  );
  const session = new SessionController({ fetch: server.fetch });
  await session.bootstrap();
  const client = createOwnerClient({ session, pending, fetch: server.fetch, sleep: async () => undefined });
  const wrong = pending.resume(operation.id, { key: 'XY' }, 'tab');
  assert.equal(wrong.id, operation.id);
  await assert.rejects(
    client.mutate(wrong),
    (error: unknown) => error instanceof ApiFailure && error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(pending.tombstones()[0]?.id, operation.id, 'conflict giữ tombstone');
  assert.equal(pending.get(operation.id), undefined, 'payload sai không được giữ');
  const right = pending.resume(operation.id, { key: 'AB' }, 'tab');
  assert.deepEqual(await client.mutate(right), { id: projectId });
  assert.equal(server.calls[2]?.headers.get('idempotency-key'), operation.id);
  assert.equal(pending.tombstones().length, 0);
});

test('reload tab: operation tab giữ key/body ở trạng thái ambiguous, operation memory thành tombstone', () => {
  const storage = memoryStorage();
  const first = new PendingStore(storage);
  const tab = first.begin({
    intentId: 'a',
    method: 'POST',
    path: '/v2/projects',
    body: { key: 'AB' },
    storage: 'tab',
  });
  const secret = first.begin({
    intentId: 's',
    method: 'POST',
    path: `/v2/machines/${projectId}/api-providers/p/secret`,
    body: { expectedRevision: 2, keyId: projectId, operationId: projectId, secret: 'sk-live-123' },
    storage: 'memory',
  });
  assert.doesNotMatch(storage.data.get(pendingStorageKey) ?? '', /sk-live-123|"secret"/);
  const reloaded = new PendingStore(storage);
  assert.equal(reloaded.get(tab.id)?.state, 'ambiguous');
  assert.equal(reloaded.get(tab.id)?.bodyJson, tab.bodyJson);
  assert.equal(reloaded.get(secret.id), undefined);
  assert.equal(reloaded.tombstones()[0]?.id, secret.id);
  assert.equal(reloaded.tombstones()[0]?.expectedRevision, 2);
});

test('đóng form secret chuyển operation memory thành tombstone và xóa secret', () => {
  const pending = new PendingStore(memoryStorage());
  const secret = pending.begin({
    intentId: 's',
    method: 'POST',
    path: '/v2/machines/x/secret',
    body: { secret: 'sk-1' },
    storage: 'memory',
  });
  pending.discardMemory('s');
  assert.equal(pending.get(secret.id), undefined);
  assert.equal(pending.tombstones()[0]?.id, secret.id);
  assert.doesNotMatch(JSON.stringify(pending.tombstones()), /sk-1/);
});

test('serializer từ chối memory operation, secret, token và hash của secret', () => {
  const base = {
    id: 'k',
    intentId: 'i',
    ownerId: 'owner' as const,
    method: 'POST' as const,
    path: '/v2/projects',
    state: 'pending' as const,
  };
  assert.throws(
    () => serializePending({ operations: [{ ...base, bodyJson: '{}', storage: 'memory' }], tombstones: [] }),
    PendingSerializationError,
  );
  for (const bodyJson of [
    '{"password":"x"}',
    '{"secret":"x"}',
    '{"provider":{"apiKey":"x"}}',
    '{"token":"abc"}',
    '{"secretSha256":"abc"}',
    '{"items":[{"csrfToken":"x"}]}',
  ]) {
    assert.throws(
      () => serializePending({ operations: [{ ...base, bodyJson, storage: 'tab' }], tombstones: [] }),
      PendingSerializationError,
      bodyJson,
    );
  }
  assert.throws(
    () =>
      new PendingStore(null).begin({
        intentId: 'x',
        method: 'POST',
        path: '/v2/machines',
        body: { token: 't' },
        storage: 'tab',
      }),
    PendingSerializationError,
    'payload secret bắt buộc storage=memory',
  );
  assert.match(
    serializePending({ operations: [{ ...base, bodyJson: '{"key":"AB"}', storage: 'tab' }], tombstones: [] }),
    /"version":1/,
  );
});

test('return route chỉ nhận path nội bộ /crew-v2/', () => {
  assert.equal(safeReturnPath('/crew-v2/projects/abc?view=list#x'), '/crew-v2/projects/abc?view=list#x');
  for (const raw of [
    'https://evil.example/crew-v2/',
    '//evil.example/crew-v2/',
    '/crew-v2/../v2/auth/session',
    '/crew-v2\\evil',
    '/v2/projects',
    'javascript:alert(1)',
    null,
    '',
  ]) {
    assert.equal(safeReturnPath(raw), '/crew-v2/', String(raw));
  }
});

test('logout với CSRF cũ làm mới CSRF rồi DELETE lại để server thu hồi phiên', async () => {
  const server = scripted(
    sessionOk(),
    () => json(403, { error: { code: 'CSRF_INVALID', message: 'Mã bảo vệ không hợp lệ' } }),
    sessionOk(nextCsrf),
    () => new Response(null, { status: 204 }),
  );
  const session = new SessionController({ fetch: server.fetch });
  await session.bootstrap();
  await session.logout();
  assert.equal(server.calls[3]?.init.method, 'DELETE');
  assert.equal(server.calls[3]?.headers.get('x-csrf-token'), nextCsrf);
  assert.deepEqual(session.snapshot(), { state: 'guest', ownerId: null, error: null, busy: false });
});
