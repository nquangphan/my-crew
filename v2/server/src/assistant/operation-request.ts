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

/** Schema tag of the request hash; a new canonical form needs a new tag. */
export const operationRequestSchema = 'crew-v2:operation-request:1';

/**
 * `sha256(canonicalJson({schema, action, payload}))`. The schema tag versions the form and
 * the action separates the domains; the transport must hash every tool with this function.
 */
export function operationRequestSha256(request: OperationRequest): Sha256 {
  return createHash('sha256')
    .update(
      canonicalJson({ schema: operationRequestSchema, action: request.action, payload: request.payload }),
    )
    .digest('hex');
}
