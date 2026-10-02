import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../journal/canonical.ts';
import { appendEvent } from '../journal/events.ts';
import type { Actor, Db, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { safeTicketJson } from '../tickets/service.ts';
import type { Command, CreateCommand } from './contracts.ts';

export function mapCommand(row: Record<string, unknown>): Command {
  return {
    id: row.id as Id,
    machineId: row.machine_id as Id,
    ticketId: row.ticket_id as Id,
    type: row.type as Command['type'],
    payload: row.payload as Record<string, unknown>,
    state: row.state as Command['state'],
    result: row.result as Record<string, unknown> | null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function createCommand(tx: Tx, input: CreateCommand, actor: Actor): Promise<Command> {
  if (
    !['start', 'pause', 'cancel', 'resume', 'reconcile'].includes(input.type) ||
    !input.payload ||
    typeof input.payload !== 'object' ||
    Array.isArray(input.payload) ||
    !safeTicketJson(input.payload)
  )
    throw new ApiError('VALIDATION', 400, 'Lệnh không hợp lệ');
  const [scope] = await tx`select root_id from tickets where id=${input.ticketId}`;
  if (!scope) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
  await tx`select id from tickets where id=${scope.root_id} for update`;
  const [ticket] =
    await tx`select t.project_id,t.status,p.machine_id,p.binding_revision,m.revoked_at from tickets t join projects p on p.id=t.project_id join machines m on m.id=${input.machineId} where t.id=${input.ticketId} for update of t,p`;
  if (
    !ticket ||
    ticket.machine_id !== input.machineId ||
    ticket.revoked_at ||
    (actor.kind === 'machine' && actor.id !== input.machineId)
  )
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy đích thực thi');
  if (input.type === 'start' && ticket.status !== 'ready')
    throw new ApiError('TICKET_NOT_READY', 409, 'Ticket chưa sẵn sàng');
  const id = randomUUID();
  const [row] =
    await tx`insert into commands(id,machine_id,ticket_id,binding_revision,type,payload,state) values(${id},${input.machineId},${input.ticketId},${ticket.binding_revision},${input.type},${tx.json(input.payload as never)},'queued') returning *`;
  await appendEvent(tx, {
    type: 'command.created',
    projectId: ticket.project_id as Id,
    ticketId: input.ticketId,
    audienceMachineId: input.machineId,
    data: { commandId: id, type: input.type },
  });
  return mapCommand(row as Record<string, unknown>);
}

export async function ackCommand(
  tx: Tx,
  commandId: Id,
  input: { phase: 'received' | 'completed'; result?: Record<string, unknown> },
  actor: Actor,
): Promise<Command> {
  if (actor.kind !== 'machine') throw new ApiError('MACHINE_REQUIRED', 403, 'Cần máy thực thi');
  if (
    !['received', 'completed'].includes(input.phase) ||
    (input.result !== undefined &&
      (!input.result || Array.isArray(input.result) || !safeTicketJson(input.result)))
  )
    throw new ApiError('VALIDATION', 400, 'Xác nhận không hợp lệ');
  const [row] =
    await tx`select c.*,t.project_id,p.machine_id as bound_machine_id,p.binding_revision as current_binding_revision,m.revoked_at from commands c join tickets t on t.id=c.ticket_id join projects p on p.id=t.project_id join machines m on m.id=c.machine_id where c.id=${commandId} for update of c`;
  if (
    !row ||
    row.machine_id !== actor.id ||
    row.bound_machine_id !== actor.id ||
    row.revoked_at ||
    Number(row.binding_revision) !== Number(row.current_binding_revision)
  )
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lệnh');
  if (row.state === 'completed') {
    if (input.phase === 'completed' && canonicalJson(row.result) === canonicalJson(input.result ?? {}))
      return mapCommand(row);
    throw new ApiError('COMMAND_CONFLICT', 409, 'Lệnh đã hoàn thành với kết quả khác');
  }
  if (input.phase === 'received' && row.state === 'received') return mapCommand(row);
  const result = input.phase === 'completed' ? (input.result ?? {}) : null;
  const [updated] =
    await tx`update commands set state=${input.phase},result=${result ? tx.json(result as never) : null},received_at=coalesce(received_at,now()),completed_at=case when ${input.phase}='completed' then now() else completed_at end where id=${commandId} returning *`;
  await appendEvent(tx, {
    type: 'command.acknowledged',
    projectId: row.project_id as Id,
    ticketId: row.ticket_id as Id,
    audienceMachineId: actor.id,
    data: { commandId, phase: input.phase },
  });
  return mapCommand(updated as Record<string, unknown>);
}

export async function readCommand(db: Db, id: Id, actor: Actor): Promise<Command> {
  if (actor.kind !== 'machine') throw new ApiError('MACHINE_REQUIRED', 403, 'Cần máy thực thi');
  const [row] =
    await db`select c.* from commands c join tickets t on t.id=c.ticket_id join projects p on p.id=t.project_id join machines m on m.id=c.machine_id where c.id=${id} and c.machine_id=${actor.id} and p.machine_id=${actor.id} and p.binding_revision=c.binding_revision and m.revoked_at is null`;
  if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lệnh');
  return mapCommand(row);
}

export async function assertCreateCommandScope(db: Db, input: CreateCommand, actor: Actor): Promise<void> {
  const [row] =
    await db`select p.machine_id,m.revoked_at from tickets t join projects p on p.id=t.project_id join machines m on m.id=${input.machineId} where t.id=${input.ticketId}`;
  if (
    !row ||
    row.machine_id !== input.machineId ||
    row.revoked_at ||
    (actor.kind === 'machine' && actor.id !== input.machineId)
  )
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy đích thực thi');
}

export async function assertCommandReplayScope(db: Db, actor: Actor, key: string): Promise<void> {
  const [stored] =
    await db`select response from idempotency where actor_kind=${actor.kind} and actor_id=${actor.id} and route='POST:/v2/commands' and key=${key}`;
  if (!stored) return;
  const id = stored.response?.id;
  if (typeof id !== 'string') throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lệnh');
  const [row] =
    await db`select c.id from commands c join tickets t on t.id=c.ticket_id join projects p on p.id=t.project_id join machines m on m.id=c.machine_id where c.id=${id} and p.machine_id=c.machine_id and p.binding_revision=c.binding_revision and m.revoked_at is null and (${actor.kind === 'owner'} or c.machine_id=${actor.id === 'owner' ? null : actor.id}::uuid)`;
  if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lệnh');
}

async function lockTargetScope(
  tx: Tx,
  ticketId: Id,
  machineId: Id,
  actor: Actor,
): Promise<{ bindingRevision: number }> {
  const [scope] = await tx`select root_id,project_id from tickets where id=${ticketId}`;
  if (!scope) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy đích thực thi');
  await tx`select id from tickets where id=${scope.root_id} for update`;
  await tx`select id from tickets where id=${ticketId} for update`;
  const [project] =
    await tx`select machine_id,binding_revision from projects where id=${scope.project_id} for update`;
  const [host] = await tx`select revoked_at from machines where id=${machineId}`;
  if (
    !project ||
    !host ||
    host.revoked_at ||
    project.machine_id !== machineId ||
    (actor.kind === 'machine' && actor.id !== machineId)
  )
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy đích thực thi');
  return { bindingRevision: Number(project.binding_revision) };
}

export async function authorizeCreateCommandMutation(
  tx: Tx,
  input: CreateCommand,
  actor: Actor,
  key: string,
): Promise<void> {
  const binding = await lockTargetScope(tx, input.ticketId, input.machineId, actor);
  const [stored] =
    await tx`select response from idempotency where actor_kind=${actor.kind} and actor_id=${actor.id} and route='POST:/v2/commands' and key=${key}`;
  if (!stored) return;
  const id = stored.response?.id;
  if (typeof id !== 'string') throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lệnh');
  const [command] = await tx`select machine_id,ticket_id,binding_revision from commands where id=${id}`;
  if (
    !command ||
    command.machine_id !== input.machineId ||
    command.ticket_id !== input.ticketId ||
    Number(command.binding_revision) !== binding.bindingRevision
  )
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lệnh');
}

export async function authorizeCommandMutation(tx: Tx, id: Id, actor: Actor): Promise<void> {
  const [command] = await tx`select ticket_id,machine_id,binding_revision from commands where id=${id}`;
  if (!command) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lệnh');
  const binding = await lockTargetScope(tx, command.ticket_id as Id, command.machine_id as Id, actor);
  if (Number(command.binding_revision) !== binding.bindingRevision)
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lệnh');
}

export async function listCommands(
  db: Db,
  actor: Actor,
  after: Id | null,
  limit: number,
): Promise<{ items: Command[]; nextCursor: Id | null }> {
  if (actor.kind !== 'machine') throw new ApiError('MACHINE_REQUIRED', 403, 'Cần máy thực thi');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new ApiError('LIMIT_INVALID', 400, 'Giới hạn không hợp lệ');
  return db.begin(async (tx) => {
    const [machine] = await tx`select id from machines where id=${actor.id} and revoked_at is null`;
    if (!machine) throw new ApiError('MACHINE_REVOKED', 403, 'Máy không còn quyền');
    let anchor: { created_at: Date; id: Id } | undefined;
    if (after) {
      const [found] =
        await tx`select c.created_at,c.id from commands c join tickets t on t.id=c.ticket_id join projects p on p.id=t.project_id where c.id=${after} and c.machine_id=${actor.id} and p.machine_id=${actor.id} and p.binding_revision=c.binding_revision`;
      anchor = found as { created_at: Date; id: Id } | undefined;
      if (!anchor) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy con trỏ lệnh');
    }
    const rows =
      await tx`select c.* from commands c join tickets t on t.id=c.ticket_id join projects p on p.id=t.project_id where c.machine_id=${actor.id} and p.machine_id=${actor.id} and p.binding_revision=c.binding_revision and c.state in ('queued','received') and (${anchor?.created_at ?? null}::timestamptz is null or (c.created_at,c.id)>(${anchor?.created_at ?? null}::timestamptz,${anchor?.id ?? null}::uuid)) order by c.created_at,c.id limit ${limit + 1}`;
    const items = rows.slice(0, limit).map(mapCommand);
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  });
}
