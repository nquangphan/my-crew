import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import type { AppRuntime } from '../src/app-runtime.ts';
import type { Ticket } from '../src/contracts/tickets.ts';
import { formDrafts } from '../src/tickets/create-request-state.ts';
import {
  FakeComposeServer,
  harness,
  inlineHasher,
  pngFile,
  projectId,
  settle,
} from './support/compose-server.ts';
import { installDom } from './support/dom.ts';
import { useDomEventConstructors } from './support/dom-events.ts';

const closeDom = installDom();
// biome-ignore lint/correctness/useHookAtTopLevel: not a React hook; it binds jsdom event constructors.
useDomEventConstructors();
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createElement, useState } = await import('react');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { ComposeServicesProvider } = await import('../src/compose/composer.tsx');
const { RuntimeContext } = await import('../src/app-runtime.ts');
const { TicketDialog } = await import('../src/tickets/dialog.tsx');
const { TicketDetail } = await import('../src/tickets/detail.tsx');
const { queryKeys, queryRoots } = await import('../src/lib/query-keys.ts');
const { RequestList } = await import('../src/tickets/requests.tsx');
const { TicketDraftStorageProvider } = await import('../src/tickets/create-request.tsx');

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});
after(() => closeDom());

const ticketA = '66666666-6666-4666-8666-666666666666';
const ticketB = '77777777-7777-4777-8777-777777777777';
const ticketDone = '88888888-8888-4888-8888-888888888888';

function ticket(id: string, title: string, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id,
    projectId,
    parentId: null,
    rootId: id,
    level: 'request',
    kind: 'code',
    title,
    description: 'Mô tả',
    mandatory: true,
    criteria: { workflowChoice: 'superpowers' },
    inputs: {},
    outputs: {},
    skill: null,
    workflowPin: null,
    status: 'running',
    revision: 1,
    waitReason: null,
    repairCycles: 0,
    mergedCommit: null,
    ...overrides,
  };
}

/** The in-memory attachment producer plus the ticket read routes (`tickets/routes.ts`). */
function serverWithTickets(rows: Ticket[], attachments: Record<string, unknown[]> = {}) {
  const server = new FakeComposeServer();
  const base = server.fetch;
  const reads: string[] = [];
  server.fetch = async (url: string, init: RequestInit = {}) => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if ((init.method ?? 'GET') === 'GET') {
      const match = /^\/v2\/tickets\/([^/?]+)(\/[a-z]+)?(?:\?.*)?$/.exec(url);
      const row = match ? rows.find((candidate) => candidate.id === match[1]) : undefined;
      if (match && row) {
        reads.push(url);
        if (!match[2]) return json(row);
        if (match[2] === '/graph') return json({ nodes: [row], dependencies: [], repairLinks: [] });
        if (match[2] === '/comments')
          return json({
            items: server.comments.filter((comment) => (comment as { ticketId: string }).ticketId === row.id),
            nextCursor: null,
          });
        if (match[2] === '/decisions') return json({ items: [], nextCursor: null });
        if (match[2] === '/attachments') return json({ items: attachments[row.id] ?? [], nextCursor: null });
      }
    }
    return base(url, init);
  };
  return { server, reads };
}

type Env = Awaited<ReturnType<typeof harness>>;
let openTicket: (id: string | null) => void = () => undefined;

let showPage: (id: string) => void = () => undefined;

/** Mounts the dialog host, or with `page` the ticket page whose `ticketId` prop changes without remount. */
function mount(env: Env, mode: 'dialog' | 'page' = 'dialog') {
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
  function Host() {
    const [open, setOpen] = useState<string | null>(null);
    openTicket = setOpen;
    return createElement(TicketDialog, { ticketId: open, onClose: () => setOpen(null), returnFocus: null });
  }
  function Page() {
    const [id, setId] = useState(ticketA);
    showPage = setId;
    return createElement(TicketDetail, { ticketId: id, presentation: 'page' });
  }
  render(
    createElement(
      RuntimeContext.Provider,
      { value: runtime },
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ComposeServicesProvider, {
          services,
          children: createElement(TicketDraftStorageProvider, {
            storage: env.storage,
            children: createElement(mode === 'page' ? Page : Host),
          }),
        }),
      ),
    ),
  );
  return queryClient;
}

async function until(predicate: () => boolean, label: string) {
  await act(async () => {
    await settle(predicate, label);
  });
}

async function open(id: string | null) {
  await act(async () => openTicket(id));
  if (id !== null)
    await until(
      () =>
        document.querySelector(`[data-testid="ticket-detail"][data-ticket-id="${id.toLowerCase()}"]`) !==
        null,
      `open ${id}`,
    );
  await act(async () => undefined);
}

const commentBox = () => screen.queryByLabelText('Nội dung') as HTMLTextAreaElement | null;

async function typeComment(value: string) {
  await until(() => commentBox() !== null, 'composer');
  await act(async () => {
    fireEvent.change(commentBox() as HTMLTextAreaElement, { target: { value } });
  });
}

test('draft bình luận giữ theo từng ticket khi đóng/mở hộp thoại; chỉ “Bỏ bản nháp bình luận” mới xóa', async () => {
  const { server } = serverWithTickets([ticket(ticketA, 'Ticket A'), ticket(ticketB, 'Ticket B')]);
  const env = await harness(server);
  mount(env);
  await open(ticketA);
  await typeComment('nháp cho A');
  await open(null);
  assert.equal(screen.queryByRole('dialog'), null);
  await open(ticketB);
  await until(() => commentBox() !== null, 'composer B');
  assert.equal(commentBox()?.value, '', 'ticket khác không mang draft của A');
  await typeComment('nháp cho B');
  await open(null);
  await open(ticketA);
  await until(() => commentBox() !== null, 'composer A again');
  assert.equal(commentBox()?.value, 'nháp cho A');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Bỏ bản nháp bình luận/ }));
  });
  assert.equal(commentBox()?.value, '');
  await open(null);
  await open(ticketA);
  await until(() => commentBox() !== null, 'composer A third');
  assert.equal(commentBox()?.value, '', 'đã bỏ thì không khôi phục');
  assert.equal(formDrafts(env.session, env.storage).comment(ticketB), 'nháp cho B');
});

test('gửi bình luận qua composer chung: một comment, ô nhập trống và timeline đọc lại', async () => {
  const { server, reads } = serverWithTickets([ticket(ticketA, 'Ticket A')]);
  const env = await harness(server);
  mount(env);
  await open(ticketA);
  await typeComment('Bình luận có dấu tiếng Việt');
  const before = reads.filter((url) => url.startsWith(`/v2/tickets/${ticketA}/comments`)).length;
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Gửi bình luận/ }));
  });
  await until(() => server.comments.length === 1, 'comment');
  await until(() => commentBox()?.value === '', 'cleared');
  await until(
    () => reads.filter((url) => url.startsWith(`/v2/tickets/${ticketA}/comments`)).length > before,
    'timeline refetch',
  );
  await until(() => (document.body.textContent ?? '').includes('Bình luận có dấu tiếng Việt'), 'timeline');
  assert.equal(formDrafts(env.session, env.storage).comment(ticketA), '');
});

test('ticket đã kết thúc chỉ xem: không có composer bình luận', async () => {
  const { server } = serverWithTickets([ticket(ticketDone, 'Ticket xong', { status: 'done' })]);
  const env = await harness(server);
  mount(env);
  await open(ticketDone);
  assert.match(document.body.textContent ?? '', /chỉ xem/);
  assert.equal(commentBox(), null);
});

test('deep link ID chữ hoa đọc bằng ID chữ thường và vẫn hiện lý do chờ ngoài needs_input', async () => {
  // Hex letters so upper and lower case differ.
  const hexId = 'abcdef01-2345-4678-9abc-def012345678';
  const { server, reads } = serverWithTickets([
    ticket(hexId, 'Ticket hex', { status: 'running', waitReason: 'final_result_pending' }),
  ]);
  const env = await harness(server);
  mount(env);
  await open(hexId.toUpperCase());
  assert.ok(reads.length > 0);
  assert.ok(reads.every((url) => !url.includes(hexId.toUpperCase())));
  assert.match(document.body.textContent ?? '', /Lý do chờ: Máy chưa xác nhận kết quả cuối/);
});

test('danh sách yêu cầu: đọc level=request của producer, chỉ hiện gốc thật, chọn yêu cầu mở ticket, có “Tạo yêu cầu”', async () => {
  const root = ticket(ticketA, 'Yêu cầu gốc');
  // A malformed row (request level but with a parent) must not be shown as a root.
  const fake = ticket(ticketB, 'Không phải gốc', { parentId: ticketA, rootId: ticketA });
  const { server } = serverWithTickets([]);
  const base = server.fetch;
  const listed: string[] = [];
  server.fetch = async (url: string, init: RequestInit = {}) => {
    if ((init.method ?? 'GET') === 'GET' && url.startsWith('/v2/tickets?')) {
      listed.push(url);
      return new Response(JSON.stringify({ items: [root, fake], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return base(url, init);
  };
  const env = await harness(server);
  const opened: string[] = [];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  });
  const runtime = { client: env.client, session: env.session, pending: env.pending } as unknown as AppRuntime;
  render(
    createElement(
      RuntimeContext.Provider,
      { value: runtime },
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RequestList, {
          filters: { projectId },
          onFiltersChange: () => undefined,
          onOpenTicket: (id: string) => opened.push(id),
        }),
      ),
    ),
  );
  await until(() => document.querySelector(`[data-ticket-id="${ticketA}"]`) !== null, 'roots');
  assert.equal(listed[0], `/v2/tickets?projectId=${projectId}&level=request&limit=50`);
  assert.equal(document.querySelector(`[data-ticket-id="${ticketB}"]`), null);
  assert.ok(screen.getByRole('button', { name: /^Tạo yêu cầu$/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Yêu cầu gốc/ }));
  });
  assert.deepEqual(opened, [ticketA]);
});

test('chi tiết dùng danh sách tệp đính kèm chung của Task5 cho đúng ticket', async () => {
  const { server, reads } = serverWithTickets([ticket(ticketA, 'Ticket A')], {
    [ticketA]: [
      {
        linkId: '99999999-9999-4999-8999-999999999999',
        attachmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sha256: 'a'.repeat(64),
        ownerId: 'owner',
        fileName: 'bao-cao-kiem-thu.pdf',
        mime: 'application/pdf',
        byteLength: 2048,
      },
    ],
  });
  const env = await harness(server);
  mount(env);
  await open(ticketA);
  await until(() => (document.body.textContent ?? '').includes('bao-cao-kiem-thu.pdf'), 'attachment listed');
  assert.ok(reads.some((url) => url.startsWith(`/v2/tickets/${ticketA}/attachments`)));
  assert.doesNotMatch(document.body.textContent ?? '', /máy chủ chưa mở API tệp đính kèm/);
});

test('chi tiết trong hộp thoại nhúng editor liên kết tài liệu của ticket thay cho dòng “chưa có dữ liệu”', async () => {
  const snapshotId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const { server } = serverWithTickets([ticket(ticketA, 'Ticket A')]);
  const base = server.fetch;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  server.fetch = async (url: string, init: RequestInit = {}) => {
    if ((init.method ?? 'GET') === 'GET' && url.startsWith(`/v2/projects/${projectId}/docs/tree`))
      return json({
        projectId,
        snapshotId,
        sourceCommit: null,
        auditState: 'verified',
        contentClass: 'implemented',
        pages: [
          { path: 'docs/huong-dan.md', title: 'Hướng dẫn', parentPath: null, contentClass: 'implemented' },
        ],
        links: [],
        relatedTicketIds: [],
      });
    if ((init.method ?? 'GET') === 'GET' && url.startsWith(`/v2/tickets/${ticketA}/docs-links`))
      return json({ items: [{ snapshotId, path: 'docs/huong-dan.md' }], nextCursor: null });
    return base(url, init);
  };
  const env = await harness(server);
  mount(env);
  await open(ticketA);
  await until(
    () => screen.queryByRole('region', { name: 'Tài liệu liên kết với ticket' }) !== null,
    'editor',
  );
  const dialog = screen.getByRole('dialog');
  assert.ok(dialog.contains(screen.getByRole('region', { name: 'Tài liệu liên kết với ticket' })));
  await until(
    () =>
      (screen.queryByRole('checkbox', { name: /huong-dan|Hướng dẫn/ }) as HTMLInputElement | null)
        ?.checked === true,
    'linked page checked',
  );
  assert.doesNotMatch(
    document.querySelector('[data-testid="ticket-detail"]')?.textContent ?? '',
    /Tài liệu liên quanChưa có dữ liệu/,
  );
});

test('trang ticket đổi ticketId mà không remount: chữ nháp của A không sang B', async () => {
  const { server } = serverWithTickets([ticket(ticketA, 'Ticket A'), ticket(ticketB, 'Ticket B')]);
  const env = await harness(server);
  mount(env, 'page');
  await until(() => document.querySelector(`[data-ticket-id="${ticketA}"]`) !== null, 'page A');
  await typeComment('chỉ dành cho A');
  await act(async () => showPage(ticketB));
  await until(
    () => document.querySelector(`[data-testid="ticket-detail"][data-ticket-id="${ticketB}"]`) !== null,
    'page B',
  );
  await until(() => commentBox() !== null, 'composer B');
  assert.equal(commentBox()?.value, '');
  const drafts = formDrafts(env.session, env.storage);
  assert.equal(drafts.comment(ticketB), '');
  assert.equal(drafts.comment(ticketA), 'chỉ dành cho A');
  await act(async () => showPage(ticketA));
  await until(() => commentBox()?.value === 'chỉ dành cho A', 'A restored');
});

test('mất response bình luận rồi tải lại trang: ô nội dung khôi phục, khóa và khớp body gửi lại', async () => {
  const { server } = serverWithTickets([ticket(ticketA, 'Ticket A')]);
  const env = await harness(server);
  mount(env);
  await open(ticketA);
  await typeComment('Bình luận trước khi tải lại');
  server.dropAfterCommit = (call) => call.url.endsWith('/attachment-comments');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Gửi bình luận/ }));
  });
  await until(() => document.querySelector('[data-compose-state="ambiguous"]') !== null, 'ambiguous');
  cleanup();
  const reloaded = await harness(server, env.storage);
  mount(reloaded);
  await open(ticketA);
  await until(
    () => document.querySelector('[data-compose-state="ambiguous"]') !== null,
    'ambiguous after reload',
  );
  const posts = () => server.calls.filter((call) => call.url.endsWith('/attachment-comments'));
  assert.equal(commentBox()?.value, JSON.parse(posts()[0]?.body ?? '{}').text);
  assert.equal(commentBox()?.readOnly, true);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Gửi lại đúng yêu cầu cũ/ }));
  });
  await until(() => server.comments.length === 1 && posts().length >= 2, 'replayed');
  assert.equal(new Set(posts().map((call) => call.body)).size, 1);
  assert.equal(new Set(posts().map((call) => call.headers.get('idempotency-key'))).size, 1);
});

test('deep link chữ hoa: cache theo key chữ thường, invalidation chữ thường làm mới, revision cũ không ghi đè', async () => {
  const hexId = 'abcdef01-2345-4678-9abc-def012345678';
  const row = ticket(hexId, 'Ticket hex', { revision: 1 });
  const { server } = serverWithTickets([row]);
  const env = await harness(server);
  const cache = mount(env);
  await open(hexId.toUpperCase());
  assert.equal(cache.getQueryData<Ticket>(queryKeys.ticket(hexId))?.revision, 1);
  assert.equal(cache.getQueryData(queryKeys.ticket(hexId.toUpperCase())), undefined);
  const revision = () =>
    document.querySelector('[data-testid="ticket-detail"]')?.getAttribute('data-revision');
  Object.assign(row, { revision: 5, title: 'Ticket hex mới' });
  await act(async () => {
    await cache.invalidateQueries({ queryKey: queryRoots.ticket(hexId) });
  });
  await until(() => revision() === '5', 'refetched by lower-case invalidation');
  Object.assign(row, { revision: 3, title: 'Bản cũ' });
  await act(async () => {
    await cache.invalidateQueries({ queryKey: queryRoots.ticket(hexId) });
  });
  await act(async () => undefined);
  assert.equal(revision(), '5', 'revision guard giữ bản mới');
  assert.doesNotMatch(document.body.textContent ?? '', /Bản cũ/);
});

test('ticket kết thúc: liên kết tài liệu chỉ xem, không có điều khiển sửa; lỗi đọc có “Thử lại” bấm được', async () => {
  const { server } = serverWithTickets([ticket(ticketDone, 'Ticket xong', { status: 'done' })]);
  const base = server.fetch;
  let failures = 1;
  server.fetch = async (url: string, init: RequestInit = {}) => {
    if ((init.method ?? 'GET') === 'GET' && url.startsWith(`/v2/tickets/${ticketDone}/docs-links`)) {
      if (failures-- > 0)
        return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'lỗi' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      return new Response(
        JSON.stringify({
          items: [{ snapshotId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', path: 'docs/huong-dan.md' }],
          nextCursor: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return base(url, init);
  };
  const env = await harness(server);
  mount(env);
  await open(ticketDone);
  const region = () => screen.getByRole('region', { name: 'Tài liệu liên kết với ticket' });
  await until(
    () => screen.queryByRole('button', { name: 'Thử lại tải liên kết tài liệu' }) !== null,
    'read error',
  );
  const retry = screen.getByRole('button', { name: 'Thử lại tải liên kết tài liệu' }) as HTMLButtonElement;
  assert.equal(retry.matches(':disabled'), false);
  await act(async () => {
    fireEvent.click(retry);
  });
  await until(() => (region().textContent ?? '').includes('docs/huong-dan.md'), 'links listed');
  assert.equal(region().querySelectorAll('input').length, 0, 'không có checkbox sửa');
  assert.equal(screen.queryByRole('button', { name: 'Lưu liên kết' }), null);
});

test('ticket chuyển sang kết thúc qua realtime khi bình luận chưa xác nhận: composer vẫn còn để gửi lại', async () => {
  const row = ticket(ticketA, 'Ticket A', { status: 'running' });
  const { server } = serverWithTickets([row]);
  const env = await harness(server);
  const cache = mount(env);
  await open(ticketA);
  await typeComment('gửi lúc sắp xong');
  server.dropAfterCommit = (call) => call.url.endsWith('/attachment-comments');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Gửi bình luận/ }));
  });
  await until(() => document.querySelector('[data-compose-state="ambiguous"]') !== null, 'ambiguous');
  Object.assign(row, { status: 'done', revision: 2 });
  await act(async () => {
    await cache.invalidateQueries({ queryKey: queryRoots.ticket(ticketA) });
  });
  await until(() => /chỉ xem/.test(document.body.textContent ?? ''), 'terminal');
  assert.ok(screen.getByRole('button', { name: /Gửi lại đúng yêu cầu cũ/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Gửi lại đúng yêu cầu cũ/ }));
  });
  await until(() => server.comments.length === 1, 'resent');
  await until(() => document.querySelector('[data-compose-state]') === null, 'composer gone once settled');
});

test('“Bỏ bản nháp bình luận” bỏ trọn chữ, tệp và compose; chưa xác nhận thì giữ chữ và báo', async () => {
  const { server } = serverWithTickets([ticket(ticketA, 'Ticket A')]);
  const env = await harness(server);
  mount(env);
  await open(ticketA);
  await typeComment('bình luận kèm tệp');
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Đính kèm tệp'), { target: { files: [pngFile('a.png', 2)] } });
  });
  await until(() => document.querySelector('[data-state="ready"]') !== null, 'file ready');
  const compose = [...server.composes.values()].at(-1);
  server.failBefore = (call) => call.method === 'DELETE';
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Bỏ bản nháp bình luận/ }));
  });
  await until(
    () => /Chưa xác nhận được việc bỏ bản nháp/.test(document.body.textContent ?? ''),
    'unconfirmed',
  );
  assert.equal(commentBox()?.value, 'bình luận kèm tệp');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Bỏ bản nháp bình luận/ }));
  });
  await until(() => commentBox()?.value === '', 'cleared');
  assert.equal(compose?.state, 'abandoned');
  assert.equal(document.querySelectorAll('[data-local-id]').length, 0);
  assert.equal(formDrafts(env.session, env.storage).comment(ticketA), '');
});

test('bỏ bản nháp bình luận chưa xác nhận cần xác nhận cảnh báo trùng', async () => {
  const { server } = serverWithTickets([ticket(ticketA, 'Ticket A')]);
  const env = await harness(server);
  mount(env);
  await open(ticketA);
  await typeComment('chưa rõ đã gửi chưa');
  server.dropAfterCommit = (call) => call.url.endsWith('/attachment-comments');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Gửi bình luận/ }));
  });
  await until(() => document.querySelector('[data-compose-state="ambiguous"]') !== null, 'ambiguous');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Bỏ bản nháp bình luận/ }));
  });
  assert.match(document.body.textContent ?? '', /có thể tạo bản trùng/);
  assert.equal(commentBox()?.value, 'chưa rõ đã gửi chưa');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Vẫn bỏ bản nháp/ }));
  });
  await until(() => commentBox()?.value === '', 'discarded');
  assert.equal(formDrafts(env.session, env.storage).comment(ticketA), '');
});
