import { createHash } from 'node:crypto';
import { digest } from '../attachments/submissions.ts';
import { canonicalJson } from '../journal/canonical.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import {
  immutableSnapshot,
  invalidScope,
  orchestrationTargetHash,
  uuid,
} from '../tickets/assistant-access.ts';
import type { CreateTicket, DecisionInput, Ticket, TicketServiceDependencies } from '../tickets/contracts.ts';
import { createTicketServices } from '../tickets/service.ts';
import type { PersistedAssistantActorResolver } from './authority.ts';
import type {
  OrchestrationAction,
  OrchestrationProof,
  ProjectOrchestrationAuthority,
  ProjectOrchestrationPort,
  Sha256,
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
  element?: GraphElement;
};

/** Child ticket of the run root, keyed by its pre-allocated step operation ID. */
export type RunGraphTicket = { key: Id; input: CreateTicket };
/** Dependency edge between two graph tickets, keyed by its own operation ID. */
export type RunGraphEdge = { key: Id; ticketKey: Id; predecessorKey: Id };
/** Exact set of mutations one pending `create_run` operation may authorize. */
export type RunGraph = { runId: Id; rootTicketId: Id; tickets: RunGraphTicket[]; edges: RunGraphEdge[] };
export interface RunGraphSession {
  createTicket(tx: Tx, key: Id, input: CreateTicket): Promise<Ticket>;
  dependency(tx: Tx, ticketId: Id, predecessorId: Id, expectedRevision: number): Promise<void>;
  /** Every element must be used exactly once; afterwards the session is spent. */
  close(tx: Tx): void;
}
export interface WorkflowOrchestrationPort extends ProjectOrchestrationPort {
  authorizeGraph(
    tx: Tx,
    actor: Actor,
    proof: OrchestrationProof,
    graph: RunGraph,
    graphSha256: Sha256,
  ): Promise<RunGraphSession>;
}
type GraphEntry = {
  tx: Tx;
  actor: Actor;
  proof: OrchestrationProof;
  rootTicketId: Id;
  tickets: Map<Id, { hash: string; used: boolean; ticketId: Id | null }>;
  edges: Map<Id, { ticketKey: Id; predecessorKey: Id; used: boolean }>;
  closed: boolean;
};
type GraphElement = { graph: GraphEntry; kind: 'ticket' | 'edge'; key: Id };
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
const operationNotFound = () =>
  new ApiError('ASSISTANT_OPERATION_NOT_FOUND', 404, 'Không tìm thấy thao tác Trợ lý');
const targetNotAuthorized = () =>
  new ApiError('ORCHESTRATION_TARGET_NOT_AUTHORIZED', 403, 'Thao tác ngoài tập đã được duyệt');
const targetConsumed = () =>
  new ApiError('ORCHESTRATION_TARGET_CONSUMED', 409, 'Phần tử của tập đã được dùng');
const graphInvalid = () => new ApiError('VALIDATION', 400, 'Đồ thị điều phối không hợp lệ');
const lowerUuid = (value: unknown): value is Id =>
  typeof value === 'string' && uuid.test(value) && value === value.toLowerCase();

/** Canonical digest of the exact graph a `create_run` operation authorizes. */
export function runGraphSha256(graph: RunGraph): Sha256 {
  return createHash('sha256')
    .update(canonicalJson(['crew-v2:orchestration-graph:1', graph]))
    .digest('hex');
}

// Shape only: children of the one root, unique lowercase keys, edges between graph tickets.
function assertGraphShape(graph: RunGraph): void {
  const plain = (value: unknown, keys: string[]): value is Record<string, unknown> =>
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
  if (
    !plain(graph, ['runId', 'rootTicketId', 'tickets', 'edges']) ||
    !lowerUuid(graph.runId) ||
    !lowerUuid(graph.rootTicketId) ||
    !Array.isArray(graph.tickets) ||
    !Array.isArray(graph.edges) ||
    graph.tickets.length < 1 ||
    graph.tickets.length > 64 ||
    graph.edges.length > 256
  )
    throw graphInvalid();
  const keys = new Set<string>();
  const pairs = new Set<string>();
  for (const ticket of graph.tickets) {
    if (
      !plain(ticket, ['key', 'input']) ||
      !lowerUuid(ticket.key) ||
      keys.has(ticket.key) ||
      !ticket.input ||
      typeof ticket.input !== 'object' ||
      ticket.input.parentId !== graph.rootTicketId ||
      ticket.input.level !== 'step'
    )
      throw graphInvalid();
    keys.add(ticket.key);
  }
  const ticketKeys = new Set(keys);
  for (const edge of graph.edges) {
    if (
      !plain(edge, ['key', 'ticketKey', 'predecessorKey']) ||
      !lowerUuid(edge.key) ||
      keys.has(edge.key) ||
      !ticketKeys.has(edge.ticketKey) ||
      !ticketKeys.has(edge.predecessorKey) ||
      edge.ticketKey === edge.predecessorKey
    )
      throw graphInvalid();
    const pair = `${edge.ticketKey}>${edge.predecessorKey}`;
    if (pairs.has(pair)) throw graphInvalid();
    keys.add(edge.key);
    pairs.add(pair);
  }
}

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
// The message row is share-locked so its input revision cannot move under the check.
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
    order by d.id for share of m`;
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
  const graphs = new WeakMap<Tx, GraphEntry>();
  // Each operation row authorizes exactly one mutation in its own Tx.
  const consumed = new WeakMap<Tx, Set<string>>();
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
      if (binding.element) return verifyGraphElement(tx, binding, binding.element, action, targetSha256);
      const resolved = await resolve(tx, binding.proof);
      if (binding.actor.kind !== 'machine' || binding.actor.id !== resolved.id)
        throw new ApiError('ORCHESTRATION_ACTOR_MISMATCH', 403, 'Máy gọi không phải máy Trợ lý hiện hành');
      const [scope] = await tx`select root_ticket_id,message_id,project_id,actions,input_snapshot_id
        from assistant_scopes where id=${binding.proof.scopeId}`;
      if (!scope) throw new ApiError('ASSISTANT_SCOPE_NOT_FOUND', 404, 'Không tìm thấy phạm vi Trợ lý');
      if (!Array.isArray(scope.actions) || !scope.actions.includes(action))
        throw new ApiError('ORCHESTRATION_ACTION_NOT_IN_SCOPE', 403, 'Hành động ngoài phạm vi Trợ lý');
      // The tools route writes the pending row in this same Tx before calling the port.
      const [operation] =
        await tx`select operation_id,turn_id,state,input_snapshot_id from assistant_tool_operations
        where operation_id=${binding.proof.operationId} and xmin=pg_current_xact_id()::xid for update`;
      if (!operation || operation.turn_id !== binding.proof.fence.turnId || operation.state !== 'pending')
        throw new ApiError('ASSISTANT_OPERATION_NOT_FOUND', 404, 'Không tìm thấy thao tác Trợ lý');
      if (operation.input_snapshot_id !== scope.input_snapshot_id)
        throw new ApiError('ASSISTANT_OPERATION_STALE', 409, 'Thao tác Trợ lý không cùng input của phạm vi');
      const used = consumed.get(tx) ?? new Set<string>();
      consumed.set(tx, used);
      const operationKey = String(operation.operation_id);
      if (used.has(operationKey))
        throw new ApiError('ASSISTANT_OPERATION_CONSUMED', 409, 'Thao tác Trợ lý đã được dùng');
      used.add(operationKey);
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
  // One element of the graph authorized for this Tx. The pending `create_run` operation
  // was consumed once by authorizeGraph; each element is consumed here exactly once and
  // the Actor, scope and root membership are re-resolved from persisted rows every time.
  async function verifyGraphElement(
    tx: Tx,
    binding: Binding,
    element: GraphElement,
    action: OrchestrationAction,
    targetSha256: string,
  ): Promise<void> {
    const { graph } = element;
    if (
      graphs.get(tx) !== graph ||
      graph.tx !== tx ||
      graph.closed ||
      canonicalJson(binding.actor) !== canonicalJson(graph.actor) ||
      canonicalJson(binding.proof) !== canonicalJson(graph.proof)
    )
      throw invalidScope();
    const { target } = binding;
    let members: Id[];
    if (element.kind === 'ticket') {
      const ticket = graph.tickets.get(element.key);
      if (!ticket || target.action !== 'create_ticket' || ticket.hash !== targetSha256)
        throw targetNotAuthorized();
      if (ticket.used) throw targetConsumed();
      ticket.used = true;
      members = [graph.rootTicketId];
    } else {
      const edge = graph.edges.get(element.key);
      if (!edge || target.action !== 'dependency') throw targetNotAuthorized();
      const ticketId = graph.tickets.get(edge.ticketKey)?.ticketId;
      const predecessorId = graph.tickets.get(edge.predecessorKey)?.ticketId;
      if (
        !ticketId ||
        !predecessorId ||
        target.payload.ticketId.toLowerCase() !== ticketId ||
        target.payload.predecessorId.toLowerCase() !== predecessorId
      )
        throw targetNotAuthorized();
      if (edge.used) throw targetConsumed();
      edge.used = true;
      members = [ticketId, predecessorId];
    }
    const resolved = await resolve(tx, graph.proof);
    if (graph.actor.kind !== 'machine' || graph.actor.id !== resolved.id)
      throw new ApiError('ORCHESTRATION_ACTOR_MISMATCH', 403, 'Máy gọi không phải máy Trợ lý hiện hành');
    const [scope] = await tx`select root_ticket_id,project_id,actions,input_snapshot_id
      from assistant_scopes where id=${graph.proof.scopeId}`;
    if (!scope || scope.root_ticket_id !== graph.rootTicketId) throw notFound();
    if (!Array.isArray(scope.actions) || !scope.actions.includes(action))
      throw new ApiError('ORCHESTRATION_ACTION_NOT_IN_SCOPE', 403, 'Hành động ngoài phạm vi Trợ lý');
    await verifyMembership(
      tx,
      {
        rootTicketId: graph.rootTicketId,
        messageId: null,
        projectId: nullableId(scope.project_id),
        inputSnapshotId: String(scope.input_snapshot_id),
      },
      members,
    );
  }
  /**
   * Consumes one pending `create_run` operation written in this Tx and binds it to the
   * exact hashed graph. Locks root → project before the persisted Actor resolves.
   */
  async function authorizeGraph(
    tx: Tx,
    actor: Actor,
    proof: OrchestrationProof,
    graph: RunGraph,
    graphSha256: string,
  ): Promise<GraphEntry> {
    assertGraphShape(graph);
    if (graphSha256 !== runGraphSha256(graph)) throw invalidScope();
    if (graphs.has(tx) || bindings.has(tx)) throw invalidScope();
    if (actor.kind !== 'machine' || !uuid.test(actor.id))
      throw new ApiError('ORCHESTRATION_MACHINE_REQUIRED', 403, 'Chỉ máy trợ lý được điều phối');
    const [root] =
      await tx`select id,root_id,project_id,level from tickets where id=${graph.rootTicketId} for update`;
    if (!root || root.root_id !== root.id || root.level !== 'request') throw notFound();
    await tx`select id from projects where id=${root.project_id} for update`;
    const resolved = await resolve(tx, proof);
    if (actor.id !== resolved.id)
      throw new ApiError('ORCHESTRATION_ACTOR_MISMATCH', 403, 'Máy gọi không phải máy Trợ lý hiện hành');
    const [scope] = await tx`select root_ticket_id,project_id,actions,tool_names,input_snapshot_id
      from assistant_scopes where id=${proof.scopeId}`;
    if (!scope) throw new ApiError('ASSISTANT_SCOPE_NOT_FOUND', 404, 'Không tìm thấy phạm vi Trợ lý');
    if (scope.root_ticket_id !== graph.rootTicketId || scope.project_id !== root.project_id) throw notFound();
    const needed: OrchestrationAction[] = graph.edges.length
      ? ['create_ticket', 'dependency']
      : ['create_ticket'];
    if (
      !Array.isArray(scope.actions) ||
      !Array.isArray(scope.tool_names) ||
      !scope.tool_names.includes('create_run') ||
      needed.some((action) => !scope.actions.includes(action))
    )
      throw new ApiError('ORCHESTRATION_ACTION_NOT_IN_SCOPE', 403, 'Hành động ngoài phạm vi Trợ lý');
    const [operation] =
      await tx`select operation_id,turn_id,state,input_snapshot_id from assistant_tool_operations
      where operation_id=${proof.operationId} and xmin=pg_current_xact_id()::xid for update`;
    if (!operation || operation.turn_id !== proof.fence.turnId || operation.state !== 'pending')
      throw operationNotFound();
    if (operation.input_snapshot_id !== scope.input_snapshot_id)
      throw new ApiError('ASSISTANT_OPERATION_STALE', 409, 'Thao tác Trợ lý không cùng input của phạm vi');
    const used = consumed.get(tx) ?? new Set<string>();
    consumed.set(tx, used);
    const operationKey = String(operation.operation_id);
    if (used.has(operationKey))
      throw new ApiError('ASSISTANT_OPERATION_CONSUMED', 409, 'Thao tác Trợ lý đã được dùng');
    used.add(operationKey);
    const entry: GraphEntry = {
      tx,
      actor,
      proof,
      rootTicketId: graph.rootTicketId,
      tickets: new Map(
        graph.tickets.map((ticket) => [
          ticket.key,
          { hash: orchestrationTargetHash('create_ticket', ticket.input), used: false, ticketId: null },
        ]),
      ),
      edges: new Map(
        graph.edges.map((edge) => [
          edge.key,
          { ticketKey: edge.ticketKey, predecessorKey: edge.predecessorKey, used: false },
        ]),
      ),
      closed: false,
    };
    graphs.set(tx, entry);
    return entry;
  }
  // Records the port's own captured call so verify can check target membership;
  // it grants nothing: every permission still comes from persisted rows above.
  async function withTarget<R>(
    tx: Tx,
    actor: Actor,
    proof: OrchestrationProof,
    target: Target,
    run: () => Promise<R>,
    element?: GraphElement,
  ): Promise<R> {
    if (bindings.has(tx)) throw invalidScope();
    bindings.set(tx, {
      target,
      targetSha256: orchestrationTargetHash(target.action, target.payload),
      actor,
      proof,
      used: false,
      ...(element ? { element } : {}),
    });
    try {
      return await run();
    } finally {
      bindings.delete(tx);
    }
  }
  return { authority, withTarget, authorizeGraph };
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
): WorkflowOrchestrationPort {
  const { authority, withTarget, authorizeGraph } = persistedAuthority(deps.resolver);
  const services = createTicketServices({ ...deps.tickets, assistant: authority });
  // A session works only in the Tx that authorized it; any other Tx sees no operation.
  const session = (graph: GraphEntry): RunGraphSession => {
    const current = (tx: Tx) => {
      if (graph.tx !== tx || graph.closed) throw operationNotFound();
    };
    return Object.freeze({
      async createTicket(tx: Tx, key: Id, input: CreateTicket) {
        current(tx);
        const call = immutableSnapshot({ key, input });
        const ticket = graph.tickets.get(call.key);
        if (!ticket) throw targetNotAuthorized();
        if (ticket.used) throw targetConsumed();
        if (ticket.hash !== orchestrationTargetHash('create_ticket', call.input)) throw targetNotAuthorized();
        const created = await withTarget(
          tx,
          graph.actor,
          graph.proof,
          { action: 'create_ticket', payload: call.input },
          () => services.assistantCreateTicket(tx, graph.actor, graph.proof, call.input),
          { graph, kind: 'ticket', key: call.key },
        );
        ticket.ticketId = created.id.toLowerCase();
        return created;
      },
      async dependency(tx: Tx, ticketId: Id, predecessorId: Id, expectedRevision: number) {
        current(tx);
        const call = immutableSnapshot({ ticketId, predecessorId, expectedRevision });
        const keyOf = (id: unknown) =>
          typeof id === 'string'
            ? [...graph.tickets].find(([, ticket]) => ticket.ticketId === id.toLowerCase())?.[0]
            : undefined;
        const ticketKey = keyOf(call.ticketId);
        const predecessorKey = keyOf(call.predecessorId);
        const edge = [...graph.edges].find(
          ([, value]) => value.ticketKey === ticketKey && value.predecessorKey === predecessorKey,
        );
        if (!ticketKey || !predecessorKey || !edge) throw targetNotAuthorized();
        if (edge[1].used) throw targetConsumed();
        const payload = {
          ticketId: call.ticketId,
          predecessorId: call.predecessorId,
          expectedRevision: call.expectedRevision,
        };
        await withTarget(
          tx,
          graph.actor,
          graph.proof,
          { action: 'dependency', payload },
          () =>
            services.assistantAddDependency(
              tx,
              graph.actor,
              graph.proof,
              payload.ticketId,
              payload.predecessorId,
              payload.expectedRevision,
            ),
          { graph, kind: 'edge', key: edge[0] },
        );
      },
      close(tx: Tx) {
        current(tx);
        if ([...graph.tickets.values(), ...graph.edges.values()].some((element) => !element.used))
          throw new ApiError('ORCHESTRATION_GRAPH_INCOMPLETE', 409, 'Đồ thị điều phối chưa hoàn tất');
        graph.closed = true;
      },
    });
  };
  return Object.freeze({
    async authorizeGraph(
      tx: Tx,
      actor: Actor,
      proof: OrchestrationProof,
      graph: RunGraph,
      graphSha256: Sha256,
    ) {
      const call = immutableSnapshot({ actor, proof, graph, graphSha256 });
      return session(await authorizeGraph(tx, call.actor, call.proof, call.graph, call.graphSha256));
    },
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
