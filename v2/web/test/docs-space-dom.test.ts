import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import type { AppRuntime } from '../src/app-runtime.ts';
import { FakeComposeServer, harness, settle } from './support/compose-server.ts';
import { installDom } from './support/dom.ts';
import { useDomEventConstructors } from './support/dom-events.ts';

const closeDom = installDom();
// biome-ignore lint/correctness/useHookAtTopLevel: not a React hook; it binds jsdom event constructors.
useDomEventConstructors();
const { act, cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { createElement, useState } = await import('react');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { RuntimeContext } = await import('../src/app-runtime.ts');
const { invalidations } = await import('../src/lib/events.ts');
const { DocsSpace } = await import('../src/docs/space.tsx');

afterEach(() => cleanup());
after(() => closeDom());

const projectA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const projectB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const snapA = '11111111-1111-4111-8111-111111111111';
const snapB = '22222222-2222-4222-8222-222222222222';
const ticket1 = '33333333-3333-4333-8333-333333333333';

type Cls = 'implemented' | 'workflow_artifact';
const pageRow = (
  path: string,
  title: string,
  parentPath: string | null,
  contentClass: Cls = 'implemented',
) => ({
  path,
  title,
  parentPath,
  contentClass,
});

function tree(projectId: string, snapshotId: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId,
    snapshotId,
    sourceCommit: 'abc1234def',
    auditState: 'verified',
    contentClass: 'mixed',
    pages: [
      pageRow('docs/index.md', 'Tổng quan', null),
      pageRow('docs/flows/đăng-nhập.md', 'Đăng nhập', 'docs/index.md'),
      pageRow('docs/plan.md', 'Kế hoạch', 'docs/index.md', 'workflow_artifact'),
    ],
    links: [],
    relatedTicketIds: [],
    ...overrides,
  };
}

function pageBody(projectId: string, snapshotId: string, path: string, text: string, extra = {}) {
  return {
    snapshotId,
    projectId,
    path,
    text,
    sha256: 'f'.repeat(64),
    sourceCommit: 'abc1234def',
    auditState: 'verified',
    contentClass: 'implemented',
    receivedAt: '2026-10-04T05:30:00.000Z',
    relatedTicketIds: [],
    ...extra,
  };
}

function project(id: string, docsState: string) {
  return {
    id,
    key: 'K',
    name: 'Dự án',
    repositoryUrl: null,
    machineId: null,
    checkoutPath: null,
    bindingRevision: 1,
    docsState,
  };
}

type Handler = (url: URL, signal: AbortSignal | null) => Response | Promise<Response>;
type Extra = (url: URL, signal: AbortSignal | null) => Response | undefined | Promise<Response | undefined>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

function docsServer(handler: Handler) {
  const server = new FakeComposeServer();
  const base = server.fetch;
  const requests: string[] = [];
  server.fetch = async (url: string, init: RequestInit = {}) => {
    if ((init.method ?? 'GET') === 'GET' && url.startsWith('/v2/') && !url.startsWith('/v2/auth/')) {
      requests.push(url);
      const response = await handler(new URL(url, 'http://x'), init.signal ?? null);
      if (response.status !== 599) return response;
    }
    return base(url, init);
  };
  return { server, requests };
}

type Env = Awaited<ReturnType<typeof harness>>;
type Mounted = {
  navigations: string[];
  tickets: string[];
  setProject: (id: string) => void;
  queryClient: InstanceType<typeof QueryClient>;
};

function mount(env: Env, initialProject = projectA, initialPath: string | null = null): Mounted {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  });
  const runtime = { client: env.client, session: env.session, pending: env.pending } as unknown as AppRuntime;
  const out: Mounted = { navigations: [], tickets: [], setProject: () => undefined, queryClient };
  function Host() {
    const [id, setId] = useState(initialProject);
    const [path, setPath] = useState<string | null>(initialPath);
    out.setProject = (next) => {
      setPath(null);
      setId(next);
    };
    return createElement(DocsSpace, {
      projectId: id,
      path,
      onPathChange: (next: string | null) => {
        out.navigations.push(String(next));
        setPath(next);
      },
      onOpenTicket: (ticketId: string) => out.tickets.push(ticketId),
    });
  }
  render(
    createElement(
      RuntimeContext.Provider,
      { value: runtime },
      createElement(QueryClientProvider, { client: queryClient }, createElement(Host)),
    ),
  );
  return out;
}

async function until(predicate: () => boolean, label: string) {
  await act(async () => {
    await settle(predicate, label);
  });
}
const has = (text: string | RegExp) => () =>
  document.body.textContent !== null &&
  (typeof text === 'string'
    ? document.body.textContent.includes(text)
    : text.test(document.body.textContent));

/** Standard single-project routes; `pages` maps path → markdown. */
function standard(
  pages: Record<string, string>,
  options: { docsState?: string; extra?: Extra; pageExtra?: Record<string, unknown> } = {},
) {
  return docsServer(async (url, signal) => {
    const custom = await options.extra?.(url, signal);
    if (custom) return custom;
    if (url.pathname === `/v2/projects/${projectA}/docs/tree`) return json(tree(projectA, snapA));
    if (url.pathname === `/v2/projects/${projectA}`)
      return json(project(projectA, options.docsState ?? 'current'));
    if (url.pathname === `/v2/projects/${projectA}/docs/page`) {
      const path = url.searchParams.get('path') ?? '';
      const text = pages[path];
      if (text === undefined) return apiError(404, 'NOT_FOUND', 'Không tìm thấy trang tài liệu');
      return json(
        pageBody(projectA, url.searchParams.get('snapshotId') ?? '', path, text, options.pageExtra),
      );
    }
    return new Response('', { status: 599 });
  });
}

test('hiện cây theo parentPath, trang mặc định và đủ commit/giờ/audit/docsState/contentClass', async () => {
  const { server } = standard({ 'docs/index.md': '# Tổng quan\n\nNội dung **chính**.' });
  mount(await harness(server));
  await until(has('Nội dung'), 'page');
  const nav = screen.getByRole('navigation', { name: 'Cây tài liệu' });
  const child = within(nav).getByRole('button', { name: /Đăng nhập/ });
  assert.ok(child.closest('ul')?.closest('li')?.textContent?.includes('Tổng quan'));
  assert.equal(
    within(nav)
      .getByRole('button', { name: /Tổng quan/ })
      .getAttribute('aria-current'),
    'page',
  );
  const meta = screen.getByLabelText('Thông tin phiên bản tài liệu').textContent ?? '';
  assert.match(meta, /abc1234def/);
  assert.match(meta, /12:30 04\/10\/2026/);
  assert.match(meta, /Đã xác minh/);
  assert.match(meta, /Hiện hành/);
  assert.match(meta, /Đã triển khai/);
  assert.equal(screen.getByRole('heading', { name: 'Tổng quan', level: 2 }) !== null, true);
});

test('trang thiết kế/kế hoạch mang nhãn riêng và không bao giờ ghi "Đã triển khai"', async () => {
  const { server } = standard(
    { 'docs/index.md': 'x', 'docs/plan.md': 'Kế hoạch triển khai' },
    { pageExtra: { contentClass: 'workflow_artifact' } },
  );
  mount(await harness(server), projectA, 'docs/plan.md');
  await until(has('Kế hoạch triển khai'), 'plan');
  const meta = screen.getByLabelText('Thông tin phiên bản tài liệu').textContent ?? '';
  assert.match(meta, /Thiết kế\/kế hoạch/);
  assert.doesNotMatch(meta, /Đã triển khai/);
});

test('docs cũ hoặc chưa xác minh không được hiện như hiện hành dù HTTP 200', async () => {
  const { server } = standard({ 'docs/index.md': 'nội dung cũ' }, { docsState: 'stale' });
  mount(await harness(server));
  await until(has('nội dung cũ'), 'page');
  const meta = screen.getByLabelText('Thông tin phiên bản tài liệu').textContent ?? '';
  assert.match(meta, /Đã cũ/);
  assert.doesNotMatch(meta, /Hiện hành/);
  assert.match(screen.getByRole('alert').textContent ?? '', /cũ/);
});

test('chưa biết docsState thì ghi "Chưa xác định", không suy ra hiện hành', async () => {
  const { server } = standard(
    { 'docs/index.md': 'a' },
    {
      extra: (url) => (url.pathname === `/v2/projects/${projectA}` ? apiError(500, 'X', 'lỗi') : undefined),
    },
  );
  mount(await harness(server));
  await until(has('Chưa xác định'), 'unknown');
  assert.doesNotMatch(screen.getByLabelText('Thông tin phiên bản tài liệu').textContent ?? '', /Hiện hành/);
});

test('HTML thô không được dựng; javascript:/data: bị chặn; liên kết ngoài noopener; ảnh từ xa không tải', async () => {
  const text = [
    '<script>window.pwned = 1</script>',
    '<img src="https://evil.example/x.png" onerror="window.pwned=2">',
    '[bấm](javascript:alert(1)) [dữ liệu](data:text/html,x) [ngoài](https://example.com/a)',
    '![ảnh xa](https://evil.example/track.png)',
    '![ảnh trong](./a.png)',
  ].join('\n\n');
  const { server } = standard({ 'docs/index.md': text });
  mount(await harness(server));
  await until(has('ngoài'), 'page');
  const article = screen.getByRole('article');
  assert.equal(article.querySelector('script'), null);
  assert.equal(article.querySelector('img'), null);
  assert.equal(article.querySelector('[onerror]'), null);
  assert.equal((globalThis as { pwned?: number }).pwned, undefined);
  assert.equal(article.querySelector('a[href^="javascript:"]'), null);
  assert.equal(article.querySelector('a[href^="data:"]'), null);
  const external = within(article).getByRole('link', { name: 'ngoài' });
  assert.equal(external.getAttribute('href'), 'https://example.com/a');
  assert.equal(external.getAttribute('target'), '_blank');
  assert.match(external.getAttribute('rel') ?? '', /noopener/);
  assert.match(external.getAttribute('rel') ?? '', /noreferrer/);
  assert.match(article.textContent ?? '', /bấm.*không được phép/);
  assert.match(article.textContent ?? '', /ảnh xa/);
  assert.match(article.textContent ?? '', /Ảnh không tự tải/);
});

test('liên kết nội bộ đi tới đúng trang, ghim snapshot của cây; trang thiếu bị chặn có lý do', async () => {
  const { server, requests } = standard({
    'docs/index.md':
      '[đăng nhập](flows/%C4%91%C4%83ng-nh%E1%BA%ADp.md#Mục) [thiếu](nope.md) [ngoài root](../../x.md)',
    'docs/flows/đăng-nhập.md': 'Trang đăng nhập',
  });
  const mounted = mount(await harness(server));
  await until(has('thiếu'), 'page');
  const article = screen.getByRole('article');
  assert.equal(within(article).queryByRole('link', { name: 'thiếu' }), null);
  assert.match(article.textContent ?? '', /thiếu.*không có trong/);
  assert.match(article.textContent ?? '', /ngoài root.*ngoài thư mục gốc/);
  await act(async () => {
    fireEvent.click(within(article).getByRole('link', { name: 'đăng nhập' }));
  });
  await until(has('Trang đăng nhập'), 'target');
  assert.deepEqual(mounted.navigations, ['docs/flows/đăng-nhập.md']);
  const pageRequests = requests.filter((url) => url.includes('/docs/page'));
  assert.ok(pageRequests.every((url) => url.includes(`snapshotId=${snapA}`)));
  assert.ok(pageRequests.some((url) => url.includes('path=docs%2Fflows%2F%C4%91')));
});

test('UTF-8 không hợp lệ (422) hiện lỗi rõ và không hiện nội dung cũ', async () => {
  const { server } = standard(
    { 'docs/index.md': 'trang tốt' },
    {
      extra: (url) =>
        url.searchParams.get('path') === 'docs/plan.md'
          ? apiError(422, 'DOCS_ENCODING_INVALID', 'Trang không phải UTF-8 hợp lệ')
          : undefined,
    },
  );
  mount(await harness(server), projectA, 'docs/plan.md');
  await until(has('UTF-8'), 'error');
  assert.match(screen.getByRole('alert').textContent ?? '', /UTF-8/);
  assert.doesNotMatch(document.body.textContent ?? '', /trang tốt/);
});

test('dự án chưa có tài liệu hiện trạng thái rỗng rõ ràng', async () => {
  const { server } = docsServer((url) =>
    url.pathname.endsWith('/docs/tree')
      ? apiError(404, 'NOT_FOUND', 'Không tìm thấy tài liệu')
      : new Response('', { status: 599 }),
  );
  mount(await harness(server));
  await until(has('chưa có tài liệu'), 'empty');
});

test('đổi dự án hủy GET cũ và không bao giờ hiện chữ của dự án cũ dưới commit mới', async () => {
  let releaseA: () => void = () => undefined;
  const abortedA: boolean[] = [];
  let startedA = false;
  const { server } = docsServer(async (url, signal) => {
    if (url.pathname === `/v2/projects/${projectA}/docs/tree`) return json(tree(projectA, snapA));
    if (url.pathname === `/v2/projects/${projectB}/docs/tree`)
      return json(
        tree(projectB, snapB, { sourceCommit: 'ffff000', pages: [pageRow('docs/index.md', 'B', null)] }),
      );
    if (url.pathname.startsWith('/v2/projects/') && url.pathname.split('/').length === 4)
      return json(project(url.pathname.split('/')[3] ?? '', 'current'));
    if (url.pathname === `/v2/projects/${projectA}/docs/page`) {
      startedA = true;
      await new Promise<void>((resolve) => {
        releaseA = resolve;
        signal?.addEventListener('abort', () => {
          abortedA.push(true);
          resolve();
        });
      });
      return json(pageBody(projectA, snapA, 'docs/index.md', 'CHỮ CỦA DỰ ÁN A'));
    }
    if (url.pathname === `/v2/projects/${projectB}/docs/page`)
      return json(pageBody(projectB, snapB, 'docs/index.md', 'chữ của dự án B', { sourceCommit: 'ffff000' }));
    return new Response('', { status: 599 });
  });
  const mounted = mount(await harness(server));
  await until(() => startedA, 'page A requested');
  await act(async () => mounted.setProject(projectB));
  await until(has('chữ của dự án B'), 'B');
  releaseA();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  assert.doesNotMatch(document.body.textContent ?? '', /CHỮ CỦA DỰ ÁN A/);
  assert.match(screen.getByLabelText('Thông tin phiên bản tài liệu').textContent ?? '', /ffff000/);
  assert.ok(abortedA.length >= 1, 'GET của dự án cũ phải bị hủy');
});

test('tìm kiếm Unicode ghim project+snapshot, phân trang bằng cursor mờ và mở đúng trang', async () => {
  const hit = (path: string, title: string) => ({
    snapshotId: snapA,
    projectId: projectA,
    path,
    title,
    snippet: 'đoạn <b>trích</b> khớp',
    sha256: 'e'.repeat(64),
    sourceCommit: 'abc1234def',
    auditState: 'verified',
    contentClass: 'implemented',
    score: 1,
    relatedTicketIds: [],
  });
  const { server, requests } = standard(
    { 'docs/index.md': 'trang chủ', 'docs/flows/đăng-nhập.md': 'Nội dung đăng nhập' },
    {
      extra: (url) => {
        if (url.pathname !== '/v2/docs/search') return undefined;
        return url.searchParams.get('after') === 'Y3Vyc29y'
          ? json({ items: [hit('docs/plan.md', 'Kế hoạch')], nextCursor: null })
          : json({ items: [hit('docs/flows/đăng-nhập.md', 'Đăng nhập')], nextCursor: 'Y3Vyc29y' });
      },
    },
  );
  const mounted = mount(await harness(server));
  await until(has('trang chủ'), 'page');
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Tìm trong tài liệu'), { target: { value: 'đăng nhập' } });
    fireEvent.submit(document.querySelector('search form') as HTMLFormElement);
  });
  await until(has('đoạn'), 'hits');
  const search = requests.find((url) => url.startsWith('/v2/docs/search')) ?? '';
  const params = new URL(search, 'http://x').searchParams;
  assert.equal(params.get('q'), 'đăng nhập');
  assert.equal(params.get('projectId'), projectA);
  assert.equal(params.get('snapshotId'), snapA);
  assert.match(document.body.textContent ?? '', /đoạn <b>trích<\/b> khớp/);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Tải thêm kết quả' }));
  });
  await until(() => screen.queryByRole('button', { name: /Kế hoạch .*docs\/plan\.md/ }) !== null, 'page2');
  assert.equal(screen.queryByRole('button', { name: 'Tải thêm kết quả' }), null);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Đăng nhập .*docs\/flows/ }));
  });
  assert.deepEqual(mounted.navigations.at(-1), 'docs/flows/đăng-nhập.md');
});

test('ticket liên quan hiện đúng danh sách máy chủ trả về, nói rõ giới hạn 20 và mở bằng callback', async () => {
  const ids = Array.from(
    { length: 20 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  );
  const { server } = standard(
    { 'docs/index.md': 'a' },
    { pageExtra: { relatedTicketIds: [ticket1, ...ids.slice(1)] } },
  );
  const mounted = mount(await harness(server));
  await until(has('Ticket liên quan'), 'related');
  assert.match(document.body.textContent ?? '', /giới hạn 20/);
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: /Mở ticket/ })[0] as HTMLElement);
  });
  assert.deepEqual(mounted.tickets, [ticket1]);
});

test('sau event docs.imported, docsState được đọc lại và không còn hiện "Hiện hành" từ cache cũ', async () => {
  let state = 'current';
  const { server } = standard(
    { 'docs/index.md': 'trang' },
    {
      extra: (url) =>
        url.pathname === `/v2/projects/${projectA}` ? json(project(projectA, state)) : undefined,
    },
  );
  const mounted = mount(await harness(server));
  await until(has('Hiện hành'), 'current');
  state = 'unverified';
  await act(async () => {
    await Promise.all(
      invalidations({
        cursor: '9',
        type: 'docs.imported',
        projectId: null,
        ticketId: null,
        audienceMachineId: null,
        occurredAt: '2026-10-04T05:30:00.000Z',
        data: {},
      }).map((queryKey) => mounted.queryClient.invalidateQueries({ queryKey })),
    );
  });
  await until(() => !(document.body.textContent ?? '').includes('Hiện hành'), 'refetched');
  assert.match(screen.getByLabelText('Thông tin phiên bản tài liệu').textContent ?? '', /Chưa xác minh/);
});

test('lỗi trang (422) vẫn hiện commit, kiểm tra, trạng thái tài liệu và loại nội dung của cây', async () => {
  const { server } = standard(
    { 'docs/index.md': 'x' },
    {
      docsState: 'stale',
      extra: (url) =>
        url.searchParams.get('path') === 'docs/plan.md'
          ? apiError(422, 'DOCS_ENCODING_INVALID', 'Trang không phải UTF-8 hợp lệ')
          : undefined,
    },
  );
  mount(await harness(server), projectA, 'docs/plan.md');
  await until(has('UTF-8'), 'error');
  const meta = screen.getByLabelText('Thông tin phiên bản tài liệu').textContent ?? '';
  assert.match(meta, /abc1234def/);
  assert.match(meta, /Đã xác minh/);
  assert.match(meta, /Đã cũ/);
  assert.match(meta, /Thiết kế\/kế hoạch/);
});

test('docs cũ và trang chưa xác minh: cả hai cảnh báo cùng hiện', async () => {
  const { server } = standard(
    { 'docs/index.md': 'x' },
    { docsState: 'stale', pageExtra: { auditState: 'invalid' } },
  );
  mount(await harness(server));
  await until(has('Đã cũ'), 'warn');
  const alert = screen.getByRole('alert').textContent ?? '';
  assert.match(alert, /đã cũ/);
  assert.match(alert, /không hợp lệ/);
});

test('404 của cây: "không có dự án" khác "chưa có tài liệu"', async () => {
  const { server } = docsServer((url) =>
    url.pathname.endsWith('/docs/tree')
      ? apiError(404, 'NOT_FOUND', 'Không tìm thấy dự án')
      : new Response('', { status: 599 }),
  );
  mount(await harness(server));
  await until(has('Không tìm thấy dự án'), 'no project');
  assert.doesNotMatch(document.body.textContent ?? '', /chưa có tài liệu/);
});
