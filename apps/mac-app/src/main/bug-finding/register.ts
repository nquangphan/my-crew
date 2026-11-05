import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRunner } from '@crew/mac';
import { app, shell } from 'electron';
import type { AppContext } from '../app-context.js';
import { runBugFindingReview } from '../jobs/executors.js';
import type { JobOutcome, MachineJob } from '../jobs/types.js';
import { createPaperclipClient } from '../paperclip/client.js';
import { boardKeys } from '../paperclip/register.js';
import { runGit } from '../projects/folder.js';
import { createProjectsIpc } from '../projects/ipc.js';
import { projectDeps } from '../projects/register.js';
import {
  checkLaunch,
  createLaunchDeps,
  type LaunchGate,
  type LaunchResult,
  launchBugFinding,
  PROBE_TIMEOUT_MS,
  trashStandalone,
} from './launch.js';
import { bugFindingPaths, resolveAppPath, STANDALONE_APP_PATH } from './paths.js';
import {
  createBridgeFileReader,
  createRelayMemory,
  mergeDelivered,
  readResponsesDir,
  relayResponses,
  relayView,
  rememberRequest,
  startResultsRelay,
} from './results.js';
import { readBugFindingState } from './state.js';
import {
  createMachineRepoLookup,
  createRepoResolver,
  createSyncRunner,
  syncedProjectKnown,
  syncProjects,
} from './sync-projects.js';

/** Ghi lại danh sách project sang Bug Finding định kỳ (ngoài các lần nhờ khi project hay checkout đổi). */
export const PROJECT_SYNC_INTERVAL_MS = 10 * 60_000;

export interface BugFindingModule {
  /** Nhờ đồng bộ project sang Bug Finding; chưa đăng nhập hay chưa chọn company thì bỏ qua. Không ném. */
  requestSync(reason: string): void;
  /**
   * Việc máy `bug-finding-review` (`runBugFindingReview` với app nhúng, sổ lượt trong `app.json`); `origin` là origin
   * board đã giao việc, `signal` bật khi việc quá giờ. Không ném.
   */
  runReview(job: MachineJob, opts: { origin: string; signal?: AbortSignal }): Promise<JobOutcome>;
  /** Máy có app Bug Finding nhúng để chạy (báo capability `bug-finding-review`). */
  available(): boolean;
}

/**
 * Mục Bug Finding (kênh `bugFinding:*`): trạng thái app đi kèm, mở app, gỡ bản cài riêng cũ, đồng bộ project Crew
 * sang Bug Finding (`crew/projects.json`: khi mở app, mỗi 10 phút, khi đổi company, khi được nhờ và khi bấm
 * **Đồng bộ lại**). App nhúng ở `<resourcesPath>/Bug Finding.app`; bản dev lấy đường dẫn từ `CREW_BUG_FINDING_APP`.
 * Việc review và nút Mở chạy trong `gate` (đóng trong lúc chờ cài bản mới).
 */
export function registerBugFinding(ctx: AppContext, gate: LaunchGate): BugFindingModule {
  const runner = createRunner();
  const paths = bugFindingPaths(ctx.home);
  const appPath = resolveAppPath({
    isPackaged: app.isPackaged,
    resourcesPath: ctx.resourcesPath,
    env: process.env,
  });
  const launchDeps = createLaunchDeps(runner, appPath);

  const readVersion = async (bundle: string) => {
    const out = await runner.run(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleShortVersionString', join(bundle, 'Contents', 'Info.plist')],
      { timeoutMs: PROBE_TIMEOUT_MS },
    );
    return out.code === 0 && !out.timedOut ? out.stdout.trim() || null : null;
  };

  const projects = createProjectsIpc({ deps: () => projectDeps(ctx) });
  // Project không có tiến độ trong app.json (dựng bằng crew-mac, hay server dựng qua ensure-project): repoPath server ghi cho máy này.
  const resolveRepo = createRepoResolver(
    (args) => runGit(args, { env: process.env, timeoutMs: 10_000 }),
    createMachineRepoLookup({
      client: { machineRepoPath: (...args) => projectDeps(ctx).client.machineRepoPath(...args) },
      companyId: () => ctx.store.get().setup.companyId,
      machineId: async () => (await ctx.ops.call('jobTargets')).machineId,
    }),
  );
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

  ctx.ipc.handle('bugFinding:state', () => {
    const state = ctx.store.get();
    return readBugFindingState({
      paths,
      appPath,
      standalonePath: STANDALONE_APP_PATH,
      readVersion,
      runningAppPaths: launchDeps.runningAppPaths,
      now: () => Date.now(),
      lastSyncAt: () => lastSyncAt,
      relay: () =>
        relayView(state.bugFindingOutbox ?? [], state.bugFindingRequests ?? {}, state.setup.paperclipOrigin),
    });
  });

  ctx.ipc.handle('bugFinding:open', async () => {
    const result = await gate.run(
      () => launchBugFinding(launchDeps, { background: false }),
      (): LaunchResult => ({ ok: false, reason: 'updating' }),
    );
    ctx.log(result.ok ? 'info' : 'warn', 'bug-finding-open', { ...result });
    return result;
  });

  ctx.ipc.handle('bugFinding:trashStandalone', async () => {
    const result = await trashStandalone({
      standalonePath: STANDALONE_APP_PATH,
      exists: existsSync,
      runningAppPaths: launchDeps.runningAppPaths,
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

  const runReview = (job: MachineJob, opts: { origin: string; signal?: AbortSignal }) =>
    runBugFindingReview(
      job,
      {
        home: ctx.home,
        requestsDir: paths.requestsDir,
        repoExists: existsSync,
        syncProjects: async () => {
          if (signedIn()) await sync.runNow('bug-finding-review');
        },
        projectKnown: (company, projectId) => syncedProjectKnown(paths.projectsFile, company, projectId),
        checkLaunch: () => checkLaunch(launchDeps),
        launch: (launchOpts) => launchBugFinding(launchDeps, launchOpts),
        recordRequest: async (ref) => {
          await ctx.store.update((state) => ({
            ...state,
            bugFindingRequests: rememberRequest(state.bugFindingRequests, ref, new Date().toISOString()),
          }));
          relay.request();
        },
        gate,
      },
      opts,
    ).then((outcome) => {
      ctx.log(outcome.status === 'done' ? 'info' : 'warn', 'bug-finding-review-job', {
        status: outcome.status,
        ...(outcome.status === 'failed' ? { errorCode: outcome.errorCode } : {}),
      });
      return outcome;
    });

  // Tiến độ và kết quả Bug Finding chỉ về origin đã giao việc, bằng board key của origin đó khi đang đăng nhập đúng nó.
  const memory = createRelayMemory();
  const readBridgeFile = createBridgeFileReader(paths.dataDir);
  const relay = startResultsRelay({
    responsesDir: paths.responsesDir,
    log: (level, event, fields) => ctx.log(level, event, fields),
    relay: async () => {
      const state = ctx.store.get();
      // Chưa có lượt nào do 2P Crew xếp: không đọc thư mục responses.
      if (Object.keys(state.bugFindingRequests ?? {}).length === 0 && !state.bugFindingOutbox?.length) return;
      await relayResponses({
        listResponses: () => readResponsesDir(paths.responsesDir),
        readFile: readBridgeFile,
        load: () => {
          const current = ctx.store.get();
          return { outbox: current.bugFindingOutbox ?? [], requests: current.bugFindingRequests ?? {} };
        },
        save: async (next) => {
          await ctx.store.update((current) => ({
            ...current,
            bugFindingOutbox: next.outbox,
            bugFindingRequests: mergeDelivered(current.bugFindingRequests, next.requests),
          }));
        },
        currentOrigin: () => ctx.store.get().setup.paperclipOrigin,
        post: async (origin, body) => {
          const client = createPaperclipClient(origin, {
            fetch: globalThis.fetch,
            readKey: () => boardKeys.read(origin),
            log: (event, fields) => ctx.log('debug', event, fields),
          });
          await client.postBugFindingResult(body);
        },
        now: () => Date.now(),
        memory,
        log: (level, event, fields) => ctx.log(level, event, fields),
      });
    },
  });
  app.on('will-quit', () => relay.stop());

  const available = () => appPath !== null && existsSync(appPath);
  return { requestSync, runReview, available };
}
