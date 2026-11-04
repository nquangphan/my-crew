import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRunner, macPaths } from '@crew/mac';
import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import type { AppContext } from '../app-context.js';
import { createLaunchDeps, type LaunchGate, launchBugFinding } from '../bug-finding/launch.js';
import { BUG_FINDING_BUNDLE_ID, bugFindingPaths, resolveAppPath } from '../bug-finding/paths.js';
import { bugFindingRunningReviews } from '../bug-finding/state.js';
import type { SshdRuntime } from '../sshd/register.js';
import {
  BUG_FINDING_QUIT_MS,
  type BugFindingDrain,
  reopenBugFindingAfterUpdate,
  reviewsFromHeartbeat,
} from './drain.js';
import { installCrewMacWhenIdle, runProbation } from './probation.js';
import {
  APP_BUNDLE_NAME,
  bundleFromExe,
  developerIdFromCodesign,
  fileMarkers,
  readPreviousVersion,
  snapshotPrevious,
  spawnRollbackHelper,
} from './rollback.js';
import { type AutoUpdaterLike, createUpdater, DISABLED_UNSIGNED } from './updater.js';

/** Squirrel.Mac thay bundle tại chỗ, helper quay lui chỉ ghi vào đúng đường dẫn này. */
const INSTALLED_BUNDLE = `/Applications/${APP_BUNDLE_NAME}`;
const DOCTOR_OPTS = { probe: false, tccWindow: '24h', probeTimeoutSec: 90 } as const;
/**
 * Doctor của probation: chỉ xét hộp thoại quyền mới trong 15 phút (bản mới vừa mở), để `log show` nhanh; hộp thoại cũ
 * hơn đã nằm trong baseline 24 giờ lúc tải.
 */
const PROBATION_DOCTOR_OPTS = { ...DOCTOR_OPTS, tccWindow: '15m' } as const;

const after = (ms: number, fn: () => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

function disabledReason(bundle: string | null): string | null {
  if (!app.isPackaged) return 'Bản chạy thử (chưa đóng gói), cập nhật tự động tắt';
  if (bundle !== INSTALLED_BUNDLE) return `App không chạy từ ${INSTALLED_BUNDLE}, cập nhật tự động tắt`;
  const run = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], { encoding: 'utf8' });
  return run.status === 0 && developerIdFromCodesign(`${run.stdout}${run.stderr}`) ? null : DISABLED_UNSIGNED;
}

/**
 * App Bug Finding nhúng (`<resourcesPath>/Bug Finding.app`) cho bước chờ máy rảnh: lượt review theo `heartbeat.json`,
 * đang chạy theo `ps`, thoát bằng AppleScript theo bundle id, cờ `reopenBugFinding` trong `app.json`, cổng mở Bug
 * Finding (`gate`) đóng trong lúc chờ cài. Không đọc được heartbeat hay `ps` thì ném (drain coi là đang review).
 */
function bugFindingForUpdate(ctx: AppContext, gate: LaunchGate) {
  const runner = createRunner();
  const paths = bugFindingPaths(ctx.home);
  const appPath = resolveAppPath({
    isPackaged: app.isPackaged,
    resourcesPath: ctx.resourcesPath,
    env: process.env,
  });
  const launchDeps = createLaunchDeps(runner, appPath);
  const setReopen = (on: boolean) =>
    ctx.store
      .update((state) => {
        const { reopenBugFinding: _old, ...rest } = state;
        return on ? { ...rest, reopenBugFinding: true } : rest;
      })
      .then(() => undefined);
  const isRunning = async () => appPath !== null && (await launchDeps.runningAppPaths()).includes(appPath);
  const drain: BugFindingDrain = {
    runningReviews: () =>
      reviewsFromHeartbeat(() => bugFindingRunningReviews(paths.heartbeatFile, Date.now()), isRunning),
    isRunning,
    quit: async () => {
      ctx.log('info', 'bug-finding-quit-for-update');
      const out = await runner.run('/usr/bin/osascript', ['-e', `quit app id "${BUG_FINDING_BUNDLE_ID}"`], {
        timeoutMs: BUG_FINDING_QUIT_MS,
      });
      if (out.code !== 0)
        ctx.log('warn', 'bug-finding-quit-failed', { code: out.code, timedOut: out.timedOut });
    },
    setReopen,
    hold: async () => {
      await gate.close();
      ctx.log('info', 'bug-finding-gate-closed');
    },
    release: () => {
      if (gate.isOpen()) return;
      gate.open();
      ctx.log('info', 'bug-finding-gate-opened');
    },
  };
  const reopen = () =>
    reopenBugFindingAfterUpdate({
      pending: () => ctx.store.get().reopenBugFinding === true,
      clear: () => setReopen(false),
      launch: (opts) => launchBugFinding(launchDeps, opts),
    });
  return { drain, reopen };
}

/**
 * Updater trong app (kênh `update:*`): probation của bản vừa cài chạy trước, rồi mới kiểm bản mới. Chỉ Main ghi
 * `app.json` (`updateState`, `update.*`); `crew-mac status` đọc `updateState` gửi lên thẻ máy.
 */
export function registerUpdate(ctx: AppContext, sshd: SshdRuntime, bugFindingGate: LaunchGate): void {
  const support = dirname(macPaths(ctx.home).appState);
  const bundle = bundleFromExe(app.getPath('exe'));
  const markers = fileMarkers(support);
  const spawnHelper = (mode: 'now' | 'watchdog', toVersion: string) =>
    spawnRollbackHelper({
      mode,
      waitPid: process.pid,
      support,
      toVersion,
      resourcesPath: ctx.resourcesPath,
      spawn,
    });
  const doctor = () => ctx.ops.call('doctor', { ...DOCTOR_OPTS });
  const sendStatus = () => ctx.ops.call('sendStatus');
  const exit = (code: number) => app.exit(code);
  const bugFinding = bugFindingForUpdate(ctx, bugFindingGate);

  const updater = createUpdater({
    autoUpdater: () => {
      const instance = electronUpdater.autoUpdater;
      instance.logger = {
        info: () => undefined,
        warn: (message: unknown) => ctx.log('warn', 'updater-log', { message: String(message) }),
        error: (message: unknown) => ctx.log('error', 'updater-log', { message: String(message) }),
      };
      return instance as unknown as AutoUpdaterLike;
    },
    appVersion: ctx.appVersion,
    disabledReason: disabledReason(bundle),
    store: ctx.store,
    supervisor: sshd,
    markers,
    doctor,
    sendStatus,
    bugFinding: bugFinding.drain,
    askDrain: async (runs) => {
      const result = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Cài ngay, run vẫn chạy', 'Để sau'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        message: 'Bản mới của 2P Crew đã tải xong.',
        detail: `${runs === null ? 'Không đọc được danh sách run' : `Còn ${runs} run đang chạy`} sau 30 phút chờ. Cài ngay: app khởi động lại, run đang chạy vẫn chạy tới xong. Để sau: bấm "Cài khi rảnh" ở màn hình Cập nhật.`,
      });
      return result.response === 0 ? 'now' : 'later';
    },
    confirmRollback: async (runs) => {
      const result = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Quay về bản trước', 'Hủy'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        message: runs === null ? 'Không đọc được danh sách run.' : `Có ${runs} run đang chạy trên máy này.`,
        detail: 'Quay về bản trước sẽ thoát và mở lại app; run đang chạy vẫn chạy tới xong.',
      });
      return result.response === 0;
    },
    snapshotPrevious: async () => {
      if (!bundle) throw new Error('Không biết đường dẫn app đang chạy');
      await snapshotPrevious({ bundle, support, version: ctx.appVersion });
    },
    previousVersion: () => readPreviousVersion(support),
    spawnRollback: spawnHelper,
    exit,
    sleep: (ms) => sleep(ms),
    now: () => new Date(),
    every: (ms, fn) => {
      const timer = setInterval(fn, ms);
      return () => clearInterval(timer);
    },
    after,
    log: ctx.log,
  });

  ctx.ipc.handle('update:state', () => updater.view());
  ctx.ipc.handle('update:check', async () => {
    await updater.check();
    return undefined;
  });
  ctx.ipc.handle('update:installWhenIdle', async () => {
    await updater.installWhenIdle();
    return undefined;
  });
  ctx.ipc.handle('update:rollback', async () => {
    await updater.rollback();
    return undefined;
  });
  app.on('will-quit', () => updater.stop());

  // Bản trước đã thoát Bug Finding (đang mở) để cài bản này: mở lại chạy nền, xóa cờ.
  void bugFinding
    .reopen()
    .then((result) => {
      if (result !== 'none')
        ctx.log(result === 'reopened' ? 'info' : 'warn', 'bug-finding-reopen', { result });
    })
    .catch((error) =>
      ctx.log('error', 'bug-finding-reopen-failed', {
        error: error instanceof Error ? error.message : String(error),
      }),
    );

  void (async () => {
    const outcome = await runProbation({
      appVersion: ctx.appVersion,
      store: ctx.store,
      supervisor: sshd,
      doctor: () => ctx.ops.call('doctor', { ...PROBATION_DOCTOR_OPTS }),
      sendStatus,
      markers,
      hasPrevious: () => readPreviousVersion(support) !== null,
      spawnRollbackNow: (toVersion) => spawnHelper('now', toVersion),
      exit,
      sleep: (ms) => sleep(ms),
      now: () => new Date(),
      after,
      log: ctx.log,
    });
    if (outcome === 'failed' && readPreviousVersion(support) !== null) return; // app đang thoát để quay lui
    if (outcome === 'passed') {
      void installCrewMacWhenIdle({
        activeRuns: async () => (await sshd.activeRuns()).length,
        install: () => ctx.ops.call('installCrewMacFrom', join(ctx.resourcesPath, 'crew-mac')),
        sleep: (ms) => sleep(ms),
        log: ctx.log,
      });
    }
    updater.start();
  })().catch((error) =>
    ctx.log('error', 'update-start-failed', {
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}
