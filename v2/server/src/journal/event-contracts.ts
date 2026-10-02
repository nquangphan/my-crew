import type { EventInput } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sensitive = /token|password|credential|secret/i;
const ticketStatuses = new Set(['pending', 'ready', 'running', 'needs_input', 'paused', 'done', 'cancelled']);
const decisionKinds = new Set([
  'assessment',
  'delegated',
  'owner_answer',
  'approval',
  'intervention',
  'dispatch',
]);
const repairClassifications = new Set(['initial_review', 'repair_review', 'infrastructure', 'model']);

function safeData(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value))
    throw new ApiError('EVENT_INVALID', 422, 'Dữ liệu sự kiện không hợp lệ');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) safeData(item, seen);
      return;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new ApiError('EVENT_INVALID', 422, 'Dữ liệu sự kiện không hợp lệ');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || sensitive.test(key))
        throw new ApiError('EVENT_INVALID', 422, 'Dữ liệu sự kiện không hợp lệ');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor))
        throw new ApiError('EVENT_INVALID', 422, 'Dữ liệu sự kiện không hợp lệ');
      safeData(descriptor.value, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function exactKeys(data: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(data).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function inputRevision(value: unknown): boolean {
  return (
    typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
  );
}

export function validateEventInput(input: EventInput): void {
  if (
    !input ||
    ![input.projectId, input.ticketId, input.audienceMachineId].every(
      (id) => id === null || (typeof id === 'string' && uuid.test(id)),
    ) ||
    !input.data ||
    typeof input.data !== 'object' ||
    Array.isArray(input.data)
  )
    throw new ApiError('EVENT_INVALID', 422, 'Dữ liệu sự kiện không hợp lệ');
  safeData(input.data);
  const data = input.data;
  let valid = false;
  switch (input.type) {
    case 'assistant.message.created':
      valid =
        exactKeys(data, ['messageId', 'inputRevision']) &&
        typeof data.messageId === 'string' &&
        uuid.test(data.messageId) &&
        inputRevision(data.inputRevision) &&
        input.projectId === null &&
        input.ticketId === null &&
        input.audienceMachineId === null;
      break;
    case 'attachment.input.changed':
      valid =
        exactKeys(data, ['targetKind', 'targetId', 'inputRevision']) &&
        typeof data.targetId === 'string' &&
        uuid.test(data.targetId) &&
        inputRevision(data.inputRevision) &&
        input.audienceMachineId !== null &&
        ((data.targetKind === 'ticket' && input.projectId !== null && input.ticketId === data.targetId) ||
          (data.targetKind === 'message' && input.projectId === null && input.ticketId === null));
      break;
    case 'attachment.changed':
      valid =
        exactKeys(data, ['attachmentId', 'state', 'extraction']) &&
        typeof data.attachmentId === 'string' &&
        uuid.test(data.attachmentId) &&
        typeof data.state === 'string' &&
        [
          'reserved',
          'receiving',
          'ready',
          'rejected',
          'abandoned',
          'deleting',
          'deleted',
          'missing',
        ].includes(String(data.state)) &&
        typeof data.extraction === 'string' &&
        [
          'pending',
          'running',
          'complete',
          'partial',
          'encrypted',
          'corrupt',
          'unsupported',
          'blocked',
          'failed',
        ].includes(String(data.extraction)) &&
        input.audienceMachineId === null &&
        ((input.projectId === null && input.ticketId === null) ||
          (input.projectId !== null && input.ticketId !== null));
      break;
    case 'source.desired':
    case 'source.applied':
      valid =
        exactKeys(data, input.type === 'source.desired' ? ['revision'] : ['revision', 'reportId']) &&
        Number.isSafeInteger(data.revision) &&
        Number(data.revision) > 0 &&
        (input.type === 'source.desired' ||
          (typeof data.reportId === 'string' && uuid.test(data.reportId))) &&
        input.projectId === null &&
        input.ticketId === null &&
        input.audienceMachineId !== null;
      break;
    case 'gateway.config.changed':
      valid =
        exactKeys(data, ['revision']) &&
        Number.isSafeInteger(data.revision) &&
        Number(data.revision) > 0 &&
        input.projectId === null &&
        input.ticketId === null &&
        input.audienceMachineId !== null;
      break;
    case 'gateway.booted':
      valid =
        exactKeys(data, ['bootId', 'bootGeneration']) &&
        typeof data.bootId === 'string' &&
        uuid.test(data.bootId) &&
        typeof data.bootGeneration === 'string' &&
        /^[1-9][0-9]*$/.test(data.bootGeneration) &&
        input.projectId === null &&
        input.ticketId === null &&
        input.audienceMachineId !== null;
      break;
    case 'gateway.install.reported':
      valid =
        exactKeys(data, ['reportId', 'revision', 'accepted']) &&
        typeof data.reportId === 'string' &&
        uuid.test(data.reportId) &&
        Number.isSafeInteger(data.revision) &&
        Number(data.revision) > 0 &&
        typeof data.accepted === 'boolean' &&
        input.projectId === null &&
        input.ticketId === null &&
        input.audienceMachineId !== null;
      break;
    case 'gateway.command.created':
    case 'gateway.command.acknowledged':
      valid =
        exactKeys(
          data,
          input.type === 'gateway.command.created' ? ['commandId', 'type'] : ['commandId', 'phase'],
        ) &&
        typeof data.commandId === 'string' &&
        uuid.test(data.commandId) &&
        (input.type === 'gateway.command.created'
          ? ['sync_workflows', 'probe', 'reconcile_host', 'sync_models'].includes(String(data.type))
          : ['received', 'completed'].includes(String(data.phase))) &&
        input.projectId === null &&
        input.ticketId === null &&
        input.audienceMachineId !== null;
      break;
    case 'docs.imported':
      valid =
        exactKeys(data, ['importId', 'projectCount']) &&
        typeof data.importId === 'string' &&
        uuid.test(data.importId) &&
        Number.isSafeInteger(data.projectCount) &&
        Number(data.projectCount) >= 1 &&
        Number(data.projectCount) <= 100 &&
        input.projectId === null &&
        input.ticketId === null &&
        input.audienceMachineId === null;
      break;
    case 'docs.synced':
      valid =
        exactKeys(data, ['snapshotId', 'sourceCommit', 'auditState']) &&
        typeof data.snapshotId === 'string' &&
        uuid.test(data.snapshotId) &&
        typeof data.sourceCommit === 'string' &&
        /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(data.sourceCommit) &&
        ['unverified', 'verified'].includes(String(data.auditState)) &&
        input.projectId !== null &&
        input.ticketId === null &&
        input.audienceMachineId === null;
      break;
    case 'probe':
      valid = (exactKeys(data, []) || exactKeys(data, ['ok'])) && (!('ok' in data) || data.ok === true);
      break;
    case 'machine.provisioned':
      valid =
        exactKeys(data, ['machineId']) && typeof data.machineId === 'string' && uuid.test(data.machineId);
      break;
    case 'project.created':
      valid =
        exactKeys(data, ['revision']) &&
        Number.isSafeInteger(data.revision) &&
        Number(data.revision) >= 1 &&
        input.projectId !== null;
      break;
    case 'project.bound':
      valid =
        exactKeys(data, ['machineId', 'bindingRevision']) &&
        typeof data.machineId === 'string' &&
        uuid.test(data.machineId) &&
        Number.isSafeInteger(data.bindingRevision) &&
        Number(data.bindingRevision) >= 1 &&
        input.projectId !== null;
      break;
    case 'ticket.created':
    case 'ticket.changed':
      valid =
        (exactKeys(data, ['revision']) || exactKeys(data, ['revision', 'status'])) &&
        Number.isSafeInteger(data.revision) &&
        Number(data.revision) >= 1 &&
        (!('status' in data) || ticketStatuses.has(data.status as string)) &&
        input.projectId !== null &&
        input.ticketId !== null;
      break;
    case 'dependency.added':
      valid =
        exactKeys(data, ['predecessorId', 'revision']) &&
        typeof data.predecessorId === 'string' &&
        uuid.test(data.predecessorId) &&
        Number.isSafeInteger(data.revision) &&
        Number(data.revision) >= 1 &&
        input.projectId !== null &&
        input.ticketId !== null;
      break;
    case 'comment.created':
      valid =
        exactKeys(data, ['commentId']) &&
        typeof data.commentId === 'string' &&
        uuid.test(data.commentId) &&
        input.projectId !== null &&
        input.ticketId !== null;
      break;
    case 'decision.created':
      valid =
        exactKeys(data, ['decisionId', 'kind']) &&
        typeof data.decisionId === 'string' &&
        uuid.test(data.decisionId) &&
        decisionKinds.has(data.kind as string) &&
        input.projectId !== null &&
        input.ticketId !== null;
      break;
    case 'repair.recorded':
      valid =
        exactKeys(data, ['cycleId', 'classification', 'passed', 'repairCycles']) &&
        typeof data.cycleId === 'string' &&
        uuid.test(data.cycleId) &&
        repairClassifications.has(data.classification as string) &&
        typeof data.passed === 'boolean' &&
        Number.isSafeInteger(data.repairCycles) &&
        Number(data.repairCycles) >= 0 &&
        Number(data.repairCycles) <= 5 &&
        input.projectId !== null &&
        input.ticketId !== null;
      break;
    case 'command.created':
      valid =
        exactKeys(data, ['commandId', 'type']) &&
        typeof data.commandId === 'string' &&
        uuid.test(data.commandId) &&
        ['start', 'pause', 'cancel', 'resume', 'reconcile'].includes(String(data.type)) &&
        input.projectId !== null &&
        input.ticketId !== null &&
        input.audienceMachineId !== null;
      break;
    case 'command.acknowledged':
      valid =
        exactKeys(data, ['commandId', 'phase']) &&
        typeof data.commandId === 'string' &&
        uuid.test(data.commandId) &&
        ['received', 'completed'].includes(String(data.phase)) &&
        input.projectId !== null &&
        input.ticketId !== null &&
        input.audienceMachineId !== null;
      break;
    case 'attempt.claimed':
      valid =
        exactKeys(data, ['attemptId', 'commandId', 'fence']) &&
        typeof data.attemptId === 'string' &&
        uuid.test(data.attemptId) &&
        typeof data.commandId === 'string' &&
        uuid.test(data.commandId) &&
        typeof data.fence === 'string' &&
        /^[1-9][0-9]*$/.test(data.fence) &&
        input.projectId !== null &&
        input.ticketId !== null &&
        input.audienceMachineId !== null;
      break;
    case 'attempt.checkpoint':
      valid =
        exactKeys(data, ['attemptId', 'sequence']) &&
        typeof data.attemptId === 'string' &&
        uuid.test(data.attemptId) &&
        typeof data.sequence === 'string' &&
        /^(0|[1-9][0-9]*)$/.test(data.sequence) &&
        input.projectId !== null &&
        input.ticketId !== null &&
        input.audienceMachineId !== null;
      break;
    case 'attempt.stopped':
      valid =
        exactKeys(data, ['attemptId', 'reason']) &&
        typeof data.attemptId === 'string' &&
        uuid.test(data.attemptId) &&
        ['pause', 'cancel', 'exit'].includes(String(data.reason)) &&
        input.projectId !== null &&
        input.ticketId !== null &&
        input.audienceMachineId !== null;
      break;
    case 'attempt.finalized':
      valid =
        exactKeys(data, ['attemptId', 'signal']) &&
        typeof data.attemptId === 'string' &&
        uuid.test(data.attemptId) &&
        ['passed', 'reconciled_stopped', 'wait_owner', 'pause_confirmed', 'cancel_confirmed'].includes(
          String(data.signal),
        ) &&
        input.projectId !== null &&
        input.ticketId !== null &&
        input.audienceMachineId !== null;
      break;
  }
  if (!valid) throw new ApiError('EVENT_INVALID', 422, 'Dữ liệu sự kiện không hợp lệ');
}
