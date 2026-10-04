import {
  arr,
  bool,
  decodeActor,
  type Infer,
  int,
  jsonObject,
  lit,
  nullable,
  obj,
  page,
  str,
  uuid,
} from './http.ts';

/** `v2/src/ticket-policy.ts:1`. */
export const ticketStatus = lit('pending', 'ready', 'running', 'needs_input', 'paused', 'done', 'cancelled');
export const ticketLevel = lit('request', 'step', 'task');
export const ticketKind = lit('code', 'research', 'docs', 'deploy');

/** `Pin`, `v2/src/workflow-policy.ts:2`. */
export const decodePin = obj({
  workflow: lit('bmad', 'superpowers'),
  version: str,
  revision: str,
  checksum: str,
});
export type Pin = Infer<typeof decodePin>;

/** Ticket response from `mapTicket`, `v2/server/src/tickets/service.ts:28` (type at `contracts.ts:23`). */
export const decodeTicket = obj({
  id: uuid,
  projectId: uuid,
  parentId: nullable(uuid),
  rootId: uuid,
  level: ticketLevel,
  kind: ticketKind,
  title: str,
  description: str,
  mandatory: bool,
  criteria: jsonObject,
  inputs: jsonObject,
  outputs: jsonObject,
  skill: nullable(str),
  workflowPin: nullable(decodePin),
  status: ticketStatus,
  revision: int,
  waitReason: nullable(str),
  repairCycles: int,
  mergedCommit: nullable(str),
});
export type Ticket = Infer<typeof decodeTicket>;
export type TicketStatus = Ticket['status'];

/** Request body `CreateTicket`, `v2/server/src/tickets/contracts.ts:8`. */
export type CreateTicket = {
  projectId: string;
  parentId: string | null;
  level: Ticket['level'];
  kind: Ticket['kind'];
  title: string;
  description: string;
  mandatory: boolean;
  criteria: Record<string, unknown>;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  skill: string | null;
  workflowPin: Pin | null;
  deployApprovalDecisionId?: string | null;
};

/** `v2/server/src/tickets/contracts.ts:32`. */
export const decodeDependency = obj({ ticketId: uuid, predecessorId: uuid });
export type Dependency = Infer<typeof decodeDependency>;

/** `v2/server/src/tickets/contracts.ts:33`. */
export const decodeRepairLink = obj({ checkStepId: uuid, fixTicketId: uuid, cycleId: uuid });
export type RepairLink = Infer<typeof decodeRepairLink>;

/** GET `/v2/tickets/:id/graph` — whole root, `v2/server/src/tickets/dependencies.ts:153`. */
export const decodeTicketGraph = obj({
  nodes: arr(decodeTicket),
  dependencies: arr(decodeDependency),
  repairLinks: arr(decodeRepairLink),
});
export type TicketGraph = { nodes: Ticket[]; dependencies: Dependency[]; repairLinks: RepairLink[] };

/** GET `/v2/tickets` — `v2/server/src/tickets/routes.ts:199`. */
export const decodeTicketPage = page(decodeTicket);
export type TicketPage = Infer<typeof decodeTicketPage>;

/** Comment, `v2/server/src/tickets/contracts.ts:47`, page at `routes.ts:337`. */
export const decodeComment = obj({ id: uuid, ticketId: uuid, actor: decodeActor, text: str, createdAt: str });
export type Comment = Infer<typeof decodeComment>;
export const decodeCommentPage = page(decodeComment);

/** `SourceRef`, `v2/server/src/tickets/contracts.ts:34`. */
export const decodeSourceRef = obj(
  { kind: lit('docs', 'ticket', 'artifact', 'owner_decision'), id: uuid },
  { optional: { path: str, locator: str } },
);

/** Decision page row, `v2/server/src/tickets/routes.ts:393`. */
export const decodeDecision = obj({
  id: uuid,
  ticketId: uuid,
  actor: decodeActor,
  kind: lit('assessment', 'delegated', 'owner_answer', 'approval', 'intervention', 'dispatch'),
  content: str,
  rationale: str,
  sources: arr(decodeSourceRef),
  scope: jsonObject,
  createdAt: str,
});
export type Decision = Infer<typeof decodeDecision>;
export const decodeDecisionPage = page(decodeDecision);

/**
 * Revision guard for a ticket row: an older response arriving after a newer one keeps the newer row.
 */
export function newerTicket(current: Ticket | undefined, incoming: Ticket): Ticket {
  if (!current || current.id !== incoming.id) return incoming;
  return incoming.revision >= current.revision ? incoming : current;
}
