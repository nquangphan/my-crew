import type { DocsOverviewItem } from '@crew/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { project } from '../test/fixtures';
import { mockFetch, renderWithApp } from '../test/render';
import { DocsHomePage, noDocsReason } from './docs-home';

const SHA = '7b02d1f9c0e4a1b2c3d4e5f60718293a4b5c6d7e';

function scenario() {
  const admin = project({ key: 'KIDYADMIN', name: 'Kidy Admin', ownerMachineId: 'm1' });
  const school = project({ key: 'KIDYSCHOOL', name: 'Kidy School', ownerMachineId: 'm1' });
  const note = project({ key: 'VISINOTE', name: 'Visi Note', docsStatus: 'unknown', ownerMachineId: 'm1' });
  const orphan = project({ key: 'ORPHAN', name: 'Không máy', docsStatus: 'unknown' });
  const ready = (projectId: string, fileCount: number): DocsOverviewItem => ({
    projectId,
    docsStatus: 'ready',
    snapshot: { commit: SHA, branch: 'main', syncedAt: '2026-09-28T06:40:00.000Z' },
    fileCount,
    docsInit: null,
  });
  const overview: DocsOverviewItem[] = [
    ready(admin.id, 90),
    ready(school.id, 24),
    {
      projectId: note.id,
      docsStatus: 'unknown',
      snapshot: null,
      fileCount: 0,
      docsInit: {
        id: '00000000-0000-4000-8000-0000000000d1',
        key: 'VISINOTE-3',
        title: 'Khởi tạo docs',
        status: 'blocked',
        updatedAt: '2026-09-28T06:00:00.000Z',
      },
    },
    { projectId: orphan.id, docsStatus: 'unknown', snapshot: null, fileCount: 0, docsInit: null },
  ];
  return { admin, school, note, orphan, overview };
}

const card = (key: string) => screen.getByRole('listitem', { name: `Docs dự án ${key}` });

describe('DocsHomePage', () => {
  it('lists every project with its docs status, and explains why a project has no docs yet', async () => {
    const s = scenario();
    mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [s.admin, s.school, s.note, s.orphan] } })],
      ['GET /v1/docs', () => ({ body: { items: s.overview } })],
    ]);
    renderWithApp(<DocsHomePage search={{}} />);

    expect(await screen.findByRole('heading', { name: 'Tài liệu · Tất cả dự án' })).toBeInTheDocument();
    await screen.findByText(/90 file/);
    expect(screen.getByText(/2\/4 có docs/)).toBeInTheDocument();

    const admin = card('KIDYADMIN');
    expect(within(admin).getByText(/90 file · commit/)).toHaveTextContent('7b02d1f');
    expect(within(admin).getByRole('link', { name: 'Kidy Admin' })).toHaveAttribute(
      'href',
      '/projects/KIDYADMIN/docs',
    );
    expect(within(admin).getByRole('link', { name: 'Mở docs' })).toBeInTheDocument();
    expect(within(card('KIDYSCHOOL')).getByText(/24 file/)).toBeInTheDocument();

    const note = card('VISINOTE');
    expect(within(note).getByText('Chưa có docs')).toBeInTheDocument();
    expect(within(note).getByText('Khởi tạo docs đang bị chặn.')).toBeInTheDocument();
    expect(within(note).getByRole('link', { name: 'VISINOTE-3' })).toHaveAttribute(
      'href',
      '/tickets/VISINOTE-3',
    );
    expect(within(note).queryByRole('link', { name: 'Mở docs' })).toBeNull();
    expect(within(card('ORPHAN')).getByText(/chưa có máy giữ/)).toBeInTheDocument();
  });

  it('searches the docs of every project, with a project badge on each result', async () => {
    const s = scenario();
    const calls = mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [s.admin, s.school, s.note] } })],
      [
        'GET /v1/docs/search',
        () => ({
          body: {
            items: [
              {
                projectId: s.admin.id,
                path: 'docs/flows/payments.md',
                title: 'Thanh toán',
                kind: 'flow',
                flowId: 'payments',
                snippet: 'Thanh toán học phí',
              },
              {
                projectId: s.school.id,
                path: 'docs/index.md',
                title: 'Tổng quan',
                kind: 'index',
                flowId: null,
                snippet: '… thanh toán qua app',
              },
            ],
          },
        }),
      ],
      ['GET /v1/docs', () => ({ body: { items: s.overview } })],
    ]);
    const user = userEvent.setup();
    const { router } = renderWithApp(<DocsHomePage search={{}} />);
    // The page writes the search text to the URL; start on /docs so the test router keeps the same route.
    await router.navigate({ to: '/docs' });
    await user.type(
      await screen.findByRole('textbox', { name: 'Tìm trong docs của mọi dự án' }),
      'thanh toán',
    );

    const results = await screen.findByRole('list', { name: 'Kết quả tìm docs' });
    const links = within(results).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/projects/KIDYADMIN/docs?flow=payments');
    expect(within(links[0] as HTMLElement).getByText('KIDYADMIN')).toHaveAttribute(
      'data-project',
      'KIDYADMIN',
    );
    expect(links[1]).toHaveAttribute('href', '/projects/KIDYSCHOOL/docs?path=docs%2Findex.md');
    const search = calls.find((c) => c.path.startsWith('/v1/docs/search'));
    expect(new URL(search?.path ?? '', 'http://x').searchParams.get('projectIds')).toBeNull();
  });

  it('narrows the cards and the search to the projects in ?project=', async () => {
    const s = scenario();
    const calls = mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [s.admin, s.school, s.note] } })],
      ['GET /v1/docs/search', () => ({ body: { items: [] } })],
      ['GET /v1/docs', () => ({ body: { items: s.overview } })],
    ]);
    const user = userEvent.setup();
    const { router } = renderWithApp(<DocsHomePage search={{ project: 'KIDYSCHOOL', q: 'app' }} />);

    await screen.findByText(/24 file/);
    expect(screen.queryByRole('listitem', { name: 'Docs dự án KIDYADMIN' })).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.path.startsWith('/v1/docs/search'))).toBe(true));
    const search = calls.find((c) => c.path.startsWith('/v1/docs/search'));
    expect(new URL(search?.path ?? '', 'http://x').searchParams.get('projectIds')).toBe(s.school.id);
    expect(await screen.findByText(/Không có trang nào khớp/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Dự án: 1/ }));
    await user.click(await screen.findByRole('menuitem', { name: /KIDYADMIN/ }));
    expect(router.state.location.search).toMatchObject({ project: 'KIDYSCHOOL,KIDYADMIN' });
  });

  it('words each docs-init state', () => {
    const p = project({ ownerMachineId: 'm1' });
    const withInit = (status: 'todo' | 'in_progress' | 'needs_input' | 'done' | 'cancelled') =>
      noDocsReason(p, {
        projectId: p.id,
        docsStatus: 'unknown',
        snapshot: null,
        fileCount: 0,
        docsInit: { id: 'x', key: 'SHOP-1', title: 'Docs', status, updatedAt: '2026-09-28T00:00:00.000Z' },
      });
    expect(withInit('in_progress')).toBe('Đang khởi tạo docs.');
    expect(withInit('needs_input')).toBe('Khởi tạo docs đang chờ bạn trả lời.');
    expect(withInit('done')).toMatch(/chờ máy giữ dự án đồng bộ/);
    expect(withInit('cancelled')).toMatch(/bị hủy/);
    expect(noDocsReason(p, undefined)).toMatch(/chưa đồng bộ docs/);
  });
});
