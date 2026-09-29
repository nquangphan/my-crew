import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { project } from '../test/fixtures';
import { mockFetch, renderWithApp } from '../test/render';
import { QuickSearch } from './quick-search';

const shop = project({ key: 'SHOP', name: 'Shop' });
const admin = project({ key: 'KIDYADMIN', name: 'Kidy Admin' });

function setup() {
  return mockFetch([
    ['GET /v1/projects', () => ({ body: { items: [shop, admin] } })],
    [
      'GET /v1/search',
      (call) => {
        const onlyAdmin = new URL(call.path, 'http://x').searchParams.get('projectIds') === admin.id;
        const tickets = [
          { id: 't1', key: 'SHOP-4', title: 'Giỏ hàng', type: 'dev', status: 'todo', projectId: shop.id },
          {
            id: 't2',
            key: 'KIDYADMIN-9',
            title: 'Giỏ hàng admin',
            type: 'qc',
            status: 'todo',
            projectId: admin.id,
          },
          {
            id: 't3',
            key: 'AST-1',
            title: 'Giỏ hàng mọi nơi',
            type: 'request',
            status: 'todo',
            projectId: null,
          },
        ];
        return {
          body: {
            tickets: onlyAdmin ? tickets.filter((t) => t.projectId === admin.id) : tickets,
            docs: [{ projectId: admin.id, path: 'docs/index.md', title: 'Giỏ hàng trong docs' }],
          },
        };
      },
    ],
  ]);
}

describe('QuickSearch', () => {
  it('searches every project with a project badge per result, and narrows to one project with the scope chip', async () => {
    const calls = setup();
    const user = userEvent.setup();
    renderWithApp(<QuickSearch variant="inline" />);
    const input = await screen.findByRole('combobox', { name: 'Tìm kiếm' });
    await user.type(input, 'giỏ');

    const list = await screen.findByRole('listbox', { name: 'Kết quả tìm kiếm' });
    await within(list).findByText('Giỏ hàng admin');
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(4);
    const badge = (option: HTMLElement) =>
      option.querySelector('[data-project]')?.getAttribute('data-project');
    expect(options.map((o) => badge(o) ?? null)).toEqual(['SHOP', 'KIDYADMIN', null, 'KIDYADMIN']);
    const first = calls.find((c) => c.path.startsWith('/v1/search'));
    expect(new URL(first?.path ?? '', 'http://x').searchParams.get('projectIds')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Phạm vi tìm kiếm: tất cả dự án' }));
    await user.click(await screen.findByRole('menuitem', { name: /KIDYADMIN/ }));
    expect(screen.getByRole('button', { name: 'Phạm vi tìm kiếm: dự án KIDYADMIN' })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.some((c) => new URL(c.path, 'http://x').searchParams.get('projectIds') === admin.id)).toBe(
        true,
      ),
    );
    await waitFor(() => expect(screen.queryByText('Giỏ hàng mọi nơi')).toBeNull());
    expect(screen.getByText('Giỏ hàng admin')).toBeInTheDocument();
    // Focus is back in the search box, so the owner keeps typing, and the results stay open after the
    // blur's delayed close would have fired.
    await waitFor(() => expect(input).toHaveFocus());
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.getByRole('listbox', { name: 'Kết quả tìm kiếm' })).toBeInTheDocument();
  });
});
