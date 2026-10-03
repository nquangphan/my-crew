import { randomUUID } from 'node:crypto';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { AssistantConfig, AssistantPolicy, OrchestrationProof } from './contracts.ts';
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

/**
 * Slice A supplies current-identity diagnostics, never admission authority.
 * No injected boolean/callback can turn relational fixture receipts into permission.
 * A measured input/session authority must be reviewed before a positive implementation.
 */
export function createPersistedAssistantActorResolver(): PersistedAssistantActorResolver {
  return async (tx, proof) => {
    assertTurnFence(proof.fence);
    assertAssistantId(proof.scopeId);
    assertAssistantId(proof.operationId);
    const [scope] = await tx`select turn_id from assistant_scopes where id=${proof.scopeId}`;
    if (!scope || scope.turn_id !== proof.fence.turnId)
      throw new ApiError('ASSISTANT_SCOPE_NOT_FOUND', 404, 'Không tìm thấy phạm vi Trợ lý');
    await assertCurrentTurnFence(tx, proof.fence, 'claim');
    const [current] = await tx`select id from assistant_scopes where id=${proof.scopeId}
      and turn_id=${proof.fence.turnId} and expires_at>clock_timestamp()`;
    if (!current) throw new ApiError('ASSISTANT_SCOPE_STALE', 409, 'Phạm vi Trợ lý đã hết hạn');
    throw new ApiError('ASSISTANT_ADMISSION_NOT_CONFIGURED', 503, 'Chưa cấu hình admission Trợ lý');
  };
}
