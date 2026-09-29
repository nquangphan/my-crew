import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { project, ticket } from '../test/fixtures';
import { mockFetch, renderWithApp } from '../test/render';
import { AllProjectsBoardPage } from './all-board';
import { ListPage } from './list';

/** AST-2 routed to WEB and APP, each pm_task with a child, plus an unrouted request. */
function scenario() {
  const web = project({ key: 'WEB', name: 'Web shop' });
  const app = project({ key: 'APP', name: 'App' });
  const request = ticket({
    key: 'AST-2',
    type: 'request',
    assigneeRole: 'assistant',
    status: 'in_progress',
    title: 'Giỏ hàng mọi nơi',
  });
  const pmWeb = ticket({
    key: 'WEB-1',
    type: 'pm_task',
    assigneeRole: 'pm',
    parentId: request.id,
    projectId: web.id,
    status: 'in_progress',
    title: 'Giỏ hàng web',
  });
  const pmApp = ticket({
    key: 'APP-1',
    type: 'pm_task',
    assigneeRole: 'pm',
    parentId: request.id,
    projectId: app.id,
    status: 'in_progress',
    title: 'Giỏ hàng app',
  });
  const webDev = ticket({ key: 'WEB-2', parentId: pmWeb.id, projectId: web.id, title: 'Nút web' });
  const appDocs = ticket({
    key: 'APP-2',
    type: 'docs_init',
    parentId: pmApp.id,
    projectId: app.id,
    status: 'done',
    title: 'Docs app',
  });
  const lone = ticket({ key: 'AST-3', type: 'request', assigneeRole: 'assistant', title: 'Chưa định tuyến' });
  return { web, app, request, pmWeb, pmApp, webDev, appDocs, lone };
}

const cardOf = (key: string) => {
  const card = document.querySelector<HTMLElement>(`button[data-ticket-key="${key}"]`);
  if (!card) throw new Error(`no card ${key}`);
  return card;
};
const column = (name: RegExp) => screen.getByRole('region', { name });

describe('AllProjectsBoardPage', () => {
  it('shows every project and the requests, in request → pm_task lanes with project badges', async () => {
    const s = scenario();
    const calls = mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [s.app, s.web] } })],
      ['GET /v1/machines', () => ({ body: { items: [] } })],
      [
        'GET /v1/tickets',
        () => ({
          body: { items: [s.request, s.pmWeb, s.pmApp, s.webDev, s.appDocs, s.lone], nextCursor: null },
        }),
      ],
    ]);
    renderWithApp(<AllProjectsBoardPage search={{}} />);

    expect(await screen.findByRole('heading', { name: 'Board · Tất cả dự án' })).toBeInTheDocument();
    await screen.findByText('Giỏ hàng web');
    const list = calls.find((c) => c.path.startsWith('/v1/tickets?'));
    expect(list?.path).not.toContain('projectIds');
    // Cancelled tickets are not fetched for the board.
    expect(new URL(list?.path ?? '', 'http://x').searchParams.get('status')?.split(',')).not.toContain(
      'cancelled',
    );

    const doing = column(/^Đang làm/);
    const lanes = [...doing.querySelectorAll('[data-lane]')].map((el) => el.textContent);
    expect(lanes).toEqual(['AST-2 · Giỏ hàng mọi nơi']);
    for (const key of ['AST-2', 'WEB-1', 'APP-1']) expect(doing).toContainElement(cardOf(key));
    const todo = column(/^Cần làm/);
    expect([...todo.querySelectorAll('[data-lane]')].map((el) => el.textContent)).toEqual([
      'AST-2 · Giỏ hàng mọi nơi',
      '› WEB-1 · Giỏ hàng web',
      'AST-3 · Chưa định tuyến',
    ]);
    expect(within(cardOf('WEB-2')).getByText('WEB', { selector: '[data-project]' })).toBeInTheDocument();
    expect(within(cardOf('APP-2')).getByText('APP', { selector: '[data-project]' })).toBeInTheDocument();
    expect(cardOf('AST-2').querySelector('[data-project]')).toBeNull();
  });

  it('groups by project on request', async () => {
    const s = scenario();
    mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [s.app, s.web] } })],
      ['GET /v1/machines', () => ({ body: { items: [] } })],
      [
        'GET /v1/tickets',
        () => ({ body: { items: [s.request, s.pmWeb, s.pmApp, s.webDev], nextCursor: null } }),
      ],
    ]);
    renderWithApp(<AllProjectsBoardPage search={{ group: 'project' }} />);
    await screen.findByText('Giỏ hàng web');
    expect(screen.getByRole('button', { name: /Nhóm theo: Dự án/ })).toBeInTheDocument();
    const lanes = [...column(/^Đang làm/).querySelectorAll('[data-lane]')].map((el) => el.textContent);
    expect(lanes).toEqual(['Request', 'APP · App', 'WEB · Web shop']);
  });

  it('narrows to the chosen projects on the server and keeps the choice in the URL', async () => {
    const s = scenario();
    const calls = mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [s.app, s.web] } })],
      ['GET /v1/machines', () => ({ body: { items: [] } })],
      ['GET /v1/tickets', () => ({ body: { items: [s.request, s.pmWeb, s.webDev], nextCursor: null } })],
    ]);
    const { router } = renderWithApp(<AllProjectsBoardPage search={{ project: 'WEB' }} />);
    await screen.findByText('Giỏ hàng web');
    const list = calls.find((c) => c.path.startsWith('/v1/tickets?'));
    expect(new URL(list?.path ?? '', 'http://x').searchParams.get('projectIds')).toBe(s.web.id);
    expect(screen.queryByText('Giỏ hàng app')).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Dự án: 1/ }));
    await user.click(await screen.findByRole('menuitem', { name: /APP/ }));
    expect(router.state.location.search).toMatchObject({ project: 'WEB,APP' });
  });
});

describe('ListPage across projects', () => {
  it('lists every project with a project column and filters by project', async () => {
    const s = scenario();
    const calls = mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [s.app, s.web] } })],
      ['GET /v1/machines', () => ({ body: { items: [] } })],
      [
        'GET /v1/tickets',
        () => ({ body: { items: [s.request, s.pmWeb, s.pmApp, s.appDocs], nextCursor: null } }),
      ],
    ]);
    renderWithApp(
      <ListPage projectKey={null} search={{ project: 'APP,WEB', sort: 'project', order: 'asc' }} />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Danh sách ticket · Tất cả dự án' }),
    ).toBeInTheDocument();
    await screen.findByText('Giỏ hàng app');
    const list = calls.find((c) => c.path.startsWith('/v1/tickets?'));
    expect(new URL(list?.path ?? '', 'http://x').searchParams.get('projectIds')?.split(',').sort()).toEqual(
      [s.app.id, s.web.id].sort(),
    );
    expect(screen.getByRole('columnheader', { name: /Dự án/ })).toBeInTheDocument();
    const rows = [...document.querySelectorAll<HTMLElement>('tr[data-ticket-key]')];
    // Sorted by project: the request (no project) first, then APP, then WEB.
    expect(rows.map((r) => r.dataset.ticketKey)).toEqual(['AST-2', 'APP-1', 'APP-2', 'WEB-1']);
    expect(
      within(rows[1] as HTMLElement).getByText('APP', { selector: '[data-project]' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Dự án: 2/ })).toBeInTheDocument();
  });

  it('keeps the project list unchanged: no project column or filter', async () => {
    const s = scenario();
    const calls = mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [s.app, s.web] } })],
      ['GET /v1/machines', () => ({ body: { items: [] } })],
      ['GET /v1/tickets', () => ({ body: { items: [s.pmWeb, s.webDev], nextCursor: null } })],
    ]);
    renderWithApp(<ListPage projectKey="WEB" search={{}} />);
    await screen.findByText('Giỏ hàng web');
    const list = calls.find((c) => c.path.startsWith('/v1/tickets?'));
    expect(new URL(list?.path ?? '', 'http://x').searchParams.get('projectId')).toBe(s.web.id);
    expect(screen.queryByRole('columnheader', { name: /Dự án/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Dự án:/ })).toBeNull();
  });
});
