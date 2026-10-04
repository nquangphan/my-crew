import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import type {
  OrchestrationAction,
  OrchestrationProof,
  ProjectOrchestrationAuthority,
} from '../assistant/contracts.ts';
import { canonicalJson } from '../journal/canonical.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { Ticket } from './contracts.ts';

// Validate source descriptors before canonicalJson can iterate an array. Never
// read caller array elements, iterators or accessors while capturing authority.
function assertSnapshotData(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || utilTypes.isProxy(value) || ancestors.has(value))
    throw new Error('SNAPSHOT_JSON_INVALID');
  const array = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  )
    throw new Error('SNAPSHOT_JSON_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = array ? (descriptors.length?.value as number) : 0;
  if (array && Object.keys(descriptors).length !== length + 1) throw new Error('SNAPSHOT_JSON_INVALID');
  ancestors.add(value);
  try {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!('value' in descriptor)) throw new Error('SNAPSHOT_JSON_INVALID');
      if (array && key === 'length') continue;
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))
        throw new Error('SNAPSHOT_JSON_INVALID');
      assertSnapshotData(descriptor.value, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

export function immutableSnapshot<T>(value: T): T {
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  };
  try {
    assertSnapshotData(value);
    const result = JSON.parse(canonicalJson(value)) as T;
    freeze(result);
    return result;
  } catch {
    throw new ApiError('VALIDATION', 400, 'Dữ liệu điều phối không hợp lệ');
  }
}

export function orchestrationTargetHash(action: OrchestrationAction, payload: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(['crew-v2:orchestration-target:1', action, payload]))
    .digest('hex');
}

declare const capturedBrand: unique symbol;
declare const preparedBrand: unique symbol;
declare const verifiedBrand: unique symbol;
export type CapturedAssistantOperation<T> = Readonly<{
  actor: Actor;
  proof: OrchestrationProof;
  action: OrchestrationAction;
  payload: T;
  targetSha256: string;
  [capturedBrand]: true;
}>;
export type AssistantTargetTicket = Pick<
  Ticket,
  'id' | 'projectId' | 'rootId' | 'level' | 'kind' | 'status' | 'revision'
>;
export type PreparedAssistantTarget<T> = Readonly<{
  operation: CapturedAssistantOperation<T>;
  root: AssistantTargetTicket;
  projectId: Id;
  tickets: readonly AssistantTargetTicket[];
  [preparedBrand]: true;
}>;
export type VerifiedAssistantScope<T> = Readonly<{ [verifiedBrand]: T }>;
const captures = new WeakSet<object>();
const preparations = new WeakMap<object, { tx: Tx; owner: object; authorized: boolean }>();
const permissions = new WeakMap<object, { tx: Tx; prepared: PreparedAssistantTarget<unknown> }>();
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const invalidScope = (): ApiError =>
  new ApiError('ORCHESTRATION_SCOPE_INVALID', 403, 'Phạm vi điều phối không khớp');

export function captureAssistantOperation<T>(
  actor: Actor,
  proof: OrchestrationProof,
  action: OrchestrationAction,
  payload: T,
): CapturedAssistantOperation<T> {
  const snapshot = immutableSnapshot({ payload, actor, proof });
  if (snapshot.actor.kind !== 'machine')
    throw new ApiError('ORCHESTRATION_MACHINE_REQUIRED', 403, 'Chỉ máy trợ lý được điều phối');
  if (!uuid.test(snapshot.actor.id))
    throw new ApiError('VALIDATION', 400, 'Định danh điều phối không hợp lệ');
  const operation = Object.freeze({
    ...snapshot,
    action,
    targetSha256: orchestrationTargetHash(action, snapshot.payload),
  }) as CapturedAssistantOperation<T>;
  captures.add(operation);
  return operation;
}

function targetTicket(row: Record<string, unknown>): AssistantTargetTicket {
  return Object.freeze({
    id: row.id as Id,
    projectId: row.project_id as Id,
    rootId: row.root_id as Id,
    level: row.level as Ticket['level'],
    kind: row.kind as Ticket['kind'],
    status: row.status as Ticket['status'],
    revision: Number(row.revision),
  });
}

// Only this factory's captured authority can turn its same-Tx prepared prefix
// into a one-use permission. No caller-supplied boolean or serialized brand is trusted.
export function createAssistantAccess(authority?: ProjectOrchestrationAuthority) {
  const verify = authority?.verify.bind(authority);
  const owner = Object.freeze({});
  return {
    async prepare<T>(
      tx: Tx,
      operation: CapturedAssistantOperation<T>,
      ticketIds: readonly Id[],
    ): Promise<PreparedAssistantTarget<T>> {
      if (!captures.has(operation)) throw invalidScope();
      if (!verify) throw new ApiError('ORCHESTRATION_UNAVAILABLE', 503, 'Chưa có nguồn xác minh điều phối');
      const payload = operation.payload as { ticketId?: unknown; predecessorId?: unknown };
      const submitted =
        operation.action === 'decision' || operation.action === 'signal'
          ? [payload.ticketId]
          : operation.action === 'dependency'
            ? [payload.ticketId, payload.predecessorId]
            : [];
      if (!submitted.length || submitted.some((id) => typeof id !== 'string' || !uuid.test(id)))
        throw new ApiError('VALIDATION', 400, 'Định danh điều phối không hợp lệ');
      const ids = [...new Set((submitted as string[]).map((id) => id.toLowerCase()))].sort();
      if (
        ticketIds.some((id) => typeof id !== 'string' || !uuid.test(id)) ||
        canonicalJson(ids) !== canonicalJson([...new Set(ticketIds.map((id) => id.toLowerCase()))].sort())
      )
        throw invalidScope();
      const initial = [];
      for (const id of ids) {
        const [row] = await tx`select id,root_id,project_id from tickets where id=${id}`;
        if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
        initial.push(row);
      }
      const [first] = initial;
      if (!first) throw invalidScope();
      const rootId = first.root_id as Id;
      const projectId = first.project_id as Id;
      if (initial.some((row) => row.root_id !== rootId || row.project_id !== projectId))
        throw new ApiError('DEPENDENCY_SCOPE', 409, 'Phụ thuộc phải cùng yêu cầu');
      const [root] =
        await tx`select id,root_id,project_id,level,kind,status,revision from tickets where id=${rootId} for update`;
      if (!root || root.project_id !== projectId || root.root_id !== rootId) throw invalidScope();
      const tickets: AssistantTargetTicket[] = [];
      for (const id of ids) {
        const [row] =
          id === rootId
            ? [root]
            : await tx`select id,root_id,project_id,level,kind,status,revision from tickets where id=${id} for update`;
        if (!row || row.root_id !== rootId || row.project_id !== projectId) throw invalidScope();
        tickets.push(targetTicket(row));
      }
      const [project] = await tx`select id from projects where id=${projectId} for update`;
      if (!project) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
      const prepared = Object.freeze({
        operation,
        root: targetTicket(root),
        projectId,
        tickets: Object.freeze(tickets),
      }) as PreparedAssistantTarget<T>;
      preparations.set(prepared, { tx, owner, authorized: false });
      return prepared;
    },
    async authorize<T>(tx: Tx, prepared: PreparedAssistantTarget<T>): Promise<VerifiedAssistantScope<T>> {
      const entry = preparations.get(prepared);
      if (!verify || !entry || entry.tx !== tx || entry.owner !== owner || entry.authorized)
        throw invalidScope();
      entry.authorized = true;
      const op = prepared.operation;
      await verify(tx, op.actor, op.proof, op.action, op.targetSha256);
      const scope = Object.freeze({}) as VerifiedAssistantScope<T>;
      permissions.set(scope, { tx, prepared });
      return scope;
    },
  };
}

export function consumeAssistantScope<T>(
  tx: Tx,
  scope: VerifiedAssistantScope<T>,
  operation: CapturedAssistantOperation<T>,
  prepared: PreparedAssistantTarget<T>,
): void {
  const entry = permissions.get(scope);
  permissions.delete(scope);
  if (
    !entry ||
    entry.tx !== tx ||
    entry.prepared !== prepared ||
    prepared.operation !== operation ||
    !captures.has(operation) ||
    operation.targetSha256 !== orchestrationTargetHash(operation.action, operation.payload) ||
    prepared.root.projectId !== prepared.projectId ||
    prepared.tickets.some(
      (ticket) => ticket.rootId !== prepared.root.id || ticket.projectId !== prepared.projectId,
    )
  )
    throw invalidScope();
}
