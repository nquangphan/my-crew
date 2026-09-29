import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { comment, detail, ticket } from '../test/fixtures';
import { mockFetch, renderWithApp } from '../test/render';
import { TicketView } from './ticket-view';

const lists: [string, () => { body: unknown }][] = [
  ['GET /v1/projects', () => ({ body: { items: [] } })],
  ['GET /v1/machines', () => ({ body: { items: [] } })],
];

describe('TicketView', () => {
  it('shows the REPORT_REQUIRED refusal and keeps the status when moving to Xong without a report', async () => {
    const t = ticket({ key: 'SHOP-8', title: 'Làm endpoint /health', status: 'in_review' });
    const calls = mockFetch([
      ...lists,
      ['GET /v1/tickets/SHOP-8', () => ({ body: detail(t) })],
      [
        `POST /v1/tickets/${t.id}/transition`,
        () => ({
          status: 409,
          body: { error: { code: 'REPORT_REQUIRED', message: 'SHOP-8 needs a report before done' } },
        }),
      ],
    ]);
    const user = userEvent.setup();
    renderWithApp(<TicketView ticketKey="SHOP-8" mode="page" />);

    await user.click(await screen.findByRole('button', { name: /^Trạng thái: Review/ }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Xong', 'Đang làm', 'Đã hủy']);
    await user.click(screen.getByRole('menuitem', { name: 'Xong' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ticket cần có report trước khi chuyển sang Xong.',
    );
    expect(screen.getByRole('button', { name: /^Trạng thái: Review/ })).toBeInTheDocument();
    const transition = calls.find((c) => c.method === 'POST');
    expect(transition?.body).toEqual({ to: 'done' });
  });

  it('shows the needs_input banner and focuses the reply box from "Trả lời"', async () => {
    const t = ticket({ key: 'SHOP-7', type: 'pm_task', assigneeRole: 'pm', status: 'needs_input' });
    mockFetch([
      ...lists,
      [
        'GET /v1/tickets/SHOP-7',
        () => ({ body: detail(t, { comments: [comment({ body: 'Chỉ Postgres hay cả Redis?' })] }) }),
      ],
    ]);
    const user = userEvent.setup();
    renderWithApp(<TicketView ticketKey="SHOP-7" mode="panel" />);

    expect(await screen.findByText('Agent đang chờ bạn trả lời')).toBeInTheDocument();
    expect(screen.getByText('Chỉ Postgres hay cả Redis?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Trả lời' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Trả lời' })).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Bỏ chặn' })).toBeInTheDocument();
  });

  it('tells the owner a comment on a blocked ticket unblocks it, and not on an open one', async () => {
    const blocked = ticket({ key: 'SHOP-10', status: 'blocked' });
    const open = ticket({ key: 'SHOP-11', status: 'in_progress' });
    mockFetch([
      ...lists,
      ['GET /v1/tickets/SHOP-10', () => ({ body: detail(blocked) })],
      ['GET /v1/tickets/SHOP-11', () => ({ body: detail(open) })],
    ]);
    const view = renderWithApp(<TicketView ticketKey="SHOP-10" mode="page" />);
    const box = await screen.findByRole('textbox', { name: 'Thêm bình luận' });
    expect(box).toHaveAccessibleDescription('Bình luận sẽ mở chặn ticket');
    view.unmount();

    renderWithApp(<TicketView ticketKey="SHOP-11" mode="page" />);
    await screen.findByRole('textbox', { name: 'Thêm bình luận' });
    expect(screen.queryByText('Bình luận sẽ mở chặn ticket')).not.toBeInTheDocument();
  });

  it('renders agent markdown without executing embedded HTML', async () => {
    const t = ticket({ key: 'SHOP-9' });
    mockFetch([
      ...lists,
      [
        'GET /v1/tickets/SHOP-9',
        () => ({
          body: detail(t, {
            comments: [
              comment({ body: '**Đậm** <img src=x onerror="alert(1)"> [link](javascript:alert(1))' }),
            ],
          }),
        }),
      ],
    ]);
    const { container } = renderWithApp(<TicketView ticketKey="SHOP-9" mode="page" />);
    expect(await screen.findByText('Đậm')).toContainHTML('Đậm');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
