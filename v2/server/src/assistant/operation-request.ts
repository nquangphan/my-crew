import { createHash } from 'node:crypto';
import { canonicalJson } from '../journal/canonical.ts';
import type { Id } from '../platform/contracts.ts';
import type { CreateTicket, DecisionInput } from '../tickets/contracts.ts';
import type { Sha256, WorkflowRun } from './contracts.ts';

/**
 * Exact request one pending `assistant_tool_operations` row authorizes. The tools
 * transport writes `request_hash = operationRequestSha256(request)` with the row; the
 * orchestration port accepts the operation only for this exact action and payload.
 * Single mutations carry the exact submitted payload; `create_run` carries the run
 * input plus the graph digest the server derived itself.
 */
export type OperationRequest =
  | { action: 'create_ticket'; payload: CreateTicket }
  | { action: 'decision'; payload: { ticketId: Id; input: DecisionInput } }
  | { action: 'dependency'; payload: { ticketId: Id; predecessorId: Id; expectedRevision: number } }
  | {
      action: 'signal';
      payload: { ticketId: Id; signal: 'dependencies_ready' | 'wait_owner'; expectedRevision: number };
    }
  | {
      action: 'create_run';
      payload: { rootTicketId: Id; path: WorkflowRun['path']; definitionSha256: Sha256; graphSha256: Sha256 };
    };

/** `sha256(canonicalJson({action, payload}))`; the action field separates the domains. */
export function operationRequestSha256(request: OperationRequest): Sha256 {
  return createHash('sha256')
    .update(canonicalJson({ action: request.action, payload: request.payload }))
    .digest('hex');
}
