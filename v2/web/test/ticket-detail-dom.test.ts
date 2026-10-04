import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import type { AppRuntime } from '../src/app-runtime.ts';
import type { Ticket } from '../src/contracts/tickets.ts';
import { formDrafts } from '../src/tickets/create-request-state.ts';
import { FakeComposeServer, harness, inlineHasher, projectId, settle } from './support/compose-server.ts';
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
const { RequestList } = await import('../src/tickets/requests.tsx');

afterEach(() => cleanup());
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

function mount(env: Env) {
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
  render(
    createElement(
      RuntimeContext.Provider,
      { value: runtime },
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ComposeServicesProvider, { services, children: createElement(Host) }),
      ),
    ),
  );
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
  assert.equal(formDrafts(env.session).comments.get(ticketB), 'nháp cho B');
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
  assert.equal(formDrafts(env.session).comments.get(ticketA) ?? '', '');
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
