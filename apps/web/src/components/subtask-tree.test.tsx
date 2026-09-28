import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ticket } from '../test/fixtures';
import { renderWithApp } from '../test/render';
import { buildSubtaskTree, SubtaskTree } from './subtask-tree';

function family() {
  const dev = ticket({
    key: 'SHOP-9',
    title: 'Tách service thanh toán',
    status: 'in_progress',
    createdAt: '2026-09-28T01:00:00.000Z',
  });
  const qc = ticket({
    key: 'SHOP-10',
    type: 'qc',
    assigneeRole: 'qc',
    title: 'QC tách service',
    pairsWith: dev.id,
    createdAt: '2026-09-28T01:01:00.000Z',
  });
  const bug1 = ticket({
    key: 'SHOP-11',
    type: 'bug',
    title: 'Webhook trả 500',
    originDevId: dev.id,
    bugCycle: 1,
    status: 'blocked',
    createdAt: '2026-09-28T02:00:00.000Z',
  });
  const retest1 = ticket({
    key: 'SHOP-12',
    type: 'qc',
    assigneeRole: 'qc',
    title: 'Retest webhook',
    pairsWith: bug1.id,
    createdAt: '2026-09-28T02:01:00.000Z',
  });
  const bug2 = ticket({
    key: 'SHOP-13',
    type: 'bug',
    title: 'Thiếu chữ ký',
    originDevId: dev.id,
    bugCycle: 2,
    createdAt: '2026-09-28T03:00:00.000Z',
  });
  const next = ticket({
    key: 'SHOP-14',
    title: 'Hoàn tiền',
    dependsOn: [dev.id],
    createdAt: '2026-09-28T04:00:00.000Z',
  });
  return { dev, qc, bug1, retest1, bug2, next, all: [bug2, next, retest1, qc, bug1, dev] };
}

describe('SubtaskTree', () => {
  it('groups dev↔QC pairs and hangs the bug chain, with retests, under its dev ticket by cycle', () => {
    const f = family();
    const groups = buildSubtaskTree(f.all);
    expect(groups.map((g) => g.ticket.key)).toEqual(['SHOP-9', 'SHOP-14']);
    const [devGroup] = groups;
    expect(devGroup?.qc.map((t) => t.key)).toEqual(['SHOP-10']);
    expect(devGroup?.bugs.map((b) => [b.bug.key, b.retest?.key ?? null])).toEqual([
      ['SHOP-11', 'SHOP-12'],
      ['SHOP-13', null],
    ]);
  });

  it('renders the bug cycle, dependency waits and opens a child on click', async () => {
    const f = family();
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<SubtaskTree tickets={f.all} onOpen={onOpen} />);
    const tree = await screen.findByRole('list', { name: 'Ticket con' });
    const bug = within(tree).getByRole('button', { name: /SHOP-11/ });
    expect(bug).toHaveTextContent('(vòng 1/3)');
    expect(bug).toHaveTextContent('Bị chặn');
    expect(within(tree).getByRole('button', { name: /SHOP-13/ })).toHaveTextContent('(vòng 2/3)');
    expect(within(tree).getByRole('button', { name: /SHOP-14/ })).toHaveTextContent('Chờ SHOP-9');
    await user.click(within(tree).getByRole('button', { name: /SHOP-12/ }));
    expect(onOpen).toHaveBeenCalledWith('SHOP-12');
  });
});
