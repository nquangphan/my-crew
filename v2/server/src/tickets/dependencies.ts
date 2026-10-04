import type { OrchestrationProof, ProjectOrchestrationAuthority } from '../assistant/contracts.ts';
import { appendEvent } from '../journal/events.ts';
import type { Actor, Db, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { PreparedAssistantTarget, VerifiedAssistantScope } from './assistant-access.ts';
import {
  captureAssistantOperation,
  consumeAssistantScope,
  createAssistantAccess,
} from './assistant-access.ts';
import type { Dependency, RepairLink, Ticket } from './contracts.ts';
import { mapTicket, requireTicket } from './service.ts';

type DependencyPayload = { ticketId: Id; predecessorId: Id; expectedRevision: number };
type DependencyState = {
  root: { status: unknown } | undefined;
  ticket: { revision: unknown; status: unknown } | undefined;
  projectId: Id;
};
type DependencyPermission = {
  prepared: PreparedAssistantTarget<DependencyPayload>;
  scope: VerifiedAssistantScope<DependencyPayload>;
};

function validateDependencyInput(ticketId: Id, predecessorId: Id, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    throw new ApiError('VALIDATION', 400, 'Revision không hợp lệ');
  if (ticketId === predecessorId)
    throw new ApiError('DEPENDENCY_CYCLE', 409, 'Ticket không thể phụ thuộc chính nó');
}

async function prepareDependency(tx: Tx, ticketId: Id, predecessorId: Id): Promise<DependencyState> {
  const [a] = await tx`select project_id,root_id from tickets where id=${ticketId}`;
  const [b] = await tx`select project_id,root_id from tickets where id=${predecessorId}`;
  if (!a || !b) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
  if (a.root_id !== b.root_id || a.project_id !== b.project_id)
    throw new ApiError('DEPENDENCY_SCOPE', 409, 'Phụ thuộc phải cùng yêu cầu');
  // Every graph mutation acquires its root row first, serializing opposite edges on independent transactions.
  const [root] = await tx`select id,status from tickets where id=${a.root_id} for update`;
  const [ticket] = await tx`select id,revision,status from tickets where id=${ticketId} for update`;
  return {
    root: root ? { status: root.status } : undefined,
    ticket: ticket ? { revision: ticket.revision, status: ticket.status } : undefined,
    projectId: a.project_id as Id,
  };
}

async function validateDependency(
  tx: Tx,
  ticketId: Id,
  predecessorId: Id,
  expectedRevision: number,
  state: DependencyState,
): Promise<void> {
  const { root, ticket } = state;
  if (!root || root.status === 'done' || root.status === 'cancelled')
    throw new ApiError('TICKET_CLOSED', 409, 'Cây ticket đã kết thúc');
  if (Number(ticket?.revision) !== expectedRevision)
    throw new ApiError('REVISION_CONFLICT', 409, 'Ticket đã thay đổi');
  if (!['pending', 'needs_input', 'paused'].includes(ticket?.status as string))
    throw new ApiError('DEPENDENCY_EDIT_NOT_ALLOWED', 409, 'Ticket đã sẵn sàng hoặc đang chạy');
  const [cycle] = await tx`with recursive predecessors(id) as (
    select ${predecessorId}::uuid
    union
    select d.predecessor_id from dependencies d join predecessors p on p.id=d.ticket_id
  ) select 1 from predecessors where id=${ticketId} limit 1`;
  if (cycle) throw new ApiError('DEPENDENCY_CYCLE', 409, 'Phụ thuộc tạo vòng lặp');
  const [existing] =
    await tx`select 1 from dependencies where ticket_id=${ticketId} and predecessor_id=${predecessorId}`;
  if (existing) throw new ApiError('DEPENDENCY_EXISTS', 409, 'Phụ thuộc đã tồn tại');
}

async function persistDependency(
  tx: Tx,
  ticketId: Id,
  predecessorId: Id,
  projectId: Id,
  permission?: DependencyPermission,
): Promise<Dependency> {
  if (permission) {
    const operation = permission.prepared.operation;
    if (
      operation.action !== 'dependency' ||
      operation.payload.ticketId !== ticketId ||
      operation.payload.predecessorId !== predecessorId ||
      permission.prepared.projectId !== projectId
    )
      throw new ApiError('ORCHESTRATION_SCOPE_INVALID', 403, 'Phạm vi điều phối không khớp');
    consumeAssistantScope(tx, permission.scope, operation, permission.prepared);
  }
  try {
    await tx`insert into dependencies(ticket_id,predecessor_id) values (${ticketId},${predecessorId})`;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw new ApiError('DEPENDENCY_EXISTS', 409, 'Phụ thuộc đã tồn tại');
    throw error;
  }
  const [updated] = await tx`update tickets set revision=revision+1 where id=${ticketId} returning revision`;
  await appendEvent(tx, {
    type: 'dependency.added',
    projectId,
    ticketId,
    audienceMachineId: null,
    data: { predecessorId, revision: Number(updated?.revision) },
  });
  return { ticketId, predecessorId };
}

export async function addDependency(
  tx: Tx,
  ticketId: Id,
  predecessorId: Id,
  expectedRevision: number,
): Promise<Dependency> {
  validateDependencyInput(ticketId, predecessorId, expectedRevision);
  const state = await prepareDependency(tx, ticketId, predecessorId);
  await validateDependency(tx, ticketId, predecessorId, expectedRevision, state);
  return persistDependency(tx, ticketId, predecessorId, state.projectId);
}

export function createAssistantDependencyWriter(authority?: ProjectOrchestrationAuthority) {
  const access = createAssistantAccess(authority);
  return async (
    tx: Tx,
    actor: Actor,
    proof: OrchestrationProof,
    ticketId: Id,
    predecessorId: Id,
    expectedRevision: number,
  ): Promise<void> => {
    const operation = captureAssistantOperation(actor, proof, 'dependency', {
      ticketId,
      predecessorId,
      expectedRevision,
    });
    const payload = operation.payload;
    validateDependencyInput(payload.ticketId, payload.predecessorId, payload.expectedRevision);
    const prepared = await access.prepare(tx, operation, [payload.ticketId, payload.predecessorId]);
    const ticket = prepared.tickets.find((row) => row.id === payload.ticketId.toLowerCase());
    await validateDependency(tx, payload.ticketId, payload.predecessorId, payload.expectedRevision, {
      root: prepared.root,
      ticket,
      projectId: prepared.projectId,
    });
    const scope = await access.authorize(tx, prepared);
    await persistDependency(tx, payload.ticketId, payload.predecessorId, prepared.projectId, {
      prepared,
      scope,
    });
  };
}

export async function readGraph(
  db: Db,
  ticketId: Id,
  actor: Actor,
): Promise<{
  nodes: Ticket[];
  dependencies: Dependency[];
  repairLinks: RepairLink[];
}> {
  return db.begin(async (tx) => {
    const ticket = await requireTicket(tx, ticketId, actor);
    const nodes = await tx`select * from tickets where root_id=${ticket.rootId} order by id`;
    const dependencies = await tx`select d.ticket_id,d.predecessor_id from dependencies d
      join tickets t on t.id=d.ticket_id where t.root_id=${ticket.rootId} order by d.ticket_id,d.predecessor_id`;
    const repairLinks = await tx`select r.check_step_id,r.fix_ticket_id,r.cycle_id from repair_links r
      join tickets t on t.id=r.check_step_id where t.root_id=${ticket.rootId} order by r.check_step_id,r.cycle_id`;
    return {
      nodes: nodes.map(mapTicket),
      dependencies: dependencies.map((row) => ({
        ticketId: row.ticket_id as Id,
        predecessorId: row.predecessor_id as Id,
      })),
      repairLinks: repairLinks.map((row) => ({
        checkStepId: row.check_step_id as Id,
        fixTicketId: row.fix_ticket_id as Id,
        cycleId: row.cycle_id as Id,
      })),
    };
  });
}
