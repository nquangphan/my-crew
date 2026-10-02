import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { AttemptReadContext, BlobHandle, InputManifest } from './contracts.ts';
import { validId } from './submissions.ts';

export type AttachmentExecutionGate = (tx: Tx, actor: Actor, context: AttemptReadContext) => Promise<void>;
export const denyAttachmentExecution: AttachmentExecutionGate = async () => {
  throw new ApiError('ATTACHMENT_EXECUTION_NOT_CONFIGURED', 409, 'Chưa cấu hình quyền đọc của attempt');
};
export function notFound(): never {
  throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy tài nguyên');
}
export function validateContext(context: AttemptReadContext): void {
  if (
    !context ||
    ![context.projectId, context.ticketId, context.attemptId, context.processInstanceId].every(validId) ||
    !/^\d+$/.test(context.fence) ||
    !Number.isSafeInteger(context.bindingRevision) ||
    context.bindingRevision < 1
  )
    throw new ApiError('VALIDATION', 400, 'Ngữ cảnh attempt không hợp lệ');
}
// Trusted controller injection may use this persisted 005 guard. It is never the
// public route's implicit default and does not attest workflow/model isolation.
export const assertAttachmentExecutionCurrent: AttachmentExecutionGate = async (tx, actor, context) => {
  validateContext(context);
  if (actor.kind !== 'machine') throw new ApiError('MACHINE_REQUIRED', 403, 'Cần xác thực máy');
  const [scope] = await tx`select root_id,project_id from tickets where id=${context.ticketId}`;
  if (!scope || scope.project_id !== context.projectId) notFound();
  await tx`select id from tickets where id=${scope.root_id} for share`;
  await tx`select id from tickets where id=${context.ticketId} for share`;
  const [row] =
    await tx`select a.*,t.project_id,p.machine_id as bound_machine_id,p.binding_revision as current_binding_revision,m.revoked_at,g.active_attempt_id from attempts a join tickets t on t.id=a.ticket_id join projects p on p.id=t.project_id join machines m on m.id=a.machine_id join execution_guards g on g.ticket_id=a.ticket_id where a.id=${context.attemptId} for share of p,a,g,m`;
  if (
    !row ||
    row.revoked_at ||
    row.machine_id !== actor.id ||
    row.bound_machine_id !== actor.id ||
    row.project_id !== context.projectId ||
    row.ticket_id !== context.ticketId
  )
    notFound();
  if (
    Number(row.current_binding_revision) !== context.bindingRevision ||
    Number(row.binding_revision) !== context.bindingRevision ||
    String(row.fence) !== context.fence ||
    row.process_instance_id !== context.processInstanceId ||
    row.active_attempt_id !== context.attemptId
  )
    throw new ApiError('STALE_FENCE', 409, 'Attempt hoặc binding đã cũ');
  const [clock] = await tx`select clock_timestamp() as now`;
  if (
    row.state !== 'active' ||
    row.stopped_at ||
    new Date(String(row.lease_expires_at)).getTime() <= new Date(String(clock.now)).getTime()
  )
    throw new ApiError('ATTEMPT_NOT_ACTIVE', 409, 'Attempt không còn hoạt động');
};
export async function liveLinkIds(tx: Tx, ticketId: Id): Promise<Id[]> {
  // An inherited ref remains valid only while every source/route in its chain is
  // current. IDs/hashes alone cannot recover revoked authority.
  const rows = await tx`with recursive chain(origin,id,parent,valid,seen) as (
 select l.id,l.id,l.inherited_from_link_id,(l.revoked_at is null and (l.message_route_id is null or r.revoked_at is null)),array[l.id] from attachment_links l left join attachment_message_routes r on r.id=l.message_route_id where l.ticket_id=${ticketId}
 union all select c.origin,l.id,l.inherited_from_link_id,c.valid and l.revoked_at is null and (l.message_route_id is null or r.revoked_at is null),c.seen||l.id from chain c join attachment_links l on l.id=c.parent left join attachment_message_routes r on r.id=l.message_route_id where not l.id=any(c.seen))
 select origin from chain group by origin having bool_and(valid) and bool_or(parent is null)`;
  return rows.map((r) => String(r.origin));
}
export async function authorizeAttachment(
  tx: Tx,
  actor: Actor,
  input: {
    attachmentId: Id;
    context: AttemptReadContext | null;
    derivativeId: Id | null;
    manifestId: Id | null;
  },
  gate: AttachmentExecutionGate = denyAttachmentExecution,
): Promise<BlobHandle> {
  if (
    !validId(input.attachmentId) ||
    (input.derivativeId !== null && !validId(input.derivativeId)) ||
    (input.manifestId !== null && !validId(input.manifestId))
  )
    throw new ApiError('VALIDATION', 400, 'Mã tệp không hợp lệ');
  if (actor.kind === 'machine') {
    if (!input.context)
      throw new ApiError('ATTACHMENT_EXECUTION_NOT_CONFIGURED', 409, 'Cần ngữ cảnh attempt');
    await gate(tx, actor, input.context);
    // Always retain persisted fencing checks even if a custom policy gate allows.
    await assertAttachmentExecutionCurrent(tx, actor, input.context);
    const ids = await liveLinkIds(tx, input.context.ticketId);
    if (!ids.length) notFound();
    const [link] =
      await tx`select id from attachment_links where id in ${tx(ids)} and attachment_id=${input.attachmentId} and project_id=${input.context.projectId}`;
    if (!link) notFound();
    if (input.manifestId) {
      const manifest = await readAuthorizedManifest(tx, actor, input.manifestId, input.context, gate);
      if (
        !manifest.originals.some((o) => o.attachmentId === input.attachmentId) ||
        (input.derivativeId !== null && !manifest.selectedDerivativeIds.includes(input.derivativeId))
      )
        notFound();
    }
  }
  const [upload] =
    await tx`select u.*,c.state as compose_state,c.expires_at as compose_expires from attachment_uploads u join attachment_compose_sessions c on c.id=u.compose_id where u.id=${input.attachmentId} and u.owner_id='owner'`;
  if (upload?.state !== 'ready' || !upload.durable_at) notFound();
  if (
    actor.kind === 'owner' &&
    !upload.linked_at &&
    (upload.compose_state !== 'open' || new Date(String(upload.compose_expires)).getTime() <= Date.now())
  )
    notFound();
  if (input.derivativeId) {
    const [d] =
      await tx`select d.*,e.manifest,e.manifest_sha256 from attachment_derivatives d join attachment_extractions e on e.id=d.extraction_id where d.id=${input.derivativeId} and d.attachment_id=${input.attachmentId}`;
    if (
      d?.verification !== 'verified' ||
      !d.manifest ||
      d.manifest.original?.attachmentId !== input.attachmentId ||
      d.manifest.original?.sha256 !== upload.expected_sha256 ||
      d.manifest.verification !== 'verified' ||
      !d.manifest.derivatives?.some(
        (entry: { id: string; sha256: string }) => entry.id === d.id && entry.sha256 === d.sha256,
      )
    )
      notFound();
    return { key: String(d.blob_key), sha256: String(d.sha256), byteLength: Number(d.byte_length) };
  }
  return {
    key: String(upload.storage_key),
    sha256: String(upload.expected_sha256),
    byteLength: Number(upload.expected_bytes),
  };
}
export async function readAuthorizedManifest(
  tx: Tx,
  actor: Actor,
  id: Id,
  context: AttemptReadContext,
  gate: AttachmentExecutionGate,
): Promise<InputManifest> {
  await gate(tx, actor, context);
  await assertAttachmentExecutionCurrent(tx, actor, context);
  const [row] =
    await tx`select m.*,e.data as evidence_body from attachment_input_manifests m join evidence e on e.id=m.evidence_id where m.id=${id} and m.ticket_id=${context.ticketId}`;
  if (
    !row ||
    row.canonical.sha256 !== row.sha256 ||
    row.canonical.snapshotSha256 !== row.snapshot_sha256 ||
    row.canonical.snapshotId !== row.snapshot_id ||
    row.evidence_body?.sha256 !== row.sha256
  )
    notFound();
  return row.canonical as InputManifest;
}
