import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { macPaths } from '@crew/mac';
import { app, ipcMain, utilityProcess } from 'electron';
import { STATE_CHANGED_EVENT } from '../shared/ipc-contract.js';
import type { AppContext } from './app-context.js';
import { AppLog } from './app-log.js';
import { AppStateStore, chromiumUserDataDir } from './app-state.js';
import { isTrustedSender, registerIpc } from './ipc.js';
import { registerJobs } from './jobs/register.js';
import { electronLoginItem } from './login-item.js';
import { type UtilityLike, UtilityOpsBridge } from './ops-bridge.js';
import { registerPaperclip } from './paperclip/register.js';
import { registerProjects } from './projects/register.js';
import { registerHealth } from './register-health.js';
import { registerSetup } from './setup/register.js';
import { registerSshd } from './sshd/register.js';
import { createStatusNudge } from './status-nudge.js';
import { CrewTray } from './tray.js';
import { registerUpdate } from './update/register.js';
import { createMainWindow } from './window.js';
import { createWindowController, type ShowTrigger } from './window-controller.js';

const here = dirname(fileURLToPath(import.meta.url));

const home = process.env.HOME ?? homedir();
const paths = macPaths(home);
// userData của Chromium phải đổi trước khi xin khóa một instance: khóa nằm trong thư mục userData, mà thư mục
// mặc định trùng với app 2P Crew cũ (cùng tên), nên xin khóa trước thì app mới tự thoát khi app cũ còn mở.
app.setPath('userData', chromiumUserDataDir(paths.appState));

// 1. Một instance: lần mở thứ hai chỉ đưa cửa sổ lên.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

async function start(): Promise<void> {
  const dataDir = dirname(paths.appState);

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

  const windows = createWindowController({
    create: () =>
      createMainWindow({
        preload: join(here, '..', 'preload', 'index.cjs'),
        rendererUrl,
        route: 'health',
        show: true,
      }),
    log,
    // App tray: không có cửa sổ thì không để biểu tượng Dock; chỉ tray, mở lại app hoặc chạy lại app mới mở cửa sổ.
    dock: app.dock ? { show: () => void app.dock?.show(), hide: () => app.dock?.hide() } : undefined,
  });
  const showWindow = (trigger: ShowTrigger) => windows.show(trigger);

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
  const statusNudge = createStatusNudge({
    send: () => ops.call('sendStatus'),
    log: (level, event, fields) => log(level, event, fields),
  });
  const tray = new CrewTray({ open: () => showWindow('tray'), quit: () => app.quit() });
  const ctx: AppContext = {
    home,
    appVersion: app.getVersion(),
    resourcesPath: process.resourcesPath,
    store,
    log,
    ops,
    sendStatusSoon: (reason) => statusNudge.request(reason),
    ipc,
    loginItem,
    tray,
    showWindow: () => showWindow('tray'),
    quit: () => app.quit(),
  };

  ipc.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));
  ipc.handle('app:reportError', (report) => {
    log('error', 'renderer-error', { ...report });
    return undefined;
  });
  store.onChange(() => windows.send(STATE_CHANGED_EVENT));
  const sshd = registerSshd(ctx);
  registerJobs(ctx);
  const health = registerHealth(ctx, sshd);
  registerPaperclip(ctx);
  registerProjects(ctx);
  registerSetup(ctx, sshd, health);
  registerUpdate(ctx, sshd);

  app.on('second-instance', () => showWindow('second-instance'));
  app.on('activate', (_event, hasVisibleWindows) => windows.activate(hasVisibleWindows));
  // Đóng cửa sổ không thoát app.
  app.on('window-all-closed', () => undefined);
  app.on('will-quit', () => ops.dispose());

  log('info', 'app-started', { version: app.getVersion(), openedAtLogin: loginItem.openedAtLogin() });
  if (!loginItem.openedAtLogin()) showWindow('startup');
  else app.dock?.hide();
}
