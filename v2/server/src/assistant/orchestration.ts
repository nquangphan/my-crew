import { digest } from '../attachments/submissions.ts';
import { canonicalJson } from '../journal/canonical.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { immutableSnapshot, invalidScope, orchestrationTargetHash } from '../tickets/assistant-access.ts';
import type { CreateTicket, DecisionInput, TicketServiceDependencies } from '../tickets/contracts.ts';
import { createTicketServices } from '../tickets/service.ts';
import type { PersistedAssistantActorResolver } from './authority.ts';
import type {
  OrchestrationAction,
  OrchestrationProof,
  ProjectOrchestrationAuthority,
  ProjectOrchestrationPort,
} from './contracts.ts';

type AssistantSignal = 'dependencies_ready' | 'wait_owner';
type Target =
  | { action: 'create_ticket'; payload: CreateTicket }
  | { action: 'decision'; payload: { ticketId: Id; input: DecisionInput } }
  | { action: 'dependency'; payload: { ticketId: Id; predecessorId: Id; expectedRevision: number } }
  | { action: 'signal'; payload: { ticketId: Id; signal: AssistantSignal; expectedRevision: number } };
type Binding = {
  target: Target;
  targetSha256: string;
  actor: Actor;
  proof: OrchestrationProof;
  used: boolean;
};
type ScopeRow = {
  rootTicketId: Id | null;
  messageId: Id | null;
  projectId: Id | null;
  inputSnapshotId: Id;
};

const notFound = () => new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
const routingRequired = () =>
  new ApiError('ORCHESTRATION_ROUTING_DECISION_REQUIRED', 403, 'Thiếu quyết định định tuyến cho yêu cầu mới');
const nullableId = (value: unknown): Id | null => (value === null ? null : String(value));

function sameIdentity(binding: Binding, actor: Actor, proof: OrchestrationProof): boolean {
  try {
    return (
      canonicalJson(actor) === canonicalJson(binding.actor) &&
      canonicalJson(proof) === canonicalJson(binding.proof)
    );
  } catch {
    return false;
  }
}

// A new root exists only through the router's persisted routing decision written
// in this same transaction for this exact operation, scope and CreateTicket hash.
async function verifyNewRoot(
  tx: Tx,
  scope: ScopeRow,
  proof: OrchestrationProof,
  actor: Actor,
  targetSha256: string,
): Promise<void> {
  if (!scope.messageId) throw routingRequired();
  const decisions = await tx`select d.*,m.input_revision as current_revision
    from attachment_message_decisions d join attachment_messages m on m.id=d.message_id
    where d.message_id=${scope.messageId} and d.kind='routing' and d.xmin=pg_current_xact_id()::xid
    order by d.id`;
  const body = canonicalJson({
    operationId: proof.operationId,
    scopeId: proof.scopeId,
    ticketSha256: targetSha256,
  });
  const matched = decisions.some((row) => {
    const stored = {
      messageId: String(row.message_id),
      inputRevision: String(row.input_revision),
      snapshotId: nullableId(row.snapshot_id),
      grantId: nullableId(row.grant_id),
      receiptId: nullableId(row.receipt_id),
      kind: 'routing',
      body: row.body,
      actor,
    };
    return (
      canonicalJson(row.body) === body &&
      row.snapshot_id === scope.inputSnapshotId &&
      String(row.input_revision) === String(row.current_revision) &&
      row.actor_kind === actor.kind &&
      row.actor_id === actor.id &&
      digest(stored) === row.sha256
    );
  });
  if (!matched) throw routingRequired();
}

// Every existing target ticket must sit in the scope's exact root (and project).
// Callers already hold the root, ticket and project locks from the shared prefix.
async function verifyMembership(tx: Tx, scope: ScopeRow, ticketIds: readonly Id[]): Promise<void> {
  if (!scope.rootTicketId) throw notFound();
  for (const id of ticketIds) {
    const [row] = await tx`select root_id,project_id from tickets where id=${id.toLowerCase()}`;
    if (
      !row ||
      row.root_id !== scope.rootTicketId ||
      (scope.projectId !== null && row.project_id !== scope.projectId)
    )
      throw notFound();
  }
}

async function verifyTarget(
  tx: Tx,
  scope: ScopeRow,
  binding: Binding,
  actor: Actor,
  targetSha256: string,
): Promise<void> {
  const { target } = binding;
  if (target.action === 'create_ticket') {
    const input = target.payload;
    if (input.parentId === null) {
      if (scope.projectId !== null && input.projectId.toLowerCase() !== scope.projectId) throw notFound();
      return verifyNewRoot(tx, scope, binding.proof, actor, targetSha256);
    }
    return verifyMembership(tx, scope, [input.parentId]);
  }
  if (target.action === 'dependency')
    return verifyMembership(tx, scope, [target.payload.ticketId, target.payload.predecessorId]);
  return verifyMembership(tx, scope, [target.payload.ticketId]);
}

function persistedAuthority(resolver: PersistedAssistantActorResolver) {
  const resolve = resolver;
  const bindings = new WeakMap<Tx, Binding>();
  const authority: ProjectOrchestrationAuthority = Object.freeze({
    async verify(
      tx: Tx,
      actor: Actor,
      proof: OrchestrationProof,
      action: OrchestrationAction,
      targetSha256: string,
    ): Promise<void> {
      const binding = bindings.get(tx);
      if (
        !binding ||
        binding.used ||
        binding.target.action !== action ||
        binding.targetSha256 !== targetSha256 ||
        !sameIdentity(binding, actor, proof)
      )
        throw invalidScope();
      binding.used = true;
      const resolved = await resolve(tx, binding.proof);
      if (binding.actor.kind !== 'machine' || binding.actor.id !== resolved.id)
        throw new ApiError('ORCHESTRATION_ACTOR_MISMATCH', 403, 'Máy gọi không phải máy Trợ lý hiện hành');
      const [scope] = await tx`select root_ticket_id,message_id,project_id,actions,input_snapshot_id
        from assistant_scopes where id=${binding.proof.scopeId}`;
      if (!scope) throw new ApiError('ASSISTANT_SCOPE_NOT_FOUND', 404, 'Không tìm thấy phạm vi Trợ lý');
      if (!Array.isArray(scope.actions) || !scope.actions.includes(action))
        throw new ApiError('ORCHESTRATION_ACTION_NOT_IN_SCOPE', 403, 'Hành động ngoài phạm vi Trợ lý');
      const [operation] = await tx`select turn_id,state,input_snapshot_id from assistant_tool_operations
        where operation_id=${binding.proof.operationId} for update`;
      if (!operation || operation.turn_id !== binding.proof.fence.turnId || operation.state !== 'pending')
        throw new ApiError('ASSISTANT_OPERATION_NOT_FOUND', 404, 'Không tìm thấy thao tác Trợ lý');
      if (operation.input_snapshot_id !== scope.input_snapshot_id)
        throw new ApiError('ASSISTANT_OPERATION_STALE', 409, 'Thao tác Trợ lý không cùng input của phạm vi');
      await verifyTarget(
        tx,
        {
          rootTicketId: nullableId(scope.root_ticket_id),
          messageId: nullableId(scope.message_id),
          projectId: nullableId(scope.project_id),
          inputSnapshotId: String(scope.input_snapshot_id),
        },
        binding,
        resolved,
        targetSha256,
      );
    },
  });
  // Records the port's own captured call so verify can check target membership;
  // it grants nothing: every permission still comes from persisted rows above.
  async function withTarget<R>(
    tx: Tx,
    actor: Actor,
    proof: OrchestrationProof,
    target: Target,
    run: () => Promise<R>,
  ): Promise<R> {
    if (bindings.has(tx)) throw invalidScope();
    bindings.set(tx, {
      target,
      targetSha256: orchestrationTargetHash(target.action, target.payload),
      actor,
      proof,
      used: false,
    });
    try {
      return await run();
    } finally {
      bindings.delete(tx);
    }
  }
  return { authority, withTarget };
}

/**
 * Persisted A2 authority. Membership needs the exact captured target, so only the
 * port of this module can supply it; a bare verify call always fails closed.
 */
export function createPersistedOrchestrationAuthority(
  resolver: PersistedAssistantActorResolver,
): ProjectOrchestrationAuthority {
  return persistedAuthority(resolver).authority;
}

export type ProjectOrchestrationPortDependencies = {
  tickets?: Omit<TicketServiceDependencies, 'assistant'>;
  resolver: PersistedAssistantActorResolver;
};

/**
 * Real G1 port over the scoped ticket writers. Each call snapshots its arguments
 * synchronously, then the writer locks root → sorted tickets → project before the
 * persisted authority verifies. `command` stays unreleased until execution owns it.
 */
export function createProjectOrchestrationPort(
  deps: ProjectOrchestrationPortDependencies,
): ProjectOrchestrationPort {
  const { authority, withTarget } = persistedAuthority(deps.resolver);
  const services = createTicketServices({ ...deps.tickets, assistant: authority });
  return Object.freeze({
    async createTicket(tx: Tx, actor: Actor, proof: OrchestrationProof, input: CreateTicket) {
      const call = immutableSnapshot({ actor, proof, input });
      return withTarget(tx, call.actor, call.proof, { action: 'create_ticket', payload: call.input }, () =>
        services.assistantCreateTicket(tx, call.actor, call.proof, call.input),
      );
    },
    async decision(tx: Tx, actor: Actor, proof: OrchestrationProof, ticketId: Id, input: DecisionInput) {
      const call = immutableSnapshot({ actor, proof, ticketId, input });
      return withTarget(
        tx,
        call.actor,
        call.proof,
        { action: 'decision', payload: { ticketId: call.ticketId, input: call.input } },
        () => services.assistantRecordDecision(tx, call.actor, call.proof, call.ticketId, call.input),
      );
    },
    async dependency(
      tx: Tx,
      actor: Actor,
      proof: OrchestrationProof,
      ticketId: Id,
      predecessorId: Id,
      expectedRevision: number,
    ) {
      const call = immutableSnapshot({ actor, proof, ticketId, predecessorId, expectedRevision });
      const payload = {
        ticketId: call.ticketId,
        predecessorId: call.predecessorId,
        expectedRevision: call.expectedRevision,
      };
      return withTarget(tx, call.actor, call.proof, { action: 'dependency', payload }, () =>
        services.assistantAddDependency(
          tx,
          call.actor,
          call.proof,
          payload.ticketId,
          payload.predecessorId,
          payload.expectedRevision,
        ),
      );
    },
    async command(): Promise<never> {
      throw new ApiError('ORCHESTRATION_COMMAND_NOT_RELEASED', 503, 'Lệnh điều phối chưa được phát hành');
    },
    async signal(
      tx: Tx,
      actor: Actor,
      proof: OrchestrationProof,
      ticketId: Id,
      signal: AssistantSignal,
      expectedRevision: number,
    ) {
      const call = immutableSnapshot({ actor, proof, ticketId, signal, expectedRevision });
      const payload = {
        ticketId: call.ticketId,
        signal: call.signal,
        expectedRevision: call.expectedRevision,
      };
      return withTarget(tx, call.actor, call.proof, { action: 'signal', payload }, () =>
        services.assistantSignalTicket(
          tx,
          call.actor,
          call.proof,
          payload.ticketId,
          payload.signal,
          payload.expectedRevision,
        ),
      );
    },
  });
}
