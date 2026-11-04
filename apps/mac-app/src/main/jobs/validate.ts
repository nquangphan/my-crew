import { join } from 'node:path';
import { forbiddenRootReason } from '@crew/mac';
import { folderGuardReason } from '../projects/folder.js';
import { KEY_RE } from '../projects/progress.js';
import {
  BUG_FINDING_INPUT_MAX,
  CREW_ROLE_SLOTS,
  type CrewRoleSlot,
  EXECUTOR_SLOTS,
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
/** Origin repo cho `ensure-project`: https/ssh/file URL hoặc dạng `user@host:path`. */
const ORIGIN = /^(?:(?:https|ssh|file):\/\/\S+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+)$/;
/** Tên thư mục checkout trên máy; `repo` để dành cho bản clone. */
const CHECKOUT_NAME = /^[a-z][a-z0-9-]{0,30}$/;
const COMPANION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_COMPANIONS = 5;
/** Thư mục checkout tối đa của một project trên máy: mọi ô vai trò cộng agent UIUX (`designer`), như plugin. */
const MAX_CHECKOUTS = CREW_ROLE_SLOTS.length + 1;

const KEYS: Record<MachineJobKind, readonly string[]> = {
  'inspect-folder': ['folder'],
  'prepare-checkouts': ['projectKey', 'folder', 'roles'],
  'agent-workspace': ['projectKey', 'folder', 'role', 'branch'],
  'skill-sync': ['skillId', 'slug', 'version'],
  check: ['projectKey'],
  'remove-checkouts': ['projectId', 'projectKey', 'roles', 'removeStatusRepo'],
  'skill-remove': ['skillId', 'slug'],
  'runtimes-setup': [],
  'ensure-project': ['projectKey', 'projectId', 'originUrl', 'branch', 'roles', 'companions'],
  'bug-finding-review': [
    'requestId',
    'issueId',
    'identifier',
    'run',
    'projectId',
    'projectKey',
    'repoPath',
    'provider',
    'prNumber',
    'prUrl',
    'headSha',
    'baseBranch',
    'reviewerInputText',
  ],
};
const IDENTIFIER = /^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}$/;
const HEAD_SHA = /^[0-9a-f]{40}$/;
/** URL pull request GitHub, như `GITHUB_PR_URL` của plugin. */
const GITHUB_PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/([1-9][0-9]*)$/;

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
  const max = REQUIRED_ROLES.length + EXECUTOR_SLOTS.length - 1;
  if (roles.length < REQUIRED_ROLES.length || roles.length > max)
    return `roles phải có ${REQUIRED_ROLES.length} đến ${max} vai trò`;
  const seen = new Set<string>();
  for (const { role } of roles as { role: CrewRoleSlot }[]) {
    if (seen.has(role)) return `role ${role} bị trùng`;
    seen.add(role);
  }
  const missing = REQUIRED_ROLES.find((role) => !seen.has(role));
  return missing ? `roles thiếu ${missing}` : null;
}

/** Tên thư mục checkout hợp lệ: khớp CHECKOUT_NAME, khác `repo`. */
const checkoutNameOk = (value: unknown): value is string =>
  typeof value === 'string' && CHECKOUT_NAME.test(value) && value !== 'repo';

/** Thư mục checkout cần gỡ: tới `MAX_CHECKOUTS`, không trùng (tên ô, `designer` hay tên thư mục của app như `executor-1`), khác `repo`. */
function removeRolesError(roles: unknown): string | null {
  if (!Array.isArray(roles)) return 'roles phải là mảng';
  for (const role of roles) {
    if (!checkoutNameOk(role)) return 'role không hợp lệ';
  }
  if (roles.length < 1 || roles.length > MAX_CHECKOUTS) return `roles phải có 1 đến ${MAX_CHECKOUTS} vai trò`;
  const seen = new Set<string>();
  for (const role of roles as string[]) {
    if (seen.has(role)) return `role ${role} bị trùng`;
    seen.add(role);
  }
  return null;
}

const originError = (value: unknown) =>
  typeof value === 'string' && value.length <= 500 && !CONTROL.test(value) && ORIGIN.test(value)
    ? null
    : 'originUrl không hợp lệ';

function ensureRolesError(roles: unknown): string | null {
  if (!Array.isArray(roles)) return 'roles phải là mảng';
  for (const item of roles) {
    if (!isObject(item)) return 'mỗi phần tử roles phải là object';
    const error =
      unknownKeyError(item, ['role', 'branch']) ??
      (checkoutNameOk(item.role) ? null : 'role không hợp lệ') ??
      branchError(item.branch);
    if (error) return error;
  }
  if (roles.length < 1 || roles.length > MAX_CHECKOUTS) return `roles phải có 1 đến ${MAX_CHECKOUTS} vai trò`;
  const seen = new Set<string>();
  for (const { role } of roles as { role: string }[]) {
    if (seen.has(role)) return `role ${role} bị trùng`;
    seen.add(role);
  }
  return null;
}

function companionsError(list: unknown, roles: readonly { role: string }[]): string | null {
  if (!Array.isArray(list)) return 'companions phải là mảng';
  if (list.length > MAX_COMPANIONS) return `companions có tối đa ${MAX_COMPANIONS} repo`;
  const taken = new Set(roles.map((item) => item.role));
  for (const item of list) {
    if (!isObject(item)) return 'mỗi phần tử companions phải là object';
    const error =
      unknownKeyError(item, ['name', 'originUrl']) ??
      (typeof item.name === 'string' && COMPANION_NAME.test(item.name) && item.name !== 'repo'
        ? null
        : 'tên repo đi kèm không hợp lệ') ??
      originError(item.originUrl);
    if (error) return error;
    const name = item.name as string;
    if (taken.has(name)) return `tên repo đi kèm ${name} bị trùng`;
    taken.add(name);
  }
  return null;
}

const uuidError = (value: unknown, name: string) =>
  typeof value === 'string' && UUID_RE.test(value) ? null : `${name} phải là uuid`;

function reviewerInputError(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') return 'reviewerInputText phải là chuỗi';
  return value.length > BUG_FINDING_INPUT_MAX ? `reviewerInputText quá ${BUG_FINDING_INPUT_MAX} ký tự` : null;
}

/** Payload `bug-finding-review`, cùng thứ tự kiểm và câu lỗi với plugin. */
function bugFindingReviewPayload(p: Record<string, unknown>): JobPayload | string {
  const pr = typeof p.prUrl === 'string' ? GITHUB_PR_URL.exec(p.prUrl) : null;
  const run = p.run as number;
  const error =
    uuidError(p.requestId, 'requestId') ??
    uuidError(p.issueId, 'issueId') ??
    (typeof p.identifier === 'string' && IDENTIFIER.test(p.identifier) ? null : 'identifier không hợp lệ') ??
    (Number.isInteger(run) && run >= 1 && run <= 3 ? null : 'run phải là số nguyên 1 đến 3') ??
    uuidError(p.projectId, 'projectId') ??
    projectKeyError(p.projectKey) ??
    (folderError(p.repoPath)?.replace('folder', 'repoPath') || null) ??
    (p.provider === 'github' ? null : 'provider chỉ nhận github') ??
    (Number.isInteger(p.prNumber) && (p.prNumber as number) > 0
      ? null
      : 'prNumber phải là số nguyên dương') ??
    (pr ? null : 'prUrl không hợp lệ') ??
    (Number(pr?.[1]) === p.prNumber ? null : 'prUrl không khớp prNumber') ??
    (typeof p.headSha === 'string' && HEAD_SHA.test(p.headSha) ? null : 'headSha phải là 40 ký tự hex') ??
    (branchError(p.baseBranch) ? 'baseBranch không hợp lệ' : null) ??
    reviewerInputError(p.reviewerInputText);
  if (error) return error;
  return {
    kind: 'bug-finding-review',
    requestId: (p.requestId as string).toLowerCase(),
    issueId: (p.issueId as string).toLowerCase(),
    identifier: p.identifier as string,
    run,
    projectId: (p.projectId as string).toLowerCase(),
    projectKey: p.projectKey as string,
    repoPath: p.repoPath as string,
    provider: 'github',
    prNumber: p.prNumber as number,
    prUrl: p.prUrl as string,
    headSha: p.headSha as string,
    baseBranch: p.baseBranch as string,
    ...(typeof p.reviewerInputText === 'string' ? { reviewerInputText: p.reviewerInputText } : {}),
  };
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
          roles: [...(p.roles as string[])],
          removeStatusRepo: p.removeStatusRepo,
        }
      );
    case 'runtimes-setup':
      return { kind };
    case 'ensure-project': {
      const error =
        projectKeyError(p.projectKey) ??
        (typeof p.projectId === 'string' && UUID_RE.test(p.projectId) ? null : 'projectId phải là uuid') ??
        originError(p.originUrl) ??
        branchError(p.branch) ??
        ensureRolesError(p.roles) ??
        companionsError(p.companions, p.roles as { role: string }[]);
      if (error) return error;
      return {
        kind,
        projectKey: p.projectKey as string,
        projectId: (p.projectId as string).toLowerCase(),
        originUrl: p.originUrl as string,
        branch: p.branch as string,
        roles: (p.roles as { role: string; branch: string }[]).map(({ role, branch }) => ({ role, branch })),
        companions: (p.companions as { name: string; originUrl: string }[]).map(({ name, originUrl }) => ({
          name,
          originUrl,
        })),
      };
    }
    case 'bug-finding-review':
      return bugFindingReviewPayload(p);
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
  // Repo của owner chỉ đọc (Bug Finding tạo worktree review riêng cạnh nó): theo luật của thêm project.
  if (payload.kind === 'bug-finding-review') return folderGuardReason(home, payload.repoPath);
  if (payload.kind === 'ensure-project')
    return checkoutsGuardReason(home, payload.projectKey, [
      ...payload.roles.map((item) => item.role),
      'repo',
      ...payload.companions.map((item) => item.name),
    ]);
  const folderReason = folderGuardReason(home, payload.folder);
  if (folderReason) return folderReason;
  if (payload.kind === 'inspect-folder') return null;
  const roles = payload.kind === 'prepare-checkouts' ? payload.roles.map((r) => r.role) : [payload.role];
  return checkoutsGuardReason(home, payload.projectKey, roles);
}

function checkoutsGuardReason(home: string, projectKey: string, roles: readonly string[]): string | null {
  for (const role of roles) {
    const dir = checkoutPath(home, projectKey, role);
    const reason = forbiddenRootReason(home, dir);
    if (reason) return `${dir}: ${reason}`;
  }
  return null;
}
