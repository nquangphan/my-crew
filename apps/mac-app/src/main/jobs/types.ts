/**
 * Việc board xếp hàng cho một máy (hàng đợi `machine-jobs` của plugin `crew.core`): app nhận bằng board key, làm trên
 * máy rồi báo kết quả. Bản chép kiểu của plugin (`packages/crew-plugin/src/jobs/types.ts` trong fork Paperclip).
 */
export type MachineJobKind =
  | 'inspect-folder'
  | 'prepare-checkouts'
  | 'agent-workspace'
  | 'skill-sync'
  | 'check'
  | 'remove-checkouts'
  | 'skill-remove'
  | 'runtimes-setup';
export type MachineJobStatus = 'queued' | 'claimed' | 'done' | 'failed' | 'cancelled';
/** `executor-codex`, `executor-opencode`, `reviewer-codex`: agent chạy runtime ngoài Claude, mỗi ô một agent. */
export type CrewRoleSlot =
  | 'assistant'
  | 'executor'
  | 'executor-2'
  | 'reviewer'
  | 'integrator'
  | 'executor-codex'
  | 'executor-opencode'
  | 'reviewer-codex';

export const MACHINE_JOB_KINDS: readonly MachineJobKind[] = [
  'inspect-folder',
  'prepare-checkouts',
  'agent-workspace',
  'skill-sync',
  'check',
  'remove-checkouts',
  'skill-remove',
  'runtimes-setup',
];
export const CREW_ROLE_SLOTS: readonly CrewRoleSlot[] = [
  'assistant',
  'executor',
  'executor-2',
  'reviewer',
  'integrator',
  'executor-codex',
  'executor-opencode',
  'reviewer-codex',
];

export interface MachineJob {
  id: string;
  companyId: string;
  machineId: string;
  kind: MachineJobKind;
  payload: JobPayload;
  status: MachineJobStatus;
  result: JobResult | null;
  errorCode: JobErrorCode | null;
  errorText: string | null;
  attempts: number;
  setupRunId: string | null;
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
}

export type JobPayload =
  | { kind: 'inspect-folder'; folder: string }
  | {
      kind: 'prepare-checkouts';
      projectKey: string;
      folder: string;
      roles: { role: CrewRoleSlot; branch: string }[];
    }
  | { kind: 'agent-workspace'; projectKey: string; folder: string; role: CrewRoleSlot; branch: string }
  | { kind: 'skill-sync'; skillId: string; slug: string; version: string }
  | { kind: 'check'; projectKey: string }
  | {
      kind: 'remove-checkouts';
      projectId: string;
      projectKey: string;
      roles: CrewRoleSlot[];
      removeStatusRepo: boolean;
    }
  | { kind: 'skill-remove'; skillId: string; slug: string }
  /** Cài/cập nhật wrapper runtime rồi báo trạng thái. Key OpenCode không bao giờ đi qua hàng đợi. */
  | { kind: 'runtimes-setup' };

export type JobResult =
  | {
      kind: 'inspect-folder';
      root: string;
      branch: string | null;
      remote: string | null;
      docsBundle: string | null;
      clean: boolean;
    }
  | { kind: 'prepare-checkouts'; checkouts: { role: CrewRoleSlot; path: string; head: string }[] }
  | { kind: 'agent-workspace'; role: CrewRoleSlot; path: string; head: string }
  | { kind: 'skill-sync'; sha256: string; files: number }
  | { kind: 'check'; items: CheckItem[] }
  | {
      kind: 'remove-checkouts';
      removed: { role: CrewRoleSlot; path: string }[];
      kept: KeptCheckout[];
      absent: CrewRoleSlot[];
    }
  | { kind: 'skill-remove'; removed: boolean }
  | {
      kind: 'runtimes-setup';
      wrappers: { codex: boolean; opencode: boolean };
      codex: { version: string | null; loggedIn: boolean | null };
      opencode: { version: string | null; keyPresent: boolean | null };
    };

/**
 * Checkout gỡ không được nên giữ nguyên: còn việc chưa commit (`dirty`), có process đang dùng (`busy`), không phải
 * worktree phụ nằm đúng chỗ (`not_worktree`), hoặc git từ chối (`git_failed`). Không bao giờ xóa cưỡng bức.
 */
export interface KeptCheckout {
  role: CrewRoleSlot;
  path: string;
  reason: 'dirty' | 'busy' | 'not_worktree' | 'git_failed';
  detail?: string;
}

export interface CheckItem {
  id: string;
  status: 'ok' | 'warn' | 'error';
  title: string;
}

export type JobErrorCode =
  | 'folder_not_git'
  | 'folder_forbidden'
  | 'folder_missing'
  | 'checkout_exists'
  | 'git_failed'
  | 'skill_fetch_failed'
  | 'check_failed'
  | 'lease_expired'
  | 'app_error';

/** Kết quả app gửi lên `POST /machine-jobs/:id/result`. `check` thất bại vẫn kèm `result` (danh sách mục kiểm). */
export type JobOutcome =
  | { status: 'done'; result: JobResult }
  | { status: 'failed'; errorCode: JobErrorCode; errorText: string; result?: JobResult };

/** Một file skill lấy từ Paperclip (Main có board key) để utility ghi xuống máy. */
export interface SkillFile {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
  executable: boolean;
}

/** Dữ liệu Main lấy trước bằng board key rồi chuyển cho utility cùng việc. */
export interface JobExtras {
  /** Project Paperclip của việc `prepare-checkouts` (từ setup run), để thêm repo vào bản tin docs. */
  projectId: string | null;
  skillFiles?: SkillFile[];
}

/** Lỗi có mã cố định của hàng đợi; message là câu tiếng Việt cho owner (sẽ được làm sạch trước khi gửi). */
export class JobError extends Error {
  constructor(
    readonly code: JobErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'JobError';
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Việc vượt thời gian này thì app hủy và báo lỗi (dưới lease 10 phút của plugin). */
export const JOB_TIMEOUT_MS = 8 * 60_000;
