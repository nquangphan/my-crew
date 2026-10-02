import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { appendEvent } from '../journal/events.ts';
import type { Actor, Db, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';

export type CreateProject = { key: string; name: string; repositoryUrl: string | null };
export type Binding = { machineId: Id; checkoutPath: string; expectedRevision: number };
export type BindingGuard = (tx: Tx, projectId: Id) => Promise<void>;
export const denyRebinding: BindingGuard = async () => {
  throw new ApiError('ACTIVE_EXECUTION', 409, 'Đối chiếu tác vụ đang chạy trước khi đổi máy');
};
export type Project = {
  id: Id;
  key: string;
  name: string;
  repositoryUrl: string | null;
  machineId: Id | null;
  checkoutPath: string | null;
  bindingRevision: number;
  docsState: 'missing' | 'unverified' | 'invalid' | 'current' | 'stale';
};

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as Id,
    key: row.key as string,
    name: row.name as string,
    repositoryUrl: row.repository_url as string | null,
    machineId: row.machine_id as Id | null,
    checkoutPath: row.checkout_path as string | null,
    bindingRevision: Number(row.binding_revision),
    docsState: 'missing',
  };
}

function validRepo(value: string | null): boolean {
  if (value === null) return true;
  try {
    const url = new URL(value);
    return ['https:', 'ssh:'].includes(url.protocol) && !url.username && !url.password && !!url.hostname;
  } catch {
    return false;
  }
}

export async function createProject(tx: Tx, input: CreateProject): Promise<Project> {
  if (
    !/^[A-Z][A-Z0-9_-]{1,31}$/.test(input.key) ||
    input.name.length < 1 ||
    input.name.length > 200 ||
    !validRepo(input.repositoryUrl)
  ) {
    throw new ApiError('VALIDATION', 400, 'Thông tin dự án không hợp lệ');
  }
  const id = randomUUID();
  let row: Record<string, unknown> | undefined;
  try {
    [row] =
      await tx`insert into projects (id, key, name, repository_url) values (${id}, ${input.key}, ${input.name}, ${input.repositoryUrl}) returning *`;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505' &&
      'constraint_name' in error &&
      error.constraint_name === 'projects_key_key'
    ) {
      throw new ApiError('PROJECT_KEY_CONFLICT', 409, 'Mã dự án đã tồn tại');
    }
    throw error;
  }
  if (!row) throw new Error('PROJECT_INSERT_FAILED');
  await appendEvent(tx, {
    type: 'project.created',
    projectId: id,
    ticketId: null,
    audienceMachineId: null,
    data: { revision: 1 },
  });
  return mapProject(row);
}

export async function bindProject(
  tx: Tx,
  projectId: Id,
  input: Binding,
  bindingGuard: BindingGuard = denyRebinding,
): Promise<Project> {
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    !isAbsolute(input.checkoutPath) ||
    input.checkoutPath.length > 4096 ||
    input.checkoutPath.length < 1 ||
    input.checkoutPath.includes('\0')
  ) {
    throw new ApiError('VALIDATION', 400, 'Thông tin gắn máy không hợp lệ');
  }
  const [row] = await tx`select * from projects where id=${projectId} for update`;
  if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
  if (Number(row.binding_revision) !== input.expectedRevision)
    throw new ApiError('REVISION_CONFLICT', 409, 'Dự án đã thay đổi');
  const [machine] = await tx`select id from machines where id=${input.machineId} and revoked_at is null`;
  if (!machine) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy máy');
  if (row.machine_id) await bindingGuard(tx, projectId);
  const [bound] =
    await tx`update projects set machine_id=${input.machineId}, checkout_path=${input.checkoutPath}, expected_commit=null, binding_revision=binding_revision+1 where id=${projectId} returning *`;
  if (!bound) throw new Error('PROJECT_BIND_FAILED');
  await appendEvent(tx, {
    type: 'project.bound',
    projectId,
    ticketId: null,
    audienceMachineId: null,
    data: { machineId: input.machineId, bindingRevision: Number(bound.binding_revision) },
  });
  return mapProject(bound);
}

export async function getProject(db: Db, id: Id): Promise<Project> {
  const [row] = await db`select * from projects where id=${id}`;
  if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
  return mapProject(row);
}

export async function listProjects(
  db: Db,
  limit: number,
  cursor: Id | null,
): Promise<{ items: Project[]; nextCursor: Id | null }> {
  const rows = cursor
    ? await db`select * from projects where id > ${cursor} order by id limit ${limit + 1}`
    : await db`select * from projects order by id limit ${limit + 1}`;
  const items = rows.slice(0, limit).map(mapProject);
  return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}

export async function projectEventScope(
  db: Db,
  actor: Actor,
): Promise<{ projectIds: Id[]; allowGlobal: boolean }> {
  if (actor.kind === 'owner') return { projectIds: [], allowGlobal: true };
  const rows = await db`select id from projects where machine_id=${actor.id} order by id`;
  return { projectIds: rows.map((row) => row.id as Id), allowGlobal: false };
}
