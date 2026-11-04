import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRunner } from '@crew/mac';
import { app, shell } from 'electron';
import type { AppContext } from '../app-context.js';
import { launchBugFinding, runningBugFindingApps, trashStandalone } from './launch.js';
import { bugFindingPaths, resolveAppPath, STANDALONE_APP_PATH } from './paths.js';
import { readBugFindingState } from './state.js';

/**
 * Mục Bug Finding (kênh `bugFinding:*`): trạng thái app đi kèm, mở app, gỡ bản cài riêng cũ. App nhúng ở
 * `<resourcesPath>/Bug Finding.app`; bản dev lấy đường dẫn từ `CREW_BUG_FINDING_APP`.
 */
export function registerBugFinding(ctx: AppContext): void {
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

  ctx.ipc.handle('bugFinding:state', () =>
    readBugFindingState({
      paths,
      appPath,
      standalonePath: STANDALONE_APP_PATH,
      readVersion,
      runningAppPaths,
      now: () => Date.now(),
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

  // Đồng bộ danh sách project Crew sang Bug Finding (`projects.json`) đi cùng module đồng bộ project.
  ctx.ipc.handle('bugFinding:syncNow', async () => {
    throw new Error('Bản này chưa đồng bộ project sang Bug Finding');
  });
}
