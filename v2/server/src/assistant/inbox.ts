import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../journal/canonical.ts';
import { parseCursor } from '../journal/events.ts';
import type { Event, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { TurnFence } from './contracts.ts';
import { assertAssistantId, assertCurrentTurnFence } from './store.ts';

const inputEvents = new Set([
  'assistant.message.created',
  'attachment.input.changed',
  'comment.created',
  'attachment.changed',
]);
const lifecycleEvents = new Set([
  'ticket.created',
  'ticket.changed',
  'dependency.added',
  'decision.created',
  'repair.recorded',
  'command.created',
  'command.acknowledged',
  'attempt.claimed',
  'attempt.checkpoint',
  'attempt.stopped',
  'attempt.finalized',
]);
type Target = { kind: 'message' | 'ticket'; id: Id; revision: string | null };

async function insertWork(tx: Tx, target: Target, cursor: string | null): Promise<void> {
  const logicalKey =
    cursor === null
      ? `reconcile:${target.kind}:${target.id}:${target.revision}`
      : `event:${cursor}:${target.kind}:${target.id}:${target.revision ?? 'lifecycle'}`;
  await tx`insert into assistant_work_inbox(id,logical_key,source_cursor,target_kind,target_id,input_revision,state)
    values(${randomUUID()},${logicalKey},${cursor},${target.kind},${target.id},${target.revision},'pending')
    on conflict do nothing`;
}

async function inputTargets(tx: Tx, event: Event): Promise<Target[]> {
  if (
    event.type === 'assistant.message.created' ||
    (event.type === 'attachment.input.changed' && event.data.targetKind === 'message')
  ) {
    const id = event.type === 'assistant.message.created' ? event.data.messageId : event.data.targetId;
    assertAssistantId(id);
    const [message] = await tx`select id,input_revision from attachment_messages where id=${id}`;
    return message
      ? [{ kind: 'message', id: String(message.id), revision: String(message.input_revision) }]
      : [];
  }
  if (!event.ticketId || !event.projectId) return [];
  // Only comments are inherited by every current descendant. Other scoped input
  // events already name the target whose 009 producer owns its revision.
  const descendants = event.type === 'comment.created';
  const rows = descendants
    ? await tx`with recursive affected as (
        select id from tickets where id=${event.ticketId} and project_id=${event.projectId}
        union all select t.id from tickets t join affected a on t.parent_id=a.id
      ) select t.id,coalesce(r.revision,1) as revision from tickets t join affected a on a.id=t.id
      left join attachment_input_revisions r on r.target_kind='ticket' and r.target_id=t.id order by t.id`
    : await tx`select t.id,coalesce(r.revision,1) as revision from tickets t
      left join attachment_input_revisions r on r.target_kind='ticket' and r.target_id=t.id
      where t.id=${event.ticketId} and t.project_id=${event.projectId}`;
  return rows.map((row) => ({ kind: 'ticket', id: String(row.id), revision: String(row.revision) }));
}

async function fanout(tx: Tx, event: Event): Promise<void> {
  if (inputEvents.has(event.type)) {
    for (const target of await inputTargets(tx, event)) await insertWork(tx, target, event.cursor);
  } else if (lifecycleEvents.has(event.type) && event.ticketId && event.projectId) {
    const [ticket] =
      await tx`select id from tickets where id=${event.ticketId} and project_id=${event.projectId}`;
    if (ticket) await insertWork(tx, { kind: 'ticket', id: event.ticketId, revision: null }, event.cursor);
  }
}

function eventRow(row: Record<string, unknown>): Event {
  return {
    cursor: String(row.cursor),
    type: String(row.type),
    projectId: row.project_id as Id | null,
    ticketId: row.ticket_id as Id | null,
    audienceMachineId: row.audience_machine_id as Id | null,
    occurredAt: new Date(String(row.occurred_at)).toISOString(),
    data: row.data as Record<string, unknown>,
  };
}

export async function enqueueWork(tx: Tx, event: Event): Promise<void> {
  const cursor = parseCursor(event.cursor);
  await tx`select value from event_cursor where singleton=true for update`;
  const [row] = await tx`select * from events where cursor=${cursor}`;
  if (!row || canonicalJson(eventRow(row)) !== canonicalJson(event))
    throw new ApiError('ASSISTANT_EVENT_MISMATCH', 409, 'Sự kiện không khớp journal đã lưu');
  await fanout(tx, eventRow(row));
}

export async function ingestEvents(tx: Tx, through: string): Promise<void> {
  const cursor = parseCursor(through);
  const [journal] = await tx`select value from event_cursor where singleton=true for update`;
  if (!journal || BigInt(cursor) > BigInt(String(journal.value)))
    throw new ApiError('ASSISTANT_CURSOR_AHEAD', 409, 'Con trỏ vượt journal hiện hành');
  const [monitor] = await tx`select cursor from assistant_monitor where singleton=true for update`;
  if (!monitor) throw new ApiError('ASSISTANT_STORE_MISSING', 503, 'Chưa khởi tạo kho Trợ lý');
  let after = String(monitor.cursor);
  if (BigInt(cursor) <= BigInt(after)) return;
  // Bounded pages avoid materializing the complete event history in memory.
  while (BigInt(after) < BigInt(cursor)) {
    const rows =
      await tx`select * from events where cursor>${after} and cursor<=${cursor} order by cursor limit 200`;
    if (!rows.length) break;
    for (const row of rows) await fanout(tx, eventRow(row));
    after = String(rows.at(-1)?.cursor);
  }
  await tx`update assistant_monitor set cursor=${cursor} where singleton=true`;
}

export async function reconcileWork(tx: Tx): Promise<void> {
  await tx`select value from event_cursor where singleton=true for update`;
  await tx`select cursor from assistant_monitor where singleton=true for update`;
  // Counter009 owns inherited inputs. The scanner never increments it or mints a turn.
  const messages = await tx`select id,input_revision from attachment_messages order by id`;
  for (const row of messages)
    await insertWork(tx, { kind: 'message', id: String(row.id), revision: String(row.input_revision) }, null);
  const tickets = await tx`select t.id,coalesce(r.revision,1) as revision from tickets t
    left join attachment_input_revisions r on r.target_kind='ticket' and r.target_id=t.id order by t.id`;
  for (const row of tickets)
    await insertWork(tx, { kind: 'ticket', id: String(row.id), revision: String(row.revision) }, null);
}

async function lockWorkRoot(tx: Tx, workId: Id): Promise<void> {
  assertAssistantId(workId);
  const [work] = await tx`select target_kind,target_id from assistant_work_inbox where id=${workId}`;
  if (!work) throw new ApiError('ASSISTANT_WORK_MISSING', 404, 'Không tìm thấy công việc');
  if (work.target_kind === 'ticket') {
    await tx`select value from event_cursor where singleton=true for update`;
    const [ticket] = await tx`select root_id from tickets where id=${work.target_id}`;
    if (!ticket) throw new ApiError('ASSISTANT_WORK_MISSING', 404, 'Không tìm thấy ticket');
    await tx`select id from tickets where id=${ticket.root_id} for update`;
  }
}

async function assertWorkScope(tx: Tx, workId: Id, fence: TurnFence): Promise<void> {
  // Caller has locked the ticket root (when applicable), then current authority.
  // These immutable identity reads never add a root lock on the message path.
  const [allowed] = await tx`select w.id from assistant_work_inbox w
    join assistant_turns t on t.id=${fence.turnId}
    where w.id=${workId} and (
      (w.target_kind='message' and w.target_id=t.message_id and exists(
        select 1 from attachment_messages m where m.id=w.target_id and m.conversation_id=t.conversation_id))
      or (w.target_kind='ticket' and exists(
        select 1 from tickets ticket join assistant_scopes s on s.root_ticket_id=ticket.root_id
        and s.project_id=ticket.project_id and s.turn_id=t.id
        where ticket.id=w.target_id and s.expires_at>clock_timestamp() and
          (t.message_id is null or exists(select 1 from attachment_message_routes r
            join tickets routed on routed.id=r.ticket_id where r.message_id=t.message_id
            and r.revoked_at is null and r.project_id=s.project_id and routed.root_id=s.root_ticket_id)))))`;
  if (!allowed)
    throw new ApiError('ASSISTANT_WORK_SCOPE_MISMATCH', 409, 'Công việc không thuộc phạm vi của lượt Trợ lý');
}

export async function claimWork(tx: Tx, workId: Id, fence: TurnFence): Promise<void> {
  await lockWorkRoot(tx, workId);
  await assertCurrentTurnFence(tx, fence, 'claim');
  await assertWorkScope(tx, workId, fence);
  const [work] =
    await tx`select state,turn_id,claim_generation,next_due_at from assistant_work_inbox where id=${workId} for update`;
  if (
    work?.state === 'claimed' &&
    work.turn_id === fence.turnId &&
    String(work.claim_generation) === fence.generation
  )
    return;
  if (work?.state !== 'pending')
    throw new ApiError('ASSISTANT_WORK_HELD', 409, 'Công việc đã giữ quyền hoặc hoàn tất');
  const [changed] = await tx`update assistant_work_inbox set state='claimed',turn_id=${fence.turnId},
    claim_generation=${fence.generation},attempts=attempts+1 where id=${workId} and next_due_at<=now() returning id`;
  if (!changed) throw new ApiError('ASSISTANT_WORK_NOT_DUE', 409, 'Công việc chưa đến lượt thử lại');
}

export async function ackWork(tx: Tx, workId: Id, fence: TurnFence): Promise<void> {
  await lockWorkRoot(tx, workId);
  await assertCurrentTurnFence(tx, fence, 'ack');
  await assertWorkScope(tx, workId, fence);
  const [work] =
    await tx`select state,turn_id,claim_generation from assistant_work_inbox where id=${workId} for update`;
  if (
    !work ||
    !['claimed', 'acked'].includes(String(work.state)) ||
    work.turn_id !== fence.turnId ||
    String(work.claim_generation) !== fence.generation
  )
    throw new ApiError('ASSISTANT_WORK_FENCE_MISMATCH', 409, 'Công việc không thuộc lượt hiện hành');
  if (work.state === 'acked') return;
  await tx`update assistant_work_inbox set state='acked',acked_at=now() where id=${workId}`;
}
