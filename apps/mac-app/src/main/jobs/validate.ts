import { join } from 'node:path';
import { forbiddenRootReason } from '@crew/mac';
import { folderGuardReason } from '../projects/folder.js';
import { KEY_RE } from '../projects/progress.js';
import {
  CREW_ROLE_SLOTS,
  type CrewRoleSlot,
  type JobPayload,
  MACHINE_JOB_KINDS,
  type MachineJobKind,
  UUID_RE,
} from './types.js';

// Luật kiểm chép từ plugin crew.core (`packages/crew-plugin/src/jobs/validate.ts` của fork): app kiểm lại đúng như
// server trước khi đụng tới máy, cùng câu lỗi.
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^[A-Za-z0-9._+-]{1,64}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ký tự điều khiển chính là thứ bị từ chối
const CONTROL = /[\x00-\x1f\x7f]/;
const REQUIRED_ROLES: readonly CrewRoleSlot[] = ['assistant', 'executor', 'reviewer', 'integrator'];

const KEYS: Record<MachineJobKind, readonly string[]> = {
  'inspect-folder': ['folder'],
  'prepare-checkouts': ['projectKey', 'folder', 'roles'],
  'agent-workspace': ['projectKey', 'folder', 'role', 'branch'],
  'skill-sync': ['skillId', 'slug', 'version'],
  check: ['projectKey'],
  'remove-checkouts': ['projectId', 'projectKey', 'roles', 'removeStatusRepo'],
  'skill-remove': ['skillId', 'slug'],
  'runtimes-setup': [],
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function unknownKeyError(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  const key = Object.keys(value).find((name) => !allowed.includes(name));
  return key === undefined ? null : `trường ${key} không được hỗ trợ`;
}

function folderError(folder: unknown): string | null {
  if (typeof folder !== 'string' || !folder.startsWith('/')) return 'folder phải là đường tuyệt đối';
  if (folder.length > 4096) return 'folder quá dài';
  if (folder.includes('..')) return 'folder không được chứa ..';
  if (CONTROL.test(folder)) return 'folder có ký tự điều khiển';
  return null;
}

const projectKeyError = (key: unknown) =>
  typeof key === 'string' && KEY_RE.test(key) ? null : 'projectKey không hợp lệ';
const roleError = (role: unknown) =>
  CREW_ROLE_SLOTS.includes(role as CrewRoleSlot) ? null : 'role không hợp lệ';
const branchError = (branch: unknown) =>
  typeof branch === 'string' && BRANCH.test(branch) && !branch.startsWith('-') ? null : 'branch không hợp lệ';

function rolesError(roles: unknown): string | null {
  if (!Array.isArray(roles)) return 'roles phải là mảng';
  for (const item of roles) {
    if (!isObject(item)) return 'mỗi phần tử roles phải là object';
    const error =
      unknownKeyError(item, ['role', 'branch']) ?? roleError(item.role) ?? branchError(item.branch);
    if (error) return error;
  }
  if (roles.length < 4 || roles.length > 5) return 'roles phải có 4 hoặc 5 vai trò';
  const seen = new Set<string>();
  for (const { role } of roles as { role: CrewRoleSlot }[]) {
    if (seen.has(role)) return `role ${role} bị trùng`;
    seen.add(role);
  }
  const missing = REQUIRED_ROLES.find((role) => !seen.has(role));
  return missing ? `roles thiếu ${missing}` : null;
}

/** Vai trò cần gỡ checkout: 1–8 tên vai trò, không trùng. */
function removeRolesError(roles: unknown): string | null {
  if (!Array.isArray(roles)) return 'roles phải là mảng';
  for (const role of roles) {
    const error = roleError(role);
    if (error) return error;
  }
  if (roles.length < 1 || roles.length > CREW_ROLE_SLOTS.length)
    return `roles phải có 1 đến ${CREW_ROLE_SLOTS.length} vai trò`;
  const seen = new Set<string>();
  for (const role of roles as CrewRoleSlot[]) {
    if (seen.has(role)) return `role ${role} bị trùng`;
    seen.add(role);
  }
  return null;
}

const skillIdError = (id: unknown) =>
  typeof id === 'string' && UUID_RE.test(id) ? null : 'skillId phải là uuid';
const slugError = (slug: unknown) =>
  typeof slug === 'string' && SLUG.test(slug) ? null : 'slug không hợp lệ';

/** Payload đúng loại việc thì trả bản đã gắn `kind`; sai thì trả câu lỗi cố định (giống plugin). */
export function validateJobPayload(kind: MachineJobKind, payload: unknown): JobPayload | string {
  if (!MACHINE_JOB_KINDS.includes(kind)) return 'kind không hợp lệ';
  if (!isObject(payload)) return 'payload phải là object';
  const unknown = unknownKeyError(payload, [...KEYS[kind], 'kind']);
  if (unknown) return unknown;
  if ('kind' in payload && payload.kind !== kind) return 'kind trong payload không khớp';
  const p = payload;
  switch (kind) {
    case 'inspect-folder':
      return folderError(p.folder) ?? { kind, folder: p.folder as string };
    case 'prepare-checkouts':
      return (
        projectKeyError(p.projectKey) ??
        folderError(p.folder) ??
        rolesError(p.roles) ?? {
          kind,
          projectKey: p.projectKey as string,
          folder: p.folder as string,
          roles: (p.roles as { role: CrewRoleSlot; branch: string }[]).map(({ role, branch }) => ({
            role,
            branch,
          })),
        }
      );
    case 'agent-workspace':
      return (
        projectKeyError(p.projectKey) ??
        folderError(p.folder) ??
        roleError(p.role) ??
        branchError(p.branch) ?? {
          kind,
          projectKey: p.projectKey as string,
          folder: p.folder as string,
          role: p.role as CrewRoleSlot,
          branch: p.branch as string,
        }
      );
    case 'skill-sync': {
      const error = skillIdError(p.skillId) ?? slugError(p.slug);
      if (error) return error;
      if (typeof p.version !== 'string' || !VERSION.test(p.version)) return 'version không hợp lệ';
      return {
        kind,
        skillId: (p.skillId as string).toLowerCase(),
        slug: p.slug as string,
        version: p.version,
      };
    }
    case 'check':
      return projectKeyError(p.projectKey) ?? { kind, projectKey: p.projectKey as string };
    case 'remove-checkouts':
      if (typeof p.projectId !== 'string' || !UUID_RE.test(p.projectId)) return 'projectId phải là uuid';
      if (typeof p.removeStatusRepo !== 'boolean') return 'removeStatusRepo phải là boolean';
      return (
        projectKeyError(p.projectKey) ??
        removeRolesError(p.roles) ?? {
          kind,
          projectId: p.projectId.toLowerCase(),
          projectKey: p.projectKey as string,
          roles: [...(p.roles as CrewRoleSlot[])],
          removeStatusRepo: p.removeStatusRepo,
        }
      );
    case 'runtimes-setup':
      return { kind };
    case 'skill-remove':
      return (
        skillIdError(p.skillId) ??
        slugError(p.slug) ?? { kind, skillId: (p.skillId as string).toLowerCase(), slug: p.slug as string }
      );
  }
}

/** Thư mục checkout của một vai trò: `~/crew-agents/<khóa>/<vai trò>`. */
export const checkoutPath = (home: string, projectKey: string, role: string) =>
  join(home, 'crew-agents', projectKey, role);

/**
 * Lý do máy này không làm việc ở đường dẫn của payload, hoặc null. Folder repo của owner chỉ đọc nên theo luật của
 * thêm project (chặn gốc ổ đĩa, HOME, cha của HOME; KHÔNG chặn `/Volumes`, `~/Documents` vì app có Full Disk Access);
 * checkout agent sẽ ghi và là nơi agent chạy nên theo `forbiddenRootReason` của crew-mac.
 */
export function machineGuardReason(home: string, payload: JobPayload): string | null {
  if (
    payload.kind === 'skill-sync' ||
    payload.kind === 'check' ||
    payload.kind === 'skill-remove' ||
    payload.kind === 'runtimes-setup'
  )
    return null;
  if (payload.kind === 'remove-checkouts')
    return checkoutsGuardReason(home, payload.projectKey, payload.roles);
  const folderReason = folderGuardReason(home, payload.folder);
  if (folderReason) return folderReason;
  if (payload.kind === 'inspect-folder') return null;
  const roles = payload.kind === 'prepare-checkouts' ? payload.roles.map((r) => r.role) : [payload.role];
  return checkoutsGuardReason(home, payload.projectKey, roles);
}

function checkoutsGuardReason(
  home: string,
  projectKey: string,
  roles: readonly CrewRoleSlot[],
): string | null {
  for (const role of roles) {
    const dir = checkoutPath(home, projectKey, role);
    const reason = forbiddenRootReason(home, dir);
    if (reason) return `${dir}: ${reason}`;
  }
  return null;
}
