import { describe, expect, it } from 'vitest';
import { AGENT_EDGES, allowedTransitions, canTransition, OWNER_EDGES } from './status-workflow.js';
import { TicketStatus } from './ticket-schemas.js';

const statuses = TicketStatus.options;

describe('canTransition', () => {
  it('allows every listed agent edge for agent and system', () => {
    for (const [from, tos] of Object.entries(AGENT_EDGES)) {
      for (const to of tos ?? []) {
        expect(canTransition('agent', from as TicketStatus, to)).toBe(true);
        expect(canTransition('system', from as TicketStatus, to)).toBe(true);
      }
    }
  });

  it('allows every listed owner edge', () => {
    for (const [from, tos] of Object.entries(OWNER_EDGES)) {
      for (const to of tos ?? []) expect(canTransition('owner', from as TicketStatus, to)).toBe(true);
    }
  });

  it('rejects every unlisted edge for agent and owner', () => {
    for (const from of statuses) {
      for (const to of statuses) {
        expect(canTransition('agent', from, to)).toBe(AGENT_EDGES[from]?.includes(to) ?? false);
        expect(canTransition('owner', from, to)).toBe(OWNER_EDGES[from]?.includes(to) ?? false);
      }
    }
  });

  it('lets system cascade any live ticket to cancelled', () => {
    for (const from of statuses) {
      expect(canTransition('system', from, 'cancelled')).toBe(from !== 'cancelled');
    }
  });

  it('matches the documented examples', () => {
    expect(canTransition('owner', 'in_progress', 'cancelled')).toBe(true);
    expect(canTransition('agent', 'todo', 'done')).toBe(false);
    expect(canTransition('agent', 'done', 'in_progress')).toBe(false);
    expect(canTransition('owner', 'done', 'in_progress')).toBe(true);
    expect(canTransition('owner', 'cancelled', 'in_progress')).toBe(false);
  });

  it('never allows a self edge', () => {
    for (const s of statuses)
      for (const a of ['owner', 'agent', 'system'] as const) {
        expect(canTransition(a, s, s)).toBe(false);
      }
  });
});

describe('allowedTransitions', () => {
  it('agrees with canTransition', () => {
    for (const actor of ['owner', 'agent', 'system'] as const) {
      for (const from of statuses) {
        const expected = statuses.filter((to) => canTransition(actor, from, to)).sort();
        expect(allowedTransitions(actor, from).sort()).toEqual(expected);
      }
    }
  });
});
