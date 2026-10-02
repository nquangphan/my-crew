import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '../journal/canonical.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { authorizeTicketMutation } from '../tickets/authorization.ts';
import type { Comment, CreateTicket, Ticket } from '../tickets/contracts.ts';
import { type createTicketServices, safeTicketJson } from '../tickets/service.ts';
import type { AttachmentRef, BlobStore, ComposeTarget, Selection, StageServices } from './contracts.ts';

export const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validId(value: unknown): value is Id {
  return typeof value === 'string' && uuid.test(value);
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && safeTicketJson(value);
}
export function ownerOnly(actor: Actor): void {
  if (actor.kind !== 'owner' || actor.id !== 'owner')
    throw new ApiError('FORBIDDEN', 403, 'Chỉ chủ sở hữu được gửi tệp');
}
export function normalizeSelection(input: Selection): Selection {
  if (
    !input ||
    !validId(input.composeSessionId) ||
    !Number.isSafeInteger(input.selectionRevision) ||
    input.selectionRevision < 1 ||
    !Array.isArray(input.attachmentIds) ||
    !input.attachmentIds.every(validId)
  )
    throw new ApiError('VALIDATION', 400, 'Lượt chọn không hợp lệ');
  const ids = input.attachmentIds.map((id) => id.toLowerCase()).sort();
  if (new Set(ids).size !== ids.length) throw new ApiError('VALIDATION', 400, 'Tệp được chọn trùng');
  return {
    composeSessionId: input.composeSessionId.toLowerCase(),
    selectionRevision: input.selectionRevision,
    attachmentIds: ids,
  };
}
export function permission(value: unknown): 'none' | 'selected-inputs' {
  if (value === undefined || value === 'none') return 'none';
  if (value === 'selected-inputs') return value;
  throw new ApiError('VALIDATION', 400, 'Phạm vi đọc không hợp lệ');
}
// Wire this guard into Mutator.context.authorize, which runs before its cache.
// Historical receipts require current actor/scope, not an open fresh selection.
export async function authorizeSubmission(
  tx: Tx,
  actor: Actor,
  target?: { projectId?: Id; ticketId?: Id | null; parentId?: Id | null; conversationId?: Id },
): Promise<void> {
  ownerOnly(actor);
  for (const key of ['projectId', 'ticketId', 'parentId', 'conversationId'] as const) {
    const id = target?.[key];
    if ((key === 'parentId' || key === 'ticketId') && id === null) continue;
    if (id !== undefined && !validId(id)) throw new ApiError('VALIDATION', 400, 'Target không hợp lệ');
  }
  if (target?.conversationId) {
    const [row] =
      await tx`select id from attachment_conversations where id=${target.conversationId} and owner_id='owner'`;
    if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy hội thoại');
  }
  if (target?.projectId || target?.ticketId || target?.parentId)
    await authorizeTicketMutation(tx, actor, { ...target, ticketId: target.ticketId ?? undefined });
  if (target?.projectId) {
    const [project] = await tx`select id from projects where id=${target.projectId}`;
    if (!project) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
  }
  const id = target?.ticketId ?? target?.parentId;
  if (id) {
    const [ticket] = await tx`select project_id from tickets where id=${id}`;
    if (!ticket || (target?.projectId && ticket.project_id !== target.projectId))
      throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
  }
}
export async function lockSubmissionScope(
  tx: Tx,
  target: { projectId: Id; ticketId: Id | null; parentId: Id | null; purpose: 'ticket' | 'comment' },
  actor: Actor,
): Promise<void> {
  await authorizeSubmission(tx, actor, target);
  const id = target.ticketId ?? target.parentId;
  if (id) {
    const [scope] = await tx`select root_id,project_id from tickets where id=${id}`;
    if (!scope || scope.project_id !== target.projectId)
      throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
    await tx`select id from tickets where id=${scope.root_id} for update`;
    if (target.purpose === 'comment') {
      const affected =
        await tx`with recursive affected(id) as (select id from tickets where id=${id} union all select t.id from tickets t join affected a on t.parent_id=a.id) select t.id from tickets t join affected a on a.id=t.id order by t.id for update of t`;
      const ids = affected.map((row) => String(row.id));
      await tx`select id from projects where id=${target.projectId} for update`;
      await tx`select target_id from attachment_input_revisions where target_kind='ticket' and target_id in ${tx(ids)} order by target_id for update`;
    } else await tx`select id from tickets where id=${id} for update`;
  }
  const [project] = await tx`select id from projects where id=${target.projectId} for update`;
  if (!project) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
}
export type SelectedOriginal = AttachmentRef & { storageKey: string; byteLength: number };
export type SelectionDependencies = {
  store: Pick<BlobStore, 'verify'>;
  queuePolicy?: { extractorVersion: string; configSha256: string };
  now?: () => Date;
};
export function createSelectionServices(deps: SelectionDependencies) {
  const verify = deps.store.verify.bind(deps.store);
  const now = deps.now ?? (() => new Date());
  const policy = deps.queuePolicy ? Object.freeze({ ...deps.queuePolicy }) : undefined;
  if (policy && (!policy.extractorVersion || !/^[0-9a-f]{64}$/.test(policy.configSha256)))
    throw new Error('EXTRACTION_POLICY_INVALID');
  return Object.freeze({
    now,
    async lock(
      tx: Tx,
      selection: Selection,
      actor: Actor,
      target: ComposeTarget,
    ): Promise<SelectedOriginal[]> {
      ownerOnly(actor);
      const [compose] =
        await tx`select * from attachment_compose_sessions where id=${selection.composeSessionId} and owner_id='owner' for update`;
      if (
        !compose ||
        compose.purpose !== target.purpose ||
        compose.project_id !== target.projectId ||
        compose.ticket_id !== target.ticketId ||
        compose.conversation_id !== ('conversationId' in target ? target.conversationId : null)
      )
        throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lượt gửi');
      if (
        compose.state !== 'open' ||
        Number(compose.revision) !== selection.selectionRevision ||
        new Date(String(compose.expires_at)).getTime() <= now().getTime()
      )
        throw new ApiError('SELECTION_CHANGED', 409, 'Lượt chọn đã thay đổi');
      const uploads =
        await tx`select * from attachment_uploads where compose_id=${compose.id} order by id for update`;
      for (const id of selection.attachmentIds)
        if (!uploads.some((row) => row.id === id && row.owner_id === 'owner'))
          throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy tệp');
      const active = uploads.filter((row) => row.state !== 'abandoned');
      if (
        active.length !== selection.attachmentIds.length ||
        active.some((row) => !selection.attachmentIds.includes(String(row.id)))
      )
        throw new ApiError('SELECTION_CHANGED', 409, 'Tập tệp đã thay đổi');
      if (active.length && !policy)
        throw new ApiError('EXTRACTION_NOT_CONFIGURED', 503, 'Chưa cấu hình xử lý tệp');
      const selected: SelectedOriginal[] = [];
      for (const upload of active) {
        if (
          upload.state !== 'ready' ||
          !upload.durable_at ||
          upload.linked_at ||
          upload.quota_released_at ||
          new Date(String(upload.expires_at)).getTime() <= now().getTime()
        )
          throw new ApiError('ATTACHMENT_NOT_READY', 422, 'Tệp chưa sẵn sàng');
        const [receiver] =
          await tx`select state,attachment_id,generation,instance_id,closed_at,closed_ack_sha256,stop_proof from attachment_receivers where id=${upload.receiver_id} for share`;
        const proof = receiver?.stop_proof;
        // Native disappearance proves stop, not the current producer's closed
        // publication ACK. Recovery readiness needs a separately reviewed transition.
        if (
          receiver?.state !== 'closed' ||
          !receiver.closed_at ||
          receiver.attachment_id !== upload.id ||
          String(receiver.generation) !== String(upload.generation) ||
          !record(proof) ||
          proof.receiverId !== upload.receiver_id ||
          String(proof.generation) !== String(upload.generation) ||
          !record(proof.identity) ||
          proof.identity.instanceId !== receiver.instance_id ||
          proof.kind !== 'closed-ack' ||
          proof.proofSha256 !== receiver.closed_ack_sha256
        )
          throw new ApiError('ATTACHMENT_NOT_READY', 422, 'Writer chưa có proof dừng');
        const original = {
          attachmentId: String(upload.id),
          ownerId: 'owner' as const,
          sha256: String(upload.expected_sha256),
          storageKey: String(upload.storage_key),
          byteLength: Number(upload.expected_bytes),
        };
        if (
          (await verify({
            key: original.storageKey,
            sha256: original.sha256,
            byteLength: original.byteLength,
          })) !== 'present'
        )
          throw new ApiError('ATTACHMENT_NOT_READY', 422, 'Original không sẵn sàng');
        selected.push(original);
      }
      return selected;
    },
    async retain(tx: Tx, originals: SelectedOriginal[]): Promise<void> {
      for (const original of originals) {
        await tx`update attachment_uploads set linked_at=${now()},quota_released_at=${now()} where id=${original.attachmentId} and linked_at is null and quota_released_at is null`;
        if (!policy) throw new ApiError('EXTRACTION_NOT_CONFIGURED', 503, 'Chưa cấu hình xử lý tệp');
        await tx`insert into attachment_extractions(id,attachment_id,original_sha256,extractor_version,config_sha256,status) values(${randomUUID()},${original.attachmentId},${original.sha256},${policy.extractorVersion},${policy.configSha256},'pending') on conflict(attachment_id,extractor_version,config_sha256) do nothing`;
      }
    },
    async authorize(
      tx: Tx,
      kind: 'ticket' | 'message',
      id: Id,
      originals: SelectedOriginal[],
      read: 'none' | 'selected-inputs',
    ): Promise<void> {
      if (read === 'none') return;
      const refs = originals.map(({ attachmentId, sha256, ownerId }) => ({ attachmentId, sha256, ownerId }));
      const expires = new Date(now().getTime() + 24 * 60 * 60 * 1000);
      const body = {
        ownerId: 'owner',
        targetKind: kind,
        targetId: id,
        originals: refs,
        allowOriginal: false,
        scope: 'submitted-inputs',
        expiresAt: expires.toISOString(),
      };
      await tx`insert into attachment_submission_authorizations(id,target_kind,target_id,originals,authorization_sha256,allow_original,expires_at) values(${randomUUID()},${kind},${id},${tx.json(refs)},${digest(body)},false,${expires})`;
    },
  });
}
export async function readSubmission(
  tx: Tx,
  selection: Selection,
  hash: string,
  actor: Actor,
  kind: 'ticket' | 'comment' | 'message',
): Promise<unknown | null> {
  ownerOnly(actor);
  const [compose] =
    await tx`select owner_id from attachment_compose_sessions where id=${selection.composeSessionId}`;
  if (compose?.owner_id !== 'owner') throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lượt gửi');
  const [prior] =
    await tx`select * from attachment_submissions where compose_id=${selection.composeSessionId}`;
  if (!prior) return null;
  if (prior.payload_sha256 !== hash || prior.target_kind !== kind)
    throw new ApiError('COMPOSE_ALREADY_SUBMITTED', 409, 'Lượt gửi đã được sử dụng');
  return prior.response;
}
export async function finishSubmission(
  tx: Tx,
  selection: Selection,
  hash: string,
  kind: 'ticket' | 'comment' | 'message',
  id: Id,
  response: unknown,
): Promise<void> {
  await tx`insert into attachment_submissions(compose_id,payload_sha256,target_kind,target_id,response) values(${selection.composeSessionId},${hash},${kind},${id},${tx.json(JSON.parse(canonicalJson(response)))})`;
  await tx`update attachment_compose_sessions set state='submitted',revision=revision+1 where id=${selection.composeSessionId}`;
}
function isTicket(value: unknown): value is Ticket {
  if (!record(value)) return false;
  return (
    validId(value.id) &&
    validId(value.projectId) &&
    validId(value.rootId) &&
    (value.parentId === null || validId(value.parentId)) &&
    ['request', 'step', 'task'].includes(String(value.level)) &&
    ['code', 'research', 'docs', 'deploy'].includes(String(value.kind)) &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    typeof value.mandatory === 'boolean' &&
    record(value.criteria) &&
    record(value.inputs) &&
    record(value.outputs) &&
    (value.skill === null || typeof value.skill === 'string') &&
    (value.workflowPin === null ||
      (record(value.workflowPin) &&
        ['superpowers', 'bmad'].includes(String(value.workflowPin.workflow)) &&
        typeof value.workflowPin.version === 'string' &&
        typeof value.workflowPin.revision === 'string' &&
        typeof value.workflowPin.checksum === 'string' &&
        /^[0-9a-f]{64}$/i.test(value.workflowPin.checksum))) &&
    ['pending', 'ready', 'running', 'needs_input', 'paused', 'done', 'cancelled'].includes(
      String(value.status),
    ) &&
    Number.isSafeInteger(value.revision) &&
    Number.isSafeInteger(value.repairCycles) &&
    (value.waitReason === null || typeof value.waitReason === 'string') &&
    (value.mergedCommit === null || typeof value.mergedCommit === 'string')
  );
}
function isComment(value: unknown): value is Comment {
  return (
    record(value) &&
    validId(value.id) &&
    validId(value.ticketId) &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'string' &&
    record(value.actor) &&
    ((value.actor.kind === 'owner' && value.actor.id === 'owner') ||
      (value.actor.kind === 'machine' && validId(value.actor.id)))
  );
}
function replayTicket(value: unknown): { ticket: Ticket; attachmentIds: Id[] } {
  if (
    !record(value) ||
    !isTicket(value.ticket) ||
    !Array.isArray(value.attachmentIds) ||
    !value.attachmentIds.every(validId)
  )
    throw new Error('SUBMISSION_RECEIPT_INVALID');
  return { ticket: value.ticket, attachmentIds: value.attachmentIds };
}
function replayComment(value: unknown): { comment: Comment; attachmentIds: Id[] } {
  if (
    !record(value) ||
    !isComment(value.comment) ||
    !Array.isArray(value.attachmentIds) ||
    !value.attachmentIds.every(validId)
  )
    throw new Error('SUBMISSION_RECEIPT_INVALID');
  return { comment: value.comment, attachmentIds: value.attachmentIds };
}
export function createAttachmentSubmissions(
  deps: SelectionDependencies & { tickets: typeof createTicketServices; stage: StageServices },
) {
  const selected = createSelectionServices(deps);
  const factory = deps.tickets;
  async function linkSelection(
    tx: Tx,
    input: { selection: Selection; ticketId: Id; commentId: Id | null },
    actor: Actor,
  ): Promise<Id[]> {
    const [ticket] = await tx`select project_id from tickets where id=${input.ticketId}`;
    if (!ticket) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
    const target: ComposeTarget = input.commentId
      ? { purpose: 'comment', projectId: String(ticket.project_id), ticketId: input.ticketId }
      : { purpose: 'ticket', projectId: String(ticket.project_id), ticketId: null };
    const originals = await selected.lock(tx, input.selection, actor, target);
    for (const original of originals)
      await tx`insert into attachment_links(id,attachment_id,project_id,ticket_id,comment_id) values(${randomUUID()},${original.attachmentId},${ticket.project_id},${input.ticketId},${input.commentId})`;
    await selected.retain(tx, originals);
    return originals.map((o) => o.attachmentId);
  }
  const tickets = factory({
    commentAttachments: async (tx, input, actor) => {
      await linkSelection(
        tx,
        {
          selection: normalizeSelection(input.attachments),
          ticketId: input.ticketId,
          commentId: input.commentId,
        },
        actor,
      );
    },
  });
  return Object.freeze({
    linkSelection,
    async ticket(
      tx: Tx,
      input: { ticket: CreateTicket; selection: Selection; assistantRead?: 'none' | 'selected-inputs' },
      actor: Actor,
    ) {
      if (!record(input.ticket)) throw new ApiError('VALIDATION', 400, 'Ticket không hợp lệ');
      await authorizeSubmission(tx, actor, input.ticket);
      const selection = normalizeSelection(input.selection),
        read = permission(input.assistantRead);
      const hash = digest({ kind: 'ticket', ticket: input.ticket, selection, assistantRead: read });
      const prior = await readSubmission(tx, selection, hash, actor, 'ticket');
      if (prior !== null) return replayTicket(prior);
      await tx`select pg_advisory_xact_lock(hashtextextended('attachment-owner-quota:owner',0))`;
      await lockSubmissionScope(
        tx,
        {
          projectId: input.ticket.projectId,
          ticketId: null,
          parentId: input.ticket.parentId,
          purpose: 'ticket',
        },
        actor,
      );
      const originals = await selected.lock(tx, selection, actor, {
        purpose: 'ticket',
        projectId: input.ticket.projectId,
        ticketId: null,
      });
      const ticket = await tickets.createTicket(tx, input.ticket, actor);
      const attachmentIds = await linkSelection(
        tx,
        { selection, ticketId: ticket.id, commentId: null },
        actor,
      );
      await tx`insert into attachment_input_revisions(target_kind,target_id) values('ticket',${ticket.id}) on conflict do nothing`;
      await selected.authorize(tx, 'ticket', ticket.id, originals, read);
      const response = { ticket, attachmentIds };
      await finishSubmission(tx, selection, hash, 'ticket', ticket.id, response);
      return response;
    },
    async comment(
      tx: Tx,
      ticketId: Id,
      input: { text: string; selection: Selection; assistantRead?: 'none' | 'selected-inputs' },
      actor: Actor,
    ) {
      await authorizeSubmission(tx, actor, { ticketId });
      const selection = normalizeSelection(input.selection),
        read = permission(input.assistantRead);
      const hash = digest({ kind: 'comment', ticketId, text: input.text, selection, assistantRead: read });
      const prior = await readSubmission(tx, selection, hash, actor, 'comment');
      if (prior !== null) return replayComment(prior);
      const [scope] = await tx`select project_id from tickets where id=${ticketId}`;
      if (!scope) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
      await tx`select pg_advisory_xact_lock(hashtextextended('attachment-owner-quota:owner',0))`;
      await lockSubmissionScope(
        tx,
        { projectId: String(scope.project_id), ticketId, parentId: null, purpose: 'comment' },
        actor,
      );
      const originals = await selected.lock(tx, selection, actor, {
        purpose: 'comment',
        projectId: String(scope.project_id),
        ticketId,
      });
      const comment = await tickets.appendAttachmentComment(
        tx,
        ticketId,
        { text: input.text, attachments: selection },
        actor,
      );
      await selected.authorize(tx, 'ticket', ticketId, originals, read);
      const response = { comment, attachmentIds: originals.map((o) => o.attachmentId) };
      await finishSubmission(tx, selection, hash, 'comment', comment.id, response);
      return response;
    },
  });
}
