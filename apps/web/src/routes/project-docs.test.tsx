import type { DocsPageSummary, FlowsManifest, Project } from '@crew/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ticket } from '../test/fixtures';
import { type MockCall, mockFetch, renderWithApp } from '../test/render';
import { viewport } from '../test/setup';
import { ProjectDocsPage } from './project-docs';

const PID = '00000000-0000-4000-8000-0000000000a1';
const SHA = '7b02d1f9c0e4a1b2c3d4e5f60718293a4b5c6d7e';
const SNAPSHOT = { commit: SHA, branch: 'main', syncedAt: '2026-09-28T06:40:00.000Z' };

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: PID,
    key: 'SHOP',
    name: 'Shop API',
    description: '',
    repoUrl: 'https://github.com/2p/shop-api.git',
    defaultBranch: 'main',
    ownerMachineId: null,
    docsStatus: 'ready',
    platform: 'web',
    uiTestMcp: { maestro: 'maestro', playwright: 'playwright' },
    maxChildrenPerTicket: 8,
    ticketTreeBudgetUsd: null,
    dailyBudgetUsd: null,
    bmadProfile: null,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

const manifest: FlowsManifest = {
  version: 1,
  source: { include: ['src/**'], exclude: [] },
  flows: {
    payments: {
      title: 'Thanh toán',
      doc: 'docs/flows/payments.md',
      entrypoints: ['src/payment-routes.ts'],
      files: ['src/payment-service.ts'],
      tests: ['test/webhook.test.ts'],
    },
    auth: { title: 'Auth & session', doc: 'docs/flows/auth.md', entrypoints: [], files: [], tests: [] },
  },
  shared: { 'src/db.ts': ['payments', 'auth'] },
  unassigned: [{ path: 'src/legacy.ts', reason: 'Mã cũ, sắp xóa' }],
};

const summaries: DocsPageSummary[] = [
  { path: 'AGENTS.md', title: 'Hướng dẫn agent', kind: 'agents', flowId: null },
  { path: 'docs/architecture.md', title: 'Kiến trúc', kind: 'architecture', flowId: null },
  { path: 'docs/files.md', title: 'Tra cứu file', kind: 'files', flowId: null },
  { path: 'docs/flows.yaml', title: 'flows.yaml', kind: 'other', flowId: null },
  { path: 'docs/flows/auth.md', title: 'Auth & session', kind: 'flow', flowId: 'auth' },
  { path: 'docs/flows/payments.md', title: 'Thanh toán', kind: 'flow', flowId: 'payments' },
  { path: 'docs/index.md', title: 'Tổng quan', kind: 'index', flowId: null },
];

const CONTENT: Record<string, string> = {
  'docs/index.md': [
    '# Shop API',
    '',
    'Xem [kiến trúc](architecture.md), [thanh toán](flows/payments.md), [mã](../src/app.ts) và [Google](https://google.com).',
    '',
    '<img src=x onerror="alert(1)">',
    '',
    '[xấu](javascript:alert(1))',
    '',
    '## Mục đích',
    '',
    'Đoạn [lên đầu](#mục-đích).',
    '',
    '### Chi tiết',
    '',
    '## Mục đích',
  ].join('\n'),
  'docs/flows/payments.md':
    '# Thanh toán\n\n## Mục đích\n\nTạo payment intent.\n\n## Các bước\n\n1. Nhận request.',
  'docs/files.md':
    '# Tra cứu file\n\n## Bảng file\n\n| Đường dẫn | Flow |\n| --- | --- |\n| src/db.ts | shared |',
  'docs/flows.yaml': 'version: 1\nflows: {}\n',
};

interface Setup {
  project?: Project;
  snapshot?: typeof SNAPSHOT | null;
  tickets?: ReturnType<typeof ticket>[];
}

function setup({ project: p = project(), snapshot = SNAPSHOT, tickets = [] }: Setup = {}): MockCall[] {
  return mockFetch([
    [
      `GET /v1/projects/${PID}/docs/page`,
      (call) => {
        const path = new URL(call.path, 'http://x').searchParams.get('path') ?? '';
        const summary = summaries.find((s) => s.path === path);
        if (!summary || !snapshot)
          return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
        return { body: { snapshot, page: { ...summary, content: CONTENT[path] ?? `# ${summary.title}\n` } } };
      },
    ],
    [
      `GET /v1/projects/${PID}/docs/search`,
      () => ({
        body: {
          items: [{ ...summaries[5], snippet: '…Tạo payment intent cho đơn hàng…' }],
        },
      }),
    ],
    [
      `GET /v1/projects/${PID}/docs`,
      () => ({
        body: snapshot
          ? { snapshot, pages: summaries, manifest }
          : { snapshot: null, pages: [], manifest: null },
      }),
    ],
    ['GET /v1/projects', () => ({ body: { items: [p] } })],
    ['GET /v1/tickets', () => ({ body: { items: tickets, nextCursor: null } })],
  ]);
}

describe('ProjectDocsPage', () => {
  it('shows the docs status before the first sync', async () => {
    setup({ project: project({ docsStatus: 'initializing' }), snapshot: null });
    renderWithApp(<ProjectDocsPage projectKey="SHOP" search={{ flow: 'payments' }} />);
    expect(await screen.findByText(/chưa có dữ liệu đồng bộ/)).toHaveTextContent(
      'Trạng thái docs: đang khởi tạo.',
    );
    expect(screen.getByText('Trang được yêu cầu: flow payments')).toBeInTheDocument();
  });

  it('builds the page tree in order and groups flows and other pages', async () => {
    setup();
    const user = userEvent.setup();
    renderWithApp(<ProjectDocsPage projectKey="SHOP" search={{}} />);
    const tree = await screen.findByRole('navigation', { name: 'Cây trang docs' });
    const entries = within(tree)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(entries).toEqual([
      'Tổng quan',
      'Kiến trúc',
      'Auth & session',
      'Thanh toán',
      'Tra cứu file',
      'Hướng dẫn agent',
      'flows.yaml',
    ]);
    expect(within(tree).getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('aria-current', 'page');
    expect(within(tree).getByRole('link', { name: 'Thanh toán' })).toHaveAttribute(
      'href',
      '/projects/SHOP/docs?flow=payments',
    );
    const flows = within(tree).getByRole('button', { name: 'Flows (2)' });
    await user.click(flows);
    expect(flows).toHaveAttribute('aria-expanded', 'false');
    expect(within(tree).queryByRole('link', { name: 'Thanh toán' })).not.toBeInTheDocument();
    expect(within(tree).getByRole('button', { name: 'Khác' })).toBeInTheDocument();
    expect(screen.getByText('Docs chỉ đọc. Sửa bằng commit trong repo.')).toBeInTheDocument();
  });

  it('renders the home page sanitised, with heading anchors the TOC links to and in-app relative links', async () => {
    setup();
    renderWithApp(<ProjectDocsPage projectKey="SHOP" search={{}} />);
    const article = await screen.findByRole('article', { name: 'Tổng quan' });
    await within(article).findByRole('heading', { level: 3, name: 'Chi tiết' });

    // No raw HTML and no javascript: URL survives.
    expect(article.querySelector('img')).toBeNull();
    expect(article.innerHTML).not.toContain('onerror');
    expect(within(article).getByText('xấu').closest('a')?.getAttribute('href') ?? '').not.toMatch(
      /javascript/i,
    );

    // Relative docs links stay in the space; other repo paths go to GitHub; external links open a new tab.
    expect(within(article).getByRole('link', { name: 'kiến trúc' })).toHaveAttribute(
      'href',
      '/projects/SHOP/docs?path=docs%2Farchitecture.md',
    );
    expect(within(article).getByRole('link', { name: 'thanh toán' })).toHaveAttribute(
      'href',
      '/projects/SHOP/docs?flow=payments',
    );
    expect(within(article).getByRole('link', { name: 'thanh toán' })).not.toHaveAttribute('target');
    expect(within(article).getByRole('link', { name: 'mã' })).toHaveAttribute(
      'href',
      `https://github.com/2p/shop-api/blob/${SHA}/src/app.ts`,
    );
    const google = within(article).getByRole('link', { name: 'Google' });
    expect(google).toHaveAttribute('target', '_blank');
    expect(google).toHaveAttribute('rel', expect.stringContaining('noopener'));

    // Every TOC entry points at a heading id of the page (duplicates get a suffix), h2 and h3 only.
    const toc = screen.getByRole('navigation', { name: 'Mục lục' });
    await waitFor(() => expect(within(toc).getAllByRole('link')).toHaveLength(3));
    const ids = [...article.querySelectorAll('h2, h3')].map((h) => h.id);
    const targets = within(toc)
      .getAllByRole('link')
      .map((link) => decodeURIComponent(link.getAttribute('href')?.slice(1) ?? ''));
    expect(targets).toEqual(ids);
    expect(ids).toEqual(['mục-đích', 'chi-tiết', 'mục-đích-1']);
    expect(ids.every((id) => !id.startsWith('user-content-'))).toBe(true);
    // The in-page anchor uses the same slug.
    const anchor = within(article).getByRole('link', { name: 'lên đầu' }).getAttribute('href') ?? '';
    expect(decodeURIComponent(anchor)).toBe('#mục-đích');

    // The page title comes from the header, not a second h1 from the markdown.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/Cập nhật ở commit/)).toHaveTextContent(
      'Cập nhật ở commit 7b02d1f lúc 28/09 13:40',
    );
    expect(screen.getByRole('link', { name: /Xem trên GitHub/ })).toHaveAttribute(
      'href',
      `https://github.com/2p/shop-api/blob/${SHA}/docs/index.md`,
    );
  });

  it('shows a flow page with its files table, GitHub links and related tickets', async () => {
    const calls = setup({
      tickets: [
        ticket({ key: 'SHOP-9', title: 'Tách service thanh toán', status: 'in_progress' }),
        ticket({ key: 'SHOP-11', title: 'Bug webhook 500', status: 'blocked' }),
      ],
    });
    renderWithApp(<ProjectDocsPage projectKey="SHOP" search={{ flow: 'payments' }} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Thanh toán' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'Shop API/Flows/Thanh toán',
    );

    const files = screen.getByRole('region', { name: 'File của flow' });
    const rows = within(files).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'src/payment-routes.tsĐiểm vào',
      'src/payment-service.tsFile',
      'test/webhook.test.tsTest',
      'src/db.tsDùng chung',
    ]);
    expect(within(files).getByRole('link', { name: 'src/payment-service.ts' })).toHaveAttribute(
      'href',
      `https://github.com/2p/shop-api/blob/${SHA}/src/payment-service.ts`,
    );

    const related = screen.getByRole('region', { name: 'Ticket liên quan' });
    expect(await within(related).findByRole('link', { name: /SHOP-9/ })).toHaveAttribute(
      'href',
      '/tickets/SHOP-9',
    );
    expect(within(related).getByText('Bị chặn')).toBeInTheDocument();
    const query = calls.find((c) => c.path.startsWith('/v1/tickets'))?.path ?? '';
    expect(query).toContain(`projectId=${PID}`);
    expect(query).toContain('flow=payments');
    expect(query).toContain('limit=10');
  });

  it('gives no GitHub links when the repo is an ssh remote', async () => {
    setup({ project: project({ repoUrl: 'git@github.com:2p/shop-api.git' }) });
    renderWithApp(<ProjectDocsPage projectKey="SHOP" search={{ flow: 'payments' }} />);
    const files = await screen.findByRole('region', { name: 'File của flow' });
    expect(within(files).queryAllByRole('link')).toHaveLength(0);
    expect(within(files).getByText('src/payment-service.ts')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Xem trên GitHub/ })).not.toBeInTheDocument();
  });

  it('looks up the flows that own a file on "Tra cứu file"', async () => {
    setup();
    const user = userEvent.setup();
    renderWithApp(<ProjectDocsPage projectKey="SHOP" search={{ path: 'docs/files.md' }} />);
    const input = await screen.findByRole('combobox', { name: 'Tra cứu file theo đường dẫn' });
    const lookup = screen.getByRole('region', { name: 'Tra cứu file theo đường dẫn' });

    await user.type(input, './src/db.ts');
    const owners = within(lookup).getByRole('list', { name: 'Flow sở hữu file' });
    expect(
      within(owners)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Thanh toánpaymentsDùng chung', 'Auth & sessionauthDùng chung']);
    expect(within(owners).getByRole('link', { name: 'Thanh toán' })).toHaveAttribute(
      'href',
      '/projects/SHOP/docs?flow=payments',
    );

    await user.clear(input);
    await user.type(input, 'src/legacy.ts');
    expect(lookup).toHaveTextContent(
      'src/legacy.ts không thuộc flow nào (ngoại lệ trong manifest): Mã cũ, sắp xóa',
    );

    await user.clear(input);
    await user.type(input, 'src/unknown.ts');
    expect(lookup).toHaveTextContent('src/unknown.ts không thuộc flow nào.');

    // The rendered files.md table sits in its own scroll box.
    const article = screen.getByRole('article', { name: 'Tra cứu file' });
    expect(article.querySelector('.docs-prose table')?.parentElement).toHaveClass('docs-scroll');
  });

  it('renders flows.yaml as a code block and an unknown flow as not found', async () => {
    setup();
    const { unmount } = renderWithApp(
      <ProjectDocsPage projectKey="SHOP" search={{ path: 'docs/flows.yaml' }} />,
    );
    const article = await screen.findByRole('article', { name: 'flows.yaml' });
    expect(article.querySelector('pre code')).toHaveTextContent('version: 1');
    unmount();

    renderWithApp(<ProjectDocsPage projectKey="SHOP" search={{ flow: 'refunds' }} />);
    expect(await screen.findByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument();
    expect(screen.getByText(/không có trong docs\/flows.yaml/)).toHaveTextContent('Flow refunds');
    expect(screen.getByRole('link', { name: 'Về Tổng quan' })).toHaveAttribute('href', '/projects/SHOP/docs');
  });

  it('searches the space and links results to their page', async () => {
    setup();
    const user = userEvent.setup();
    renderWithApp(<ProjectDocsPage projectKey="SHOP" search={{}} />);
    await user.type(await screen.findByLabelText('Tìm trong space'), 'payment');
    const results = await screen.findByRole('list', { name: 'Kết quả tìm trong space' });
    const hit = within(results).getByRole('link', { name: /Thanh toán/ });
    expect(hit).toHaveTextContent('…Tạo payment intent cho đơn hàng…');
    expect(hit).toHaveAttribute('href', '/projects/SHOP/docs?flow=payments');
  });

  it('moves the page tree into a drawer and collapses the TOC on phones', async () => {
    viewport.width = 390;
    setup();
    const user = userEvent.setup();
    renderWithApp(<ProjectDocsPage projectKey="SHOP" search={{}} />);
    await screen.findByRole('article', { name: 'Tổng quan' });
    expect(screen.queryByRole('navigation', { name: 'Cây trang docs' })).not.toBeInTheDocument();
    expect(screen.getByText('Trên trang này').closest('details')).not.toHaveAttribute('open');
    await user.click(screen.getByRole('button', { name: 'Trang docs' }));
    const drawer = screen.getByRole('dialog', { name: 'Trang docs' });
    expect(within(drawer).getByRole('navigation', { name: 'Cây trang docs' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Đóng trang docs' }));
    expect(screen.queryByRole('dialog', { name: 'Trang docs' })).not.toBeInTheDocument();
  });
});
