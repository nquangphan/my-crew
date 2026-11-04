import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRunner } from '@crew/mac';
import { app, shell } from 'electron';
import type { AppContext } from '../app-context.js';
import { runGit } from '../projects/folder.js';
import { createProjectsIpc } from '../projects/ipc.js';
import { projectDeps } from '../projects/register.js';
import { launchBugFinding, runningBugFindingApps, trashStandalone } from './launch.js';
import { bugFindingPaths, resolveAppPath, STANDALONE_APP_PATH } from './paths.js';
import { readBugFindingState } from './state.js';
import { createRepoResolver, createSyncRunner, syncProjects } from './sync-projects.js';

/** Ghi lại danh sách project sang Bug Finding định kỳ (ngoài các lần nhờ khi project hay checkout đổi). */
export const PROJECT_SYNC_INTERVAL_MS = 10 * 60_000;

export interface BugFindingModule {
  /** Nhờ đồng bộ project sang Bug Finding; chưa đăng nhập hay chưa chọn company thì bỏ qua. Không ném. */
  requestSync(reason: string): void;
}

/**
 * Mục Bug Finding (kênh `bugFinding:*`): trạng thái app đi kèm, mở app, gỡ bản cài riêng cũ, đồng bộ project Crew
 * sang Bug Finding (`crew/projects.json`: khi mở app, mỗi 10 phút, khi đổi company, khi được nhờ và khi bấm
 * **Đồng bộ lại**). App nhúng ở `<resourcesPath>/Bug Finding.app`; bản dev lấy đường dẫn từ `CREW_BUG_FINDING_APP`.
 */
export function registerBugFinding(ctx: AppContext): BugFindingModule {
  const runner = createRunner();
  const paths = bugFindingPaths(ctx.home);
  const appPath = resolveAppPath({
    isPackaged: app.isPackaged,
    resourcesPath: ctx.resourcesPath,
    env: process.env,
  });
  const runningAppPaths = () => runningBugFindingApps(runner);

  const readVersion = async (bundle: string) => {
    const out = await runner.run('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleShortVersionString',
      join(bundle, 'Contents', 'Info.plist'),
    ]);
    return out.code === 0 ? out.stdout.trim() || null : null;
  };

  const projects = createProjectsIpc({ deps: () => projectDeps(ctx) });
  const resolveRepo = createRepoResolver((args) => runGit(args, { env: process.env, timeoutMs: 10_000 }));
  let lastSyncAt: string | null = null;
  const sync = createSyncRunner({
    sync: async () => {
      const companyId = ctx.store.get().setup.companyId;
      if (!companyId) throw new Error('Chưa chọn company Paperclip (mục Cài đặt)');
      const result = await syncProjects({
        file: paths.projectsFile,
        companyId,
        listRows: () => projects.list(),
        resolveRepo,
      });
      lastSyncAt = new Date().toISOString();
      return result;
    },
    log: (level, event, fields) => ctx.log(level, event, fields),
  });
  const signedIn = () => {
    const setup = ctx.store.get().setup;
    return Boolean(setup.paperclipOrigin && setup.companyId);
  };
  const requestSync = (reason: string) => {
    if (signedIn()) sync.request(reason);
  };

  ctx.ipc.handle('bugFinding:state', () =>
    readBugFindingState({
      paths,
      appPath,
      standalonePath: STANDALONE_APP_PATH,
      readVersion,
      runningAppPaths,
      now: () => Date.now(),
      lastSyncAt: () => lastSyncAt,
    }),
  );

  ctx.ipc.handle('bugFinding:open', async () => {
    const result = await launchBugFinding(
      {
        embedded: appPath,
        exists: existsSync,
        runningAppPaths,
        run: (argv) => runner.run(argv[0] as string, argv.slice(1)),
      },
      { background: false },
    );
    ctx.log(result.ok ? 'info' : 'warn', 'bug-finding-open', { ...result });
    return result;
  });

  ctx.ipc.handle('bugFinding:trashStandalone', async () => {
    const result = await trashStandalone({
      standalonePath: STANDALONE_APP_PATH,
      exists: existsSync,
      runningAppPaths,
      trashItem: (path) => shell.trashItem(path),
    });
    ctx.log('info', 'bug-finding-trash-standalone', { ...result });
    return result;
  });

  ctx.ipc.handle('bugFinding:syncNow', () => sync.runNow('sync-now'));

  // Đăng nhập xong hay đổi company: đồng bộ ngay, không chờ lượt định kỳ.
  let companyId = ctx.store.get().setup.companyId;
  ctx.store.onChange(() => {
    const next = ctx.store.get().setup.companyId;
    if (next === companyId) return;
    companyId = next;
    requestSync('company-changed');
  });
  requestSync('startup');
  const timer = setInterval(() => requestSync('interval'), PROJECT_SYNC_INTERVAL_MS);
  timer.unref();
  app.on('will-quit', () => clearInterval(timer));

  return { requestSync };
}
