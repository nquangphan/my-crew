import type { Actor, TicketStatus } from './ticket-schemas.js';

type Edges = Partial<Record<TicketStatus, readonly TicketStatus[]>>;

/** Edges an agent may take. The `system` actor gets these plus `* → cancelled` during a cascade. */
export const AGENT_EDGES: Edges = {
  todo: ['triage', 'in_progress', 'needs_input'],
  triage: ['in_progress', 'needs_input'],
  needs_input: ['in_progress'],
  in_progress: ['needs_input', 'in_review', 'done', 'blocked'],
  in_review: ['done', 'in_progress'],
  blocked: ['in_progress'],
};

export const OWNER_EDGES: Edges = {
  todo: ['cancelled'],
  triage: ['cancelled'],
  needs_input: ['in_progress', 'cancelled'],
  in_progress: ['cancelled'],
  in_review: ['done', 'in_progress', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  done: ['in_progress'],
};

export const TERMINAL_STATUSES: readonly TicketStatus[] = ['done', 'cancelled'];

export function canTransition(actor: Actor, from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return false;
  if (actor === 'owner') return OWNER_EDGES[from]?.includes(to) ?? false;
  if (AGENT_EDGES[from]?.includes(to)) return true;
  return actor === 'system' && to === 'cancelled' && from !== 'cancelled';
}

/** Legal targets for a status dropdown. */
export function allowedTransitions(actor: Actor, from: TicketStatus): TicketStatus[] {
  const edges = actor === 'owner' ? OWNER_EDGES : AGENT_EDGES;
  const targets = [...(edges[from] ?? [])];
  if (actor === 'system' && from !== 'cancelled' && !targets.includes('cancelled')) targets.push('cancelled');
  return targets;
}
