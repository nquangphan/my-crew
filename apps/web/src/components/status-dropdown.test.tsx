import { canTransition, TicketStatus } from '@crew/shared';
import { describe, expect, it } from 'vitest';
import { ownerTargets } from './status-dropdown';

describe('status dropdown targets', () => {
  it('offers exactly the moves canTransition("owner", …) allows, for every status', () => {
    for (const from of TicketStatus.options) {
      const legal = TicketStatus.options.filter((to) => canTransition('owner', from, to));
      expect(new Set(ownerTargets(from))).toEqual(new Set(legal));
    }
  });
});
