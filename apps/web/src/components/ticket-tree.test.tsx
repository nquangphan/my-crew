import type { AgentActivity, Ticket } from '@crew/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { detail, project, ticket } from '../test/fixtures';
import { mockFetch, renderWithApp } from '../test/render';
import { projectKeyResolver } from './project-badge';
import { TicketTree } from './ticket-tree';
import { TicketView } from './ticket-view';

function activity(overrides: Partial<AgentActivity>): AgentActivity {
  return {
    status: 'running',
    machineId: 'm1',
    machineName: 'Macbook-M4',
    machineOnline: true,
    role: 'dev',
    stage: null,
    since: null,
    model: null,
    effort: null,
    waitReason: null,
    waitDetail: null,
    reportedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** AST-2 routed to WEB and APP: a pm_task each, with dev↔QC, docs_init and a closed child. */
function routedRequest() {
  const web = project({ key: 'WEB' });
  const app = project({ key: 'APP' });
  const request = ticket({ key: 'AST-2', type: 'request', assigneeRole: 'assistant', status: 'in_progress' });
  const pmWeb = ticket({
    key: 'WEB-1',
    type: 'pm_task',
    assigneeRole: 'pm',
    parentId: request.id,
    projectId: web.id,
    status: 'in_progress',
    title: 'Giỏ hàng web',
    createdAt: '2026-09-28T02:01:00.000Z',
  });
  const pmApp = ticket({
    key: 'APP-1',
    type: 'pm_task',
    assigneeRole: 'pm',
    parentId: request.id,
    projectId: app.id,
    status: 'in_progress',
    title: 'Giỏ hàng app',
    createdAt: '2026-09-28T02:02:00.000Z',
  });
  const dev = ticket({
    key: 'WEB-2',
    parentId: pmWeb.id,
    projectId: web.id,
    status: 'in_progress',
    title: 'Làm giỏ hàng',
    agentActivity: activity({ status: 'running' }),
  });
  const qc = ticket({
    key: 'WEB-3',
    type: 'qc',
    assigneeRole: 'qc',
    parentId: pmWeb.id,
    projectId: web.id,
    pairsWith: dev.id,
    dependsOn: [dev.id],
    title: 'QC giỏ hàng',
    agentActivity: activity({ status: 'queued', role: 'qc', waitReason: 'waiting_deps' }),
  });
  const docs = ticket({
    key: 'APP-2',
    type: 'docs_init',
    parentId: pmApp.id,
    projectId: app.id,
    title: 'Docs app',
    agentActivity: activity({ status: 'failed', role: 'dev' }),
  });
  const done = ticket({ key: 'APP-3', parentId: pmApp.id, projectId: app.id, status: 'done', title: 'Nút' });
  return { web, app, request, pmWeb, pmApp, dev, qc, docs, done };
}

const rowOf = (key: string) => {
  const row = document.querySelector<HTMLElement>(`[data-ticket-key="${key}"]`);
  if (!row) throw new Error(`no row ${key}`);
  return row;
};

describe('TicketTree', () => {
  it('lists every descendant under its parent with project, status and agent activity', async () => {
    const s = routedRequest();
    const items: Ticket[] = [s.done, s.docs, s.qc, s.dev, s.pmApp, s.pmWeb];
    const onOpen = vi.fn();
    render(
      <TicketTree
        rootId={s.request.id}
        items={items}
        projectKeyOf={projectKeyResolver([s.web, s.app])}
        onOpen={onOpen}
      />,
    );
    const tree = screen.getByRole('list', { name: 'Cây ticket' });
    // Both pm_tasks sit at the top; their children are nested under them.
    const top = within(tree)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === tree);
    expect(top.map((li) => li.querySelector('[data-ticket-key]')?.getAttribute('data-ticket-key'))).toEqual([
      'WEB-1',
      'APP-1',
    ]);
    expect(within(top[0] as HTMLElement).getByText('Làm giỏ hàng')).toBeInTheDocument();
    expect(within(top[0] as HTMLElement).getByText('QC giỏ hàng')).toBeInTheDocument();
    expect(within(top[1] as HTMLElement).getByText('Docs app')).toBeInTheDocument();
    expect(within(top[1] as HTMLElement).getByText('Nút')).toBeInTheDocument();

    expect(within(rowOf('WEB-1')).getByText('WEB', { selector: '[data-project]' })).toBeInTheDocument();
    expect(within(rowOf('APP-2')).getByText('APP', { selector: '[data-project]' })).toBeInTheDocument();
    expect(within(rowOf('APP-3')).getByText('Xong')).toBeInTheDocument();
    // QC waits for its dev ticket; the failed docs_init and the waiting QC carry the activity mark.
    expect(within(rowOf('WEB-3')).getByText('Chờ WEB-2')).toBeInTheDocument();
    expect(rowOf('WEB-3').querySelector('[data-activity="waiting"]')).not.toBeNull();
    expect(rowOf('APP-2').querySelector('[data-activity="failed"]')).not.toBeNull();
    // A running job shows the avatar spinner, not a mark.
    expect(rowOf('WEB-2').querySelector('[data-activity]')).toBeNull();
    expect(within(rowOf('WEB-2')).getByRole('status')).toBeInTheDocument();

    await userEvent.setup().click(rowOf('APP-3'));
    expect(onOpen).toHaveBeenCalledWith('APP-3');
  });
});

describe('TicketView: "Cây ticket" of a request', () => {
  it('loads the whole tree in one call and follows live refreshes', async () => {
    const s = routedRequest();
    let docsStatus: Ticket['status'] = 'todo';
    const calls = mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [s.web, s.app] } })],
      ['GET /v1/machines', () => ({ body: { items: [] } })],
      [
        `GET /v1/tickets/${s.request.id}/tree`,
        () => ({
          body: {
            items: [s.pmWeb, s.pmApp, s.dev, s.qc, { ...s.docs, status: docsStatus }, s.done],
            truncated: false,
          },
        }),
      ],
      ['GET /v1/tickets/AST-2', () => ({ body: detail(s.request, { children: [s.pmWeb, s.pmApp] }) })],
    ]);
    const { queryClient } = renderWithApp(<TicketView ticketKey="AST-2" mode="page" />);

    expect(await screen.findByRole('heading', { name: 'Cây ticket (6)' })).toBeInTheDocument();
    for (const key of ['WEB-1', 'APP-1', 'WEB-2', 'WEB-3', 'APP-2', 'APP-3']) {
      expect(rowOf(key)).toBeInTheDocument();
    }
    // The tree replaces the flat child list, and no request goes out per level or per node.
    expect(screen.queryByRole('list', { name: 'Ticket con' })).toBeNull();
    const listCalls = calls.filter((c) => c.path.startsWith('/v1/tickets?'));
    expect(listCalls).toEqual([]);
    expect(calls.filter((c) => c.path.endsWith('/tree'))).toHaveLength(1);

    // A ticket event invalidates the `descendants` prefix (as the owner stream does): the tree refetches.
    expect(within(rowOf('APP-2')).getByText('Cần làm')).toBeInTheDocument();
    docsStatus = 'in_progress';
    await queryClient.invalidateQueries({ queryKey: ['descendants'] });
    expect(await within(rowOf('APP-2')).findByText('Đang làm')).toBeInTheDocument();
  });

  it('shows the direct children when the tree cannot be loaded', async () => {
    const s = routedRequest();
    mockFetch([
      ['GET /v1/projects', () => ({ body: { items: [s.web, s.app] } })],
      ['GET /v1/machines', () => ({ body: { items: [] } })],
      [`GET /v1/tickets/${s.pmWeb.id}/tree`, () => ({ status: 500, body: { error: { code: 'INTERNAL' } } })],
      ['GET /v1/tickets/WEB-1', () => ({ body: detail(s.pmWeb, { children: [s.dev, s.qc] }) })],
      [`GET /v1/tickets/${s.request.id}`, () => ({ body: detail(s.request, { children: [s.pmWeb] }) })],
    ]);
    renderWithApp(<TicketView ticketKey="WEB-1" mode="panel" />);
    expect(await screen.findByText(/Không tải được cả cây ticket/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cây ticket (2)' })).toBeInTheDocument();
    expect(rowOf('WEB-2')).toBeInTheDocument();
    expect(rowOf('WEB-3')).toBeInTheDocument();
  });
});
