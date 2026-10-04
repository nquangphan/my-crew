import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import type { AppRuntime } from '../src/app-runtime.ts';
import { submissionRequest } from '../src/compose/state.ts';
import type { SessionSnapshot } from '../src/lib/session.ts';
import {
  clearTicketDrafts,
  defaultRequestFields,
  discardMode,
  formDrafts,
  makeRequestSubmission,
  type RequestFormFields,
  requestFormLocked,
  workflowOptions,
} from '../src/tickets/create-request-state.ts';
import {
  FakeComposeServer,
  harness,
  inlineHasher,
  MemoryStorage,
  pngFile,
  projectId,
  settle,
} from './support/compose-server.ts';
import { installDom } from './support/dom.ts';
import { useDomEventConstructors } from './support/dom-events.ts';

const otherProjectId = '44444444-4444-4444-8444-444444444444';

// ---------------------------------------------------------------------------------------------------------
// Pure state
// ---------------------------------------------------------------------------------------------------------

test('makeRequestSubmission map chính xác field form sang CreateTicket và target ticket', () => {
  const fields: RequestFormFields = {
    projectId,
    kind: 'research',
    title: 'Khảo sát thư viện biểu đồ',
    description: 'Cần so sánh ba thư viện.\nƯu tiên nhẹ.',
    workflowChoice: 'bmad',
  };
  const submission = makeRequestSubmission(fields);
  assert.deepEqual(submission, {
    kind: 'ticket',
    target: { purpose: 'ticket', projectId, ticketId: null },
    ticket: {
      projectId,
      parentId: null,
      level: 'request',
      kind: 'research',
      title: 'Khảo sát thư viện biểu đồ',
      description: 'Cần so sánh ba thư viện.\nƯu tiên nhẹ.',
      mandatory: true,
      criteria: { workflowChoice: 'bmad' },
      inputs: {},
      outputs: {},
      skill: null,
      workflowPin: null,
      deployApprovalDecisionId: null,
    },
  });
  // Unknown form fields never reach the body.
  const extra = makeRequestSubmission({ ...fields, extra: 'x' } as RequestFormFields);
  assert.equal('extra' in extra.ticket, false);
  // The strict producer body built by the shared composer keeps exactly these values.
  const request = submissionRequest(
    submission,
    { composeSessionId: '55555555-5555-4555-8555-555555555555', selectionRevision: 1, attachmentIds: [] },
    'none',
  );
  assert.equal(request.path, '/v2/attachment-submissions/tickets');
  assert.deepEqual(request.body.ticket, submission.ticket);
});

test('defaultRequestFields: Superpowers mặc định, loại code, giữ project được chọn', () => {
  assert.deepEqual(defaultRequestFields(projectId), {
    projectId,
    kind: 'code',
    title: '',
    description: '',
    workflowChoice: 'superpowers',
  });
  assert.equal(defaultRequestFields().projectId, '');
});

test('workflowOptions: Superpowers đứng đầu là mặc định, BMAD ghi rõ chỉ có định nghĩa cho Claude Code', () => {
  assert.deepEqual(
    workflowOptions.map((option) => option.value),
    ['superpowers', 'bmad'],
  );
  const bmad = workflowOptions[1];
  assert.match(bmad?.note ?? '', /Claude Code/);
  assert.match(bmad?.note ?? '', /Codex/);
  assert.match(bmad?.note ?? '', /chưa/);
  assert.match(workflowOptions[0]?.note ?? '', /mặc định/i);
});

test('requestFormLocked: chỉ sửa field khi composer đang editing', () => {
  assert.equal(requestFormLocked('editing'), false);
  for (const state of ['sending', 'ambiguous', 'suspended', 'accepted'] as const)
    assert.equal(requestFormLocked(state), true, state);
});

function fakeSession(state: SessionSnapshot['state'] = 'authenticated') {
  const listeners = new Set<() => void>();
  let snapshot: SessionSnapshot = { state, ownerId: 'owner', error: null, busy: false };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => snapshot,
    set(next: SessionSnapshot['state']) {
      snapshot = { ...snapshot, state: next };
      for (const listener of listeners) listener();
    },
  };
}

/** Tab storage double with the `Storage` members the draft store uses. */
function tabStorage() {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

test('formDrafts giữ bản nháp qua hết phiên/đăng nhập lại, xóa khi đăng xuất, tách theo session', () => {
  const storage = tabStorage();
  const session = fakeSession();
  const drafts = formDrafts(session, storage);
  assert.equal(formDrafts(session, storage), drafts, 'một kho cho một session');
  drafts.request = { ...defaultRequestFields(projectId), title: 'Nháp' };
  drafts.setComment('t1', 'bình luận nháp');
  session.set('expired');
  session.set('authenticated');
  assert.equal(drafts.request?.title, 'Nháp');
  assert.equal(drafts.comment('t1'), 'bình luận nháp');
  session.set('logging_out');
  assert.equal(drafts.request, null);
  assert.equal(drafts.comment('t1'), '');
  assert.equal(storage.map.size, 0, 'đăng xuất xóa cả bản lưu trong tab');
  drafts.setComment('t2', 'x');
  session.set('guest');
  assert.equal(drafts.comment('t2'), '');
});

test('formDrafts lưu vào tab storage, phiên mới (tải lại trang) đọc lại đúng field; dữ liệu hỏng bị bỏ', () => {
  const storage = tabStorage();
  const before = formDrafts(fakeSession(), storage);
  const fields: RequestFormFields = {
    projectId,
    kind: 'docs',
    title: 'Tiêu đề có dấu',
    description: 'Mô tả\nhai dòng',
    workflowChoice: 'bmad',
  };
  before.request = fields;
  before.setComment('t1', 'nháp bình luận');
  for (const value of storage.map.values()) assert.doesNotMatch(value, /csrf|token|password/i);
  const after = formDrafts(fakeSession(), storage);
  assert.notEqual(after, before);
  assert.deepEqual(after.request, fields);
  assert.equal(after.comment('t1'), 'nháp bình luận');
  after.setComment('t1', '');
  assert.equal(formDrafts(fakeSession(), storage).comment('t1'), '');
  for (const key of [...storage.map.keys()]) storage.map.set(key, '{"projectId":1,"kind":"epic"}');
  assert.equal(formDrafts(fakeSession(), storage).request, null, 'field sai kiểu không được khôi phục');
});

test('clearTicketDrafts xóa mọi bản nháp form/bình luận trong tab storage, kể cả khi chưa tạo kho trong lần tải trang', () => {
  // Storage that only has the Task2 `TabStorage` members (no enumeration), like the composer's.
  const storage = new MemoryStorage();
  const before = formDrafts(fakeSession(), storage);
  before.request = { ...defaultRequestFields(projectId), title: 'Còn sau đăng xuất?' };
  before.setComment('t1', 'nháp 1');
  before.setComment('t2', 'nháp 2');
  storage.setItem('crew-v2:pending:other', 'giữ nguyên');
  assert.ok(storage.map.size >= 4);
  // A reload: no draft store exists in this page; the logout hook clears the tab storage directly.
  clearTicketDrafts(storage);
  assert.deepEqual([...storage.map.keys()], ['crew-v2:pending:other']);
  const after = formDrafts(fakeSession(), storage);
  assert.equal(after.request, null);
  assert.equal(after.comment('t1'), '');
  // An enumerable storage also loses stray prefixed keys that no index lists.
  const enumerable = tabStorage();
  enumerable.setItem('crew-v2:form-draft:comment:lac', 'x');
  enumerable.setItem('khac', 'y');
  clearTicketDrafts(enumerable);
  assert.deepEqual([...enumerable.map.keys()], ['khac']);
});

test('formDrafts không có storage thì giữ trong bộ nhớ của session, không ghi ra ngoài', () => {
  const session = fakeSession();
  const drafts = formDrafts(session, null);
  drafts.setComment('t1', 'chỉ trong bộ nhớ');
  drafts.request = { ...defaultRequestFields(projectId), title: 'Bộ nhớ' };
  assert.equal(formDrafts(session, null).comment('t1'), 'chỉ trong bộ nhớ');
  assert.equal(formDrafts(fakeSession(), null).comment('t1'), '', 'trang mới không thấy bản nháp bộ nhớ');
  session.set('logging_out');
  assert.equal(drafts.comment('t1'), '');
  assert.equal(drafts.request, null);
});

test('discardMode: ẩn khi accepted, hỏi xác nhận khi ambiguous/suspended, gọi thẳng khi editing/sending', () => {
  assert.equal(discardMode('accepted'), 'hidden');
  assert.equal(discardMode('ambiguous'), 'confirm');
  assert.equal(discardMode('suspended'), 'confirm');
  assert.equal(discardMode('editing'), 'direct');
  assert.equal(discardMode('sending'), 'direct', 'composer tự trả blocked');
});

// ---------------------------------------------------------------------------------------------------------
// Form component (jsdom + RTL, real Task2 client/session/pending over the in-memory producer)
// ---------------------------------------------------------------------------------------------------------

const closeDom = installDom();
// biome-ignore lint/correctness/useHookAtTopLevel: not a React hook; it binds jsdom event constructors.
useDomEventConstructors();
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createElement } = await import('react');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { ComposeServicesProvider } = await import('../src/compose/composer.tsx');
const { RuntimeContext } = await import('../src/app-runtime.ts');
const { CreateRequestAction, CreateRequestForm, TicketDraftStorageProvider } = await import(
  '../src/tickets/create-request.tsx'
);

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});
after(() => closeDom());

function project(id: string, name: string) {
  return {
    id,
    key: name.slice(0, 4).toUpperCase(),
    name,
    repositoryUrl: null,
    machineId: null,
    checkoutPath: null,
    bindingRevision: 0,
    docsState: 'missing',
  };
}

/** The in-memory attachment producer plus GET `/v2/projects` (`projects/routes.ts:45`). */
function serverWithProjects(): FakeComposeServer {
  const server = new FakeComposeServer();
  const base = server.fetch;
  server.fetch = async (url: string, init: RequestInit = {}) => {
    if ((init.method ?? 'GET') === 'GET' && url.startsWith('/v2/projects'))
      return new Response(
        JSON.stringify({
          items: [project(projectId, 'Dự án web'), project(otherProjectId, 'Dự án máy chủ')],
          nextCursor: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    return base(url, init);
  };
  return server;
}

type Env = Awaited<ReturnType<typeof harness>>;

function providers(env: Env, child: ReturnType<typeof createElement>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  });
  // Test runtime: only the members the ticket views read (`client`, `session`, `pending`).
  const runtime = { client: env.client, session: env.session, pending: env.pending } as unknown as AppRuntime;
  const services = {
    client: env.client,
    pending: env.pending,
    session: env.session,
    storage: env.storage,
    createHasher: () => inlineHasher().hasher,
  };
  return createElement(
    RuntimeContext.Provider,
    { value: runtime },
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ComposeServicesProvider, {
        services,
        children: createElement(TicketDraftStorageProvider, { storage: env.storage, children: child }),
      }),
    ),
  );
}

async function until(predicate: () => boolean, label: string) {
  await act(async () => {
    await settle(predicate, label);
  });
}

const titleInput = () => screen.getByLabelText('Tiêu đề') as HTMLInputElement;
const projectSelect = () => screen.getByLabelText('Dự án') as HTMLSelectElement;
const kindSelect = () => screen.getByLabelText('Loại') as HTMLSelectElement;
const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement;
const description = () => screen.getByLabelText('Mô tả') as HTMLTextAreaElement;
const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const composeState = () => document.querySelector('[data-compose-state]')?.getAttribute('data-compose-state');

async function formReady() {
  await until(
    () => projectSelect().options.length > 1 && document.querySelector('[data-compose-state]') !== null,
    'form ready',
  );
  await act(async () => undefined);
}

async function change(element: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
}

function ticketPosts(server: FakeComposeServer) {
  return server.calls.filter((call) => call.url === '/v2/attachment-submissions/tickets');
}

test('form tạo yêu cầu text-only: Superpowers mặc định, gửi đúng body, một ticket và mở ticket.id trả về', async () => {
  const server = serverWithProjects();
  const env = await harness(server);
  const created: string[] = [];
  render(
    providers(
      env,
      createElement(CreateRequestForm, { initialProjectId: projectId, onCreated: (id) => created.push(id) }),
    ),
  );
  await formReady();
  assert.equal(projectSelect().value, projectId);
  assert.equal(kindSelect().value, 'code');
  assert.equal(radio(/Superpowers/).checked, true, 'Superpowers mặc định');
  assert.equal(radio(/BMAD/).checked, false);
  assert.match(document.body.textContent ?? '', /Claude Code/);
  await change(kindSelect(), 'research');
  await change(titleInput(), 'Nghiên cứu cách lưu ảnh');
  await change(description(), 'Mô tả tiếng Việt có dấu: ảnh chụp màn hình.');
  // Switching project keeps the other fields.
  await change(projectSelect(), otherProjectId);
  assert.equal(titleInput().value, 'Nghiên cứu cách lưu ảnh');
  assert.equal(description().value, 'Mô tả tiếng Việt có dấu: ảnh chụp màn hình.');
  await change(projectSelect(), projectId);
  await act(async () => {
    fireEvent.click(button(/Tạo ticket/));
  });
  await until(() => created.length === 1, 'created');
  assert.equal(server.tickets.length, 1);
  const stored = server.tickets[0] as Record<string, unknown>;
  assert.equal(created[0], stored.id);
  assert.equal(stored.title, 'Nghiên cứu cách lưu ảnh');
  assert.equal(stored.kind, 'research');
  assert.equal(stored.level, 'request');
  assert.equal(stored.parentId, null);
  assert.equal(stored.projectId, projectId);
  assert.equal(stored.description, 'Mô tả tiếng Việt có dấu: ảnh chụp màn hình.');
  assert.deepEqual(stored.criteria, { workflowChoice: 'superpowers' });
  assert.deepEqual(JSON.parse(ticketPosts(server)[0]?.body ?? '{}').selection.attachmentIds, []);
  await act(async () => undefined);
  assert.equal(titleInput().value, '', 'sau khi tạo, form bắt đầu bản nháp mới');
  assert.equal(description().value, '');
  assert.equal(projectSelect().value, projectId, 'giữ project đang chọn');
  assert.equal(formDrafts(env.session, env.storage).request?.title ?? '', '');
});

test('chọn BMAD rõ ràng kèm PNG: body có workflowChoice bmad và đúng ID tệp', async () => {
  const server = serverWithProjects();
  const env = await harness(server);
  const created: string[] = [];
  render(
    providers(
      env,
      createElement(CreateRequestForm, { initialProjectId: projectId, onCreated: (id) => created.push(id) }),
    ),
  );
  await formReady();
  await act(async () => {
    fireEvent.click(radio(/BMAD/));
  });
  assert.equal(radio(/BMAD/).checked, true);
  await change(titleInput(), 'Sửa giao diện đăng nhập');
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Đính kèm tệp'), {
      target: { files: [pngFile('man-hinh.png', 3)] },
    });
  });
  await until(() => document.querySelector('[data-state="ready"]') !== null, 'file ready');
  await act(async () => {
    fireEvent.click(button(/Tạo ticket/));
  });
  await until(() => created.length === 1, 'created');
  const body = JSON.parse(ticketPosts(server)[0]?.body ?? '{}');
  assert.deepEqual(body.ticket.criteria, { workflowChoice: 'bmad' });
  assert.equal(body.ticket.description, '');
  const uploaded = [...server.uploads.values()].map((upload) => upload.attachmentId);
  assert.equal(uploaded.length, 1);
  assert.deepEqual(body.selection.attachmentIds, uploaded);
  assert.equal(server.tickets.length, 1);
});

test('mất response rồi hết phiên: field bị khóa, đăng nhập lại gửi lại đúng key/body, một ticket', async () => {
  const server = serverWithProjects();
  const env = await harness(server);
  const created: string[] = [];
  render(
    providers(
      env,
      createElement(CreateRequestForm, { initialProjectId: projectId, onCreated: (id) => created.push(id) }),
    ),
  );
  await formReady();
  await change(titleInput(), 'Yêu cầu chưa xác nhận');
  await change(description(), 'Nội dung gốc');
  server.dropAfterCommit = (call) => call.url === '/v2/attachment-submissions/tickets';
  await act(async () => {
    fireEvent.click(button(/Tạo ticket/));
  });
  await until(() => composeState() === 'ambiguous', 'ambiguous');
  for (const field of [titleInput(), projectSelect(), kindSelect(), radio(/BMAD/), radio(/Superpowers/)])
    assert.equal(field.disabled, true, `${field.tagName} bị khóa khi chưa xác nhận`);
  // Discard is offered only behind the duplicate-risk confirmation (own test below).
  assert.equal(screen.queryByRole('alertdialog'), null);
  await change(titleInput(), 'Đổi tiêu đề để gửi body mới');
  assert.equal(titleInput().value, 'Yêu cầu chưa xác nhận');
  server.authenticated = false;
  await act(async () => {
    fireEvent.click(button(/Gửi lại đúng yêu cầu cũ/));
  });
  await until(
    () => env.session.snapshot().state === 'expired' && composeState() === 'suspended',
    'suspended',
  );
  assert.equal(titleInput().disabled, true, 'vẫn khóa khi chờ đăng nhập lại');
  assert.equal(titleInput().value, 'Yêu cầu chưa xác nhận', 'giữ field qua hết phiên');
  await act(async () => {
    assert.equal(await env.session.login('mat-khau-dung'), true);
  });
  await until(() => !button(/Gửi lại đúng yêu cầu cũ/).disabled, 'retry enabled');
  await act(async () => {
    fireEvent.click(button(/Gửi lại đúng yêu cầu cũ/));
  });
  await until(() => created.length === 1, 'created');
  const posts = ticketPosts(server);
  assert.ok(posts.length >= 2);
  assert.equal(new Set(posts.map((call) => call.headers.get('idempotency-key'))).size, 1);
  assert.equal(new Set(posts.map((call) => call.body)).size, 1);
  assert.equal(JSON.parse(posts[0]?.body ?? '{}').ticket.title, 'Yêu cầu chưa xác nhận');
  assert.equal(server.tickets.length, 1);
  assert.equal(created[0], (server.tickets[0] as { id: string }).id);
});

test('nút “Tạo yêu cầu”: đóng hộp thoại giữ field, chỉ “Bỏ bản nháp yêu cầu” mới xóa', async () => {
  const server = serverWithProjects();
  const env = await harness(server);
  const opened: string[] = [];
  render(
    providers(
      env,
      createElement(CreateRequestAction, {
        projectId: otherProjectId,
        onOpenTicket: (id: string) => opened.push(id),
      }),
    ),
  );
  await act(async () => {
    fireEvent.click(button(/^Tạo yêu cầu$/));
  });
  assert.ok(screen.getByRole('dialog', { name: 'Tạo yêu cầu' }));
  await formReady();
  assert.equal(projectSelect().value, otherProjectId, 'mặc định project của view');
  await change(titleInput(), 'Bản nháp giữ lại');
  await change(description(), 'Mô tả giữ lại');
  await act(async () => {
    fireEvent.click(radio(/BMAD/));
  });
  await act(async () => {
    fireEvent.click(button(/^Đóng$/));
  });
  assert.equal(screen.queryByRole('dialog'), null);
  await act(async () => {
    fireEvent.click(button(/^Tạo yêu cầu$/));
  });
  await formReady();
  assert.equal(titleInput().value, 'Bản nháp giữ lại');
  assert.equal(description().value, 'Mô tả giữ lại');
  assert.equal(radio(/BMAD/).checked, true);
  await act(async () => {
    fireEvent.click(button(/Bỏ bản nháp yêu cầu/));
  });
  assert.equal(titleInput().value, '');
  assert.equal(description().value, '');
  assert.equal(radio(/Superpowers/).checked, true);
  await change(titleInput(), 'Tạo xong mở ticket');
  await act(async () => {
    fireEvent.click(button(/Tạo ticket/));
  });
  await until(() => opened.length === 1, 'opened');
  assert.equal(opened[0], (server.tickets[0] as { id: string }).id);
  assert.equal(screen.queryByRole('dialog', { name: 'Tạo yêu cầu' }), null, 'đóng form, mở ticket');
});

test('mất response rồi tải lại trang: field khôi phục, bị khóa và khớp từng byte body gửi lại', async () => {
  const server = serverWithProjects();
  const env = await harness(server);
  render(
    providers(
      env,
      createElement(CreateRequestForm, { initialProjectId: projectId, onCreated: () => undefined }),
    ),
  );
  await formReady();
  await change(projectSelect(), otherProjectId);
  await change(kindSelect(), 'deploy');
  await change(titleInput(), 'Triển khai bản vá');
  await change(description(), 'Mô tả trước khi tải lại');
  await act(async () => {
    fireEvent.click(radio(/BMAD/));
  });
  server.dropAfterCommit = (call) => call.url === '/v2/attachment-submissions/tickets';
  await act(async () => {
    fireEvent.click(button(/Tạo ticket/));
  });
  await until(() => composeState() === 'ambiguous', 'ambiguous');
  // Reload: new session/pending/client over the same tab storage; in-memory state is gone.
  cleanup();
  const reloaded = await harness(server, env.storage);
  const created: string[] = [];
  render(
    providers(
      reloaded,
      createElement(CreateRequestForm, { initialProjectId: projectId, onCreated: (id) => created.push(id) }),
    ),
  );
  await formReady();
  await until(() => composeState() === 'ambiguous', 'ambiguous after reload');
  for (const field of [titleInput(), projectSelect(), kindSelect(), radio(/BMAD/)])
    assert.equal(field.disabled, true, `${field.tagName} khóa sau tải lại`);
  const sent = JSON.parse(ticketPosts(server)[0]?.body ?? '{}').ticket;
  assert.equal(projectSelect().value, sent.projectId);
  assert.equal(kindSelect().value, sent.kind);
  assert.equal(titleInput().value, sent.title);
  assert.equal(description().value, sent.description);
  assert.equal(radio(/BMAD/).checked, sent.criteria.workflowChoice === 'bmad');
  await act(async () => {
    fireEvent.click(button(/Gửi lại đúng yêu cầu cũ/));
  });
  await until(() => created.length === 1, 'created');
  const posts = ticketPosts(server);
  assert.equal(new Set(posts.map((call) => call.body)).size, 1);
  assert.equal(new Set(posts.map((call) => call.headers.get('idempotency-key'))).size, 1);
  assert.equal(server.tickets.length, 1);
});

test('bản nháp form dùng storage của runtime (cùng nguồn với composer), không ghi thẳng sessionStorage', async () => {
  const server = serverWithProjects();
  const env = await harness(server);
  render(
    providers(
      env,
      createElement(CreateRequestForm, { initialProjectId: projectId, onCreated: () => undefined }),
    ),
  );
  await formReady();
  await change(titleInput(), 'Lưu cùng chỗ với composer');
  assert.equal(window.sessionStorage.length, 0);
  assert.ok([...env.storage.map.values()].some((value) => value.includes('Lưu cùng chỗ với composer')));
});

async function withUploadedFile(server: FakeComposeServer) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Đính kèm tệp'), { target: { files: [pngFile('cu.png', 9)] } });
  });
  await until(() => document.querySelector('[data-state="ready"]') !== null, 'file ready');
  return [...server.composes.values()].at(-1);
}

test('“Bỏ bản nháp yêu cầu” bỏ trọn: compose và tệp bị abandon, field về mặc định, yêu cầu sau không mang tệp cũ', async () => {
  const server = serverWithProjects();
  const env = await harness(server);
  const created: string[] = [];
  render(
    providers(
      env,
      createElement(CreateRequestForm, { initialProjectId: projectId, onCreated: (id) => created.push(id) }),
    ),
  );
  await formReady();
  await change(titleInput(), 'Sẽ bỏ');
  await change(description(), 'Mô tả sẽ bỏ');
  const compose = await withUploadedFile(server);
  await act(async () => {
    fireEvent.click(button(/Bỏ bản nháp yêu cầu/));
  });
  await until(() => titleInput().value === '', 'fields cleared');
  assert.equal(compose?.state, 'abandoned');
  assert.equal(document.querySelectorAll('[data-local-id]').length, 0);
  assert.equal(description().value, '');
  assert.equal(formDrafts(env.session, env.storage).request?.title ?? '', '');
  await change(titleInput(), 'Yêu cầu mới không tệp');
  await act(async () => {
    fireEvent.click(button(/Tạo ticket/));
  });
  await until(() => created.length === 1, 'created');
  assert.deepEqual(JSON.parse(ticketPosts(server)[0]?.body ?? '{}').selection.attachmentIds, []);
});

test('bỏ bản nháp chưa xác nhận được (DELETE mất kết nối) thì giữ field và báo; đang gửi thì báo bị chặn', async () => {
  const server = serverWithProjects();
  const env = await harness(server);
  render(
    providers(
      env,
      createElement(CreateRequestForm, { initialProjectId: projectId, onCreated: () => undefined }),
    ),
  );
  await formReady();
  await change(titleInput(), 'Giữ khi chưa xác nhận');
  await withUploadedFile(server);
  server.failBefore = (call) => call.method === 'DELETE';
  await act(async () => {
    fireEvent.click(button(/Bỏ bản nháp yêu cầu/));
  });
  await until(
    () => /Chưa xác nhận được việc bỏ bản nháp/.test(document.body.textContent ?? ''),
    'unconfirmed',
  );
  assert.equal(titleInput().value, 'Giữ khi chưa xác nhận');
  assert.equal(formDrafts(env.session, env.storage).request?.title, 'Giữ khi chưa xác nhận');
  // Sending: the composer refuses to discard, the form keeps its fields.
  server.hold = (call) => call.url === '/v2/attachment-submissions/tickets';
  await act(async () => {
    fireEvent.click(button(/Tạo ticket/));
  });
  await until(() => composeState() === 'sending', 'sending');
  await act(async () => {
    fireEvent.click(button(/Bỏ bản nháp yêu cầu/));
  });
  await until(() => /Đang gửi nên chưa bỏ được bản nháp/.test(document.body.textContent ?? ''), 'blocked');
  assert.equal(titleInput().value, 'Giữ khi chưa xác nhận');
  server.hold = null;
  server.release();
  await until(() => server.tickets.length === 1, 'released');
});

test('bỏ bản nháp khi yêu cầu chưa xác nhận: phải xác nhận cảnh báo trùng trước, “Giữ lại” không bỏ gì', async () => {
  const server = serverWithProjects();
  const env = await harness(server);
  render(
    providers(
      env,
      createElement(CreateRequestForm, { initialProjectId: projectId, onCreated: () => undefined }),
    ),
  );
  await formReady();
  await change(titleInput(), 'Chưa xác nhận');
  server.dropAfterCommit = (call) => call.url === '/v2/attachment-submissions/tickets';
  await act(async () => {
    fireEvent.click(button(/Tạo ticket/));
  });
  await until(() => composeState() === 'ambiguous', 'ambiguous');
  const deletesBefore = server.calls.filter((call) => call.method === 'DELETE').length;
  await act(async () => {
    fireEvent.click(button(/Bỏ bản nháp yêu cầu/));
  });
  assert.match(document.body.textContent ?? '', /có thể tạo bản trùng/);
  assert.equal(composeState(), 'ambiguous', 'chưa gọi discardDraft trước khi owner xác nhận');
  await act(async () => {
    fireEvent.click(button(/^Giữ lại$/));
  });
  assert.doesNotMatch(document.body.textContent ?? '', /có thể tạo bản trùng/);
  assert.equal(titleInput().value, 'Chưa xác nhận');
  assert.equal(server.calls.filter((call) => call.method === 'DELETE').length, deletesBefore);
  await act(async () => {
    fireEvent.click(button(/Bỏ bản nháp yêu cầu/));
  });
  await act(async () => {
    fireEvent.click(button(/Vẫn bỏ bản nháp/));
  });
  await until(() => titleInput().value === '' && composeState() === 'editing', 'discarded');
  assert.equal(titleInput().disabled, false);
});
