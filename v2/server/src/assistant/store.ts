import type { Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { TurnFence } from './contracts.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxGeneration = 9223372036854775807n;
export function assertAssistantId(value: unknown): asserts value is Id {
  if (typeof value !== 'string' || !uuid.test(value))
    throw new ApiError('ASSISTANT_ID_INVALID', 400, 'Định danh Trợ lý không hợp lệ');
}
export function assertTurnFence(value: unknown): asserts value is TurnFence {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError('ASSISTANT_FENCE_INVALID', 400, 'Fence Trợ lý không hợp lệ');
  const row = value as Record<string, unknown>;
  const fields = ['turnId', 'designationId', 'designationRevision', 'generation', 'processInstanceId'];
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new ApiError('ASSISTANT_FENCE_INVALID', 400, 'Fence Trợ lý có trường không hợp lệ');
  for (const key of ['turnId', 'designationId', 'processInstanceId']) assertAssistantId(row[key]);
  if (
    !Number.isSafeInteger(row.designationRevision) ||
    Number(row.designationRevision) < 1 ||
    typeof row.generation !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(row.generation) ||
    BigInt(row.generation) > maxGeneration
  )
    throw new ApiError('ASSISTANT_FENCE_INVALID', 400, 'Revision hoặc generation không hợp lệ');
}

// Persistence primitive only. The admission caller holds the same transaction
// through writing its exact normal turn or calibration launch. No separate commit.
export async function allocateAssistantGeneration(tx: Tx): Promise<string> {
  const [guard] = await tx`select singleton from assistant_calibration_guard where singleton=true for update`;
  if (!guard) throw new ApiError('ASSISTANT_STORE_MISSING', 503, 'Chưa khởi tạo kho Trợ lý');
  const [row] = await tx`
    update assistant_monitor set generation=generation+1
    where singleton=true and generation<9223372036854775807 returning generation
  `;
  if (!row) throw new ApiError('ASSISTANT_GENERATION_EXHAUSTED', 409, 'Generation Trợ lý đã hết');
  return String(row.generation);
}

export async function assertCurrentTurnFence(
  tx: Tx,
  fence: TurnFence,
  purpose: 'claim' | 'ack',
): Promise<void> {
  assertTurnFence(fence);
  const reject = () => new ApiError('ASSISTANT_TURN_STALE', 409, 'Lượt Trợ lý không còn quyền hiện hành');
  const [guard] =
    await tx`select challenge_id from assistant_calibration_guard where singleton=true for update`;
  if (!guard || guard.challenge_id !== null) throw reject();
  // Resolve identity before ordered locking; every field is rechecked below.
  const [identity] = await tx`select machine_id from assistant_designations where id=${fence.designationId}`;
  if (!identity) throw reject();
  const [machine] = await tx`select revoked_at from machines where id=${identity.machine_id} for update`;
  const [config] = await tx`select designation_id from assistant_config where singleton=true for update`;
  const [designation] =
    await tx`select machine_id,revision,retired_at from assistant_designations where id=${fence.designationId} for update`;
  const [turn] =
    await tx`select designation_id,designation_revision,generation,process_instance_id,state from assistant_turns where id=${fence.turnId} for update`;
  const [monitor] = await tx`select generation from assistant_monitor where singleton=true for update`;
  const states = purpose === 'claim' ? ['reserved', 'running'] : ['running', 'finalizing', 'stopped'];
  if (
    !machine ||
    machine.revoked_at !== null ||
    config?.designation_id !== fence.designationId ||
    !designation ||
    designation.retired_at !== null ||
    designation.machine_id !== identity.machine_id ||
    Number(designation.revision) !== fence.designationRevision ||
    !turn ||
    turn.designation_id !== fence.designationId ||
    Number(turn.designation_revision) !== fence.designationRevision ||
    String(turn.generation) !== fence.generation ||
    String(monitor?.generation) !== fence.generation ||
    turn.process_instance_id !== fence.processInstanceId ||
    !states.includes(String(turn.state))
  )
    throw reject();
}
