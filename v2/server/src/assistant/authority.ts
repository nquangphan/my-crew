import { randomUUID } from 'node:crypto';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { AssistantConfig, AssistantPolicy, OrchestrationProof, Sha256 } from './contracts.ts';
import { assertAssistantId, assertCurrentTurnFence, assertTurnFence } from './store.ts';

export type AssistantConfigChange = {
  expectedRevision: number;
  machineId: Id;
  preferred: null;
  policy: AssistantPolicy;
};

function ownerOnly(actor: Actor): void {
  if (actor.kind !== 'owner' || actor.id !== 'owner')
    throw new ApiError('OWNER_REQUIRED', 403, 'Cần quyền chủ dự án');
}

export async function readAssistantConfig(tx: Tx, actor: Actor): Promise<AssistantConfig> {
  ownerOnly(actor);
  const [row] = await tx`select c.revision,c.preferred_model,c.policy,d.id,d.machine_id,
    d.revision as designation_revision,d.retired_at
    from assistant_config c left join assistant_designations d on d.id=c.designation_id
    where c.singleton=true`;
  if (!row) throw new ApiError('ASSISTANT_STORE_MISSING', 503, 'Chưa khởi tạo kho Trợ lý');
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision))
    throw new ApiError('ASSISTANT_REVISION_EXHAUSTED', 409, 'Revision Trợ lý đã hết');
  return {
    revision,
    designation:
      row.id === null || row.retired_at !== null
        ? null
        : {
            id: String(row.id),
            ownerId: 'owner',
            machineId: String(row.machine_id),
            revision: Number(row.designation_revision),
          },
    preferred: row.preferred_model as AssistantConfig['preferred'],
    policy: row.policy as AssistantPolicy,
  };
}

/** Journal holds event_cursor first. The guard serializes config and turn admission. */
export async function authorizeAssistantConfigChange(tx: Tx, actor: Actor, machineId: Id): Promise<void> {
  ownerOnly(actor);
  assertAssistantId(machineId);
  const [guard] =
    await tx`select challenge_id from assistant_calibration_guard where singleton=true for update`;
  if (!guard) throw new ApiError('ASSISTANT_STORE_MISSING', 503, 'Chưa khởi tạo kho Trợ lý');
  if (guard.challenge_id !== null)
    throw new ApiError('ASSISTANT_CALIBRATION_ACTIVE', 409, 'Đang đối chiếu runtime Trợ lý');
  const [current] = await tx`select d.machine_id,d.retired_at from assistant_config c
    join assistant_designations d on d.id=c.designation_id where c.singleton=true`;
  const ids = [...new Set([machineId, ...(current ? [String(current.machine_id)] : [])])].sort();
  const machines = await tx`select id,revoked_at from machines where id in ${tx(ids)} order by id for update`;
  if (!machines.some((machine) => machine.id === machineId && machine.revoked_at === null))
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy máy');
  const [config] = await tx`select designation_id from assistant_config where singleton=true for update`;
  if (!config) throw new ApiError('ASSISTANT_STORE_MISSING', 503, 'Chưa khởi tạo kho Trợ lý');
  if (config.designation_id !== null)
    await tx`select id from assistant_designations where id=${config.designation_id} for update`;
  // Prelock every reassignment authority row before the route's final credential check.
  // Work repeats this query with these locks held and keeps its existing validation order.
  if (!current || current.retired_at !== null || current.machine_id !== machineId)
    await tx`select id from assistant_turns where state<>'stopped' for update`;
}

/** Called only with the strict config route body in the caller's mutation transaction. */
export async function setAssistantConfig(
  tx: Tx,
  actor: Actor,
  input: AssistantConfigChange,
): Promise<AssistantConfig> {
  await authorizeAssistantConfigChange(tx, actor, input.machineId);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.preferred !== null)
    throw new ApiError('VALIDATION', 400, 'Cấu hình Trợ lý không hợp lệ');
  const current = await readAssistantConfig(tx, actor);
  if (current.revision !== input.expectedRevision)
    throw new ApiError('REVISION_CONFLICT', 409, 'Cấu hình Trợ lý đã thay đổi');
  if (current.revision >= Number.MAX_SAFE_INTEGER)
    throw new ApiError('ASSISTANT_REVISION_EXHAUSTED', 409, 'Revision Trợ lý đã hết');
  const [pending] = await tx`select pending_designation from assistant_config where singleton=true`;
  if (pending.pending_designation !== null)
    throw new ApiError('ASSISTANT_REASSIGNMENT_PENDING', 409, 'Đang chờ đổi máy Trợ lý');
  let designationId = current.designation?.id ?? null;
  if (!current.designation || current.designation.machineId !== input.machineId) {
    const live = await tx`select id from assistant_turns where state<>'stopped' for update`;
    if (live.length)
      throw new ApiError('ASSISTANT_TURN_IN_USE', 409, 'Cần đối chiếu dừng lượt Trợ lý trước khi đổi máy');
    const [last] = await tx`select coalesce(max(revision),0) as revision from assistant_designations`;
    const revision = Number(last.revision) + 1;
    if (revision > 2147483647)
      throw new ApiError('ASSISTANT_REVISION_EXHAUSTED', 409, 'Revision designation đã hết');
    if (designationId)
      await tx`update assistant_designations set retired_at=clock_timestamp() where id=${designationId}`;
    designationId = randomUUID();
    await tx`insert into assistant_designations(id,owner_id,machine_id,revision)
      values(${designationId},'owner',${input.machineId},${revision})`;
  }
  await tx`update assistant_config set designation_id=${designationId},revision=revision+1,
    preferred_model=null,policy=${tx.json(input.policy)} where singleton=true`;
  return readAssistantConfig(tx, actor);
}

/** Internal T3 seam; callers lock any root/tickets/projects before resolving authority. */
export type PersistedAssistantActorResolver = (tx: Tx, proof: OrchestrationProof) => Promise<Actor>;
export type PersistedAssistantActorResolverDependencies = {
  /** Build hash of the routing verifier pinned at assembly; receipts from any other verifier deny. */
  verifierBuildSha256: Sha256;
};

const admissionDenied = () =>
  new ApiError('ASSISTANT_ADMISSION_DENIED', 403, 'Admission Trợ lý không hợp lệ');

/**
 * Positive Actor only from persisted rows in this deployment: current fence and
 * scope, the turn's admitted read session, and a current PASS policy receipt
 * issued by the pinned verifier. A turn without admission stays 503; every
 * mismatch is 403 with no fallback. Expiry is measured by `clock_timestamp()`
 * after the authority rows are locked, never by the transaction start time.
 */
export function createPersistedAssistantActorResolver(
  deps: PersistedAssistantActorResolverDependencies,
): PersistedAssistantActorResolver {
  const verifierBuildSha256: unknown = deps?.verifierBuildSha256;
  if (typeof verifierBuildSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(verifierBuildSha256))
    throw new Error('ASSISTANT_VERIFIER_PIN_INVALID');
  return async (tx, proof) => {
    assertTurnFence(proof.fence);
    assertAssistantId(proof.scopeId);
    assertAssistantId(proof.operationId);
    const fence = { ...proof.fence };
    const scopeId = proof.scopeId;
    const [scope] = await tx`select turn_id from assistant_scopes where id=${scopeId}`;
    if (!scope || scope.turn_id !== fence.turnId)
      throw new ApiError('ASSISTANT_SCOPE_NOT_FOUND', 404, 'Không tìm thấy phạm vi Trợ lý');
    // Locks guard, machine, config, designation, turn and monitor, then rechecks the exact fence.
    await assertCurrentTurnFence(tx, fence, 'claim');
    const [current] = await tx`select input_snapshot_id from assistant_scopes where id=${scopeId}
      and turn_id=${fence.turnId} and expires_at>clock_timestamp()`;
    if (!current) throw new ApiError('ASSISTANT_SCOPE_STALE', 409, 'Phạm vi Trợ lý đã hết hạn');
    const [turn] = await tx`select t.admission_id,t.read_session_id,t.model_selection_id,d.machine_id
      from assistant_turns t join assistant_designations d on d.id=t.designation_id where t.id=${fence.turnId}`;
    if (!turn) throw new ApiError('ASSISTANT_TURN_STALE', 409, 'Lượt Trợ lý không còn quyền hiện hành');
    if (turn.admission_id === null)
      throw new ApiError('ASSISTANT_ADMISSION_NOT_CONFIGURED', 503, 'Chưa cấu hình admission Trợ lý');
    const [session] =
      await tx`select id,state,machine_id,process_instance_id,designation_revision,model_selection_id,
      policy_receipt_id,snapshot_id from attachment_assistant_sessions where admission_id=${turn.admission_id} for share`;
    const [selection] = session
      ? await tx`select id,policy_receipt_id,probe_receipt_id from assistant_model_selections
        where id=${turn.model_selection_id} and turn_id=${fence.turnId} for share`
      : [];
    const [receipt] = selection
      ? await tx`select status,revoked_at,deployment_id,verifier_build_sha256,machine_id
        from assistant_policy_receipts where id=${selection.policy_receipt_id} for share`
      : [];
    const [capability] = receipt
      ? await tx`select id from routing_capability_receipts where id=${selection?.probe_receipt_id}
        and certification_receipt_id=${selection?.policy_receipt_id} for share`
      : [];
    // Every expiry is measured after the rows above are locked.
    const [clock] = session
      ? await tx`select
          (select expires_at>clock_timestamp() from attachment_assistant_sessions where id=${session.id}) as session_current,
          (select expires_at>clock_timestamp() from assistant_policy_receipts where id=${selection?.policy_receipt_id ?? null}) as receipt_current,
          (select expires_at>clock_timestamp() from routing_capability_receipts where id=${capability?.id ?? null}) as capability_current,
          (select deployment_id from assistant_config where singleton=true) as deployment_id`
      : [];
    if (
      !session ||
      !selection ||
      !receipt ||
      !capability ||
      !clock ||
      session.id !== turn.read_session_id ||
      !['reserved', 'running'].includes(String(session.state)) ||
      clock.session_current !== true ||
      session.machine_id !== turn.machine_id ||
      session.process_instance_id !== fence.processInstanceId ||
      Number(session.designation_revision) !== fence.designationRevision ||
      session.model_selection_id !== selection.id ||
      session.policy_receipt_id !== selection.policy_receipt_id ||
      session.snapshot_id !== current.input_snapshot_id ||
      receipt.status !== 'PASS' ||
      receipt.revoked_at !== null ||
      clock.receipt_current !== true ||
      clock.capability_current !== true ||
      receipt.deployment_id !== clock.deployment_id ||
      receipt.verifier_build_sha256 !== verifierBuildSha256 ||
      receipt.machine_id !== turn.machine_id
    )
      throw admissionDenied();
    const actor: Actor = { kind: 'machine', id: String(turn.machine_id) };
    return Object.freeze(actor);
  };
}
