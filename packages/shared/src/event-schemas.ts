import { z } from 'zod';
import { AgentRole } from './agent-schemas.js';
import { TicketStatus } from './ticket-schemas.js';

const TicketRef = z.object({ ticketId: z.string() });

/** Discriminated union of every event the server emits. `type` is the discriminator. */
export const EventPayload = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ticket.assigned'), data: TicketRef.extend({ role: AgentRole }) }),
  /** Owner comments only; agent comments never wake an agent. */
  z.object({
    type: z.literal('ticket.comment_added'),
    data: TicketRef.extend({ commentId: z.string() }),
  }),
  /** Owner stream only. */
  z.object({
    type: z.literal('ticket.status_changed'),
    data: TicketRef.extend({ from: TicketStatus, to: TicketStatus }),
  }),
  z.object({
    type: z.literal('dependency.resolved'),
    data: TicketRef.extend({ dependencyId: z.string() }),
  }),
  z.object({
    type: z.literal('machine.claimed'),
    data: z.object({ machineId: z.string(), projectId: z.string().nullable(), assistant: z.boolean() }),
  }),
  z.object({
    type: z.literal('claim.requested'),
    data: z.object({ claimRequestId: z.string(), machineId: z.string() }),
  }),
  z.object({
    type: z.literal('claim.changed'),
    data: z.object({
      claimRequestId: z.string(),
      status: z.enum(['approved', 'rejected']),
    }),
  }),
  z.object({ type: z.literal('children.all_done'), data: TicketRef }),
  z.object({ type: z.literal('ticket.reopened'), data: TicketRef }),
  z.object({ type: z.literal('ticket.unblocked'), data: TicketRef }),
  z.object({ type: z.literal('ticket.cancelled'), data: TicketRef }),
  z.object({ type: z.literal('machine.offline'), data: z.object({ machineId: z.string() }) }),
  z.object({
    type: z.literal('budget.exceeded'),
    data: TicketRef.extend({ kind: z.enum(['cost', 'children', 'bug_cycles', 'attempts']) }),
  }),
  z.object({
    type: z.literal('docs.synced'),
    data: z.object({ projectId: z.string(), commitSha: z.string() }),
  }),
]);
export type EventPayload = z.infer<typeof EventPayload>;
export type EventType = EventPayload['type'];

export const EventEnvelope = z.object({
  /** bigserial as a decimal string: it is also the SSE cursor. */
  id: z.string(),
  type: z.string(),
  ticketId: z.string().nullable(),
  projectId: z.string().nullable(),
  targetMachineId: z.string().nullable(),
  targetRole: AgentRole.nullable(),
  payload: EventPayload,
  createdAt: z.iso.datetime(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
