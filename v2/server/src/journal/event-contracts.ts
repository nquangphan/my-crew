import type { EventInput } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sensitive = /token|password|credential|secret/i;

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
  }
  if (!valid) throw new ApiError('EVENT_INVALID', 422, 'Dữ liệu sự kiện không hợp lệ');
}
