import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ComposeController } from '../src/compose/controller.ts';
import {
  type ComposeSubmission,
  ComposeValidationError,
  canSubmit,
  freezeSubmission,
  receiptSummary,
  submissionRequest,
} from '../src/compose/state.ts';
import type { CreateTicket } from '../src/contracts/tickets.ts';
import { PendingStore } from '../src/lib/pending-operation.ts';
import {
  conversationId,
  FakeComposeServer,
  harness,
  inlineHasher,
  pngFile,
  projectId,
  settle,
  ticketId,
} from './support/compose-server.ts';

const sessionId = '44444444-4444-4444-8444-444444444444';
const fileA = '55555555-5555-4555-8555-555555555555';
const clientMessageId = '66666666-6666-4666-8666-666666666666';

function ticket(overrides: Partial<CreateTicket> = {}): CreateTicket {
  return {
    projectId,
    parentId: null,
    level: 'request',
    kind: 'code',
    title: 'Sửa lỗi đăng nhập',
    description: 'Mô tả',
    mandatory: true,
    criteria: { workflowChoice: 'superpowers' },
    inputs: {},
    outputs: {},
    skill: null,
    workflowPin: null,
    ...overrides,
  };
}

const ticketSubmission = (overrides: Partial<CreateTicket> = {}): ComposeSubmission => ({
  kind: 'ticket',
  target: { purpose: 'ticket', projectId, ticketId: null },
  ticket: ticket(overrides),
});
const commentSubmission = (text: string): ComposeSubmission => ({
  kind: 'comment',
  target: { purpose: 'comment', projectId, ticketId },
  text,
});
const messageSubmission = (text: string): Extract<ComposeSubmission, { kind: 'assistant_message' }> => ({
  kind: 'assistant_message',
  target: { purpose: 'assistant_message', projectId: null, ticketId: null, conversationId },
  conversationId,
  clientMessageId,
  text,
});

const selection = (attachmentIds: string[] = []) => ({
  composeSessionId: sessionId,
  selectionRevision: 3,
  attachmentIds,
});

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ComposeValidationError) return error.code;
    throw error;
  }
  return 'OK';
}

test('freezeSubmission ticket: đúng path/body, không gửi kind/target/draftKey, selection rỗng hợp lệ', () => {
  const operation = freezeSubmission({
    submission: Object.assign(ticketSubmission(), { draftKey: 'x' }),
    selection: selection(),
    assistantRead: 'none',
    operationId: 'op-1',
    intentId: 'intent-1',
  });
  assert.equal(operation.path, '/v2/attachment-submissions/tickets');
  assert.equal(operation.method, 'POST');
  assert.equal(operation.storage, 'tab');
  assert.equal(operation.id, 'op-1');
  assert.equal(operation.intentId, 'intent-1');
  assert.ok(Object.isFrozen(operation));
  const body = JSON.parse(operation.bodyJson);
  assert.deepEqual(Object.keys(body), ['ticket', 'selection', 'assistantRead']);
  assert.deepEqual(body.ticket, ticket());
  assert.deepEqual(body.selection, selection());
  assert.equal(body.assistantRead, 'none');
  assert.doesNotMatch(operation.bodyJson, /"kind":"ticket"|"target"|draftKey|"purpose"/);
});

test('freezeSubmission comment và assistant_message: đúng route/body, giữ clientMessageId', () => {
  const comment = freezeSubmission({
    submission: commentSubmission(''),
    selection: selection([fileA]),
    assistantRead: 'selected-inputs',
    operationId: 'op-2',
    intentId: 'intent-2',
  });
  assert.equal(comment.path, `/v2/tickets/${ticketId}/attachment-comments`);
  assert.deepEqual(JSON.parse(comment.bodyJson), {
    text: '',
    selection: selection([fileA]),
    assistantRead: 'selected-inputs',
  });
  const message = freezeSubmission({
    submission: messageSubmission('xin chào'),
    selection: selection(),
    assistantRead: 'none',
    operationId: 'op-3',
    intentId: 'intent-3',
  });
  assert.equal(message.path, '/v2/attachment-submissions/messages');
  const body = JSON.parse(message.bodyJson);
  assert.deepEqual(Object.keys(body), [
    'conversationId',
    'clientMessageId',
    'text',
    'selection',
    'assistantRead',
  ]);
  assert.equal(body.clientMessageId, clientMessageId);
});

test('freezeSubmission chặn target sai, field sai giới hạn và text/file cùng rỗng', () => {
  const freeze = (submission: ComposeSubmission, ids: string[] = []) =>
    code(() =>
      freezeSubmission({
        submission,
        selection: selection(ids),
        assistantRead: 'none',
        operationId: 'o',
        intentId: 'i',
      }),
    );
  assert.equal(
    freeze(ticketSubmission({ projectId: '77777777-7777-4777-8777-777777777777' })),
    'TARGET_MISMATCH',
  );
  assert.equal(
    freeze({ ...commentSubmission('a'), target: { purpose: 'comment', projectId, ticketId: null } } as never),
    'TARGET_INVALID',
  );
  assert.equal(
    freeze({
      ...messageSubmission('a'),
      target: { purpose: 'assistant_message', projectId, ticketId: null, conversationId },
    } as never),
    'TARGET_INVALID',
  );
  assert.equal(freeze({ ...messageSubmission('a'), conversationId: fileA }), 'TARGET_MISMATCH');
  assert.equal(freeze({ ...messageSubmission('a'), clientMessageId: 'x' }), 'CLIENT_MESSAGE_ID_INVALID');
  assert.equal(freeze({ ...ticketSubmission(), kind: 'comment' } as never), 'TARGET_MISMATCH');
  assert.equal(freeze(ticketSubmission({ title: '   ' })), 'TITLE_REQUIRED');
  assert.equal(freeze(ticketSubmission({ title: '😀'.repeat(200) })), 'OK', '200 code point vẫn hợp lệ');
  assert.equal(freeze(ticketSubmission({ title: '😀'.repeat(201) })), 'TITLE_TOO_LONG');
  assert.equal(freeze(ticketSubmission({ description: 'a'.repeat(65537) })), 'DESCRIPTION_TOO_LONG');
  assert.equal(freeze(ticketSubmission({ kind: 'ops' as never })), 'TICKET_KIND_INVALID');
  assert.equal(
    freeze(
      ticketSubmission({
        workflowPin: { workflow: 'other', version: '1', revision: '1', checksum: 'a'.repeat(64) } as never,
      }),
    ),
    'WORKFLOW_INVALID',
  );
  assert.equal(freeze(commentSubmission('a'.repeat(32769))), 'TEXT_TOO_LONG');
  assert.equal(freeze(commentSubmission('  ')), 'TEXT_OR_FILES_REQUIRED');
  assert.equal(freeze(commentSubmission(''), [fileA]), 'OK', 'chỉ ảnh, text rỗng được phép');
  assert.equal(freeze(ticketSubmission({ description: '' })), 'OK', 'ticket không file, mô tả rỗng hợp lệ');
  assert.equal(
    code(() => submissionRequest(commentSubmission('a'), { ...selection(), selectionRevision: 0 }, 'none')),
    'SELECTION_INVALID',
  );
  assert.equal(
    code(() => submissionRequest(commentSubmission('a'), selection([fileA, fileA]), 'none')),
    'SELECTION_INVALID',
  );
});

test('PendingStore.begin cho cùng intent/path/body ra đúng bytes của freezeSubmission', () => {
  const store = new PendingStore(null, () => 'store-key');
  const request = submissionRequest(ticketSubmission(), selection(), 'none');
  const operation = store.begin({ intentId: 'intent', method: 'POST', ...request, storage: 'tab' });
  const frozen = freezeSubmission({
    submission: ticketSubmission(),
    selection: selection(),
    assistantRead: 'none',
    operationId: operation.id,
    intentId: 'intent',
  });
  assert.deepEqual({ ...frozen }, { ...operation });
});

test('canSubmit: file lỗi chặn gửi dù có text; sending/accepted không gửi; ambiguous chỉ retry op cũ', () => {
  const base = {
    submission: commentSubmission('có nội dung'),
    sessionId,
    selectionRevision: 2,
    submitOperation: null,
    state: 'editing' as const,
  };
  const ready = {
    localId: 'l1',
    name: 'a.png',
    size: 10,
    sha256: 'a'.repeat(64),
    uploadId: fileA,
    errorCode: null,
  };
  assert.equal(canSubmit({ ...base, files: [{ ...ready, state: 'ready' }] }), true);
  assert.equal(canSubmit({ ...base, files: [{ ...ready, state: 'failed', errorCode: 'X' }] }), false);
  assert.equal(canSubmit({ ...base, files: [{ ...ready, state: 'uploading' }] }), false);
  assert.equal(canSubmit({ ...base, files: [], submission: commentSubmission('') }), false);
  assert.equal(canSubmit({ ...base, files: [], sessionId: null, selectionRevision: null }), true);
  assert.equal(canSubmit({ ...base, files: [], state: 'sending' }), false);
  assert.equal(canSubmit({ ...base, files: [], state: 'ambiguous' }), false);
  const frozenOp = freezeSubmission({
    submission: commentSubmission('có nội dung'),
    selection: selection(),
    assistantRead: 'none',
    operationId: 'op',
    intentId: 'intent',
  });
  assert.equal(canSubmit({ ...base, files: [], state: 'ambiguous', submitOperation: frozenOp }), true);
  assert.equal(canSubmit({ ...base, files: [], state: 'suspended', submitOperation: frozenOp }), true);
});

async function controllerFor(
  server: FakeComposeServer,
  submission: ComposeSubmission,
  env?: Awaited<ReturnType<typeof harness>>,
) {
  const h = env ?? (await harness(server));
  const controller = new ComposeController({
    draftKey: 'draft-1',
    submission,
    client: h.client,
    pending: h.pending,
    storage: h.storage,
    hasher: inlineHasher().hasher,
    loadPolicy: (signal) => h.client.get('/v2/attachment-policy', { signal }),
    sleep: async () => undefined,
  });
  return { ...h, controller };
}

test('mất phản hồi sau commit: khóa form, retry cùng key/body, một ticket; frozen body không đổi khi form đổi', async () => {
  const server = new FakeComposeServer();
  const { controller } = await controllerFor(server, ticketSubmission());
  server.dropAfterCommit = (call) => call.url === '/v2/attachment-submissions/tickets';
  assert.equal(await controller.submit('none'), null);
  assert.equal(controller.view().draft.state, 'ambiguous');
  assert.equal(server.tickets.length, 1, 'server đã commit');
  assert.equal(controller.setSubmission(ticketSubmission({ title: 'Đổi trong lúc chờ' })), false);
  const receipt = await controller.submit('selected-inputs');
  assert.equal(receipt?.kind, 'ticket');
  assert.equal(controller.view().draft.state, 'accepted');
  const posts = server.calls.filter((call) => call.url === '/v2/attachment-submissions/tickets');
  assert.equal(posts.length, 2);
  assert.equal(posts[0]?.headers.get('idempotency-key'), posts[1]?.headers.get('idempotency-key'));
  assert.equal(posts[0]?.body, posts[1]?.body);
  assert.equal(JSON.parse(posts[1]?.body ?? '{}').ticket.title, 'Sửa lỗi đăng nhập');
  assert.equal(JSON.parse(posts[1]?.body ?? '{}').assistantRead, 'none');
  assert.equal(server.tickets.length, 1);
  assert.equal(receipt?.kind === 'ticket' && receipt.attachmentIds.length, 0);
});

test('hết phiên rồi đăng nhập lại cùng owner: retry giữ key gốc và clientMessageId, một message', async () => {
  const server = new FakeComposeServer();
  const env = await controllerFor(server, messageSubmission('hỏi trợ lý'));
  server.dropAfterCommit = (call) => call.url === '/v2/attachment-submissions/messages';
  await env.controller.submit('none');
  assert.equal(env.controller.view().draft.state, 'ambiguous');
  server.authenticated = false;
  await env.controller.submit('none');
  assert.equal(env.session.snapshot().state, 'expired');
  assert.equal(env.controller.view().draft.state, 'suspended');
  assert.equal(env.controller.view().submittable, true);
  assert.equal(await env.session.login('mat-khau-dung'), true);
  const receipt = await env.controller.submit('none');
  assert.equal(receipt?.kind, 'assistant_message');
  const posts = server.calls.filter((call) => call.url === '/v2/attachment-submissions/messages');
  assert.equal(new Set(posts.map((call) => call.headers.get('idempotency-key'))).size, 1);
  assert.equal(new Set(posts.map((call) => call.body)).size, 1);
  assert.ok(posts.every((call) => JSON.parse(call.body ?? '{}').clientMessageId === clientMessageId));
  assert.equal(server.messages.length, 1);
  assert.equal(receipt?.kind === 'assistant_message' && receipt.message.inputRevision, '1');
});

test('reload tab: compose ID/revision và key gốc được giữ, không lưu text/File; gửi lại ra một comment', async () => {
  const server = new FakeComposeServer();
  const first = await controllerFor(server, commentSubmission('bình luận bí mật?'));
  server.dropAfterCommit = (call) => call.url.endsWith('/attachment-comments');
  await first.controller.submit('none');
  const operationId = first.controller.view().draft.submitOperation?.id;
  assert.ok(operationId);
  const record = first.storage.getItem('crew-v2:compose:draft-1') ?? '';
  assert.match(record, new RegExp(operationId));
  assert.doesNotMatch(record, /bình luận/, 'metadata draft không chứa text');
  first.controller.dispose();
  // Reload: new PendingStore/controller on the same sessionStorage; the parent lost its form content.
  const reloaded = await controllerFor(server, commentSubmission(''), await harness(server, first.storage));
  assert.equal(reloaded.controller.view().draft.state, 'ambiguous');
  assert.equal(reloaded.controller.view().draft.submitOperation?.id, operationId);
  const receipt = await reloaded.controller.submit('none');
  assert.equal(receipt?.kind, 'comment');
  assert.equal(receipt?.kind === 'comment' && receipt.comment.text, 'bình luận bí mật?');
  assert.equal(server.comments.length, 1);
  assert.equal(reloaded.storage.getItem('crew-v2:compose:draft-1'), null, 'accepted xóa draft đúng một lần');
});

test('logout: chỉ còn tombstone; không cấp key mới, nhập lại đúng nội dung gửi bằng key cũ', async () => {
  const server = new FakeComposeServer();
  const env = await controllerFor(server, commentSubmission('cần nhập lại'));
  server.dropAfterCommit = (call) => call.url.endsWith('/attachment-comments');
  await env.controller.submit('none');
  const key = env.controller.view().draft.submitOperation?.id;
  env.pending.tombstoneAll();
  env.controller.dispose();
  const after = await controllerFor(server, commentSubmission(''), await harness(server, env.storage));
  assert.equal(after.controller.view().needsPayload, true);
  assert.equal(after.controller.view().draft.state, 'suspended');
  assert.equal(after.controller.view().submittable, false, 'thiếu nội dung thì chưa gửi');
  assert.equal(after.controller.setSubmission(commentSubmission('cần nhập lại')), true);
  await after.controller.reconcile();
  const receipt = await after.controller.submit('none');
  assert.equal(receipt?.kind, 'comment');
  const posts = server.calls.filter((call) => call.url.endsWith('/attachment-comments'));
  assert.equal(posts.at(-1)?.headers.get('idempotency-key'), key);
  assert.equal(server.comments.length, 1);
});

test('comment chỉ có ảnh ready: selection đúng mọi upload active, receipt không nói “đã đọc”', async () => {
  const server = new FakeComposeServer();
  const env = await controllerFor(server, commentSubmission(''));
  await env.controller.addFiles([pngFile('image.png', 1)], 'clipboard');
  await settle(() => env.controller.view().draft.files[0]?.state === 'ready', 'ready');
  assert.equal(env.controller.view().submittable, true);
  const receipt = await env.controller.submit('selected-inputs');
  assert.equal(receipt?.kind, 'comment');
  const body = JSON.parse(
    server.calls.find((call) => call.url.endsWith('/attachment-comments'))?.body ?? '{}',
  );
  assert.deepEqual(body.selection.attachmentIds, [env.controller.view().draft.files[0]?.uploadId]);
  assert.equal(body.assistantRead, 'selected-inputs');
  assert.ok(receipt);
  assert.doesNotMatch(receiptSummary(receipt), /đã đọc|đã hiểu/i);
});

// ---- fix round 1 -----------------------------------------------------------------------------------------

test('I1: 201 không giải mã được thì draft vẫn khóa; gửi lại đúng body cũ, không có entity thứ hai', async () => {
  const server = new FakeComposeServer();
  const { controller } = await controllerFor(server, commentSubmission('nội dung gốc'));
  server.corruptNext = (call) => call.url.endsWith('/attachment-comments');
  assert.equal(await controller.submit('none'), null);
  assert.equal(server.comments.length, 1, 'server đã commit');
  assert.notEqual(controller.view().draft.state, 'editing', 'không mở khóa form khi server có thể đã commit');
  assert.equal(controller.setSubmission(commentSubmission('owner sửa sau đó')), false);
  assert.equal(controller.view().submittable, true);
  const receipt = await controller.submit('selected-inputs');
  assert.equal(receipt?.kind, 'comment');
  const posts = server.calls.filter((call) => call.url.endsWith('/attachment-comments'));
  assert.equal(posts.length, 2);
  assert.equal(posts[1]?.body, posts[0]?.body, 'đúng body đã đóng băng, kể cả assistantRead');
  assert.equal(server.comments.length, 1);
  assert.equal(server.composes.size, 1);
});

test('I1: lượt gửi đã submitted mà op cục bộ đã mất thì khóa, không mở lượt mới, không tạo bản trùng', async () => {
  const server = new FakeComposeServer();
  const first = await controllerFor(server, commentSubmission('đã gửi ở panel'));
  server.dropAfterCommit = (call) => call.url.endsWith('/attachment-comments');
  await first.controller.submit('none');
  const operation = first.controller.view().draft.submitOperation;
  assert.ok(operation);
  // The recovery panel replays and accepts the operation; the key is released.
  await first.client.mutate(operation);
  assert.equal(first.pending.get(operation.id), undefined);
  first.controller.dispose();
  const reloaded = await controllerFor(server, commentSubmission(''), await harness(server, first.storage));
  await reloaded.controller.reconcile();
  assert.notEqual(reloaded.controller.view().draft.state, 'editing');
  assert.equal(reloaded.controller.setSubmission(commentSubmission('nội dung khác')), false);
  await reloaded.controller.submit('none');
  await reloaded.controller.submit('none');
  assert.equal(server.comments.length, 1);
  assert.equal(server.composes.size, 1, 'không mở compose mới');
  assert.equal(reloaded.controller.view().discardable, true, 'owner có lối thoát rõ ràng');
  reloaded.controller.discard();
  assert.equal(reloaded.controller.view().draft.state, 'editing');
  assert.equal(reloaded.controller.view().draft.sessionId, null);
});

test('I2: nhập lại sau logout với file và consent selected-inputs gửi được bằng key cũ', async () => {
  const server = new FakeComposeServer();
  const env = await controllerFor(server, commentSubmission('kèm ảnh'));
  await env.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(() => env.controller.view().draft.files[0]?.state === 'ready', 'ready');
  server.dropAfterCommit = (call) => call.url.endsWith('/attachment-comments');
  await env.controller.submit('selected-inputs');
  const key = env.controller.view().draft.submitOperation?.id;
  assert.ok(key);
  env.pending.tombstoneAll();
  env.controller.dispose();
  const after = await controllerFor(server, commentSubmission(''), await harness(server, env.storage));
  await after.controller.reconcile();
  const view = after.controller.view();
  assert.equal(view.needsPayload, true);
  assert.equal(view.draft.files[0]?.state, 'ready', 'file lấy trạng thái từ GET compose');
  assert.equal(view.assistantRead, 'selected-inputs', 'consent gốc được giữ để nhập lại đúng body');
  assert.equal(view.discardable, true);
  // Wrong content first: conflict keeps the tombstone and the old key.
  assert.equal(after.controller.setSubmission(commentSubmission('sai nội dung')), true);
  await after.controller.submit('none');
  assert.equal(after.controller.view().errorCode, 'IDEMPOTENCY_CONFLICT');
  assert.equal(after.controller.view().needsPayload, true);
  assert.equal(after.controller.setSubmission(commentSubmission('kèm ảnh')), true);
  const receipt = await after.controller.submit('none');
  assert.equal(receipt?.kind, 'comment');
  const posts = server.calls.filter((call) => call.url.endsWith('/attachment-comments'));
  assert.ok(posts.every((call) => call.headers.get('idempotency-key') === key));
  assert.equal(JSON.parse(posts.at(-1)?.body ?? '{}').assistantRead, 'selected-inputs');
  assert.equal(server.comments.length, 1);
});

test('I5: op được panel khôi phục replay thì composer gửi lại đúng body, nhận lại receipt cũ', async () => {
  const server = new FakeComposeServer();
  const env = await controllerFor(server, commentSubmission('panel'));
  server.dropAfterCommit = (call) => call.url.endsWith('/attachment-comments');
  await env.controller.submit('selected-inputs');
  const operation = env.controller.view().draft.submitOperation;
  assert.ok(operation);
  await env.client.mutate(operation);
  const receipt = await env.controller.submit('none');
  assert.equal(receipt?.kind, 'comment');
  const posts = server.calls.filter((call) => call.url.endsWith('/attachment-comments'));
  assert.equal(new Set(posts.map((call) => call.body)).size, 1);
  assert.equal(server.comments.length, 1);
});

test('I5: SELECTION_CHANGED khi gửi thì đọc lại compose, upload lạ trở thành file chặn/đúng selection', async () => {
  const server = new FakeComposeServer();
  const env = await controllerFor(server, commentSubmission('có chữ'));
  await env.controller.addFiles([pngFile('a.png', 1)], 'input');
  await settle(() => env.controller.view().draft.files[0]?.state === 'ready', 'ready');
  // Another tab reserved a second file on the same compose.
  const compose = [...server.composes.values()][0];
  assert.ok(compose);
  server.uploads.set('aaaaaaaa-bbbb-4ccc-8ddd-999999999999', {
    attachmentId: 'aaaaaaaa-bbbb-4ccc-8ddd-999999999999',
    composeId: compose.id,
    fileName: 'khac.png',
    mime: 'image/png',
    byteLength: 10,
    sha256: 'e'.repeat(64),
    state: 'ready',
  });
  compose.revision++;
  assert.equal(await env.controller.submit('none'), null);
  assert.equal(env.controller.view().errorCode, 'SELECTION_CHANGED');
  await settle(() => env.controller.view().draft.files.length === 2, 'refetched');
  assert.equal(env.controller.view().draft.state, 'editing');
  const receipt = await env.controller.submit('none');
  assert.equal(receipt?.kind === 'comment' && receipt.attachmentIds.length, 2);
});

test('I5: takeReceipt trả receipt đúng một lần', async () => {
  const server = new FakeComposeServer();
  const env = await controllerFor(server, commentSubmission('một lần'));
  await env.controller.submit('none');
  assert.equal(env.controller.takeReceipt()?.kind, 'comment');
  assert.equal(env.controller.takeReceipt(), null);
});
