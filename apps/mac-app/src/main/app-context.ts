import type { AppLogEntry } from './app-log.js';
import type { AppStateStore } from './app-state.js';
import type { IpcRegistry } from './ipc.js';
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
  ipc: IpcRegistry;
  loginItem: LoginItem;
  tray: CrewTray;
  showWindow: () => void;
  quit: () => void;
}
