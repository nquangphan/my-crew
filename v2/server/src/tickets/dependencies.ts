import { appendEvent } from '../journal/events.ts';
import type { Actor, Db, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { Dependency, RepairLink, Ticket } from './contracts.ts';
import { mapTicket, requireTicket } from './service.ts';

export async function addDependency(
  tx: Tx,
  ticketId: Id,
  predecessorId: Id,
  expectedRevision: number,
): Promise<Dependency> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    throw new ApiError('VALIDATION', 400, 'Revision không hợp lệ');
  if (ticketId === predecessorId)
    throw new ApiError('DEPENDENCY_CYCLE', 409, 'Ticket không thể phụ thuộc chính nó');
  const [a] = await tx`select project_id,root_id from tickets where id=${ticketId}`;
  const [b] = await tx`select project_id,root_id from tickets where id=${predecessorId}`;
  if (!a || !b) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
  if (a.root_id !== b.root_id || a.project_id !== b.project_id)
    throw new ApiError('DEPENDENCY_SCOPE', 409, 'Phụ thuộc phải cùng yêu cầu');
  // Every graph mutation acquires its root row first, serializing opposite edges on independent transactions.
  await tx`select id from tickets where id=${a.root_id} for update`;
  const [ticket] = await tx`select id,revision,status from tickets where id=${ticketId} for update`;
  if (Number(ticket?.revision) !== expectedRevision)
    throw new ApiError('REVISION_CONFLICT', 409, 'Ticket đã thay đổi');
  if (ticket?.status === 'done' || ticket?.status === 'cancelled')
    throw new ApiError('INVALID_TICKET_TRANSITION', 409, 'Ticket đã kết thúc');
  const [cycle] = await tx`with recursive predecessors(id) as (
    select ${predecessorId}::uuid
    union
    select d.predecessor_id from dependencies d join predecessors p on p.id=d.ticket_id
  ) select 1 from predecessors where id=${ticketId} limit 1`;
  if (cycle) throw new ApiError('DEPENDENCY_CYCLE', 409, 'Phụ thuộc tạo vòng lặp');
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
    projectId: a.project_id as Id,
    ticketId,
    audienceMachineId: null,
    data: { predecessorId, revision: Number(updated?.revision) },
  });
  return { ticketId, predecessorId };
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
