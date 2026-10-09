import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type UpdateState =
  | 'idle'
  | 'downloading'
  | 'waiting-idle'
  | 'installing'
  | 'probation'
  | 'rolled-back';
export type SetupStep =
  | 'check'
  | 'v2'
  | 'move'
  | 'paperclip'
  | 'machine'
  | 'disk-access'
  | 'sshd'
  | 'doctor'
  | 'done';

export interface ProjectProgress {
  key: string;
  /** Thư mục repo git owner chọn (gốc worktree chính). Tiến độ của bản cũ (thêm bằng URL git) không có trường này. */
  folder?: string;
  /** Chỉ có ở tiến độ bản cũ: URL git đã clone vào `~/crew-projects/<key>`; app báo cần gỡ rồi thêm lại. */
  origin?: string;
  projectId: string | null;
  /** `ls-remote`, `mirror` chỉ có ở tiến độ bản cũ. */
  done: Array<
    'folder' | 'project' | 'status-repo' | `role:${string}` | 'roles' | 'check' | 'ls-remote' | 'mirror'
  >;
  agents: Record<string, { agentId: string | null; environmentId: string | null; checkout: string }>;
  error: string | null;
}

/** Nội dung `~/Library/Application Support/2P Crew/app.json`; crew-mac chỉ đọc `appVersion`, `sshdOwner`, `updateState`. */
export interface AppState {
  version: 1;
  appVersion: string;
  sshdOwner: 'app' | 'launchd';
  sshdPid: number | null;
  updateState: UpdateState;
  update: {
    from: string | null;
    to: string | null;
    installedAt: string | null;
    badVersions: string[];
    baseline: string[];
  };
  setup: { step: SetupStep; paperclipOrigin: string | null; companyId: string | null };
  projects: Record<string, ProjectProgress>;
}

/**
 * Thư mục `userData` của Chromium (Local State, Preferences, Local Storage): thư mục con cạnh `app.json`, để app mới
 * không đọc hay ghi dữ liệu Chromium của app v2 nằm ngay trong `~/Library/Application Support/2P Crew/`.
 */
export function chromiumUserDataDir(appStateFile: string): string {
  return join(dirname(appStateFile), 'chromium');
}

export function defaultAppState(appVersion: string): AppState {
  return {
    version: 1,
    appVersion,
    sshdOwner: 'launchd',
    sshdPid: null,
    updateState: 'idle',
    update: { from: null, to: null, installedAt: null, badVersions: [], baseline: [] },
    setup: { step: 'check', paperclipOrigin: null, companyId: null },
    projects: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bù khóa thiếu bằng mặc định (một cấp cho `update`, `setup`) để file cũ hay thiếu vẫn đọc được. */
function withDefaults(raw: Record<string, unknown>, appVersion: string): AppState {
  const base = defaultAppState(appVersion);
  return {
    ...base,
    ...raw,
    version: 1,
    appVersion,
    update: { ...base.update, ...(isRecord(raw.update) ? raw.update : {}) },
    setup: { ...base.setup, ...(isRecord(raw.setup) ? raw.setup : {}) },
    projects: isRecord(raw.projects) ? (raw.projects as AppState['projects']) : {},
  } as AppState;
}

/**
 * Trạng thái bền của app. Chỉ Main process ghi; `update` nối tiếp qua hàng đợi Promise, ghi atomic (file tạm
 * rồi `rename`) với mode 600. File hỏng thì đổi tên thành `app.json.broken-<giờ>` và dùng mặc định.
 */
export class AppStateStore {
  private state: AppState;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly file: string,
    private readonly appVersion: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.state = this.load();
  }

  get(): AppState {
    return structuredClone(this.state);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(fn: (state: AppState) => AppState): Promise<AppState> {
    const next = this.queue.then(() => {
      const updated = fn(this.get());
      this.write(updated);
      this.state = updated;
      for (const listener of this.listeners) listener();
      return this.get();
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private load(): AppState {
    if (!existsSync(this.file)) {
      const fresh = defaultAppState(this.appVersion);
      this.write(fresh);
      return fresh;
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!isRecord(raw)) throw new Error('app.json không phải object');
      return withDefaults(raw, this.appVersion);
    } catch {
      const stamp = this.now().toISOString().replace(/[:.]/g, '-');
      try {
        renameSync(this.file, `${this.file}.broken-${stamp}`);
      } catch {
        // không giữ được bản hỏng thì vẫn dùng mặc định
      }
      const fresh = defaultAppState(this.appVersion);
      this.write(fresh);
      return fresh;
    }
  }

  private write(state: AppState): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
