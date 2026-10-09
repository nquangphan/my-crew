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
    case 'skill-sync':
      if (typeof p.skillId !== 'string' || !UUID_RE.test(p.skillId)) return 'skillId phải là uuid';
      if (typeof p.slug !== 'string' || !SLUG.test(p.slug)) return 'slug không hợp lệ';
      if (typeof p.version !== 'string' || !VERSION.test(p.version)) return 'version không hợp lệ';
      return { kind, skillId: p.skillId.toLowerCase(), slug: p.slug, version: p.version };
    case 'check':
      return projectKeyError(p.projectKey) ?? { kind, projectKey: p.projectKey as string };
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
  if (payload.kind === 'skill-sync' || payload.kind === 'check') return null;
  const folderReason = folderGuardReason(home, payload.folder);
  if (folderReason) return folderReason;
  if (payload.kind === 'inspect-folder') return null;
  const roles = payload.kind === 'prepare-checkouts' ? payload.roles.map((r) => r.role) : [payload.role];
  for (const role of roles) {
    const dir = checkoutPath(home, payload.projectKey, role);
    const reason = forbiddenRootReason(home, dir);
    if (reason) return `${dir}: ${reason}`;
  }
  return null;
}
