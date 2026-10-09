import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { macPaths } from '@crew/mac';
import { app, type BrowserWindow, ipcMain, utilityProcess } from 'electron';
import { STATE_CHANGED_EVENT } from '../shared/ipc-contract.js';
import type { AppContext } from './app-context.js';
import { AppLog } from './app-log.js';
import { AppStateStore, chromiumUserDataDir } from './app-state.js';
import { isTrustedSender, registerIpc } from './ipc.js';
import { electronLoginItem } from './login-item.js';
import { type UtilityLike, UtilityOpsBridge } from './ops-bridge.js';
import { registerPaperclip } from './paperclip/register.js';
import { registerProjects } from './projects/register.js';
import { registerHealth } from './register-health.js';
import { registerSetup } from './setup/register.js';
import { registerSshd } from './sshd/register.js';
import { CrewTray } from './tray.js';
import { registerUpdate } from './update/register.js';
import { createMainWindow } from './window.js';

const here = dirname(fileURLToPath(import.meta.url));

// 1. Một instance: lần mở thứ hai chỉ đưa cửa sổ lên.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

async function start(): Promise<void> {
  const home = process.env.HOME ?? homedir();
  const paths = macPaths(home);
  const dataDir = dirname(paths.appState);
  app.setPath('userData', chromiumUserDataDir(paths.appState));

  // 2. Trạng thái bền, 3. nhật ký.
  const store = new AppStateStore(paths.appState, app.getVersion());
  const appLog = new AppLog(join(dataDir, 'app.log'));
  const log: AppContext['log'] = (level, event, fields = {}) =>
    appLog.write({ level, source: 'main', event, fields });
  process.on('uncaughtException', (error) =>
    log('error', 'uncaught-exception', { error: error.stack ?? error.message }),
  );
  process.on('unhandledRejection', (reason) =>
    log('error', 'unhandled-rejection', {
      error: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
    }),
  );

  // Tray, cửa sổ và utilityProcess chỉ dùng được sau khi Electron sẵn sàng.
  await app.whenReady();

  const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  const rendererUrl = devUrl ?? pathToFileURL(join(here, '..', 'renderer', 'index.html')).toString();
  const loginItem = electronLoginItem(app);

  let window: BrowserWindow | null = null;
  const showWindow = () => {
    if (!window || window.isDestroyed()) {
      window = createMainWindow({
        preload: join(here, '..', 'preload', 'index.cjs'),
        rendererUrl,
        route: 'health',
        show: true,
      });
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  const ops = new UtilityOpsBridge(
    () =>
      utilityProcess.fork(join(here, 'ops.js'), [], {
        serviceName: '2P Crew ops',
        stdio: 'pipe',
        env: { ...process.env },
      }) as unknown as UtilityLike,
  );

  // 4. IPC, 5. tray, rồi mỗi ticket thêm đúng một dòng registerX của mình bên dưới.
  const ipc = registerIpc(ipcMain, {
    isTrusted: (url) => isTrustedSender(url, rendererUrl),
    log: (event, fields) => log('warn', event, fields),
  });
  const tray = new CrewTray({ open: showWindow, quit: () => app.quit() });
  const ctx: AppContext = {
    home,
    appVersion: app.getVersion(),
    resourcesPath: process.resourcesPath,
    store,
    log,
    ops,
    ipc,
    loginItem,
    tray,
    showWindow,
    quit: () => app.quit(),
  };

  ipc.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));
  ipc.handle('app:reportError', (report) => {
    log('error', 'renderer-error', { ...report });
    return undefined;
  });
  store.onChange(() => window?.webContents.send(STATE_CHANGED_EVENT));
  const sshd = registerSshd(ctx);
  const health = registerHealth(ctx, sshd);
  registerPaperclip(ctx);
  registerProjects(ctx);
  registerSetup(ctx, sshd, health);
  registerUpdate(ctx, sshd);

  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  // Đóng cửa sổ không thoát app.
  app.on('window-all-closed', () => undefined);
  app.on('will-quit', () => ops.dispose());

  log('info', 'app-started', { version: app.getVersion(), openedAtLogin: loginItem.openedAtLogin() });
  if (!loginItem.openedAtLogin()) showWindow();
}
