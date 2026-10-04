import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  describeLocator,
  type Extraction,
  fetchVerifiedBytes,
  sniffRaster,
  summarizeExtraction,
} from '../src/attachments/queries.ts';
import { ComposeController } from '../src/compose/controller.ts';
import {
  answerHashRequest,
  createWorkerHasher,
  digestFile,
  type HashResponse,
  type HashWorker,
} from '../src/compose/file-hash.ts';
import {
  type ComposeSubmission,
  checkIntake,
  clientHashBudgetBytes,
  composeLocks,
  declaredMimeFor,
  fileActions,
  filesFromTransfer,
  localFileName,
  parseDraftRecord,
  pasteDecision,
} from '../src/compose/state.ts';
import {
  FakeComposeServer,
  harness,
  inlineHasher,
  pngFile,
  policy,
  projectId,
  settle,
  ticketId,
} from './support/compose-server.ts';

const otherProject = '77777777-7777-4777-8777-777777777777';

const ticketSubmission = (project = projectId): ComposeSubmission => ({
  kind: 'ticket',
  target: { purpose: 'ticket', projectId: project, ticketId: null },
  ticket: {
    projectId: project,
    parentId: null,
    level: 'request',
    kind: 'code',
    title: 'Ticket có tệp',
    description: '',
    mandatory: true,
    criteria: {},
    inputs: {},
    outputs: {},
    skill: null,
    workflowPin: null,
  },
});
const commentSubmission = (text: string): ComposeSubmission => ({
  kind: 'comment',
  target: { purpose: 'comment', projectId, ticketId },
  text,
});

async function setup(submission: ComposeSubmission, server = new FakeComposeServer()) {
  const env = await harness(server);
  const hasher = inlineHasher();
  const controller = new ComposeController({
    draftKey: 'draft-files',
    submission,
    client: env.client,
    pending: env.pending,
    storage: env.storage,
    hasher: hasher.hasher,
    loadPolicy: (signal) => env.client.get('/v2/attachment-policy', { signal }),
    sleep: async () => undefined,
    now: () => new Date('2026-10-04T03:04:05.000Z'),
  });
  const files = () => controller.view().draft.files;
  const allSettled = () =>
    files().every((file) => ['ready', 'failed', 'unknown'].includes(file.state)) && files().length > 0;
  return { ...env, server, controller, files, allSettled, hasher };
}

test('tên ảnh clipboard không tên/tên chung có giờ Asia/Ho_Chi_Minh và đuôi theo MIME', () => {
  const now = new Date('2026-10-04T03:04:05.000Z');
  assert.equal(
    localFileName({ name: 'image.png', type: 'image/png' }, 'clipboard', 0, now),
    'anh-dan-20261004-100405-1.png',
  );
  assert.equal(
    localFileName({ name: '', type: 'image/jpeg' }, 'clipboard', 1, now),
    'anh-dan-20261004-100405-2.jpg',
  );
  assert.equal(localFileName({ name: 'image.png', type: 'image/png' }, 'input', 0, now), 'image.png');
  assert.equal(
    localFileName({ name: 'bao-cao.pdf', type: 'application/pdf' }, 'drop', 0, now),
    'bao-cao.pdf',
  );
  assert.equal(declaredMimeFor('a.JPG'), 'image/jpeg');
  assert.equal(declaredMimeFor('a.csv'), 'text/csv');
  assert.equal(declaredMimeFor('a.log'), 'text/plain');
});

test('một luồng nhận file: paste giữ cả text và ảnh; input/drop dùng FileList', () => {
  const image = pngFile('image.png', 1);
  const pasted = filesFromTransfer({
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
    ],
    files: [image],
    getData: (format) => (format === 'text/plain' ? 'chữ đi kèm' : ''),
  });
  assert.deepEqual(pasted.files, [image], 'ảnh không bị nhân đôi từ items và files');
  assert.equal(pasted.text, 'chữ đi kèm');
  assert.deepEqual(filesFromTransfer({ items: [], files: [image] }).files, [image]);
  assert.deepEqual(filesFromTransfer(null), { files: [], text: '' });
});

test('policy kiểm trước hash theo giá trị được công bố, không gắn cứng 25MiB', () => {
  const small = { ...policy, maxFileBytes: 10, maxComposeFiles: 2, maxComposeBytes: 15 };
  assert.equal(checkIntake(small, [], { name: 'a.png', size: 10 }), null);
  assert.equal(checkIntake(small, [], { name: 'a.png', size: 11 }), 'ATTACHMENT_FILE_TOO_LARGE');
  assert.equal(checkIntake(small, [], { name: 'a.exe', size: 1 }), 'ATTACHMENT_TYPE_UNSUPPORTED');
  assert.equal(checkIntake(small, [], { name: 'a/b.png', size: 1 }), 'ATTACHMENT_FILE_NAME_INVALID');
  assert.equal(
    checkIntake(small, [{ size: 10, state: 'ready' }], { name: 'b.png', size: 6 }),
    'ATTACHMENT_COMPOSE_QUOTA',
  );
  assert.equal(
    checkIntake(
      small,
      [
        { size: 1, state: 'ready' },
        { size: 1, state: 'failed' },
      ],
      { name: 'c.png', size: 1 },
    ),
    'ATTACHMENT_COMPOSE_QUOTA',
  );
  const huge = {
    ...policy,
    maxFileBytes: clientHashBudgetBytes * 4,
    maxComposeBytes: clientHashBudgetBytes * 8,
  };
  assert.equal(
    checkIntake(huge, [], { name: 'a.pdf', size: clientHashBudgetBytes + 1 }),
    'CLIENT_HASH_LIMIT',
  );
});

test('digestFile: SHA-256 đúng, từ chối vượt ngân sách trước khi đọc', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(await digestFile(new Blob([bytes]), 3), createHash('sha256').update(bytes).digest('hex'));
  await assert.rejects(digestFile(new Blob([bytes]), 2), /CLIENT_HASH_LIMIT/);
  const answer = await answerHashRequest({ id: 7, file: new File([bytes], 'a.txt'), maxBytes: 1 });
  assert.deepEqual(answer, { id: 7, error: 'CLIENT_HASH_LIMIT' });
});

class FakeWorker implements HashWorker {
  static created: FakeWorker[] = [];
  readonly posted: { id: number; file: File }[] = [];
  terminated = false;
  readonly listeners = new Map<string, Set<(event: never) => void>>();
  constructor() {
    FakeWorker.created.push(this);
  }
  postMessage(message: { id: number; file: File; maxBytes: number }) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  addEventListener(type: string, listener: (event: never) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: (event: never) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  reply(data: HashResponse) {
    for (const listener of this.listeners.get('message') ?? []) listener({ data } as never);
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((total, set) => total + set.size, 0);
  }
}

test('worker hasher: mỗi lượt một file, abort dừng worker và bỏ listener, dispose dừng worker', async () => {
  FakeWorker.created = [];
  const hasher = createWorkerHasher(() => new FakeWorker());
  const first = hasher.hash(new File(['a'], 'a.txt'), 10);
  const second = hasher.hash(new File(['b'], 'b.txt'), 10);
  await settle(() => (FakeWorker.created[0]?.posted.length ?? 0) === 1, 'post1');
  const worker = FakeWorker.created[0] as FakeWorker;
  assert.equal(worker.posted.length, 1, 'file thứ hai chờ file đầu');
  worker.reply({ id: worker.posted[0]?.id ?? 0, sha256: 'a'.repeat(64) });
  assert.equal(await first, 'a'.repeat(64));
  await settle(() => worker.posted.length === 2, 'post2');
  worker.reply({ id: worker.posted[1]?.id ?? 0, error: 'HASH_FAILED' });
  await assert.rejects(second, /HASH_FAILED/);
  assert.equal(worker.listenerCount(), 0);
  const abort = new AbortController();
  const third = hasher.hash(new File(['c'], 'c.txt'), 10, abort.signal);
  await settle(() => worker.posted.length === 3, 'post3');
  abort.abort();
  await assert.rejects(third, /HASH_ABORTED/);
  assert.equal(worker.terminated, true, 'abort dừng worker đang hash');
  assert.equal(worker.listenerCount(), 0);
  await assert.rejects(hasher.hash(new File(['x'.repeat(20)], 'big.txt'), 10), /CLIENT_HASH_LIMIT/);
  const fourth = hasher.hash(new File(['d'], 'd.txt'), 10);
  await settle(() => FakeWorker.created.length === 2, 'worker2');
  hasher.dispose();
  assert.equal(FakeWorker.created[1]?.terminated, true);
  void fourth.catch(() => undefined);
});

test('reserve tuần tự theo revision hiện hành rồi PUT cùng upload ID; hai ảnh paste đều ready', async () => {
  const env = await setup(ticketSubmission());
  await env.controller.addFiles([pngFile('image.png', 1), pngFile('image.png', 2)], 'clipboard');
  await settle(
    () => env.files().every((file) => file.state === 'ready') && env.files().length === 2,
    'ready',
  );
  const reserves = env.server.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/uploads'));
  assert.deepEqual(
    reserves.map((call) => JSON.parse(call.body ?? '{}').expectedRevision),
    [1, 2],
  );
  assert.deepEqual(
    env.files().map((file) => file.name),
    ['anh-dan-20261004-100405-1.png', 'anh-dan-20261004-100405-2.png'],
  );
  const puts = env.server.calls.filter((call) => call.method === 'PUT');
  assert.deepEqual(
    puts.map((call) => call.url),
    env.files().map((file) => `/v2/attachment-uploads/${file.uploadId}/content`),
  );
  assert.ok(puts.every((call) => call.headers.get('content-type') === 'application/octet-stream'));
  assert.equal(env.controller.view().draft.selectionRevision, 3);
  const record = parseDraftRecord(env.storage.getItem('crew-v2:compose:draft-files'));
  assert.equal(record?.files.length, 2);
  assert.doesNotMatch(env.storage.getItem('crew-v2:compose:draft-files') ?? '', /iVBOR|base64/);
  const receipt = await env.controller.submit('none');
  assert.equal(receipt?.kind === 'ticket' && receipt.attachmentIds.length, 2);
});

test('file lỗi chặn gửi dù có text; bỏ file lỗi cục bộ thì gửi được', async () => {
  const env = await setup(commentSubmission('có nội dung'));
  await env.controller.addFiles([new File(['x'], 'virus.exe')], 'input');
  assert.equal(env.files()[0]?.state, 'failed');
  assert.equal(env.files()[0]?.errorCode, 'ATTACHMENT_TYPE_UNSUPPORTED');
  assert.equal(env.controller.view().submittable, false);
  assert.equal(await env.controller.submit('none'), null);
  assert.equal(env.controller.view().errorCode, 'FILES_NOT_READY');
  assert.equal(env.server.calls.filter((call) => call.url.endsWith('/attachment-comments')).length, 0);
  await env.controller.removeFile(env.files()[0]?.localId ?? '');
  assert.equal(env.files().length, 0);
  assert.equal(env.controller.view().submittable, true);
});

test('file trùng hash+size bị đánh dấu để owner bỏ, không reserve thêm', async () => {
  const env = await setup(commentSubmission(''));
  await env.controller.addFiles([pngFile('a.png', 5), pngFile('b.png', 5)], 'drop');
  await settle(env.allSettled, 'dup');
  assert.deepEqual(
    env.files().map((file) => [file.state, file.errorCode]),
    [
      ['ready', null],
      ['failed', 'DUPLICATE_LOCAL'],
    ],
  );
  assert.equal(env.server.uploads.size, 1);
});

test('bỏ file: DELETE với revision hiện hành, 409 thì đọc lại compose và gửi lại theo revision mới', async () => {
  const env = await setup(commentSubmission(''));
  await env.controller.addFiles([pngFile('a.png', 1), pngFile('b.png', 2)], 'input');
  await settle(() => env.files().filter((file) => file.state === 'ready').length === 2, 'ready');
  // Another tab moved the revision.
  const compose = [...env.server.composes.values()][0];
  if (compose) compose.revision += 1;
  const target = env.files()[0];
  await env.controller.removeFile(target?.localId ?? '');
  const deletes = env.server.calls.filter((call) => call.method === 'DELETE');
  assert.deepEqual(
    deletes.map((call) => JSON.parse(call.body ?? '{}').expectedRevision),
    [3, 4],
  );
  assert.notEqual(deletes[0]?.headers.get('idempotency-key'), deletes[1]?.headers.get('idempotency-key'));
  assert.equal(env.files().length, 1);
  assert.equal(env.server.uploads.get(target?.uploadId ?? '')?.state, 'abandoned');
  assert.equal(env.controller.view().draft.selectionRevision, 5);
});

test('mất phản hồi reserve sau commit: GET compose nhận lại upload, không tạo reservation thứ hai', async () => {
  const env = await setup(commentSubmission(''));
  env.server.dropAfterCommit = (call) => call.method === 'POST' && call.url.endsWith('/uploads');
  await env.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(env.allSettled, 'unknown');
  assert.equal(env.files()[0]?.state, 'unknown');
  await env.controller.retryFile(env.files()[0]?.localId ?? '');
  await settle(() => env.files()[0]?.state === 'ready', 'adopted');
  assert.equal(env.server.uploads.size, 1);
  assert.equal(
    env.server.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/uploads')).length,
    1,
  );
  assert.equal(env.pending.list().length, 0, 'operation reserve đã được giải quyết bằng GET compose');
});

test('reserve chưa tới server: GET chưa chứng minh được thì retry gửi lại đúng key/body cũ', async () => {
  const env = await setup(commentSubmission(''));
  env.server.failBefore = (call) => call.method === 'POST' && call.url.endsWith('/uploads');
  await env.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(env.allSettled, 'unknown');
  assert.equal(env.files()[0]?.state, 'unknown');
  await env.controller.retryFile(env.files()[0]?.localId ?? '');
  await settle(() => env.files()[0]?.state === 'ready', 'ready');
  const reserves = env.server.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/uploads'));
  assert.equal(reserves.length, 2);
  assert.equal(reserves[0]?.headers.get('idempotency-key'), reserves[1]?.headers.get('idempotency-key'));
  assert.equal(reserves[0]?.body, reserves[1]?.body);
  assert.equal(env.server.uploads.size, 1);
});

test('PUT bận/receiving: chờ rồi gửi lại cùng bytes cùng ID, ready thắng', async () => {
  const env = await setup(commentSubmission(''));
  env.server.busyPuts = 2;
  await env.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(() => env.files()[0]?.state === 'ready', 'ready');
  const puts = env.server.calls.filter((call) => call.method === 'PUT');
  assert.equal(new Set(puts.map((call) => call.url)).size, 1);
  assert.equal(env.server.uploads.size, 1);
});

test('lỗi transport thật khi PUT: file chưa sẵn sàng thì không gửi; retry dùng lại reservation', async () => {
  const env = await setup(commentSubmission('kèm tệp'));
  env.server.blockPuts = true;
  await env.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(env.allSettled, 'unknown');
  assert.equal(env.files()[0]?.state, 'unknown');
  assert.equal(env.files()[0]?.errorCode, 'UPLOAD_UNCONFIRMED');
  assert.equal(env.controller.view().submittable, false);
  env.server.blockPuts = false;
  await env.controller.retryFile(env.files()[0]?.localId ?? '');
  await settle(() => env.files()[0]?.state === 'ready', 'ready');
  const puts = env.server.calls.filter((call) => call.method === 'PUT');
  assert.equal(new Set(puts.map((call) => call.url)).size, 1, 'cùng upload ID');
  assert.equal(env.server.uploads.size, 1);
});

test('đổi project: bỏ compose cũ rõ ràng rồi chuyển file sang compose mới', async () => {
  const env = await setup(ticketSubmission());
  await env.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(() => env.files()[0]?.state === 'ready', 'ready');
  const oldSession = env.controller.view().draft.sessionId;
  assert.equal(env.controller.setSubmission(ticketSubmission(otherProject)), true);
  await settle(
    () => env.controller.view().draft.sessionId !== oldSession && env.files()[0]?.state === 'ready',
    'moved',
  );
  assert.equal(env.server.composes.get(oldSession ?? '')?.state, 'abandoned');
  const next = env.server.composes.get(env.controller.view().draft.sessionId ?? '');
  assert.equal(next?.projectId, otherProject);
  assert.equal(env.controller.view().errorCode, 'TARGET_CHANGED');
});

test('reload mất bytes: chọn lại phải đúng size+SHA trước khi gửi bytes', async () => {
  const server = new FakeComposeServer();
  server.blockPuts = true;
  const first = await setup(commentSubmission(''), server);
  await first.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(first.allSettled, 'unknown');
  first.controller.dispose();
  server.blockPuts = false;
  const env = await harness(server, first.storage);
  const controller = new ComposeController({
    draftKey: 'draft-files',
    submission: commentSubmission(''),
    client: env.client,
    pending: env.pending,
    storage: env.storage,
    hasher: inlineHasher().hasher,
    loadPolicy: (signal) => env.client.get('/v2/attachment-policy', { signal }),
    sleep: async () => undefined,
  });
  await controller.reconcile();
  const file = controller.view().draft.files[0];
  assert.ok(file);
  assert.equal(file.state, 'failed');
  assert.equal(file.errorCode, 'NEEDS_RESELECT');
  assert.equal(controller.view().submittable, false);
  await controller.reselectFile(file.localId, pngFile('a.png', 9));
  assert.equal(controller.view().draft.files[0]?.errorCode, 'RESELECT_MISMATCH');
  await controller.reselectFile(file.localId, pngFile('a.png', 1));
  await settle(() => controller.view().draft.files[0]?.state === 'ready', 'reselected');
  assert.equal(server.uploads.size, 1, 'không tạo attachment trùng');
});

test('dispose dừng hasher và không còn listener', async () => {
  const env = await setup(commentSubmission(''));
  let calls = 0;
  const off = env.controller.subscribe(() => calls++);
  env.controller.dispose();
  assert.equal(env.hasher.disposed(), 1);
  env.controller.startNew();
  assert.equal(calls, 0);
  off();
});

test('preview chỉ nhận PNG/JPEG theo magic bytes, không SVG/HTML/PDF', () => {
  assert.equal(sniffRaster(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffRaster(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffRaster(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  assert.equal(sniffRaster(new TextEncoder().encode('%PDF-1.7')), null);
});

test('bytes preview phải khớp SHA/MIME của record, không tin tên tệp hay content-type', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  const digest = createHash('sha256').update(png).digest('hex');
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
  const calls: RequestInit[] = [];
  const serve =
    (body: Uint8Array<ArrayBuffer>, status = 200) =>
    async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(body, { status, headers: { 'content-type': 'text/html' } });
    };
  const base = { path: `/v2/attachments/${id}/content`, expectedSha256: digest, expectedBytes: png.length };
  const ok = await fetchVerifiedBytes({ ...base, fetch: serve(png), expectedMime: 'image/png' });
  assert.equal(ok.mime, 'image/png');
  assert.equal(calls[0]?.credentials, 'same-origin');
  const svg = new TextEncoder().encode('<svg/>');
  await assert.rejects(
    fetchVerifiedBytes({ ...base, fetch: serve(svg), expectedMime: 'image/png' }),
    /HASH_MISMATCH/,
  );
  await assert.rejects(
    fetchVerifiedBytes({ ...base, fetch: serve(png), expectedMime: 'image/jpeg' }),
    /MIME_MISMATCH/,
  );
  let expired = false;
  await assert.rejects(
    fetchVerifiedBytes({
      ...base,
      fetch: serve(png, 401),
      expectedMime: 'image/png',
      onUnauthorized: () => (expired = true),
    }),
    /UNAUTHENTICATED/,
  );
  assert.equal(expired, true);
  await assert.rejects(
    fetchVerifiedBytes({
      ...base,
      path: 'https://evil.example/x',
      fetch: serve(png),
      expectedMime: 'image/png',
    }),
    /PATH_NOT_ATTACHMENT/,
  );
});

test('trạng thái trích xuất nêu phần thiếu theo trang/sheet/ô và không nói “đã đọc”', () => {
  const ref = {
    attachmentId: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
    sha256: 'a'.repeat(64),
    ownerId: 'owner' as const,
  };
  const extraction: Extraction = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002',
    original: ref,
    status: 'partial',
    extractorVersion: '1',
    configSha256: 'b'.repeat(64),
    manifestSha256: 'c'.repeat(64),
    units: [
      {
        id: 'p1',
        locator: { kind: 'pdf', page: 1, box: [0, 0, 1, 1], rotation: 0 },
        needs: 'text',
        state: 'available',
        reason: null,
      },
      {
        id: 'p2',
        locator: { kind: 'pdf', page: 2, box: [0, 0, 1, 1], rotation: 0 },
        needs: 'vision',
        state: 'missing',
        reason: 'ảnh quét',
      },
      {
        id: 's1',
        locator: { kind: 'sheet', part: 'x', sheet: 'Q4', range: 'B2', hidden: true },
        needs: 'text',
        state: 'missing',
        reason: null,
      },
    ],
    derivatives: [],
    problems: [{ code: 'PARTIAL', message: '=SUM(A1)', unitIds: ['p2'] }],
    verification: 'verified',
  };
  const summary = summarizeExtraction(extraction);
  assert.equal(summary.label, 'Trích xuất một phần');
  assert.equal(summary.available, 1);
  assert.deepEqual(
    summary.missing.map((unit) => unit.where),
    ['Trang 2', 'Trang tính “Q4”, vùng B2 (ẩn)'],
  );
  assert.doesNotMatch(JSON.stringify(summary), /đã đọc/i);
  assert.equal(
    describeLocator({ kind: 'docx', paragraph: 3, table: 1, row: 2, cell: 4 }),
    'Bảng 1, hàng 2, ô 4',
  );
  assert.equal(describeLocator({ kind: 'unknown' }), 'Vị trí không xác định');
});

// ---- fix round 1 -----------------------------------------------------------------------------------------

test('I3: đổi project khi reserve chưa xác nhận: op cũ được giải quyết, file lên compose mới', async () => {
  const env = await setup(ticketSubmission());
  env.server.failBefore = (call) => call.method === 'POST' && call.url.endsWith('/uploads');
  await env.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(env.allSettled, 'unknown');
  assert.equal(env.files()[0]?.state, 'unknown');
  const oldSession = env.controller.view().draft.sessionId;
  assert.equal(env.controller.setSubmission(ticketSubmission(otherProject)), true);
  await settle(
    () => env.controller.view().draft.sessionId !== oldSession && env.files()[0]?.state === 'ready',
    'moved',
  );
  const next = env.controller.view().draft.sessionId ?? '';
  assert.equal(env.server.composes.get(next)?.projectId, otherProject);
  assert.equal([...env.server.uploads.values()].filter((upload) => upload.composeId === next).length, 1);
  assert.equal(
    env.pending.list().filter((operation) => operation.path.includes(oldSession ?? '-')).length,
    0,
    'không còn op reserve treo trên compose cũ',
  );
});

test('I4: PUT còn receiving sau vòng chờ, Thử lại tiếp tục chờ rồi gửi cùng bytes tới khi ready', async () => {
  const env = await setup(commentSubmission(''));
  env.server.busyPuts = 6;
  await env.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(env.allSettled, 'unknown');
  assert.equal(env.files()[0]?.state, 'unknown');
  await env.controller.retryFile(env.files()[0]?.localId ?? '');
  await settle(() => env.files()[0]?.state === 'ready', 'ready');
  const puts = env.server.calls.filter((call) => call.method === 'PUT');
  assert.equal(new Set(puts.map((call) => call.url)).size, 1);
});

test('I4: reload khi server receiving và không còn bytes: có Thử lại, không đứng ở Đang tải lên', async () => {
  const server = new FakeComposeServer();
  server.busyPuts = 50;
  const first = await setup(commentSubmission(''), server);
  await first.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(first.allSettled, 'unknown');
  first.controller.dispose();
  const env = await harness(server, first.storage);
  const controller = new ComposeController({
    draftKey: 'draft-files',
    submission: commentSubmission(''),
    client: env.client,
    pending: env.pending,
    storage: env.storage,
    hasher: inlineHasher().hasher,
    loadPolicy: (signal) => env.client.get('/v2/attachment-policy', { signal }),
    sleep: async () => undefined,
  });
  await controller.reconcile();
  const file = controller.view().draft.files[0];
  assert.ok(file);
  assert.equal(file.state, 'unknown');
  assert.equal(file.errorCode, 'UPLOAD_RECEIVING');
  assert.equal(fileActions(file, { hasBytes: false, active: false, locked: false }).retry, true);
  const upload = [...server.uploads.values()][0];
  if (upload) upload.state = 'ready';
  await controller.retryFile(file.localId);
  assert.equal(controller.view().draft.files[0]?.state, 'ready');
});

test('I5: PUT gặp 401 thì file unknown; đăng nhập lại rồi reconcile tải tiếp cùng upload', async () => {
  const env = await setup(commentSubmission(''));
  env.server.failBefore = null;
  const original = env.server.fetch;
  let unauthorizedPut = true;
  env.server.fetch = async (url, init) => {
    if (unauthorizedPut && init?.method === 'PUT') {
      unauthorizedPut = false;
      return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'x' } }), {
        status: 401,
      });
    }
    return original(url, init);
  };
  const wrapped = await harness(env.server, env.storage);
  const controller = new ComposeController({
    draftKey: 'draft-401',
    submission: commentSubmission(''),
    client: wrapped.client,
    pending: wrapped.pending,
    storage: wrapped.storage,
    hasher: inlineHasher().hasher,
    loadPolicy: (signal) => wrapped.client.get('/v2/attachment-policy', { signal }),
    sleep: async () => undefined,
  });
  await controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(() => controller.view().draft.files[0]?.state === 'unknown', 'unknown');
  assert.equal(controller.view().draft.files[0]?.errorCode, 'UNAUTHENTICATED');
  assert.equal(wrapped.session.snapshot().state, 'expired');
  assert.equal(await wrapped.session.login('mat-khau'), true);
  await controller.reconcile();
  await settle(() => controller.view().draft.files[0]?.state === 'ready', 'ready');
  assert.equal(env.server.uploads.size, 1);
});

test('I5: bỏ file khi DELETE chưa tới server: GET chứng minh chưa commit thì nhả key, DELETE lại theo revision mới', async () => {
  const env = await setup(commentSubmission(''));
  await env.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(() => env.files()[0]?.state === 'ready', 'ready');
  env.server.failBefore = (call) => call.method === 'DELETE';
  const localId = env.files()[0]?.localId ?? '';
  await env.controller.removeFile(localId);
  assert.equal(env.files()[0]?.state, 'removing');
  const compose = [...env.server.composes.values()][0];
  if (compose) compose.revision++;
  await env.controller.reconcile();
  assert.equal(env.pending.list().length, 0, 'op DELETE cũ được nhả nhờ GET compose');
  await env.controller.retryFile(localId);
  assert.equal(env.files().length, 0);
  const deletes = env.server.calls.filter((call) => call.method === 'DELETE');
  assert.notEqual(deletes[0]?.headers.get('idempotency-key'), deletes.at(-1)?.headers.get('idempotency-key'));
});

test('I5: abandon gặp ATTACHMENT_SELECTION_STALE thì đọc lại revision rồi bỏ lượt gửi', async () => {
  const env = await setup(commentSubmission(''));
  await env.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(() => env.files()[0]?.state === 'ready', 'ready');
  const sessionId = env.controller.view().draft.sessionId ?? '';
  const compose = env.server.composes.get(sessionId);
  if (compose) compose.revision++;
  await env.controller.abandon();
  assert.equal(env.server.composes.get(sessionId)?.state, 'abandoned');
  const deletes = env.server.calls.filter((call) => call.method === 'DELETE');
  assert.deepEqual(
    deletes.map((call) => JSON.parse(call.body ?? '{}').expectedRevision),
    [2, 3],
  );
  assert.equal(env.controller.view().draft.sessionId, null);
  assert.equal(env.files().length, 0);
});

test('I5 composer: paste chỉ chặn khi có file, chèn chữ tại con trỏ; paste thường giữ nguyên', () => {
  const image = pngFile('image.png', 1);
  assert.deepEqual(
    pasteDecision({ files: [], text: 'chữ', value: 'ab', start: 1, end: 1, filesLocked: false }),
    { prevent: false, nextValue: null, files: [] },
  );
  assert.deepEqual(
    pasteDecision({ files: [image], text: 'XY', value: 'abcd', start: 1, end: 3, filesLocked: false }),
    { prevent: true, nextValue: 'aXYd', files: [image] },
  );
  assert.deepEqual(
    pasteDecision({ files: [image], text: '', value: 'abcd', start: null, end: null, filesLocked: false }),
    { prevent: true, nextValue: null, files: [image] },
  );
  assert.deepEqual(
    pasteDecision({ files: [image], text: 'XY', value: 'abcd', start: 0, end: 0, filesLocked: true }),
    { prevent: false, nextValue: null, files: [] },
  );
});

test('I5 composer: nút Thử lại/Chọn lại/Bỏ theo trạng thái file', () => {
  const base = { localId: 'l', name: 'a.png', size: 1, sha256: null, uploadId: null, errorCode: null };
  const open = { hasBytes: true, active: false, locked: false };
  assert.equal(fileActions({ ...base, state: 'unknown' }, open).retry, true);
  assert.equal(fileActions({ ...base, state: 'uploading' }, { ...open, active: true }).retry, false);
  assert.equal(
    fileActions({ ...base, state: 'uploading' }, open).retry,
    true,
    'uploading không có tiến trình',
  );
  assert.equal(
    fileActions({ ...base, state: 'failed', errorCode: 'X' }, { ...open, hasBytes: false }).retry,
    false,
  );
  assert.equal(fileActions({ ...base, state: 'failed', errorCode: 'DUPLICATE_LOCAL' }, open).retry, false);
  assert.equal(fileActions({ ...base, state: 'failed', errorCode: 'NEEDS_RESELECT' }, open).reselect, true);
  assert.equal(fileActions({ ...base, state: 'ready' }, open).remove, true);
  assert.equal(fileActions({ ...base, state: 'removing' }, open).remove, false);
  assert.deepEqual(fileActions({ ...base, state: 'unknown' }, { ...open, locked: true }), {
    retry: false,
    reselect: false,
    remove: false,
  });
});

test('I5 composer: khóa form, consent đóng băng và state báo cho form', () => {
  const view = {
    state: 'editing' as const,
    needsPayload: false,
    assistantRead: null,
    discardable: false,
    hasDraft: true,
  };
  const ctx = { ready: true, authenticated: true, localConsent: true };
  const editing = composeLocks(view, ctx);
  assert.equal(editing.textLocked, false);
  assert.equal(editing.consent, true);
  assert.equal(editing.consentLocked, false);
  assert.equal(editing.showAbandon, true);
  const sending = composeLocks({ ...view, state: 'sending', assistantRead: 'none' }, ctx);
  assert.equal(sending.textLocked, true);
  assert.equal(sending.filesLocked, true);
  assert.equal(sending.consent, false, 'consent hiển thị đúng giá trị đã đóng băng');
  assert.equal(sending.consentLocked, true);
  assert.equal(sending.reportedState, 'sending');
  const reentry = composeLocks(
    { ...view, state: 'suspended', needsPayload: true, assistantRead: 'selected-inputs', discardable: true },
    { ...ctx, localConsent: false },
  );
  assert.equal(reentry.textLocked, false, 'nhập lại nội dung');
  assert.equal(reentry.filesLocked, true);
  assert.equal(reentry.consent, true);
  assert.equal(reentry.consentLocked, true);
  assert.equal(reentry.reportedState, 'editing');
  assert.equal(reentry.showDiscard, true);
  assert.equal(reentry.showAbandon, false);
  const guest = composeLocks(view, { ...ctx, authenticated: false });
  assert.equal(guest.textLocked, true);
  assert.equal(guest.filesLocked, true);
});
