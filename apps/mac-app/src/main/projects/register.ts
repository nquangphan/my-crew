import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import type { AppContext } from '../app-context.js';
import { paperclipClient } from '../paperclip/register.js';
import { createProjectsIpc } from './ipc.js';

/**
 * Kênh `projects:*`. Tiến độ thêm project nằm trong `app.json` nên mỗi bước ghi đều làm
 * `AppStateStore` báo thay đổi, `index.ts` chuyển thành `state:changed` và màn hình Project đọc lại `projects:list`.
 */
export function registerProjects(ctx: AppContext): void {
  const projects = createProjectsIpc({
    deps: () => ({
      home: ctx.home,
      env: process.env,
      client: paperclipClient(ctx),
      ops: ctx.ops,
      store: ctx.store,
      log: (event, fields) => ctx.log('info', event, fields),
    }),
    pickDirectory: async () => {
      const options: OpenDialogOptions = {
        title: 'Chọn folder project',
        buttonLabel: 'Chọn',
        properties: ['openDirectory'],
      };
      const win = BrowserWindow.getFocusedWindow();
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });
  ctx.ipc.handle('projects:list', () => projects.list());
  ctx.ipc.handle('projects:pickFolder', () => projects.pickFolder());
  ctx.ipc.handle('projects:add', (input) => projects.add(input));
  ctx.ipc.handle('projects:remove', (projectId) => projects.remove(projectId));
}
