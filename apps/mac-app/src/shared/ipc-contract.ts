import type { CheckResult } from '@crew/mac';
import type { AppState, ProjectProgress, SetupStep, UpdateState } from '../main/app-state.js';
import type { JobsStatus } from '../main/jobs/poller.js';
import type { ExistingMachine } from '../main/setup/import-existing.js';
import type { V2Detection } from '../main/setup/v2-removal.js';

/**
 * Hợp đồng IPC giữa renderer và Main. Mọi kênh khai ở đây; mỗi module Main cài handler của kênh mình bằng
 * `registry.handle(channel, fn)` trong `registerX`. Kênh chưa có handler trả
 * `Chưa hỗ trợ: <kênh>`.
 */

/** Một run `claude -p` đang chạy qua sshd agent (do supervisor sshd điền dữ liệu). */
export interface ActiveRun {
  pid: number;
  runId: string;
  worktree: string | null;
  startedAt: number;
  children: number;
}

export interface StepResult {
  ok: boolean;
  message: string;
  next: SetupStep;
}

export interface SshEnvironmentCheckout {
  role: string;
  path: string;
  head: string | null;
}

export interface ProjectRow {
  projectId: string;
  name: string;
  onMac: boolean;
  checkouts: SshEnvironmentCheckout[];
  docsRepo: string | null;
  lastSentCommit: string | null;
  progress: ProjectProgress | null;
}

export interface AddProjectInput {
  /** Đường dẫn tuyệt đối tới repo git có sẵn trên máy (chọn bằng `projects:pickFolder`). */
  folder: string;
  name: string;
  key: string;
  executors: 1 | 2;
}

/** Folder owner vừa chọn trong hộp thoại: tên/khóa gợi ý từ tên folder; `problem` khác null thì không dùng được. */
export interface FolderChoice {
  folder: string;
  name: string;
  key: string;
  problem: string | null;
}

export interface UpdateView {
  current: string;
  available: string | null;
  state: UpdateState;
  previous: string | null;
  enabled: boolean;
  reason: string | null;
  lastCheckedAt: string | null;
}

export type HealthAction = 'open-privacy' | 'open-terminal' | 'open-login-items';

export type LogFile = 'app' | 'sshd' | 'reaper' | 'status';

export interface AppInfo {
  version: string;
  platform: string;
}

/** Tham số và kết quả của từng kênh. */
export interface IpcApi {
  'app:info': { args: []; result: AppInfo };
  'app:reportError': { args: [report: { kind: string; message: string; stack?: string }]; result: undefined };
  'health:run': { args: [probe: boolean]; result: CheckResult[] };
  /** Việc phụ của màn hình Sức khỏe: mở pane quyền của macOS hoặc Terminal. */
  'health:action': { args: [action: HealthAction]; result: undefined };
  'health:last': { args: []; result: { at: string; results: CheckResult[] } | null };
  'runs:list': { args: []; result: ActiveRun[] };
  'runs:cancel': { args: [runId: string]; result: { ok: boolean; message: string } };
  /** Mở trang run trên web Paperclip trong trình duyệt. */
  'runs:openWeb': { args: [runId: string]; result: { ok: boolean; message: string } };
  'logs:tail': { args: [file: LogFile, lines: number, runId?: string]; result: string[] };
  'logs:reveal': { args: [file: LogFile]; result: undefined };
  'setup:state': { args: []; result: AppState['setup'] };
  'setup:step': { args: [step: SetupStep, input: unknown]; result: StepResult };
  /** Máy này đã có cài đặt crew-mac chưa (wizard hiện "Nhận cài đặt có sẵn" hay ô nhập key). Chỉ đọc. */
  'setup:detect': { args: []; result: ExistingMachine };
  /** Bước gỡ app v2: dò app 2P Crew cũ trong Applications (chỉ đọc). */
  'setup:v2Detect': { args: []; result: V2Detection };
  'paperclip:login': { args: [origin: string]; result: { approvalUrl: string } };
  'paperclip:loginStatus': { args: []; result: 'pending' | 'approved' | 'expired' | 'cancelled' };
  'paperclip:companies': { args: []; result: { id: string; name: string }[] };
  /** Trạng thái nhận việc từ board (hàng đợi máy) và origin board đã đăng nhập (cho nút Đăng nhập lại). */
  'jobs:status': { args: []; result: JobsStatus & { origin: string | null } };
  'projects:list': { args: []; result: ProjectRow[] };
  /** Mở hộp thoại chọn thư mục của macOS ở Main rồi kiểm folder; `null` khi owner bấm Hủy. */
  'projects:pickFolder': { args: []; result: FolderChoice | null };
  'projects:add': { args: [input: AddProjectInput]; result: ProjectProgress };
  'projects:remove': { args: [projectId: string]; result: { removed: string[]; manualCommand: string } };
  'update:state': { args: []; result: UpdateView };
  'update:check': { args: []; result: undefined };
  'update:installWhenIdle': { args: []; result: undefined };
  'update:rollback': { args: []; result: undefined };
}

export type IpcChannel = keyof IpcApi;
export type IpcArgs<C extends IpcChannel> = IpcApi[C]['args'];
export type IpcResult<C extends IpcChannel> = IpcApi[C]['result'];

/** Mọi kênh renderer được gọi; preload và Main đều chỉ chấp nhận kênh trong mảng này. */
export const IPC_CHANNELS = [
  'app:info',
  'app:reportError',
  'health:run',
  'health:last',
  'health:action',
  'runs:list',
  'runs:cancel',
  'runs:openWeb',
  'logs:tail',
  'logs:reveal',
  'setup:state',
  'setup:step',
  'setup:detect',
  'setup:v2Detect',
  'paperclip:login',
  'paperclip:loginStatus',
  'paperclip:companies',
  'jobs:status',
  'projects:list',
  'projects:pickFolder',
  'projects:add',
  'projects:remove',
  'update:state',
  'update:check',
  'update:installWhenIdle',
  'update:rollback',
] as const satisfies readonly IpcChannel[];

/** Sự kiện Main → renderer, không payload: renderer gọi lại kênh đọc. */
export const STATE_CHANGED_EVENT = 'state:changed';

export type IpcAnswer<T> = { ok: true; result: T } | { ok: false; error: string };

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNELS as readonly string[]).includes(value);
}
