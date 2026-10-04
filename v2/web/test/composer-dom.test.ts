import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import type { ComposeReceipt, ComposeSubmission } from '../src/compose/state.ts';
import {
  FakeComposeServer,
  harness,
  inlineHasher,
  pngFile,
  projectId,
  settle,
  ticketId,
} from './support/compose-server.ts';
import { installDom } from './support/dom.ts';

const closeDom = installDom();
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createElement, useState } = await import('react');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { AttachmentComposer, ComposeServicesProvider } = await import('../src/compose/composer.tsx');
type ComposerHandle = import('../src/compose/composer.tsx').ComposerHandle;

afterEach(() => cleanup());
after(() => closeDom());

const comment = (text: string): ComposeSubmission => ({
  kind: 'comment',
  target: { purpose: 'comment', projectId, ticketId },
  text,
});

type Env = Awaited<ReturnType<typeof harness>>;

function mount(env: Env, initial: ComposeSubmission, draftKey = 'dom') {
  const handles: ComposerHandle[] = [];
  const events = {
    handles,
    states: [] as string[],
    accepted: [] as ComposeReceipt[],
    changes: [] as ComposeSubmission[],
  };
  function Host() {
    const [submission, setSubmission] = useState(initial);
    return createElement(AttachmentComposer, {
      draftKey,
      submission,
      onSubmissionChange: (next: ComposeSubmission) => {
        events.changes.push(next);
        setSubmission(next);
      },
      onStateChange: (state: string) => events.states.push(state),
      onAccepted: (receipt: ComposeReceipt) => events.accepted.push(receipt),
      onHandle: (handle: ComposerHandle) => handles.push(handle),
    });
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  });
  const services = {
    client: env.client,
    pending: env.pending,
    session: env.session,
    storage: env.storage,
    createHasher: () => inlineHasher().hasher,
  };
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ComposeServicesProvider, { services, children: createElement(Host) }),
    ),
  );
  return events;
}

const textarea = () => screen.getByLabelText('Nội dung') as HTMLTextAreaElement;
const submitButton = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const consent = () =>
  screen.getByLabelText('Cho phép Trợ lý đọc các tệp đã chọn trong lượt gửi này') as HTMLInputElement;

async function until(predicate: () => boolean, label: string) {
  await act(async () => {
    await settle(predicate, label);
  });
}

async function ready(env: Env) {
  await until(
    () => document.querySelector('[data-compose-state]') !== null && env.session.isAuthenticated(),
    'mount',
  );
  await act(async () => undefined);
}

function clipboard(files: File[], text: string) {
  return {
    items: [
      ...(text ? [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] : []),
      ...files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    ],
    files,
    types: [...(text ? ['text/plain'] : []), ...(files.length ? ['Files'] : [])],
    getData: (format: string) => (format === 'text/plain' ? text : ''),
  };
}

test('dán ảnh kèm chữ: chặn mặc định, chèn chữ tại con trỏ và thêm tệp; dán chữ thường không bị chặn', async () => {
  const env = await harness(new FakeComposeServer());
  const events = mount(env, comment('abcd'));
  await ready(env);
  const area = textarea();
  area.setSelectionRange(1, 3);
  let notPrevented = true;
  await act(async () => {
    notPrevented = fireEvent.paste(area, { clipboardData: clipboard([pngFile('image.png', 1)], 'XY') });
  });
  assert.equal(notPrevented, false, 'paste có tệp gọi preventDefault');
  const last = events.changes.at(-1);
  assert.equal(last?.kind === 'comment' ? last.text : null, 'aXYd');
  await until(() => document.querySelector('[data-state="ready"]') !== null, 'file ready');
  assert.match(document.body.textContent ?? '', /anh-dan-/);
  const changes = events.changes.length;
  await act(async () => {
    notPrevented = fireEvent.paste(textarea(), { clipboardData: clipboard([], 'chữ thường') });
  });
  assert.equal(notPrevented, true, 'paste chỉ có chữ để trình duyệt xử lý');
  assert.equal(events.changes.length, changes);
});

test('kéo thả khi phiên hết hạn: không nhận tệp, ô nội dung chỉ đọc', async () => {
  const env = await harness(new FakeComposeServer());
  mount(env, comment('x'));
  await ready(env);
  const zone = screen.getByRole('region', { name: 'Soạn nội dung' });
  const transfer = clipboard([pngFile('a.png', 2)], '');
  assert.equal(fireEvent.dragOver(zone, { dataTransfer: transfer }), false, 'mở khóa thì nhận kéo thả');
  await act(async () => env.session.expire());
  assert.equal(fireEvent.dragOver(zone, { dataTransfer: transfer }), true, 'khóa thì không nhận kéo thả');
  await act(async () => {
    fireEvent.drop(zone, { dataTransfer: transfer });
  });
  assert.equal(document.querySelectorAll('[data-local-id]').length, 0);
  assert.equal(textarea().readOnly, true);
  assert.match(document.body.textContent ?? '', /Cần đăng nhập/);
});

test('consent và khóa form: chưa xác nhận thì nội dung chỉ đọc, consent đã đóng băng, nút gửi lại đúng yêu cầu cũ', async () => {
  const server = new FakeComposeServer();
  const env = await harness(server);
  const events = mount(env, comment('kèm ảnh'));
  await ready(env);
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Đính kèm tệp'), { target: { files: [pngFile('a.png', 4)] } });
  });
  await until(() => document.querySelector('[data-state="ready"]') !== null, 'ready');
  assert.equal(consent().checked, false, 'consent mặc định tắt');
  assert.equal(consent().disabled, false);
  await act(async () => {
    fireEvent.click(consent());
  });
  assert.equal(consent().checked, true);
  server.dropAfterCommit = (call) => call.url.endsWith('/attachment-comments');
  await act(async () => {
    fireEvent.click(submitButton(/Gửi bình luận/));
  });
  await until(() => events.states.at(-1) === 'ambiguous', 'ambiguous');
  assert.equal(textarea().readOnly, true);
  assert.equal(consent().checked, true);
  assert.equal(consent().disabled, true);
  const retry = submitButton(/Gửi lại đúng yêu cầu cũ/);
  assert.equal(retry.disabled, false);
  assert.equal(JSON.parse(server.calls.at(-1)?.body ?? '{}').assistantRead, 'selected-inputs');
});

test('receipt được giao một lần rồi bắt đầu bản nháp mới với consent tắt', async () => {
  const server = new FakeComposeServer();
  const env = await harness(server);
  const events = mount(env, comment('gửi một lần'));
  await ready(env);
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Đính kèm tệp'), { target: { files: [pngFile('a.png', 5)] } });
  });
  await until(() => document.querySelector('[data-state="ready"]') !== null, 'ready');
  await act(async () => {
    fireEvent.click(consent());
  });
  await act(async () => {
    fireEvent.click(submitButton(/Gửi bình luận/));
  });
  await until(() => events.accepted.length === 1, 'accepted');
  await act(async () => undefined);
  assert.equal(events.accepted.length, 1);
  assert.equal(events.accepted[0]?.kind, 'comment');
  assert.ok(events.states.includes('accepted'));
  assert.equal(events.states.at(-1), 'editing');
  assert.equal(document.querySelectorAll('[data-local-id]').length, 0, 'draft mới không còn tệp');
  assert.match(document.body.textContent ?? '', /Đã gửi bình luận kèm 1 tệp/);
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Đính kèm tệp'), { target: { files: [pngFile('b.png', 6)] } });
  });
  await until(() => document.querySelector('[data-state="ready"]') !== null, 'ready2');
  assert.equal(consent().checked, false, 'consent của ý định cũ không mang sang ý định mới');
  assert.equal(server.comments.length, 1);
});

test('nút gửi theo nội dung; nhập lại sau logout có nút bỏ bản nháp kèm cảnh báo', async () => {
  const server = new FakeComposeServer();
  const env = await harness(server);
  const events = mount(env, comment(''), 'dom-reentry');
  await ready(env);
  assert.equal(submitButton(/Gửi bình luận/).disabled, true, 'text và tệp cùng rỗng');
  await act(async () => {
    fireEvent.change(textarea(), { target: { value: 'có chữ' } });
  });
  assert.equal(submitButton(/Gửi bình luận/).disabled, false);
  assert.equal(screen.queryByRole('button', { name: /Bỏ bản nháp này/ }), null);
  server.dropAfterCommit = (call) => call.url.endsWith('/attachment-comments');
  await act(async () => {
    fireEvent.click(submitButton(/Gửi bình luận/));
  });
  await until(() => events.states.at(-1) === 'ambiguous', 'ambiguous');
  cleanup();
  env.pending.tombstoneAll();
  const after = await harness(server, env.storage);
  const reentry = mount(after, comment(''), 'dom-reentry');
  await ready(after);
  await until(() => document.body.textContent?.includes('Nhập lại đúng nội dung') ?? false, 'reentry');
  assert.equal(reentry.states.at(-1), 'editing', 'form được mở để nhập lại');
  assert.equal(textarea().readOnly, false);
  const discard = submitButton(/Bỏ bản nháp này/);
  assert.equal(discard.disabled, false);
  assert.match(document.body.textContent ?? '', /có thể tạo thêm|sẽ tạo thêm một mục khác/);
  await act(async () => {
    fireEvent.click(discard);
  });
  await until(() => screen.queryByRole('button', { name: /Bỏ bản nháp này/ }) === null, 'discarded');
  assert.equal(document.body.textContent?.includes('Nhập lại đúng nội dung'), false);
});

test('máy chủ chưa sẵn sàng xử lý tệp: hiện lý do và nút gửi lại đúng yêu cầu cũ', async () => {
  const server = new FakeComposeServer();
  server.extractionConfigured = false;
  const env = await harness(server);
  const events = mount(env, comment('kèm tệp'), 'dom-503');
  await ready(env);
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Đính kèm tệp'), { target: { files: [pngFile('a.png', 7)] } });
  });
  await until(() => document.querySelector('[data-state="ready"]') !== null, 'ready');
  await act(async () => {
    fireEvent.click(submitButton(/Gửi bình luận/));
  });
  await until(() => events.states.at(-1) === 'ambiguous', 'ambiguous');
  assert.match(screen.getByRole('alert').textContent ?? '', /Chưa cấu hình xử lý tệp/);
  assert.equal(submitButton(/Gửi lại đúng yêu cầu cũ/).disabled, false);
});

test('handle bỏ bản nháp cho form: soạn dở thì discarded, tệp và consent được xóa; đang gửi thì blocked', async () => {
  const server = new FakeComposeServer();
  const env = await harness(server);
  const events = mount(env, comment('soạn dở'), 'dom-handle');
  await ready(env);
  await until(() => events.handles.length > 0, 'handle');
  const handle = events.handles.at(-1);
  assert.ok(handle);
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Đính kèm tệp'), { target: { files: [pngFile('a.png', 31)] } });
  });
  await until(() => document.querySelector('[data-state="ready"]') !== null, 'ready');
  await act(async () => {
    fireEvent.click(consent());
  });
  const sessionId = [...server.composes.keys()][0] ?? '';
  let result = '';
  await act(async () => {
    result = await handle.discardDraft();
  });
  assert.equal(result, 'discarded');
  assert.equal(server.composes.get(sessionId)?.state, 'abandoned');
  assert.equal(document.querySelectorAll('[data-local-id]').length, 0);
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Đính kèm tệp'), { target: { files: [pngFile('b.png', 32)] } });
  });
  await until(() => document.querySelector('[data-state="ready"]') !== null, 'ready2');
  assert.equal(consent().checked, false, 'consent không mang sang bản nháp mới');
  server.hold = (call) => call.url.endsWith('/attachment-comments');
  await act(async () => {
    fireEvent.click(submitButton(/Gửi bình luận/));
  });
  await until(() => events.states.at(-1) === 'sending', 'sending');
  await act(async () => {
    result = await (events.handles.at(-1) as ComposerHandle).discardDraft();
  });
  assert.equal(result, 'blocked');
  server.hold = null;
  server.release();
  await until(() => events.accepted.length === 1, 'accepted');
});
