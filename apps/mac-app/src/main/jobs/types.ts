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
  | 'runtimes-setup'
  | 'ensure-project'
  | 'bug-finding-review';
export type MachineJobStatus = 'queued' | 'claimed' | 'done' | 'failed' | 'cancelled';
/** Ô executor Claude: `executor`, `executor-2` … `executor-5` (tối đa 5, cùng `MAX_EXECUTORS` của plugin). */
export const EXECUTOR_SLOTS = ['executor', 'executor-2', 'executor-3', 'executor-4', 'executor-5'] as const;
export type ExecutorSlot = (typeof EXECUTOR_SLOTS)[number];
/** `executor-codex`, `executor-opencode`, `reviewer-codex`: agent chạy runtime ngoài Claude, mỗi ô một agent. */
export type CrewRoleSlot =
  | 'assistant'
  | ExecutorSlot
  | 'reviewer'
  | 'integrator'
  | 'executor-codex'
  | 'executor-opencode'
  | 'reviewer-codex';

/** Thư mục checkout của agent UIUX (vai `designer`): không phải ô vai trò, chỉ việc `agent-workspace` nhận. */
export const DESIGNER_CHECKOUT = 'designer';
export type WorkspaceRole = CrewRoleSlot | typeof DESIGNER_CHECKOUT;

export const MACHINE_JOB_KINDS: readonly MachineJobKind[] = [
  'inspect-folder',
  'prepare-checkouts',
  'agent-workspace',
  'skill-sync',
  'check',
  'remove-checkouts',
  'skill-remove',
  'runtimes-setup',
  'ensure-project',
  'bug-finding-review',
];
export const CREW_ROLE_SLOTS: readonly CrewRoleSlot[] = [
  'assistant',
  ...EXECUTOR_SLOTS,
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
  | { kind: 'agent-workspace'; projectKey: string; folder: string; role: WorkspaceRole; branch: string }
  | { kind: 'skill-sync'; skillId: string; slug: string; version: string }
  | { kind: 'check'; projectKey: string }
  | {
      kind: 'remove-checkouts';
      projectId: string;
      projectKey: string;
      roles: string[];
      removeStatusRepo: boolean;
    }
  | { kind: 'skill-remove'; skillId: string; slug: string }
  /** Cài/cập nhật wrapper runtime rồi báo trạng thái. Key OpenCode không bao giờ đi qua hàng đợi. */
  | { kind: 'runtimes-setup' }
  /**
   * Dựng project trên máy (server Crew xếp khi chọn máy cho cây yêu cầu): tìm repo cùng origin hoặc clone về
   * `~/crew-agents/<projectKey>/repo`, cài crew-docs, worktree `~/crew-agents/<projectKey>/<role>`, repo đi kèm cạnh đó.
   */
  | {
      kind: 'ensure-project';
      projectKey: string;
      projectId: string;
      originUrl: string;
      branch: string;
      roles: { role: string; branch: string }[];
      companions: { name: string; originUrl: string }[];
    }
  /**
   * Xếp một lượt review PR vào hàng đợi app Bug Finding trên Mac (plugin xếp khi ticket tổng vào stage cầu nối). App ghi
   * yêu cầu vào thư mục cầu nối rồi trả `accepted` ngay; tiến độ và kết quả đi qua `POST /bug-finding/results`.
   */
  | ({ kind: 'bug-finding-review' } & BugFindingReviewPayload);

export interface BugFindingReviewPayload {
  requestId: string;
  issueId: string;
  identifier: string;
  run: number;
  projectId: string;
  projectKey: string;
  repoPath: string;
  provider: 'github' | 'gitlab';
  prNumber: number;
  prUrl: string;
  headSha: string;
  baseBranch: string;
  reviewerInputText?: string;
}
/** Phản hồi người review gửi kèm lượt chạy lại (khối `crew-bf-feedback` của Trợ Lý), tối đa chừng này ký tự. */
export const BUG_FINDING_INPUT_MAX = 20_000;

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
  | { kind: 'agent-workspace'; role: WorkspaceRole; path: string; head: string }
  | { kind: 'skill-sync'; sha256: string; files: number }
  | { kind: 'check'; items: CheckItem[] }
  | {
      kind: 'remove-checkouts';
      removed: { role: string; path: string }[];
      kept: KeptCheckout[];
      absent: string[];
    }
  | { kind: 'skill-remove'; removed: boolean }
  | {
      kind: 'runtimes-setup';
      wrappers: { codex: boolean; opencode: boolean };
      codex: { version: string | null; loggedIn: boolean | null };
      opencode: { version: string | null; keyPresent: boolean | null };
    }
  | {
      kind: 'ensure-project';
      repoPath: string;
      cloned: boolean;
      checkouts: { role: string; path: string; head: string }[];
      companions: { name: string; path: string }[];
    }
  | { kind: 'bug-finding-review'; accepted: true };

/**
 * Checkout gỡ không được nên giữ nguyên: còn việc chưa commit (`dirty`), có process đang dùng (`busy`), không phải
 * worktree phụ nằm đúng chỗ (`not_worktree`), hoặc git từ chối (`git_failed`). Không bao giờ xóa cưỡng bức.
 */
export interface KeptCheckout {
  role: string;
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
  | 'clone_auth_failed'
  | 'skill_fetch_failed'
  | 'check_failed'
  | 'lease_expired'
  | 'app_error'
  /** `bug-finding-review`: máy không có repo của project, không thấy app Bug Finding nhúng, bản cài riêng cũ đang chạy. */
  | 'project_missing'
  | 'bug_finding_missing'
  | 'standalone_running';

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
/** Việc vượt thời gian này thì app hủy và báo lỗi (dưới lease 17 phút của plugin). Áp cho mọi loại việc. */
export const JOB_TIMEOUT_MS = 15 * 60_000;
