import { z } from 'zod';

export const TicketStatus = z.enum([
  'todo',
  'triage',
  'needs_input',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
]);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const TicketType = z.enum(['request', 'pm_task', 'dev', 'qc', 'bug', 'docs_init']);
export type TicketType = z.infer<typeof TicketType>;

export const TicketPriority = z.enum(['low', 'medium', 'high', 'urgent']);
export type TicketPriority = z.infer<typeof TicketPriority>;

export const Actor = z.enum(['owner', 'agent', 'system']);
export type Actor = z.infer<typeof Actor>;

/** Every write request from an agent or the owner may carry this header; the server replays the stored response. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IdempotencyKey = z.string().min(8).max(200);
