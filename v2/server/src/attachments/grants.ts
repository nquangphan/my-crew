import { randomUUID } from 'node:crypto';
import { appendEvent } from '../journal/events.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { notFound } from './access.ts';
import type {
  AssistantInputAuthority,
  AssistantReadGrant,
  AssistantReadReceipt,
  AssistantReadSession,
  AttachmentRef,
  BlobHandle,
  InputSnapshot,
  InputTarget,
  OwnerInputAuthorization,
  PreclaimSelectionAuthority,
} from './contracts.ts';
import { lockInputTarget, submittedOriginals } from './references.ts';
import { validateTarget } from './snapshots.ts';
import { digest, ownerOnly, validId } from './submissions.ts';

const deny = async (): Promise<never> => {
  throw new ApiError('ASSISTANT_INPUT_NOT_CONFIGURED', 409, 'Chưa cấu hình quyền input Trợ lý');
};
export const denyAssistantInput: AssistantInputAuthority = Object.freeze({
  designation: deny,
  authorizeIssue: deny,
  authorizeSession: deny,
  assertSessionCurrent: deny,
});
export const denyPreclaimSelection: PreclaimSelectionAuthority = async () => {
  throw new ApiError('PRECLAIM_SELECTION_NOT_CONFIGURED', 409, 'Chưa cấu hình lựa chọn input');
};
async function now(tx: Tx): Promise<number> {
  const [row] = await tx`select clock_timestamp() as now`;
  return new Date(String(row.now)).getTime();
}
async function targetFromRow(tx: Tx, row: Record<string, unknown>): Promise<InputTarget> {
  if (row.target_kind === 'message') return { kind: 'message', messageId: String(row.target_id) };
  const [t] = await tx`select project_id from tickets where id=${String(row.target_id)}`;
  if (!t) notFound();
  return { kind: 'ticket', ticketId: String(row.target_id), projectId: String(t.project_id) };
}
function exactOriginals(refs: AttachmentRef[], submitted: AttachmentRef[]): boolean {
  return (
    refs.length > 0 &&
    new Set(refs.map((r) => r.attachmentId)).size === refs.length &&
    refs.every((r) => submitted.some((s) => digest(s) === digest(r)))
  );
}
export async function createInputReadAuthorization(
  tx: Tx,
  input: { target: InputTarget; originals: AttachmentRef[]; allowOriginal: boolean; expiresAt: string },
  actor: Actor,
): Promise<OwnerInputAuthorization> {
  ownerOnly(actor);
  validateTarget(input.target);
  const expires = Date.parse(input.expiresAt),
    time = await now(tx);
  if (
    !Array.isArray(input.originals) ||
    !input.originals.length ||
    input.originals.length > 100 ||
    typeof input.allowOriginal !== 'boolean' ||
    !Number.isFinite(expires) ||
    expires <= time ||
    expires > time + 24 * 3600000
  )
    throw new ApiError('VALIDATION', 400, 'Ủy quyền input không hợp lệ');
  await lockInputTarget(tx, input.target);
  if (!exactOriginals(input.originals, await submittedOriginals(tx, input.target))) notFound();
  const originals = [...input.originals].sort((a, b) => a.attachmentId.localeCompare(b.attachmentId));
  const result: OwnerInputAuthorization = {
    id: randomUUID(),
    ownerId: 'owner',
    target: input.target,
    originals,
    allowOriginal: input.allowOriginal,
    expiresAt: new Date(expires).toISOString(),
    revokedAt: null,
  };
  const id = input.target.kind === 'ticket' ? input.target.ticketId : input.target.messageId;
  await tx`insert into attachment_submission_authorizations(id,target_kind,target_id,originals,authorization_sha256,allow_original,expires_at) values(${result.id},${input.target.kind},${id},${tx.json(originals)},${digest(result)},${input.allowOriginal},${result.expiresAt})`;
  return result;
}
async function grantFromRow(tx: Tx, row: Record<string, unknown>): Promise<AssistantReadGrant> {
  return {
    id: String(row.id),
    authorizationId: String(row.authorization_id),
    target: await targetFromRow(tx, row),
    originals: row.originals as AttachmentRef[],
    inputRevision: String(row.input_revision),
    routeRevision: Number(row.route_revision),
    designationId: String(row.designation_id),
    designationRevision: Number(row.designation_revision),
    machineId: String(row.machine_id),
    snapshotId: row.snapshot_id === null ? null : String(row.snapshot_id),
    snapshotSha256: row.snapshot_sha256 === null ? null : String(row.snapshot_sha256),
    derivativeIds: row.derivative_ids as Id[],
    allowOriginal: row.allow_original === true,
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
  };
}
export async function assertGrantCurrent(
  tx: Tx,
  actor: Actor,
  id: Id,
  authority: AssistantInputAuthority = denyAssistantInput,
  bootstrap = false,
): Promise<AssistantReadGrant> {
  if (!validId(id)) throw new ApiError('VALIDATION', 400, 'Grant không hợp lệ');
  const [first] = await tx`select * from attachment_assistant_grants where id=${id}`;
  if (!first) notFound();
  const target = await targetFromRow(tx, first),
    current = await lockInputTarget(tx, target);
  const [row] =
    await tx`select g.*,a.revoked_at as authorization_revoked,a.expires_at as authorization_expires,m.revoked_at as machine_revoked from attachment_assistant_grants g join attachment_submission_authorizations a on a.id=g.authorization_id join machines m on m.id=g.machine_id where g.id=${id} for update of g`;
  if (
    !row ||
    actor.kind !== 'machine' ||
    row.machine_id !== actor.id ||
    row.revoked_at ||
    row.authorization_revoked ||
    row.machine_revoked
  )
    notFound();
  const time = await now(tx);
  if (
    new Date(String(row.expires_at)).getTime() <= time ||
    new Date(String(row.authorization_expires)).getTime() <= time ||
    String(row.input_revision) !== current.revision ||
    Number(row.route_revision) !== current.routeRevision
  )
    throw new ApiError('INPUT_SNAPSHOT_STALE', 409, 'Grant input đã cũ');
  const designation = await authority.designation(tx);
  if (
    !designation ||
    designation.id !== row.designation_id ||
    designation.revision !== Number(row.designation_revision) ||
    designation.machineId !== actor.id
  )
    notFound();
  const grant = await grantFromRow(tx, row);
  if (!exactOriginals(grant.originals, await submittedOriginals(tx, target))) notFound();
  if (!bootstrap && !grant.snapshotId)
    throw new ApiError('GRANT_SNAPSHOT_REQUIRED', 409, 'Grant chưa ghim snapshot');
  return grant;
}
export async function issueAssistantReadGrant(
  tx: Tx,
  input: { authorizationId: Id; target: InputTarget; inputRevision: string },
  actor: Actor,
  authority: AssistantInputAuthority = denyAssistantInput,
): Promise<AssistantReadGrant> {
  validateTarget(input.target);
  await authority.authorizeIssue(tx, actor, input);
  const current = await lockInputTarget(tx, input.target);
  if (input.inputRevision !== current.revision)
    throw new ApiError('INPUT_SNAPSHOT_STALE', 409, 'Input đã thay đổi');
  const [authorization] =
    await tx`select * from attachment_submission_authorizations where id=${input.authorizationId} for update`;
  const id = input.target.kind === 'ticket' ? input.target.ticketId : input.target.messageId;
  if (
    !authorization ||
    authorization.revoked_at ||
    authorization.target_kind !== input.target.kind ||
    authorization.target_id !== id ||
    !exactOriginals(authorization.originals as AttachmentRef[], await submittedOriginals(tx, input.target))
  )
    notFound();
  const time = await now(tx);
  if (new Date(String(authorization.expires_at)).getTime() <= time)
    throw new ApiError('INPUT_AUTHORIZATION_EXPIRED', 409, 'Ủy quyền input đã hết hạn');
  const designation = await authority.designation(tx);
  if (!designation) throw new ApiError('ASSISTANT_INPUT_NOT_CONFIGURED', 409, 'Chưa có Trợ lý hiện hành');
  const [machine] =
    await tx`select id from machines where id=${designation.machineId} and revoked_at is null`;
  if (!machine) notFound();
  const expires = new Date(Math.min(new Date(String(authorization.expires_at)).getTime(), time + 15 * 60000));
  const [row] =
    await tx`insert into attachment_assistant_grants(id,authorization_id,target_kind,target_id,originals,input_revision,route_revision,designation_id,designation_revision,machine_id,allow_original,expires_at) values(${randomUUID()},${authorization.id},${input.target.kind},${id},${tx.json(authorization.originals as never)},${current.revision},${current.routeRevision},${designation.id},${designation.revision},${designation.machineId},${authorization.allow_original === true},${expires}) returning *`;
  return grantFromRow(tx, row);
}
export async function bindGrantSnapshot(
  tx: Tx,
  grantId: Id,
  snapshotId: Id,
  actor: Actor,
  authority: AssistantInputAuthority = denyAssistantInput,
): Promise<AssistantReadGrant> {
  const grant = await assertGrantCurrent(tx, actor, grantId, authority, true);
  const [row] = await tx`select canonical,sha256 from attachment_input_snapshots where id=${snapshotId}`;
  const s = row?.canonical as InputSnapshot | undefined;
  if (
    !s ||
    digest(s.target) !== digest(grant.target) ||
    s.inputRevision !== grant.inputRevision ||
    s.routeRevision !== grant.routeRevision ||
    digest(s.originals) !== digest(grant.originals) ||
    s.sha256 !== row.sha256
  )
    notFound();
  if (grant.snapshotId !== null) {
    if (grant.snapshotId !== s.id || grant.snapshotSha256 !== s.sha256)
      throw new ApiError('GRANT_SNAPSHOT_CONFLICT', 409, 'Grant đã ghim snapshot khác');
    return grant;
  }
  if (s.state !== 'ready') throw new ApiError('INPUT_NOT_READY', 422, 'Input chưa sẵn sàng');
  await tx`update attachment_assistant_grants set snapshot_id=${s.id},snapshot_sha256=${s.sha256},derivative_ids=${tx.json(s.selectedDerivativeIds)} where id=${grant.id} and snapshot_id is null`;
  return { ...grant, snapshotId: s.id, snapshotSha256: s.sha256, derivativeIds: s.selectedDerivativeIds };
}
function sessionFromRow(row: Record<string, unknown>): AssistantReadSession {
  return {
    id: String(row.id),
    grantId: String(row.grant_id),
    snapshotId: String(row.snapshot_id),
    snapshotSha256: String(row.snapshot_sha256),
    admission: {
      id: String(row.admission_id),
      admittedAt: new Date(String(row.admitted_at)).toISOString(),
      modelConfigRevision: Number(row.model_config_revision),
      sourceEnabledAtAdmission: true,
    },
    designationRevision: Number(row.designation_revision),
    machineId: String(row.machine_id),
    runtime: row.runtime as AssistantReadSession['runtime'],
    modelKey: String(row.model_key),
    modelSelectionId: String(row.model_selection_id),
    policyReceiptId: String(row.policy_receipt_id),
    processInstanceId: String(row.process_instance_id),
    state: row.state as AssistantReadSession['state'],
    expiresAt: new Date(String(row.expires_at)).toISOString(),
  };
}
export async function readAssistantSession(
  tx: Tx,
  actor: Actor,
  id: Id,
  authority: AssistantInputAuthority = denyAssistantInput,
): Promise<{ session: AssistantReadSession; grant: AssistantReadGrant }> {
  const [row] = await tx`select * from attachment_assistant_sessions where id=${id}`;
  if (!row) notFound();
  const grant = await assertGrantCurrent(tx, actor, String(row.grant_id), authority);
  const session = sessionFromRow(row);
  if (
    session.machineId !== actor.id ||
    session.snapshotId !== grant.snapshotId ||
    session.snapshotSha256 !== grant.snapshotSha256 ||
    session.designationRevision !== grant.designationRevision ||
    new Date(session.expiresAt).getTime() <= (await now(tx)) ||
    !['reserved', 'running'].includes(session.state)
  )
    throw new ApiError('ASSISTANT_SESSION_NOT_ACTIVE', 409, 'Lượt Trợ lý không còn hoạt động');
  await authority.assertSessionCurrent(tx, session);
  return { session, grant };
}
export async function startAssistantReadSession(
  tx: Tx,
  input: { grantId: Id; snapshotId: Id; modelSelectionId: Id },
  actor: Actor,
  authority: AssistantInputAuthority = denyAssistantInput,
): Promise<AssistantReadSession> {
  const grant = await assertGrantCurrent(tx, actor, input.grantId, authority);
  if (input.snapshotId !== grant.snapshotId) notFound();
  // Replay precedes the fresh admission gate. OFF cannot mint a new admission,
  // nor invalidate this exact previously admitted turn by itself.
  const priors =
    await tx`select * from attachment_assistant_sessions where grant_id=${input.grantId} and snapshot_id=${input.snapshotId} and model_selection_id=${input.modelSelectionId}`;
  if (priors.length) {
    if (priors.length !== 1) throw new ApiError('ASSISTANT_SESSION_CONFLICT', 409, 'Lượt đọc bị xung đột');
    return (await readAssistantSession(tx, actor, String(priors[0]?.id), authority)).session;
  }
  const resolved = await authority.authorizeSession(tx, actor, input);
  if (
    !validId(resolved.processInstanceId) ||
    !validId(resolved.policyReceiptId) ||
    !validId(resolved.admission.id) ||
    !Number.isSafeInteger(resolved.admission.modelConfigRevision) ||
    resolved.admission.modelConfigRevision < 1 ||
    resolved.admission.sourceEnabledAtAdmission !== true ||
    !Number.isFinite(Date.parse(resolved.admission.admittedAt))
  )
    throw new ApiError('ASSISTANT_ADMISSION_INVALID', 409, 'Admission không hợp lệ');
  let model: unknown;
  try {
    model = JSON.parse(resolved.modelKey);
  } catch {
    throw new ApiError('ASSISTANT_ADMISSION_INVALID', 409, 'Model không hợp lệ');
  }
  if (
    !model ||
    typeof model !== 'object' ||
    Array.isArray(model) ||
    Object.keys(model).sort().join(',') !== 'machineId,modelId,providerId,runtime' ||
    (model as Record<string, unknown>).machineId !== actor.id ||
    (model as Record<string, unknown>).runtime !== resolved.runtime
  )
    throw new ApiError('ASSISTANT_ADMISSION_INVALID', 409, 'Model không khớp lượt');
  if (!grant.snapshotSha256) notFound();
  const [row] =
    await tx`insert into attachment_assistant_sessions(id,grant_id,snapshot_id,snapshot_sha256,designation_revision,machine_id,runtime,model_key,model_selection_id,policy_receipt_id,process_instance_id,admission_id,admitted_at,model_config_revision,source_enabled_at_admission,state,expires_at) values(${randomUUID()},${grant.id},${input.snapshotId},${grant.snapshotSha256},${grant.designationRevision},${actor.id},${resolved.runtime},${resolved.modelKey},${input.modelSelectionId},${resolved.policyReceiptId},${resolved.processInstanceId},${resolved.admission.id},${resolved.admission.admittedAt},${resolved.admission.modelConfigRevision},true,'reserved',${grant.expiresAt}) returning *`;
  const session = sessionFromRow(row);
  await authority.assertSessionCurrent(tx, session);
  return session;
}
export async function authorizeAssistantRepresentation(
  tx: Tx,
  actor: Actor,
  input: { sessionId: Id; derivativeId: Id | null; attachmentId: Id | null },
  authority: AssistantInputAuthority = denyAssistantInput,
): Promise<BlobHandle> {
  const { session, grant } = await readAssistantSession(tx, actor, input.sessionId, authority);
  if ((input.derivativeId === null) === (input.attachmentId === null))
    throw new ApiError('VALIDATION', 400, 'Representation không hợp lệ');
  if (input.attachmentId) {
    if (!grant.allowOriginal)
      throw new ApiError('ORIGINAL_NOT_AUTHORIZED', 403, 'Grant không cho đọc nguyên bản');
    if (!grant.originals.some((o) => o.attachmentId === input.attachmentId)) notFound();
    const [u] =
      await tx`select * from attachment_uploads where id=${input.attachmentId} and state='ready' and durable_at is not null and linked_at is not null`;
    if (!u || !grant.originals.some((o) => o.attachmentId === u.id && o.sha256 === u.expected_sha256))
      notFound();
    return {
      key: String(u.storage_key),
      sha256: String(u.expected_sha256),
      byteLength: Number(u.expected_bytes),
    };
  }
  if (input.derivativeId === null) notFound();
  if (!grant.derivativeIds.includes(input.derivativeId)) notFound();
  const [d] =
    await tx`select d.*,s.canonical from attachment_derivatives d join attachment_input_snapshots s on s.id=${session.snapshotId} where d.id=${input.derivativeId}`;
  if (
    d?.verification !== 'verified' ||
    !grant.originals.some((o) => o.attachmentId === d.attachment_id) ||
    !(d.canonical as InputSnapshot).extractions.some((e) =>
      e.derivatives.some(
        (x) => x.id === d.id && x.sha256 === d.sha256 && x.original.attachmentId === d.attachment_id,
      ),
    )
  )
    notFound();
  return { key: String(d.blob_key), sha256: String(d.sha256), byteLength: Number(d.byte_length) };
}
export async function revokeInputAuthorization(tx: Tx, id: Id, actor: Actor): Promise<{ revoked: true }> {
  ownerOnly(actor);
  const [first] = await tx`select * from attachment_submission_authorizations where id=${id}`;
  if (!first) notFound();
  await lockInputTarget(tx, await targetFromRow(tx, first));
  await tx`update attachment_submission_authorizations set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=${id}`;
  const rows = await tx`select id from attachment_assistant_grants where authorization_id=${id} order by id`;
  for (const row of rows) await revokeAssistantGrant(tx, String(row.id), actor);
  return { revoked: true };
}
export async function revokeAssistantGrant(tx: Tx, id: Id, actor: Actor): Promise<{ revoked: true }> {
  ownerOnly(actor);
  const [first] = await tx`select * from attachment_assistant_grants where id=${id}`;
  if (!first) notFound();
  const target = await targetFromRow(tx, first),
    current = await lockInputTarget(tx, target);
  const [row] =
    await tx`update attachment_assistant_grants set revoked_at=clock_timestamp() where id=${id} and revoked_at is null returning *`;
  if (row) {
    await tx`update attachment_assistant_sessions set state='unknown' where grant_id=${id} and state in ('reserved','running')`;
    await appendEvent(tx, {
      type: 'attachment.input.changed',
      projectId: target.kind === 'ticket' ? target.projectId : null,
      ticketId: target.kind === 'ticket' ? target.ticketId : null,
      audienceMachineId: String(row.machine_id),
      data: {
        targetKind: target.kind,
        targetId: target.kind === 'ticket' ? target.ticketId : target.messageId,
        inputRevision: current.revision,
      },
    });
  }
  return { revoked: true };
}
export async function appendAssistantReadReceipt(
  tx: Tx,
  input: AssistantReadReceipt,
  actor: Actor,
  authority: AssistantInputAuthority = denyAssistantInput,
): Promise<{ receiptId: Id; coverage: 'all_selected' | 'partial' | 'none'; trust: 'reported_transport' }> {
  const { session } = await readAssistantSession(tx, actor, input.sessionId, authority);
  if (
    input.grantId !== session.grantId ||
    input.snapshotId !== session.snapshotId ||
    input.snapshotSha256 !== session.snapshotSha256 ||
    input.runtime !== session.runtime ||
    input.modelKey !== session.modelKey
  )
    throw new ApiError('RECEIPT_SCOPE_MISMATCH', 422, 'Receipt không khớp lượt');
  const [row] = await tx`select canonical from attachment_input_snapshots where id=${session.snapshotId}`;
  const snapshot = row.canonical as InputSnapshot;
  const selected = snapshot.extractions
    .flatMap((e) => e.derivatives)
    .filter((d) => snapshot.selectedDerivativeIds.includes(d.id));
  const delivered = new Set<string>();
  for (const item of input.delivered) {
    const derivative = selected.find((d) => d.id === item.derivativeId);
    if (
      !derivative ||
      item.sha256 !== derivative.sha256 ||
      (item.modality === 'vision') !== (derivative.kind === 'image') ||
      !item.unitIds.length ||
      new Set(item.unitIds).size !== item.unitIds.length ||
      item.unitIds.some(
        (u) =>
          !derivative.unitIds.includes(u) ||
          !snapshot.required.some(
            (r) => r.original.attachmentId === derivative.original.attachmentId && r.unitIds.includes(u),
          ),
      )
    )
      throw new ApiError('RECEIPT_SCOPE_MISMATCH', 422, 'Representation receipt không hợp lệ');
    for (const unit of item.unitIds) delivered.add(`${derivative.original.attachmentId}:${unit}`);
  }
  const required = snapshot.required.flatMap((r) => r.unitIds.map((u) => `${r.original.attachmentId}:${u}`));
  const coverage =
    required.length > 0 && required.every((u) => delivered.has(u))
      ? ('all_selected' as const)
      : delivered.size
        ? ('partial' as const)
        : ('none' as const);
  if (input.status === 'delivered' && coverage !== 'all_selected')
    throw new ApiError('RECEIPT_COVERAGE_MISMATCH', 422, 'Receipt chưa bao phủ tập được chọn');
  const hash = digest(input),
    id = randomUUID();
  const [prior] =
    await tx`select id,coverage from attachment_assistant_receipts where session_id=${session.id} and receipt_sha256=${hash}`;
  if (prior)
    return {
      receiptId: String(prior.id),
      coverage: prior.coverage as typeof coverage,
      trust: 'reported_transport',
    };
  const [receipt] =
    await tx`insert into attachment_assistant_receipts(id,session_id,grant_id,snapshot_id,receipt_sha256,body,coverage) values(${id},${session.id},${session.grantId},${session.snapshotId},${hash},${tx.json(input)},${coverage}) returning id`;
  return { receiptId: String(receipt.id), coverage, trust: 'reported_transport' };
}
