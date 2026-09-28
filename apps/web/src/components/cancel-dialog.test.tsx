import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ticket } from '../test/fixtures';
import { mockFetch, renderWithApp } from '../test/render';
import { CancelDialog } from './cancel-dialog';

describe('CancelDialog', () => {
  it('lists every open descendant, over all levels, before cancelling', async () => {
    const root = ticket({ key: 'AST-4', type: 'request', assigneeRole: 'assistant', status: 'in_progress' });
    const pm = ticket({
      key: 'SHOP-3',
      type: 'pm_task',
      assigneeRole: 'pm',
      parentId: root.id,
      status: 'in_progress',
    });
    const dev = ticket({ key: 'SHOP-9', parentId: pm.id, status: 'in_progress', title: 'Dev đang làm' });
    const done = ticket({ key: 'SHOP-8', parentId: pm.id, status: 'done', title: 'Dev đã xong' });
    const qc = ticket({
      key: 'SHOP-10',
      type: 'qc',
      assigneeRole: 'qc',
      parentId: pm.id,
      status: 'todo',
      title: 'QC chờ',
    });
    const byParent: Record<string, unknown[]> = { [root.id]: [pm], [pm.id]: [dev, done, qc] };
    mockFetch([
      [
        'GET /v1/tickets?',
        (call) => {
          const parentId = new URLSearchParams(call.path.split('?')[1]).get('parentId') ?? '';
          return { body: { items: byParent[parentId] ?? [], nextCursor: null } };
        },
      ],
    ]);
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<CancelDialog ticket={root} open onOpenChange={() => {}} onConfirm={onConfirm} />);

    const list = await screen.findByRole('list', { name: 'Ticket con sẽ bị hủy' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('SHOP-3'),
      expect.stringContaining('SHOP-9'),
      expect.stringContaining('SHOP-10'),
    ]);
    expect(within(list).queryByText('SHOP-8')).toBeNull();
    expect(screen.getByText('3 ticket con đang mở cũng sẽ bị hủy:')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hủy AST-4' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('says so when there is nothing else to cancel', async () => {
    const lone = ticket({ key: 'SHOP-20', status: 'blocked' });
    mockFetch([['GET /v1/tickets?', () => ({ body: { items: [], nextCursor: null } })]]);
    renderWithApp(<CancelDialog ticket={lone} open onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(await screen.findByText('Ticket này không có ticket con đang mở.')).toBeInTheDocument();
  });
});
