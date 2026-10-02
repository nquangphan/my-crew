import { createHash, randomUUID } from 'node:crypto';
import type { Capability } from '../models/contracts.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { requireProjectScope } from '../tickets/service.ts';
import { notFound } from './access.ts';
import type {
  AssistantInputAuthority,
  AttachmentRef,
  DispatchInputPin,
  Extraction,
  InputSnapshot,
  InputTarget,
  PreclaimSelectionAuthority,
  Problem,
  RequiredInput,
  SnapshotAccess,
} from './contracts.ts';
import { assertGrantCurrent, denyAssistantInput } from './grants.ts';
import { lockInputTarget, submittedOriginals } from './references.ts';
import { digest, record, validId } from './submissions.ts';

export function validateTarget(target: InputTarget): void {
  if (
    !target ||
    !(
      (target.kind === 'ticket' && validId(target.ticketId) && validId(target.projectId)) ||
      (target.kind === 'message' && validId(target.messageId))
    )
  )
    throw new ApiError('VALIDATION', 400, 'Đích input không hợp lệ');
}
export async function authorizeSnapshotAccess(
  tx: Tx,
  actor: Actor,
  target: InputTarget,
  access: SnapshotAccess,
  assistant: AssistantInputAuthority = denyAssistantInput,
): Promise<AttachmentRef[]> {
  validateTarget(target);
  if (access.kind === 'owner') {
    if (actor.kind !== 'owner') notFound();
    return submittedOriginals(tx, target);
  }
  if (access.kind === 'bound-project') {
    if (actor.kind !== 'machine' || target.kind !== 'ticket' || target.projectId !== access.projectId)
      notFound();
    await requireProjectScope(tx, target.projectId, actor);
    const [p] = await tx`select binding_revision from projects where id=${target.projectId}`;
    if (Number(p.binding_revision) !== access.bindingRevision) notFound();
    return submittedOriginals(tx, target);
  }
  const grant = await assertGrantCurrent(tx, actor, access.grantId, assistant, true);
  if (digest(grant.target) !== digest(target) || grant.designationRevision !== access.designationRevision)
    notFound();
  return grant.originals;
}
const problem = (code: string, unitIds: string[] = []): Problem => ({
  code,
  message: code === 'EXTRACTION_PENDING' ? 'Đang chờ xử lý tệp.' : 'Nội dung chưa có representation phù hợp.',
  unitIds,
});
export async function readInputSnapshot(
  tx: Tx,
  actor: Actor,
  input: {
    target: InputTarget;
    access: SnapshotAccess;
    expectedInputRevision: string | null;
    scopeDecisionId: Id | null;
  },
  selection: PreclaimSelectionAuthority,
  assistant: AssistantInputAuthority = denyAssistantInput,
): Promise<InputSnapshot> {
  validateTarget(input.target);
  const current = await lockInputTarget(tx, input.target);
  const originals = await authorizeSnapshotAccess(tx, actor, input.target, input.access, assistant);
  if (input.expectedInputRevision !== null && input.expectedInputRevision !== current.revision)
    throw new ApiError('INPUT_SNAPSHOT_STALE', 409, 'Input đã thay đổi');
  const subset =
    input.scopeDecisionId === null
      ? null
      : await resolveInputSelection(
          tx,
          actor,
          input.target,
          current,
          input.scopeDecisionId,
          originals,
          selection,
        );
  const extractions: Extraction[] = [],
    required: InputSnapshot['required'] = [],
    problems: Problem[] = [],
    selectedDerivativeIds: Id[] = [];
  const requiredCapabilities = new Set<'text' | 'vision'>();
  for (const original of originals) {
    if (subset !== null && !subset.has(original.attachmentId)) continue;
    const [row] =
      await tx`select * from attachment_extractions where attachment_id=${original.attachmentId} order by created_at desc,id desc limit 1`;
    const extraction = row?.manifest as Extraction | undefined;
    if (!extraction || !row.completed_at) {
      problems.push(problem('EXTRACTION_PENDING'));
      continue;
    }
    const { manifestSha256, ...body } = extraction;
    if (
      extraction.verification !== 'verified' ||
      extraction.original.attachmentId !== original.attachmentId ||
      extraction.original.sha256 !== original.sha256 ||
      row.original_sha256 !== original.sha256 ||
      row.manifest_sha256 !== manifestSha256 ||
      digest(body) !== manifestSha256
    ) {
      problems.push(problem('EXTRACTION_FAILED'));
      continue;
    }
    extractions.push(extraction);
    if (subset !== null && !subset.has(original.attachmentId)) continue;
    const units = extraction.units.filter(
      (u) => subset === null || subset.get(original.attachmentId)?.includes(u.id),
    );
    required.push({ original, unitIds: units.map((u) => u.id).sort() });
    const derivatives =
      await tx`select id,sha256,byte_length,mime,kind,unit_ids,verification from attachment_derivatives where extraction_id=${extraction.id} and attachment_id=${original.attachmentId}`;
    for (const unit of units) {
      const candidates = extraction.derivatives.filter(
        (d) =>
          d.unitIds.includes(unit.id) &&
          d.verification === 'verified' &&
          (unit.needs === 'vision' ? d.kind === 'image' : d.kind === 'text'),
      );
      const match = candidates.find((d) =>
        derivatives.some(
          (r) =>
            r.id === d.id &&
            r.sha256 === d.sha256 &&
            Number(r.byte_length) === d.byteLength &&
            r.mime === d.mime &&
            r.kind === d.kind &&
            r.verification === 'verified' &&
            digest(r.unit_ids) === digest(d.unitIds),
        ),
      );
      if (unit.state !== 'available' || !match) {
        problems.push(problem('MISSING_REPRESENTATION', [unit.id]));
        continue;
      }
      selectedDerivativeIds.push(match.id);
      requiredCapabilities.add(unit.needs);
    }
    if (!units.length || (subset === null && extraction.status !== 'complete'))
      problems.push(
        ...(extraction.problems.length ? extraction.problems : [problem('MISSING_REPRESENTATION')]),
      );
  }
  const comments: InputSnapshot['comments'] = [];
  if (input.target.kind === 'ticket') {
    const rows =
      await tx`with recursive ancestors as(select id,parent_id from tickets where id=${input.target.ticketId} union all select t.id,t.parent_id from tickets t join ancestors a on t.id=a.parent_id) select c.id,c.ticket_id,c.text from comments c join ancestors a on a.id=c.ticket_id order by c.created_at,c.id`;
    for (const row of rows)
      comments.push({
        id: String(row.id),
        ticketId: String(row.ticket_id),
        sha256: createHash('sha256').update(String(row.text)).digest('hex'),
      });
  }
  const core = {
    version: 1 as const,
    target: input.target,
    inputRevision: current.revision,
    routeRevision: current.routeRevision,
    originals,
    extractions,
    required,
    comments,
    selectedDerivativeIds: [...new Set(selectedDerivativeIds)].sort(),
    requiredCapabilities: [...requiredCapabilities].sort(),
    state: problems.length ? ('waiting' as const) : ('ready' as const),
    problems,
  };
  const targetId = input.target.kind === 'ticket' ? input.target.ticketId : input.target.messageId;
  const priors =
    await tx`select canonical from attachment_input_snapshots where target_kind=${input.target.kind} and target_id=${targetId} and input_revision=${current.revision} order by created_at,id`;
  for (const prior of priors) {
    const { id: _id, sha256: _sha, createdAt: _created, ...old } = prior.canonical as InputSnapshot;
    if (digest(old) === digest(core)) return prior.canonical as InputSnapshot;
  }
  const payload = { ...core, id: randomUUID(), createdAt: new Date().toISOString() };
  const snapshot: InputSnapshot = { ...payload, sha256: digest(payload) };
  await tx`insert into attachment_input_snapshots(id,target_kind,target_id,input_revision,route_revision,canonical,sha256) values(${snapshot.id},${input.target.kind},${targetId},${current.revision},${current.routeRevision},${tx.json(snapshot)},${snapshot.sha256})`;
  return snapshot;
}
export function assessSnapshotCapabilities(
  snapshot: InputSnapshot,
  capabilities: Capability[],
): { state: 'ready' | 'waiting'; required: Capability[]; problems: Problem[] } {
  const missing = snapshot.requiredCapabilities.filter((c) => !capabilities.includes(c));
  return {
    state: snapshot.state === 'ready' && !missing.length ? 'ready' : 'waiting',
    required: snapshot.requiredCapabilities,
    problems: [...snapshot.problems, ...missing.map(() => problem('MISSING_REPRESENTATION'))],
  };
}
export async function assertDispatchInputsCurrent(
  tx: Tx,
  input: { commandId: Id; decisionId: Id; pin: DispatchInputPin; modelRequired: Capability[] },
  actor: Actor,
): Promise<void> {
  const [row] =
    await tx`select d.*,s.canonical,c.ticket_id,c.machine_id,c.payload,c.binding_revision,dec.scope,dec.ticket_id as decision_ticket from attachment_dispatch_inputs d join attachment_input_snapshots s on s.id=d.snapshot_id join commands c on c.id=d.command_id join decisions dec on dec.id=d.decision_id where d.command_id=${input.commandId}`;
  const stale = () => {
    throw new ApiError('INPUT_SNAPSHOT_STALE', 409, 'Snapshot input đã cũ');
  };
  if (
    !row ||
    actor.kind !== 'machine' ||
    row.machine_id !== actor.id ||
    row.decision_id !== input.decisionId ||
    row.decision_ticket !== row.ticket_id
  )
    stale();
  const s = row.canonical as InputSnapshot;
  if (s.target.kind !== 'ticket' || s.target.ticketId !== row.ticket_id) return stale();
  const current = await lockInputTarget(tx, s.target);
  await requireProjectScope(tx, s.target.projectId, actor);
  const [project] = await tx`select binding_revision from projects where id=${s.target.projectId}`;
  const pin = {
    snapshotId: String(row.snapshot_id),
    snapshotSha256: String(row.sha256),
    inputRevision: String(row.input_revision),
    selectionSha256: String(row.selection_sha256),
  };
  const { sha256, ...body } = s;
  if (
    current.revision !== s.inputRevision ||
    current.routeRevision !== s.routeRevision ||
    s.state !== 'ready' ||
    digest(body) !== sha256 ||
    s.sha256 !== pin.snapshotSha256 ||
    s.id !== pin.snapshotId ||
    s.inputRevision !== pin.inputRevision ||
    digest(s.required) !== pin.selectionSha256 ||
    digest(pin) !== digest(input.pin) ||
    !row.payload?.inputSnapshot ||
    !row.scope?.inputSnapshot ||
    digest(row.payload.inputSnapshot) !== digest(pin) ||
    digest(row.scope.inputSnapshot) !== digest(pin) ||
    Number(project.binding_revision) !== Number(row.binding_revision) ||
    !s.requiredCapabilities.every((c) => input.modelRequired.includes(c))
  )
    stale();
  // Defence at admission even when a future version-enqueue writer has not yet
  // invalidated revision. This does not replace atomic enqueue/grant revoke.
  for (const extraction of s.extractions) {
    const [latest] =
      await tx`select id,status,manifest_sha256,original_sha256 from attachment_extractions where attachment_id=${extraction.original.attachmentId} order by created_at desc,id desc limit 1`;
    if (
      !latest ||
      latest.id !== extraction.id ||
      latest.status !== extraction.status ||
      latest.manifest_sha256 !== extraction.manifestSha256 ||
      latest.original_sha256 !== extraction.original.sha256
    )
      stale();
  }
}

export type PersistedInputSelection = {
  target: InputTarget;
  inputRevision: string;
  routeRevision: number;
  required: RequiredInput[];
  unitsSha256: string;
  rationale: string;
};
async function resolveInputSelection(
  tx: Tx,
  actor: Actor,
  target: InputTarget,
  current: { revision: string; routeRevision: number },
  scopeDecisionId: Id,
  originals: AttachmentRef[],
  authority: PreclaimSelectionAuthority,
): Promise<Map<string, string[]>> {
  const rows =
    target.kind === 'ticket'
      ? await tx`select scope,kind,ticket_id from decisions where id=${scopeDecisionId}`
      : await tx`select body as scope,kind,message_id as ticket_id from attachment_message_decisions where id=${scopeDecisionId}`;
  const row = rows[0],
    value = row?.scope?.inputSelection;
  if (!record(value)) {
    await authority(tx, actor, { target, requestedUnitIds: null, scopeDecisionId });
    throw new ApiError('INPUT_SELECTION_INVALID', 422, 'Thiếu quyết định lựa chọn đã lưu');
  }
  const invalid = () => {
    throw new ApiError('INPUT_SELECTION_INVALID', 422, 'Quyết định lựa chọn không khớp input');
  };
  if (
    row?.ticket_id !== (target.kind === 'ticket' ? target.ticketId : target.messageId) ||
    !record(value.target) ||
    digest(value.target) !== digest(target) ||
    value.inputRevision !== current.revision ||
    value.routeRevision !== current.routeRevision ||
    typeof value.rationale !== 'string' ||
    !value.rationale.trim() ||
    value.rationale.length > 32768 ||
    !Array.isArray(value.required) ||
    !value.required.length ||
    value.required.length > 100 ||
    typeof value.unitsSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.unitsSha256)
  )
    return invalid();
  const selected = new Map<string, string[]>(),
    projection: unknown[] = [];
  for (const input of value.required) {
    if (
      !record(input) ||
      !record(input.original) ||
      !Array.isArray(input.unitIds) ||
      !input.unitIds.length ||
      input.unitIds.length > 100000 ||
      !input.unitIds.every((u) => typeof u === 'string' && u.length > 0 && u.length <= 200) ||
      new Set(input.unitIds).size !== input.unitIds.length
    )
      return invalid();
    const original = originals.find((o) => digest(o) === digest(input.original));
    if (!original || selected.has(original.attachmentId)) return invalid();
    const [row] =
      await tx`select manifest,manifest_sha256,completed_at from attachment_extractions where attachment_id=${original.attachmentId} order by created_at desc,id desc limit 1`;
    const extraction = row?.manifest as Extraction | undefined;
    if (
      !extraction ||
      !row.completed_at ||
      extraction.verification !== 'verified' ||
      extraction.original.sha256 !== original.sha256
    )
      return invalid();
    const { manifestSha256, ...body } = extraction;
    if (row.manifest_sha256 !== manifestSha256 || digest(body) !== manifestSha256) return invalid();
    const unitIds = [...(input.unitIds as string[])].sort();
    for (const id of unitIds) {
      const unit = extraction.units.find((u) => u.id === id);
      if (unit?.state !== 'available') return invalid();
      projection.push({
        original,
        extractionId: extraction.id,
        manifestSha256,
        unitId: unit.id,
        locator: unit.locator,
        needs: unit.needs,
      });
    }
    selected.set(original.attachmentId, unitIds);
  }
  projection.sort((a, b) => digest(a).localeCompare(digest(b)));
  if (digest(projection) !== value.unitsSha256) return invalid();
  await authority(tx, actor, { target, requestedUnitIds: [...selected.values()].flat(), scopeDecisionId });
  return selected;
}
