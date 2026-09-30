import { z } from 'zod';
import { AgentRole } from './agent-schemas.js';
import { TicketStatus } from './ticket-schemas.js';

const TicketRef = z.object({ ticketId: z.string() });
/** What a claim is about: one project, or the assistant role (`projectId` null). */
const ClaimScope = z.object({ projectId: z.string().nullable(), assistant: z.boolean() });

/** Discriminated union of every event the server emits. `type` is the discriminator. */
export const EventPayload = z.discriminatedUnion('type', [
  /** `reassigned` marks a re-dispatch after the ticket's project (or the assistant role) moved machines. */
  z.object({
    type: z.literal('ticket.assigned'),
    data: TicketRef.extend({ role: AgentRole, reassigned: z.boolean().optional() }),
  }),
  /** Owner comments only; agent comments never wake an agent. */
  z.object({
    type: z.literal('ticket.comment_added'),
    data: TicketRef.extend({ commentId: z.string() }),
  }),
  /**
   * An owner comment tagged `@pm` on a ticket of a pm_task tree (the pm_task itself or one of its
   * subtasks). `ticketId` is the pm_task whose PM wakes; the event goes to the machine that owns the
   * project with role `pm`. It replaces `ticket.comment_added` for that comment: only the PM wakes.
   */
  z.object({
    type: z.literal('ticket.pm_mentioned'),
    data: TicketRef.extend({
      sourceTicketId: z.string(),
      sourceTicketKey: z.string(),
      commentId: z.string(),
    }),
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
  /** A takeover request waits for the owner. Owner stream only. */
  z.object({
    type: z.literal('claim.requested'),
    data: ClaimScope.extend({ claimRequestId: z.string(), machineId: z.string() }),
  }),
  /** Sent to the requesting machine and, on approval, to the machine that lost the claim. */
  z.object({
    type: z.literal('claim.changed'),
    data: ClaimScope.extend({
      claimRequestId: z.string(),
      status: z.enum(['approved', 'rejected']),
      /** The machine that holds the claim after the decision (null when nobody does). */
      machineId: z.string().nullable(),
      previousMachineId: z.string().nullable(),
    }),
  }),
  /** A machine released a project or the assistant role (or was revoked). Owner stream only. */
  z.object({ type: z.literal('machine.released'), data: ClaimScope.extend({ machineId: z.string() }) }),
  /** A machine created a project it owns. Owner stream only. */
  z.object({
    type: z.literal('project.created'),
    data: z.object({ projectId: z.string(), machineId: z.string() }),
  }),
  /** The desktop app's health summary turned red. Owner stream only. */
  z.object({
    type: z.literal('machine.unhealthy'),
    data: z.object({
      machineId: z.string(),
      failing: z.array(z.object({ id: z.string(), title: z.string() })),
    }),
  }),
  /**
   * Owner stream only (never targeted at a machine): something the web shows changed without a status
   * change, e.g. an agent comment, a new report, agent run metadata or an owner edit.
   */
  z.object({
    type: z.literal('ticket.updated'),
    data: TicketRef.extend({ change: z.enum(['comment', 'report', 'meta', 'fields']) }),
  }),
  z.object({ type: z.literal('children.all_done'), data: TicketRef }),
  z.object({ type: z.literal('ticket.reopened'), data: TicketRef }),
  z.object({ type: z.literal('ticket.unblocked'), data: TicketRef }),
  z.object({ type: z.literal('ticket.cancelled'), data: TicketRef }),
  z.object({ type: z.literal('machine.offline'), data: z.object({ machineId: z.string() }) }),
  /**
   * A non-terminal ticket saw no activity for a while, and no machine runs, queues or parks a job for it.
   * Sent once per quiet spell to the owner stream only.
   */
  z.object({
    type: z.literal('ticket.stuck'),
    data: TicketRef.extend({ status: TicketStatus, idleMinutes: z.number().int().min(0) }),
  }),
  z.object({
    type: z.literal('budget.exceeded'),
    data: TicketRef.extend({ kind: z.enum(['cost', 'children', 'bug_cycles', 'attempts']) }),
  }),
  /** The owning machine asked to change its project's type or UI-test MCP mapping. Owner stream only. */
  z.object({
    type: z.literal('project.change_requested'),
    data: z.object({ requestId: z.string(), projectId: z.string(), machineId: z.string() }),
  }),
  /**
   * The owner approved (the project changed) or rejected a change request, or it was withdrawn because the
   * requesting machine lost the project. Sent to the requesting machine.
   */
  z.object({
    type: z.literal('project.change_decided'),
    data: z.object({
      requestId: z.string(),
      projectId: z.string(),
      machineId: z.string(),
      status: z.enum(['approved', 'rejected', 'withdrawn']),
    }),
  }),
  /**
   * A machine's heartbeat changed what it reports doing with these tickets (a job was taken, started,
   * started waiting for another reason, failed or ended), or the machine came back after going silent.
   * Owner stream only; the web refetches the tickets' agent activity.
   */
  z.object({
    type: z.literal('agent.activity_changed'),
    data: z.object({ machineId: z.string(), ticketIds: z.array(z.string()) }),
  }),
  /** The owner's inbox read state changed on some device. Owner stream only. */
  z.object({ type: z.literal('inbox.read'), data: z.object({ unread: z.number().int().min(0) }) }),
  z.object({
    type: z.literal('docs.synced'),
    data: z.object({ projectId: z.string(), commitSha: z.string() }),
  }),
  /**
   * A server setting got a new revision (a save, a restore, a machine's upload). Sent to the owner stream and
   * to every machine it applies to; the daemon refetches its settings and uses them from its next job.
   */
  z.object({
    type: z.literal('settings.changed'),
    data: z.object({
      revisionId: z.string(),
      kind: z.string(),
      scope: z.string(),
      machineId: z.string().nullable(),
      projectId: z.string().nullable(),
      name: z.string(),
      version: z.number().int(),
    }),
  }),
  /**
   * The owner asked a machine for a whitelisted action (pause, health check or fix, BMAD install, job list, log
   * tail, …). Sent to that machine and to the owner stream.
   */
  z.object({
    type: z.literal('machine.command'),
    data: z.object({ commandId: z.string(), machineId: z.string(), action: z.string() }),
  }),
  /** A machine command started, finished, failed or expired. Owner stream only. */
  z.object({
    type: z.literal('machine.command_updated'),
    data: z.object({ commandId: z.string(), machineId: z.string(), status: z.string() }),
  }),
  /** A machine's heartbeat reports a new settings revision (it picked up a change). Owner stream only. */
  z.object({
    type: z.literal('machine.settings_applied'),
    data: z.object({ machineId: z.string(), revision: z.string() }),
  }),
]);
export type EventPayload = z.infer<typeof EventPayload>;
export type EventType = EventPayload['type'];

export const EventEnvelope = z.object({
  /**
   * Delivery sequence as a decimal string; it is also the SSE cursor. Sequence numbers are assigned in
   * commit order, so a reader that has seen `n` has seen every committed event below `n`.
   */
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

/** SSE comment heartbeat interval of both streams; the token or session is re-checked on each one. */
export const STREAM_HEARTBEAT_MS = 20_000;

/**
 * Resume point of `GET /v1/daemon/stream` and `GET /v1/stream`: the `id` of the last event received.
 * Sent as the SSE `Last-Event-ID` header or as `?cursor=`; the header wins when both are present.
 */
export const StreamCursor = z.string().regex(/^\d{1,19}$/, 'the cursor is a decimal event id');

export const StreamQuery = z.object({ cursor: StreamCursor.optional() });
export type StreamQuery = z.infer<typeof StreamQuery>;

/** Machine, budget and stuck-ticket notices the owner inbox lists (`GET /v1/notices`), newest first. */
export const NOTICE_EVENT_TYPES = [
  'machine.claimed',
  'claim.requested',
  'machine.released',
  'project.created',
  'machine.offline',
  'machine.unhealthy',
  'budget.exceeded',
  'project.change_requested',
  'ticket.stuck',
] as const satisfies readonly EventType[];

export const NoticeListQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
/** A notice with the owner's read state, which the server keeps so every device shares it. */
export const Notice = EventEnvelope.extend({ read: z.boolean() });
export type Notice = z.infer<typeof Notice>;
export const NoticeListResponse = z.object({
  items: z.array(Notice),
  /** Unread notices in the whole history, not only the listed page. */
  unread: z.number().int().min(0),
});
export type NoticeListResponse = z.infer<typeof NoticeListResponse>;

/** `POST /v1/notices/read`: marks the listed notices (by `id`) read; ids that are not notices are ignored. */
export const MarkNoticesReadRequest = z.object({ ids: z.array(StreamCursor).min(1).max(200) }).strict();
export type MarkNoticesReadRequest = z.infer<typeof MarkNoticesReadRequest>;

/**
 * `POST /v1/notices/read-all`: marks every notice read, up to `throughId` when given, so a notice that
 * arrived after the owner loaded the list stays unread.
 */
export const MarkAllNoticesReadRequest = z.object({ throughId: StreamCursor.optional() }).strict();
export type MarkAllNoticesReadRequest = z.infer<typeof MarkAllNoticesReadRequest>;

export const NoticeReadResponse = z.object({ unread: z.number().int().min(0) });
export type NoticeReadResponse = z.infer<typeof NoticeReadResponse>;
