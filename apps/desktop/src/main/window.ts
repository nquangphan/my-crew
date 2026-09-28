import { BrowserWindow, session } from 'electron';
import { isTrustedSender } from './ipc-handlers.js';

export interface WindowOptions {
  preload: string;
  /** `file://…/renderer/index.html`, or the dev server URL in development. */
  rendererUrl: string;
  route: string;
}

/**
 * The only window: a sandboxed renderer with context isolation and no Node, loading bundled files only.
 * It cannot open other windows, navigate away, or get any permission.
 */
export function createMainWindow(options: WindowOptions): BrowserWindow {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 920,
    minHeight: 620,
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
  window.once('ready-to-show', () => window.show());
  void window.loadURL(`${options.rendererUrl}#/${options.route}`);
  return window;
}
