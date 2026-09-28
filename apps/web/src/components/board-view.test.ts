import { describe, expect, it } from 'vitest';
import { ticket } from '../test/fixtures';
import { columnOf, filterBoardTickets } from './board-view';
import { sortTickets } from './issue-table';

describe('board and list helpers', () => {
  it('puts blocked tickets in the in-progress column and hides cancelled ones', () => {
    expect(columnOf('blocked')).toBe('in_progress');
    expect(columnOf('needs_input')).toBe('needs_input');
    expect(columnOf('cancelled')).toBeNull();
  });

  it('filters by type, role, priority and "waiting for me"', () => {
    const list = [
      ticket({ key: 'A-1', type: 'dev', priority: 'high' }),
      ticket({ key: 'A-2', type: 'qc', assigneeRole: 'qc', status: 'needs_input' }),
      ticket({ key: 'A-3', type: 'dev', status: 'cancelled' }),
      ticket({ key: 'A-4', type: 'pm_task', assigneeRole: 'pm', status: 'in_progress', budgetHold: 'cost' }),
    ];
    const keys = (search: Parameters<typeof filterBoardTickets>[1]) =>
      filterBoardTickets(list, search).map((t) => t.key);
    expect(keys({})).toEqual(['A-1', 'A-2', 'A-4']);
    expect(keys({ type: 'dev' })).toEqual(['A-1']);
    expect(keys({ role: 'qc,pm' })).toEqual(['A-2', 'A-4']);
    expect(keys({ priority: 'high' })).toEqual(['A-1']);
    expect(keys({ mine: true })).toEqual(['A-2', 'A-4']);
  });

  it('sorts keys numerically and priorities by rank', () => {
    const list = [
      ticket({ key: 'SHOP-10', priority: 'low' }),
      ticket({ key: 'SHOP-9', priority: 'urgent' }),
      ticket({ key: 'SHOP-2', priority: 'medium' }),
    ];
    expect(sortTickets(list, 'key', 'asc').map((t) => t.key)).toEqual(['SHOP-2', 'SHOP-9', 'SHOP-10']);
    expect(sortTickets(list, 'priority', 'desc').map((t) => t.key)).toEqual(['SHOP-9', 'SHOP-2', 'SHOP-10']);
  });
});
