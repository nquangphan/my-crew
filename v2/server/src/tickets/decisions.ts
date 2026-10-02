import { randomUUID } from 'node:crypto';
import { appendEvent } from '../journal/events.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type {
  AppendAttachmentComment,
  Comment,
  CommentAttachmentLinker,
  DecisionInput,
  DocsSourceReader,
  SourceRef,
} from './contracts.ts';
import { requireTicket, safeTicketJson } from './service.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function appendComment(tx: Tx, ticketId: Id, text: string, actor: Actor): Promise<Comment> {
  if (typeof text !== 'string' || text.length < 1 || text.length > 32768)
    throw new ApiError('VALIDATION', 400, 'Bình luận không hợp lệ');
  const ticket = await requireTicket(tx, ticketId, actor);
  const id = randomUUID();
  const [row] = await tx`insert into comments(id,ticket_id,actor_kind,actor_id,text)
    values(${id},${ticketId},${actor.kind},${actor.id},${text}) returning created_at`;
  if (!row) throw new Error('COMMENT_INSERT_FAILED');
  await appendEvent(tx, {
    type: 'comment.created',
    projectId: ticket.projectId,
    ticketId,
    audienceMachineId: null,
    data: { commentId: id },
  });
  return { id, ticketId, actor, text, createdAt: (row.created_at as Date).toISOString() };
}

export async function appendAttachmentComment(
  tx: Tx,
  ticketId: Id,
  input: Parameters<AppendAttachmentComment>[2],
  actor: Actor,
  linker?: CommentAttachmentLinker,
): Promise<Comment> {
  if (!linker) throw new ApiError('ATTACHMENT_LINKER_NOT_CONFIGURED', 503, 'Chưa tích hợp liên kết tệp');
  if (
    !input ||
    typeof input.text !== 'string' ||
    input.text.length > 32768 ||
    !input.attachments ||
    !Array.isArray(input.attachments.attachmentIds) ||
    (!input.text.trim() && input.attachments.attachmentIds.length === 0)
  )
    throw new ApiError('VALIDATION', 400, 'Bình luận không hợp lệ');
  const ticket = await requireTicket(tx, ticketId, actor);
  const id = randomUUID();
  const [row] = await tx`insert into comments(id,ticket_id,actor_kind,actor_id,text)
    values(${id},${ticketId},${actor.kind},${actor.id},${input.text}) returning created_at`;
  if (!row) throw new Error('COMMENT_INSERT_FAILED');
  await linker(tx, { commentId: id, ticketId, attachments: input.attachments }, actor);
  await appendEvent(tx, {
    type: 'comment.created',
    projectId: ticket.projectId,
    ticketId,
    audienceMachineId: null,
    data: { commentId: id },
  });
  return { id, ticketId, actor, text: input.text, createdAt: (row.created_at as Date).toISOString() };
}

async function sourceExists(
  tx: Tx,
  projectId: Id,
  rootId: Id,
  source: SourceRef,
  docsSource?: DocsSourceReader,
): Promise<boolean> {
  if (
    !source ||
    !['docs', 'ticket', 'artifact', 'owner_decision'].includes(source.kind) ||
    typeof source.id !== 'string' ||
    !uuid.test(source.id)
  )
    return false;
  if (source.kind === 'docs') {
    if (!source.path || !docsSource) return false;
    return docsSource(tx, projectId, source.id, source.path);
  }
  if (source.kind === 'ticket') {
    const [row] =
      await tx`select id from tickets where id=${source.id} and project_id=${projectId} and root_id=${rootId}`;
    return !!row;
  }
  if (source.kind === 'owner_decision') {
    const [row] = await tx`select d.id from decisions d join tickets t on t.id=d.ticket_id
      where d.id=${source.id} and t.project_id=${projectId} and t.root_id=${rootId} and d.actor_kind='owner'`;
    return !!row;
  }
  if (!source.locator || source.locator.length > 2048) return false;
  const [row] = await tx`select e.id from evidence e join tickets t on t.id=e.ticket_id
    where e.id=${source.id} and t.project_id=${projectId} and t.root_id=${rootId}
      and e.data->>'locator'=${source.locator}`;
  return !!row;
}

export async function recordDecision(
  tx: Tx,
  ticketId: Id,
  input: DecisionInput,
  actor: Actor,
  docsSource?: DocsSourceReader,
): Promise<Id> {
  if (input.kind === 'owner_answer') {
    const [scope] = await tx`select root_id from tickets where id=${ticketId}`;
    if (!scope) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
    await tx`select id from tickets where id=${scope.root_id} for update`;
  }
  const ticket = await requireTicket(tx, ticketId, actor, input.kind === 'owner_answer');
  if (
    !['assessment', 'delegated', 'owner_answer', 'approval', 'intervention', 'dispatch'].includes(
      input.kind,
    ) ||
    typeof input.content !== 'string' ||
    !input.content ||
    input.content.length > 32768 ||
    typeof input.rationale !== 'string' ||
    !input.rationale ||
    input.rationale.length > 32768 ||
    !Array.isArray(input.sources) ||
    input.sources.length > 100 ||
    !input.scope ||
    typeof input.scope !== 'object' ||
    Array.isArray(input.scope) ||
    !safeTicketJson(input.scope) ||
    !safeTicketJson(input.sources)
  )
    throw new ApiError('VALIDATION', 400, 'Quyết định không hợp lệ');
  if (input.kind === 'approval' && actor.kind !== 'owner')
    throw new ApiError('OWNER_APPROVAL_REQUIRED', 403, 'Chỉ chủ dự án được duyệt');
  if (input.kind === 'owner_answer' && actor.kind !== 'owner')
    throw new ApiError('OWNER_DECISION_REQUIRED', 403, 'Chỉ chủ dự án được trả lời');
  if (input.kind === 'approval' && input.scope.action === 'deploy') {
    const hash = input.scope.ticketDefinitionHash;
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash))
      throw new ApiError('VALIDATION', 400, 'Thiếu định danh hành động deploy');
    const preapproval = ticket.level === 'request' && input.scope.rootTicketId === ticket.id;
    const direct = ticket.kind === 'deploy' && input.scope.targetTicketId === ticket.id;
    if (!preapproval && !direct) throw new ApiError('VALIDATION', 400, 'Duyệt deploy không đúng ticket');
    if (direct) {
      const [target] = await tx`select deploy_definition_hash from tickets where id=${ticket.id}`;
      if (target?.deploy_definition_hash !== hash)
        throw new ApiError('VALIDATION', 400, 'Duyệt deploy không khớp ticket');
    }
  }
  for (const source of input.sources) {
    if (!(await sourceExists(tx, ticket.projectId, ticket.rootId, source, docsSource)))
      throw new ApiError('SOURCE_UNVERIFIED', 422, 'Nguồn quyết định chưa được ghi nhận');
  }
  const id = randomUUID();
  await tx`insert into decisions(id,ticket_id,actor_kind,actor_id,kind,content,rationale,sources,scope,created_at)
    values(${id},${ticketId},${actor.kind},${actor.id},${input.kind},${input.content},${input.rationale},
      ${tx.json(input.sources)},${tx.json(input.scope as never)},clock_timestamp())`;
  await appendEvent(tx, {
    type: 'decision.created',
    projectId: ticket.projectId,
    ticketId,
    audienceMachineId: null,
    data: { decisionId: id, kind: input.kind },
  });
  return id;
}
