import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import type { AppContext } from '../app-context.js';
import { paperclipClient } from '../paperclip/register.js';
import { repairDocsOnStart } from './docs-runtime.js';
import { createProjectsIpc } from './ipc.js';
import type { ProjectDeps } from './progress.js';

/** Deps của các thao tác project dựng từ `AppContext` (client Paperclip đọc lại origin và key mỗi lần gọi). */
export function projectDeps(ctx: AppContext): ProjectDeps {
  return {
    home: ctx.home,
    env: process.env,
    client: paperclipClient(ctx),
    ops: ctx.ops,
    store: ctx.store,
    log: (event, fields) => ctx.log('info', event, fields),
  };
}

/**
 * Kênh `projects:*`. Tiến độ thêm project nằm trong `app.json` nên mỗi bước ghi đều làm
 * `AppStateStore` báo thay đổi, `index.ts` chuyển thành `state:changed` và màn hình Project đọc lại `projects:list`.
 * Sau thêm/gỡ project thì nhờ đồng bộ danh sách project sang Bug Finding (`ctx.syncBugFindingSoon`).
 */
export function registerProjects(ctx: AppContext): void {
  const projects = createProjectsIpc({
    deps: () => projectDeps(ctx),
    onAdded: (key) => ctx.sendStatusSoon(`project-added:${key}`),
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
  // Thêm/gỡ project xong (kể cả khi lỗi giữa chừng): ghi lại danh sách project sang Bug Finding.
  ctx.ipc.handle('projects:add', async (input) => {
    try {
      return await projects.add(input);
    } finally {
      ctx.syncBugFindingSoon('project-added');
    }
  });
  ctx.ipc.handle('projects:remove', async (projectId) => {
    try {
      return await projects.remove(projectId);
    } finally {
      ctx.syncBugFindingSoon('project-removed');
    }
  });
  // Mỗi lần app mở: cài bundle crew-docs mang theo và tự sửa hook crew-docs của các repo đã biết (chạy nền).
  void repairDocsOnStart({ ops: ctx.ops, resourcesPath: ctx.resourcesPath, log: ctx.log });
}
