import type { AppLogEntry } from './app-log.js';
import type { AppStateStore } from './app-state.js';
import type { IpcRegistry } from './ipc.js';
import type { JobOutcome, MachineJob } from './jobs/types.js';
import type { LoginItem } from './login-item.js';
import type { OpsBridge } from './ops-bridge.js';
import type { CrewTray } from './tray.js';

/**
 * Những gì mỗi `registerX` của `src/main/index.ts` nhận. Ticket sau thêm dòng `registerX(ctx)` của mình và chỉ
 * dùng các phần này (cộng kênh IPC của nó qua `ctx.ipc.handle`).
 */
export interface AppContext {
  /** HOME của owner (tôn trọng biến `HOME`, test dùng HOME giả). */
  home: string;
  appVersion: string;
  /** `process.resourcesPath`: bản `crew-mac` mang theo nằm ở `<resourcesPath>/crew-mac`. */
  resourcesPath: string;
  store: AppStateStore;
  log: (level: AppLogEntry['level'], event: string, fields?: Record<string, unknown>) => void;
  ops: OpsBridge;
  /** Nhờ gửi bản tin máy sớm (gộp, chạy nền, không ném) sau khi checkout agent vừa được tạo. */
  sendStatusSoon: (reason: string) => void;
  /** Nhờ ghi lại danh sách project Crew sang Bug Finding (gộp, chạy nền, không ném) sau khi project hay checkout đổi. */
  syncBugFindingSoon: (reason: string) => void;
  /**
   * Làm việc máy `bug-finding-review` trong Main (ghi yêu cầu vào hàng đợi Bug Finding, mở app nền). `origin`: origin
   * board đã giao việc (kết quả chỉ về đó); `signal` bật khi việc quá giờ. Không ném.
   */
  runBugFindingReview: (
    job: MachineJob,
    opts: { origin: string; signal?: AbortSignal },
  ) => Promise<JobOutcome>;
  /** Máy có app Bug Finding nhúng chạy được: bản tin máy báo capability `bug-finding-review`. */
  bugFindingAvailable: () => boolean;
  ipc: IpcRegistry;
  loginItem: LoginItem;
  tray: CrewTray;
  showWindow: () => void;
  quit: () => void;
}
