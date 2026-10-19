import { BrowserWindow, session } from 'electron';
import { isTrustedSender } from './ipc.js';

export interface WindowOptions {
  preload: string;
  /** `file://…/renderer/index.html` của bản đóng gói, hoặc URL dev server. */
  rendererUrl: string;
  /** Route hash mở đầu, ví dụ `health`. */
  route: string;
  /** Mở từ login item thì tạo cửa sổ nhưng chưa hiện. */
  show: boolean;
}

/**
 * Cửa sổ duy nhất: renderer sandbox, cô lập ngữ cảnh, không Node, chỉ nạp file đóng gói. Không mở cửa sổ khác,
 * không điều hướng ra ngoài, không cấp quyền nào.
 */
export function createMainWindow(options: WindowOptions): BrowserWindow {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    title: '2P Crew',
    show: false,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedSender(url, options.rendererUrl)) event.preventDefault();
  });
  if (options.show) window.once('ready-to-show', () => window.show());
  void window.loadURL(`${options.rendererUrl}#/${options.route}`);
  return window;
}
