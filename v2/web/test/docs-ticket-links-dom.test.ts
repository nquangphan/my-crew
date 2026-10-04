import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import type { AppRuntime } from '../src/app-runtime.ts';
import { FakeComposeServer, harness, settle } from './support/compose-server.ts';
import { installDom } from './support/dom.ts';
import { useDomEventConstructors } from './support/dom-events.ts';

const closeDom = installDom();
// biome-ignore lint/correctness/useHookAtTopLevel: not a React hook; it binds jsdom event constructors.
useDomEventConstructors();
const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createElement } = await import('react');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { RuntimeContext } = await import('../src/app-runtime.ts');
const { TicketDocsLinksEditor } = await import('../src/docs/ticket-links.tsx');

afterEach(() => cleanup());
after(() => closeDom());

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ticketId = '55555555-5555-4555-8555-555555555555';
const snap = '11111111-1111-4111-8111-111111111111';
const oldSnap = '22222222-2222-4222-8222-222222222222';

const ticketBody = (revision: number) => ({
  id: ticketId,
  projectId,
  parentId: null,
  rootId: ticketId,
  level: 'request',
  kind: 'code',
  title: 'T',
  description: 'd',
  mandatory: true,
  criteria: {},
  inputs: {},
  outputs: {},
  skill: null,
  workflowPin: null,
  status: 'running',
  revision,
  waitReason: null,
  repairCycles: 0,
  mergedCommit: null,
});
const tree = {
  projectId,
  snapshotId: snap,
  sourceCommit: 'abc1234',
  auditState: 'verified',
  contentClass: 'implemented',
  pages: [
    { path: 'docs/index.md', title: 'Tổng quan', parentPath: null, contentClass: 'implemented' },
    { path: 'docs/a.md', title: 'Trang A', parentPath: 'docs/index.md', contentClass: 'implemented' },
    { path: 'docs/b.md', title: 'Trang B', parentPath: 'docs/index.md', contentClass: 'implemented' },
  ],
  links: [],
  relatedTicketIds: [],
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

type Put = {
  key: string;
  body: { snapshotId: string; paths: string[]; expectedRevision: number };
  csrf: string;
};

function setup(options: {
  revision?: () => number;
  linkPages: () => Record<
    string,
    { items: { snapshotId: string; path: string }[]; nextCursor: string | null }
  >;
  put: (put: Put, count: number) => Response | Promise<Response>;
}) {
  const server = new FakeComposeServer();
  const base = server.fetch;
  const puts: Put[] = [];
  const getUrls: string[] = [];
  server.fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (url.startsWith('/v2/') && !url.startsWith('/v2/auth/')) {
      const parsed = new URL(url, 'http://x');
      if (method === 'PUT' && parsed.pathname === `/v2/tickets/${ticketId}/docs-links`) {
        const headers = new Headers(init.headers);
        const put: Put = {
          key: headers.get('idempotency-key') ?? '',
          csrf: headers.get('x-csrf-token') ?? '',
          body: JSON.parse(String(init.body)),
        };
        puts.push(put);
        return options.put(put, puts.length);
      }
      if (method === 'GET') {
        getUrls.push(url);
        if (parsed.pathname === `/v2/tickets/${ticketId}`) return json(ticketBody(options.revision?.() ?? 2));
        if (parsed.pathname === `/v2/projects/${projectId}/docs/tree`) return json(tree);
        if (parsed.pathname === `/v2/tickets/${ticketId}/docs-links`)
          return json(options.linkPages()[parsed.searchParams.get('cursor') ?? '']);
      }
    }
    return base(url, init);
  };
  return { server, puts, getUrls };
}

function mount(env: Awaited<ReturnType<typeof harness>>) {
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
        createElement(TicketDocsLinksEditor, { ticketId }),
      ),
    ),
  );
}

async function until(predicate: () => boolean, label: string) {
  await act(async () => {
    await settle(predicate, label);
  });
}
const box = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /^Lưu liên kết/ }) as HTMLButtonElement;
const ready = () => screen.queryByRole('checkbox', { name: /Trang A/ }) !== null;

test('lưu gửi PUT với CAS expectedRevision, snapshot của cây, đường dẫn đã chọn và khóa cố định', async () => {
  let saved = false;
  const { server, puts } = setup({
    linkPages: () => ({
      '': { items: [{ snapshotId: snap, path: 'docs/a.md' }], nextCursor: null },
    }),
    put: () => {
      saved = true;
      return json(ticketBody(3));
    },
  });
  mount(await harness(server));
  await until(() => ready() && box(/Trang A/).checked, 'ready');
  assert.equal(saveButton().disabled, true);
  await act(async () => {
    fireEvent.click(box(/Trang B/));
  });
  assert.equal(saveButton().disabled, false);
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await until(() => saved, 'put');
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0]?.body, {
    snapshotId: snap,
    paths: ['docs/a.md', 'docs/b.md'],
    expectedRevision: 2,
  });
  assert.match(puts[0]?.key ?? '', /^[0-9a-f-]{36}$/);
  assert.match(puts[0]?.csrf ?? '', /^c{64}$/);
  await until(() => /Đã lưu/.test(document.body.textContent ?? ''), 'saved text');
});

test('409 giữ nguyên bản nháp, đọc lại revision và lần lưu sau dùng revision mới với khóa mới', async () => {
  let revision = 2;
  const { server, puts, getUrls } = setup({
    revision: () => revision,
    linkPages: () => ({ '': { items: [{ snapshotId: snap, path: 'docs/a.md' }], nextCursor: null } }),
    put: (_put, count) => {
      if (count === 1) {
        revision = 3;
        return apiError(409, 'REVISION_CONFLICT', 'Ticket đã thay đổi');
      }
      return json(ticketBody(4));
    },
  });
  mount(await harness(server));
  await until(ready, 'ready');
  await act(async () => {
    fireEvent.click(box(/Trang B/));
  });
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await until(() => /Ticket đã thay đổi/.test(document.body.textContent ?? ''), '409');
  assert.equal(box(/Trang B/).checked, true, 'bản nháp phải được giữ');
  assert.equal(box(/Trang A/).checked, true);
  await until(
    () => getUrls.filter((url) => url === `/v2/tickets/${ticketId}`).length >= 2,
    'ticket refetched',
  );
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await until(() => puts.length === 2, 'second put');
  assert.equal(puts[1]?.body.expectedRevision, 3);
  assert.deepEqual(puts[1]?.body.paths, ['docs/a.md', 'docs/b.md']);
  assert.notEqual(puts[1]?.key, puts[0]?.key);
});

test('mất phản hồi: lần bấm lại gửi lại đúng khóa và đúng byte, không tạo thao tác mới', async () => {
  const { server, puts } = setup({
    linkPages: () => ({ '': { items: [{ snapshotId: snap, path: 'docs/a.md' }], nextCursor: null } }),
    put: (_put, count) => {
      if (count === 1) throw new TypeError('network down');
      return json(ticketBody(3));
    },
  });
  mount(await harness(server));
  await until(ready, 'ready');
  await act(async () => {
    fireEvent.click(box(/Trang B/));
  });
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await until(() => /chưa xác nhận/.test(document.body.textContent ?? ''), 'ambiguous');
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await until(() => puts.length === 2, 'resend');
  assert.equal(puts[1]?.key, puts[0]?.key);
  assert.deepEqual(puts[1]?.body, puts[0]?.body);
});

test('chỉ cho lưu khi đã đọc hết các trang liên kết hiện có; liên kết snapshot cũ được báo sẽ bị thay', async () => {
  const { server, puts } = setup({
    linkPages: () => ({
      '': { items: [{ snapshotId: snap, path: 'docs/a.md' }], nextCursor: 'Y3Vy' },
      Y3Vy: {
        items: [
          { snapshotId: snap, path: 'docs/b.md' },
          { snapshotId: oldSnap, path: 'docs/cu.md' },
        ],
        nextCursor: null,
      },
    }),
    put: () => json(ticketBody(3)),
  });
  mount(await harness(server));
  await until(() => ready() && box(/Trang B/).checked, 'both pages read');
  assert.match(document.body.textContent ?? '', /1 liên kết thuộc phiên bản tài liệu cũ/);
  await act(async () => {
    fireEvent.click(box(/Trang A/));
  });
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await until(() => puts.length === 1, 'put');
  assert.deepEqual(puts[0]?.body.paths, ['docs/b.md']);
});

test('không cho lưu danh sách rỗng (producer yêu cầu ít nhất một trang)', async () => {
  const { server } = setup({
    linkPages: () => ({ '': { items: [{ snapshotId: snap, path: 'docs/a.md' }], nextCursor: null } }),
    put: () => json(ticketBody(3)),
  });
  mount(await harness(server));
  await until(ready, 'ready');
  await act(async () => {
    fireEvent.click(box(/Trang A/));
  });
  assert.equal(saveButton().disabled, true);
  assert.match(document.body.textContent ?? '', /ít nhất một trang/);
});
