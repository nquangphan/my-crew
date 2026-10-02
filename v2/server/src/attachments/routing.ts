import { randomUUID } from 'node:crypto';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { authorizeTicketMutation } from '../tickets/authorization.ts';
import { createTicketServices } from '../tickets/service.ts';
import type {
  InputRoutingAuthority,
  MessageRoute,
  RouteMessageInput,
  RouteRetirementAuthority,
} from './contracts.ts';
import { digest, ownerOnly, record, validId } from './submissions.ts';

function routeResponse(row: Record<string, unknown>): MessageRoute {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    revision: Number(row.revision),
    projectId: String(row.project_id),
    ticketId: String(row.ticket_id),
    decisionId: String(row.decision_id),
    supersedesRouteId: row.supersedes_route_id === null ? null : String(row.supersedes_route_id),
    revokedAt: null,
  };
}
export async function authorizeMessageRouting(
  tx: Tx,
  input: RouteMessageInput,
  actor: Actor,
  authority?: InputRoutingAuthority,
): Promise<void> {
  if (!authority) throw new ApiError('INPUT_ROUTING_NOT_CONFIGURED', 503, 'Chưa cấu hình quyền định tuyến');
  if (
    !validId(input.messageId) ||
    !validId(input.decisionId) ||
    !/^[1-9]\d*$/.test(input.expectedInputRevision) ||
    !Number.isSafeInteger(input.expectedRouteRevision) ||
    input.expectedRouteRevision < 0 ||
    !record(input.ticket) ||
    !validId(input.ticket.projectId) ||
    (input.ticket.parentId !== null && !validId(input.ticket.parentId))
  )
    throw new ApiError('VALIDATION', 400, 'Định tuyến không hợp lệ');
  if (actor.kind === 'owner') ownerOnly(actor);
  else {
    const [machine] = await tx`select revoked_at from machines where id=${actor.id}`;
    if (!machine || machine.revoked_at)
      throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy quyền định tuyến');
  }
  const [project] = await tx`select machine_id from projects where id=${input.ticket.projectId}`;
  if (!project || (actor.kind === 'machine' && project.machine_id !== actor.id))
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
  const [decision] = await tx`select * from attachment_message_decisions where id=${input.decisionId}`;
  if (
    !decision ||
    decision.message_id !== input.messageId ||
    decision.kind !== 'routing' ||
    String(decision.input_revision) !== input.expectedInputRevision ||
    decision.actor_kind !== actor.kind ||
    decision.actor_id !== actor.id ||
    !record(decision.body) ||
    digest(decision.body) !==
      digest({ ticket: input.ticket, expectedRouteRevision: input.expectedRouteRevision })
  )
    throw new ApiError('ROUTING_DECISION_INVALID', 409, 'Quyết định không khớp định tuyến');
  const stored = {
    messageId: String(decision.message_id),
    inputRevision: String(decision.input_revision),
    snapshotId: decision.snapshot_id === null ? null : String(decision.snapshot_id),
    grantId: decision.grant_id === null ? null : String(decision.grant_id),
    receiptId: decision.receipt_id === null ? null : String(decision.receipt_id),
    kind: 'routing',
    body: decision.body,
    actor,
  };
  if (digest(stored) !== decision.sha256)
    throw new ApiError('ROUTING_DECISION_INVALID', 409, 'Quyết định đã thay đổi');
  await authority(tx, actor, input);
}
export function createRoutingServices(
  deps: { authority?: InputRoutingAuthority; retire?: RouteRetirementAuthority; now?: () => Date } = {},
) {
  const authority = deps.authority,
    retire = deps.retire,
    now = deps.now ?? (() => new Date());
  const tickets = createTicketServices();
  return Object.freeze({
    authorize: (tx: Tx, input: RouteMessageInput, actor: Actor) =>
      authorizeMessageRouting(tx, input, actor, authority),
    async routeAssistantMessage(tx: Tx, input: RouteMessageInput, actor: Actor): Promise<MessageRoute> {
      await authorizeMessageRouting(tx, input, actor, authority);
      const [prior] =
        await tx`select * from attachment_message_routes where message_id=${input.messageId} and decision_id=${input.decisionId}`;
      if (prior) return routeResponse(prior);
      const [old] =
        await tx`select * from attachment_message_routes where message_id=${input.messageId} and revoked_at is null`;
      const scopeIds = [old ? String(old.ticket_id) : null, input.ticket.parentId].filter(
        (id): id is Id => id !== null,
      );
      const scopes = scopeIds.length
        ? await tx`select id,root_id,project_id from tickets where id in ${tx(scopeIds)} order by id`
        : [];
      const roots = [...new Set(scopes.map((row) => String(row.root_id)))].sort();
      if (roots.length) await tx`select id from tickets where id in ${tx(roots)} order by id for update`;
      const affected = old
        ? await tx`with recursive affected(id) as (select id from tickets where id=${old.ticket_id} union all select t.id from tickets t join affected a on t.parent_id=a.id) select id from affected order by id`
        : [];
      const affectedIds = affected.map((row) => String(row.id));
      const ticketLocks = [
        ...new Set([...affectedIds, ...(input.ticket.parentId ? [input.ticket.parentId] : [])]),
      ].sort();
      if (ticketLocks.length)
        await tx`select id from tickets where id in ${tx(ticketLocks)} order by id for update`;
      const projects = [
        ...new Set([input.ticket.projectId, ...scopes.map((row) => String(row.project_id))]),
      ].sort();
      await tx`select id from projects where id in ${tx(projects)} order by id for update`;
      if (affectedIds.length)
        await tx`select target_id from attachment_input_revisions where target_kind='ticket' and target_id in ${tx(affectedIds)} order by target_id for update`;
      await authorizeTicketMutation(tx, actor, input.ticket);
      // The initial route has no old root; message precedes input there too,
      // matching fresh snapshot/decision/publication readers without deadlock.
      const [message] = await tx`select * from attachment_messages where id=${input.messageId} for update`;
      const [revision] =
        await tx`select revision,route_revision from attachment_input_revisions where target_kind='message' and target_id=${input.messageId} for update`;
      if (!message || !revision) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy tin nhắn');
      if (
        String(revision.revision) !== input.expectedInputRevision ||
        String(message.input_revision) !== input.expectedInputRevision ||
        Number(revision.route_revision) !== input.expectedRouteRevision ||
        Number(message.route_revision) !== input.expectedRouteRevision ||
        (old ? Number(old.revision) : 0) !== input.expectedRouteRevision
      )
        throw new ApiError('INPUT_SNAPSHOT_STALE', 409, 'Định tuyến đã thay đổi');
      if (old) {
        if (!retire)
          throw new ApiError('ROUTE_CORRECTION_NOT_CONFIGURED', 503, 'Chưa cấu hình dừng định tuyến cũ');
        const attempts =
          await tx`select id from attempts where ticket_id in ${tx(affectedIds)} and (state<>'stopped' or stopped_at is null or finalized_at is null) for update`;
        const sessions =
          await tx`select s.id from attachment_assistant_sessions s join attachment_assistant_grants g on g.id=s.grant_id where ((g.target_kind='message' and g.target_id=${input.messageId}) or (g.target_kind='ticket' and g.target_id in ${tx(affectedIds)})) and s.state in ('running','unknown') for update of s`;
        if (attempts.length || sessions.length)
          throw new ApiError('ROUTE_IN_USE', 409, 'Định tuyến cũ vẫn đang chạy');
        await retire(tx, routeResponse(old), actor);
      }
      const ticket = await tickets.createTicket(tx, input.ticket, actor);
      const id = randomUUID(),
        revisionNumber = input.expectedRouteRevision + 1;
      if (old) {
        await tx`update attachment_message_routes set revoked_at=${now()} where id=${old.id}`;
        await tx`update attachment_links set revoked_at=${now()} where message_route_id=${old.id} and revoked_at is null`;
        await tx`update attachment_assistant_grants set revoked_at=${now()} where revoked_at is null and ((target_kind='message' and target_id=${input.messageId}) or (target_kind='ticket' and target_id in ${tx(affectedIds)}))`;
        for (const target of affectedIds)
          await tx`insert into attachment_input_revisions(target_kind,target_id,revision) values('ticket',${target},2) on conflict(target_kind,target_id) do update set revision=attachment_input_revisions.revision+1`;
      }
      const [route] =
        await tx`insert into attachment_message_routes(id,message_id,revision,project_id,ticket_id,decision_id,supersedes_route_id) values(${id},${input.messageId},${revisionNumber},${ticket.projectId},${ticket.id},${input.decisionId},${old ? old.id : null}) returning *`;
      const originals =
        await tx`select attachment_id from attachment_message_links where message_id=${input.messageId} order by attachment_id`;
      for (const original of originals)
        await tx`insert into attachment_links(id,attachment_id,project_id,ticket_id,message_route_id) values(${randomUUID()},${original.attachment_id},${ticket.projectId},${ticket.id},${id})`;
      await tx`insert into attachment_input_revisions(target_kind,target_id) values('ticket',${ticket.id}) on conflict do nothing`;
      await tx`update attachment_input_revisions set revision=revision+1,route_revision=${revisionNumber} where target_kind='message' and target_id=${input.messageId}`;
      await tx`update attachment_messages set input_revision=input_revision+1,route_revision=${revisionNumber} where id=${input.messageId}`;
      // No designated, authorized Assistant exists in this consumer composition.
      // Existing ticket.created carries the real project/ticket audience; a future
      // issuer emits attachment.input.changed only after verifying its audience.
      return routeResponse(route);
    },
  });
}
