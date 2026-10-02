import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { GatewayClient } from './client.ts';
import { createShellHandlers, navigationAllowed, secureWindowOptions } from './security.ts';

const mainDir = fileURLToPath(new URL('.', import.meta.url));
const rendererPath = join(mainDir, '..', '..', '..', 'src', 'renderer', 'index.html');
const preloadPath = join(mainDir, '..', '..', '..', 'src', 'preload', 'index.cjs');

if (process.env.CREW_V2_TEST_LIFECYCLE === '1') console.log('CREW_V2_TEST_MAIN_LOADED');
app
  .whenReady()
  .then(async () => {
    if (process.env.CREW_V2_TEST_LIFECYCLE === '1') console.log('CREW_V2_TEST_APP_READY');
    const window = new BrowserWindow(secureWindowOptions(preloadPath));
    const trustedUrl = pathToFileURL(rendererPath).href;
    const host = new GatewayClient(process.env.CREW_V2_GATEWAY_ROOT);
    const handlers = createShellHandlers({
      trustedWebContentsId: window.webContents.id,
      trustedUrl,
      host,
      openExternal: (url) => shell.openExternal(url),
    });
    ipcMain.handle('crew:get-status', (event) => handlers.getStatus(event));
    ipcMain.handle('crew:open-dashboard', (event) => handlers.openDashboard(event));
    window.webContents.on('will-navigate', (event, url) => {
      if (!navigationAllowed(trustedUrl, url)) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.once('ready-to-show', () => {
      window.show();
      if (process.env.CREW_V2_TEST_LIFECYCLE === '1') {
        void window.webContents
          .executeJavaScript('window.crew.getStatus().then(status => status.bootId)')
          .then(
            (bootId) => console.log(`CREW_V2_TEST_WINDOW_READY:${bootId}`),
            (error) => console.error(error),
          );
      }
    });
    if (process.env.CREW_V2_TEST_LIFECYCLE === '1') process.on('SIGUSR2', () => window.close());
    await window.loadFile(rendererPath);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
