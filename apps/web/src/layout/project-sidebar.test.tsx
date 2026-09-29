import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { project } from '../test/fixtures';
import { mockFetch, renderWithApp } from '../test/render';
import { ProjectSidebar, projectSectionOf } from './project-sidebar';

describe('projectSectionOf', () => {
  it('reads the project page from the path, and falls back to the board', () => {
    expect(projectSectionOf('/projects/SHOP/list')).toBe('list');
    expect(projectSectionOf('/projects/SHOP/docs')).toBe('docs');
    expect(projectSectionOf('/projects/SHOP/settings')).toBe('settings');
    expect(projectSectionOf('/projects/SHOP/board')).toBe('board');
    expect(projectSectionOf('/docs')).toBe('board');
    expect(projectSectionOf('/inbox')).toBe('board');
  });
});

describe('ProjectSidebar', () => {
  it('links "Tài liệu" to the docs home and keeps the open page when switching project', async () => {
    const shop = project({ key: 'SHOP', name: 'Shop' });
    const admin = project({ key: 'KIDYADMIN', name: 'Kidy Admin' });
    mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [shop, admin] } })],
      ['GET /v1/machines', () => ({ body: { items: [] } })],
    ]);
    const user = userEvent.setup();
    const { router } = renderWithApp(<ProjectSidebar mode="full" />);
    await router.navigate({ to: '/projects/$projectKey/list', params: { projectKey: 'SHOP' } });

    expect(await screen.findByRole('link', { name: 'Tài liệu' })).toHaveAttribute('href', '/docs');
    await user.click(await screen.findByRole('button', { name: 'Chọn dự án' }));
    await user.click(await screen.findByRole('menuitem', { name: /KIDYADMIN/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/KIDYADMIN/list'));
  });
});
