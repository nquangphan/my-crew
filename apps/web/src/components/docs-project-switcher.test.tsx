import type { DocsPageSummary, FlowsManifest, Project } from '@crew/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectDocsPage } from '../routes/project-docs';
import { project } from '../test/fixtures';
import { type MockCall, mockFetch, renderWithApp } from '../test/render';
import { viewport } from '../test/setup';
import { switchTarget } from './docs-project-switcher';

const SNAPSHOT = {
  commit: '7b02d1f9c0e4a1b2c3d4e5f60718293a4b5c6d7e',
  branch: 'main',
  syncedAt: '2026-09-28T06:40:00.000Z',
};
const manifest: FlowsManifest = {
  version: 1,
  source: { include: ['src/**'], exclude: [] },
  flows: {},
  shared: {},
  unassigned: [],
};
const page = (path: string, title: string, kind: DocsPageSummary['kind'] = 'other'): DocsPageSummary => ({
  path,
  title,
  kind,
  flowId: null,
});

const shop = project({ key: 'SHOP', name: 'Shop API' });
const admin = project({ key: 'ADMIN', name: 'Admin' });
const note = project({ key: 'NOTE', name: 'Note', docsStatus: 'unknown' });
const PAGES: Record<string, DocsPageSummary[]> = {
  [shop.id]: [
    page('docs/index.md', 'Tổng quan', 'index'),
    page('docs/architecture.md', 'Kiến trúc', 'architecture'),
    page('docs/guides/shop-only.md', 'Chỉ có ở Shop'),
  ],
  [admin.id]: [
    page('docs/index.md', 'Tổng quan', 'index'),
    page('docs/architecture.md', 'Kiến trúc', 'architecture'),
  ],
};

function setup(): MockCall[] {
  const overview = [shop, admin, note].map((p) => ({
    projectId: p.id,
    docsStatus: p.docsStatus,
    snapshot: PAGES[p.id] ? SNAPSHOT : null,
    fileCount: PAGES[p.id]?.length ?? 0,
    docsInit: null,
  }));
  return mockFetch([
    [
      'GET /v1/docs/search',
      () => ({
        body: {
          items: [
            {
              ...page('docs/index.md', 'Tổng quan', 'index'),
              projectId: shop.id,
              snippet: 'Shop thanh toán',
            },
            {
              ...page('docs/index.md', 'Tổng quan', 'index'),
              projectId: admin.id,
              snippet: 'Admin thanh toán',
            },
          ],
        },
      }),
    ],
    ['GET /v1/docs', () => ({ body: { items: overview } })],
    [
      'GET /v1/projects/',
      (call) => {
        const url = new URL(call.path, 'http://x');
        const [, , , id, , sub] = url.pathname.split('/');
        const pages = PAGES[id ?? ''];
        if (sub === 'search') {
          return { body: { items: [{ ...page('docs/index.md', 'Tổng quan', 'index'), snippet: 'Shop' }] } };
        }
        if (sub === 'page') {
          const path = url.searchParams.get('path') ?? '';
          const found = pages?.find((p) => p.path === path);
          if (!found) return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
          return { body: { snapshot: SNAPSHOT, page: { ...found, content: `# ${found.title}\n` } } };
        }
        return {
          body: pages
            ? { snapshot: SNAPSHOT, pages, manifest }
            : { snapshot: null, pages: [], manifest: null },
        };
      },
    ],
    ['GET /v1/projects', () => ({ body: { items: [shop, admin, note] } })],
    ['GET /v1/tickets', () => ({ body: { items: [], nextCursor: null } })],
  ]);
}

afterEach(() => {
  viewport.width = 1440;
});

describe('switchTarget', () => {
  const target: Project = admin;
  it('keeps the page when the other project has it, else opens its space home', async () => {
    const load = async () => [
      page('docs/architecture.md', 'Kiến trúc'),
      { path: 'docs/flows/a.md', flowId: 'a' },
    ];
    expect(await switchTarget(load, target, 'docs/architecture.md')).toMatchObject({
      params: { projectKey: 'ADMIN' },
      search: { path: 'docs/architecture.md' },
    });
    expect(await switchTarget(load, target, 'docs/flows/a.md')).toMatchObject({ search: { flow: 'a' } });
    expect(await switchTarget(load, target, 'docs/missing.md')).toMatchObject({ search: {} });
    expect(await switchTarget(load, target, null)).toMatchObject({ search: {} });
    const failing = async () => {
      throw new Error('offline');
    };
    expect(await switchTarget(failing, target, 'docs/architecture.md')).toMatchObject({
      params: { projectKey: 'ADMIN' },
      search: {},
    });
  });
});

describe('DocsProjectSwitcher in the docs space', () => {
  it('lists every project with its docs state and keeps the open page when switching', async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderWithApp(
      <ProjectDocsPage projectKey="SHOP" search={{ path: 'docs/architecture.md' }} />,
    );
    await screen.findByRole('article', { name: 'Kiến trúc' });
    await user.click(screen.getByRole('button', { name: 'Đổi dự án docs (đang xem SHOP)' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Tất cả dự án/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(within(menu).getByRole('menuitem', { name: /NOTE/ })).toHaveTextContent('chưa có docs'),
    );
    expect(within(menu).getByRole('menuitem', { name: /ADMIN/ })).toHaveTextContent('2 file');

    await user.click(within(menu).getByRole('menuitem', { name: /ADMIN/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/ADMIN/docs'));
    expect(router.state.location.search).toEqual({ path: 'docs/architecture.md' });
  });

  it('opens the other project home when it lacks the page, and the docs home from "Tất cả dự án"', async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderWithApp(
      <ProjectDocsPage projectKey="SHOP" search={{ path: 'docs/guides/shop-only.md' }} />,
    );
    await screen.findByRole('article', { name: 'Chỉ có ở Shop' });
    await user.click(screen.getByRole('button', { name: 'Đổi dự án docs (đang xem SHOP)' }));
    await user.click(await screen.findByRole('menuitem', { name: /ADMIN/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/ADMIN/docs'));
    expect(router.state.location.search).toEqual({});

    await user.click(await screen.findByRole('button', { name: 'Đổi dự án docs (đang xem SHOP)' }));
    await user.click(await screen.findByRole('menuitem', { name: /Tất cả dự án/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/docs'));
  });

  it('is in the phone header, and on an empty space', async () => {
    viewport.width = 390;
    setup();
    const user = userEvent.setup();
    const { router, unmount } = renderWithApp(<ProjectDocsPage projectKey="SHOP" search={{}} />);
    await screen.findByRole('article', { name: 'Tổng quan' });
    // The drawer is closed: the switcher sits in the space header.
    expect(screen.queryByRole('navigation', { name: 'Cây trang docs' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Đổi dự án docs (đang xem SHOP)' }));
    await user.click(await screen.findByRole('menuitem', { name: /ADMIN/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/ADMIN/docs'));
    unmount();

    renderWithApp(<ProjectDocsPage projectKey="NOTE" search={{}} />);
    expect(await screen.findByText(/chưa có dữ liệu đồng bộ/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đổi dự án docs (đang xem NOTE)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem docs của các dự án khác' })).toHaveAttribute(
      'href',
      '/docs',
    );
  });
});

describe('space search scope', () => {
  it('searches this project by default and every project with "Mọi dự án", with project badges', async () => {
    const calls = setup();
    const user = userEvent.setup();
    renderWithApp(<ProjectDocsPage projectKey="SHOP" search={{}} />);
    await screen.findByRole('article', { name: 'Tổng quan' });
    const scope = screen.getByRole('group', { name: 'Phạm vi tìm kiếm docs' });
    expect(within(scope).getByRole('button', { name: 'Dự án này' })).toHaveAttribute('aria-pressed', 'true');

    await user.type(screen.getByRole('textbox', { name: 'Tìm trong space' }), 'thanh toán');
    const own = await screen.findByRole('list', { name: 'Kết quả tìm trong space' });
    expect(within(own).getAllByRole('link')).toHaveLength(1);
    expect(own.querySelector('[data-project]')).toBeNull();
    expect(calls.some((c) => c.path.startsWith(`/v1/projects/${shop.id}/docs/search`))).toBe(true);

    await user.click(within(scope).getByRole('button', { name: 'Mọi dự án' }));
    const across = await screen.findByRole('list', { name: 'Kết quả tìm trong mọi dự án' });
    const links = within(across).getAllByRole('link');
    expect(links.map((link) => link.querySelector('[data-project]')?.getAttribute('data-project'))).toEqual([
      'SHOP',
      'ADMIN',
    ]);
    expect(links[1]).toHaveAttribute('href', '/projects/ADMIN/docs?path=docs%2Findex.md');
    expect(calls.some((c) => c.path.startsWith('/v1/docs/search?'))).toBe(true);
  });
});
