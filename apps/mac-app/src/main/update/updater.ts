import type { CheckResult } from '@crew/mac';
import type { UpdateView } from '../../shared/ipc-contract.js';
import type { AppContext } from '../app-context.js';
import type { AppStateStore, UpdateState } from '../app-state.js';
import type { SshdRuntime } from '../sshd/register.js';
import { type DrainAnswer, drainForUpdate } from './drain.js';
import { SEND_STATUS_BASELINE_ID } from './probation.js';
import type { ProbationMarkers, RollbackMode } from './rollback.js';
import { judgeCandidate } from './versions.js';

/** Kiểm bản mới lúc mở app, rồi mỗi 1 giờ. */
export const CHECK_INTERVAL_MS = 60 * 60_000;
export const DISABLED_UNSIGNED = 'Bản này không ký Developer ID, cập nhật tự động tắt';
/**
 * Sau `quitAndInstall`, Squirrel.Mac lấy zip qua proxy local của electron-updater, kiểm chữ ký, giải nén, xếp ShipIt
 * rồi mới thoát app (thường dưới 1 phút). Quá 5 phút app vẫn sống thì coi như cài hỏng: mở lại cổng, về `waiting-idle`.
 */
export const INSTALL_QUIT_TIMEOUT_MS = 5 * 60_000;

interface UpdateInfoLike {
  version: string;
  files?: readonly { url: string }[];
}

/** Phần của `autoUpdater` (electron-updater, MacUpdater) mà updater dùng; test thay bằng EventEmitter giả. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  on(event: 'update-available' | 'update-downloaded', listener: (info: UpdateInfoLike) => void): unknown;
  on(event: 'update-not-available', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdaterDeps {
  /** Chỉ gọi khi updater bật (dựng MacUpdater đọc `app-update.yml` của bản đóng gói). */
  autoUpdater(): AutoUpdaterLike;
  appVersion: string;
  /** Khác null: updater tắt, màn hình hiện lý do. */
  disabledReason: string | null;
  store: Pick<AppStateStore, 'get' | 'update'>;
  supervisor: Pick<SshdRuntime, 'pause' | 'resume' | 'activeRuns' | 'stopForQuit' | 'allowQuitForUpdate'>;
  markers: Pick<ProbationMarkers, 'writePending' | 'writeCancelled'>;
  doctor(): Promise<CheckResult[]>;
  sendStatus(): Promise<void>;
  askDrain(activeRuns: number | null): Promise<DrainAnswer>;
  /** Có run đang chạy: hỏi owner trước khi quay về bản trước. */
  confirmRollback(activeRuns: number | null): Promise<boolean>;
  snapshotPrevious(): Promise<void>;
  previousVersion(): string | null;
  spawnRollback(mode: RollbackMode, toVersion: string): void;
  exit(code: number): void;
  sleep(ms: number): Promise<void>;
  now(): Date;
  every(ms: number, fn: () => void): () => void;
  /** Hẹn giờ một lần; trả hàm hủy. */
  after(ms: number, fn: () => void): () => void;
  log: AppContext['log'];
}

export interface Updater {
  /** Kiểm ngay rồi mỗi 1 giờ. Gọi sau probation (trong lúc thử bản mới không kiểm). */
  start(): void;
  stop(): void;
  check(): Promise<void>;
  /** Chạy lại việc chờ máy rảnh rồi cài cho bản đã tải; trả ngay, việc chờ chạy nền. */
  installWhenIdle(): Promise<void>;
  rollback(): Promise<void>;
  view(): UpdateView;
  /** Xong mọi việc nền (tải, chờ rảnh, cài). */
  idle(): Promise<void>;
}

/** electron-updater báo repo chưa có release (hay chưa có `latest-mac.yml`): không phải lỗi. */
const UNPUBLISHED_CODES = new Set([
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
  'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
]);

function isUnpublished(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && UNPUBLISHED_CODES.has(code)) return true;
  return /No published versions|Unable to find latest version|HttpError: 404|\b404 Not Found/i.test(
    String(message ?? ''),
  );
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Đang có việc của chính updater: không kiểm chồng. */
const BUSY: readonly UpdateState[] = ['downloading', 'installing', 'probation'];

/**
 * Máy trạng thái `idle → downloading → waiting-idle → installing → (app mới) probation → idle | rolled-back`.
 * Không tự tải (lọc phiên bản trước), không tự cài khi thoát, không hạ bản, không prerelease. Cài: chờ máy rảnh
 * (drain), chép app vào `previous/`, ghi marker `pending`, sinh watchdog, ghi `installing`, cho phép thoát (quit guard
 * không hỏi lại), dừng listener, `quitAndInstall`. Squirrel báo lỗi hay app không thoát trong hạn: gỡ watchdog, hủy
 * giấy phép thoát (listener mở lại), về `waiting-idle`; không đưa bản vào `badVersions`.
 */
export function createUpdater(deps: UpdaterDeps): Updater {
  const enabled = deps.disabledReason === null;
  let available: string | null = null;
  let downloaded: string | null = null;
  /** Owner chọn "Để sau" cho bản này: tải lại cùng bản thì không hỏi lại, chờ nút "Cài khi rảnh". */
  let deferred: string | null = null;
  let reason: string | null = deps.disabledReason;
  let lastCheckedAt: string | null = null;
  let installing = false;
  /** Lần cài đang chờ app thoát: lỗi Squirrel hay hết hạn thì `abortInstall`. */
  let attempt: { version: string; revoke: () => Promise<void>; cancelTimer: () => void } | null = null;
  let stopTimer: (() => void) | null = null;
  const pending = new Set<Promise<unknown>>();

  const track = (work: Promise<unknown>) => {
    const tracked = work.catch((error) => deps.log('error', 'update-failed', { error: errorText(error) }));
    pending.add(tracked);
    void tracked.finally(() => pending.delete(tracked));
  };
  const setState = (updateState: UpdateState) => deps.store.update((s) => ({ ...s, updateState }));
  const abortInstall = async (cause: string): Promise<void> => {
    const current = attempt;
    if (!current) return;
    attempt = null;
    current.cancelTimer();
    deps.markers.writeCancelled(current.version);
    await current.revoke();
    deferred = current.version;
    reason = `Cài bản mới lỗi: ${cause}. Bấm "Cài khi rảnh" để thử lại.`;
    await setState('waiting-idle');
    deps.log('error', 'update-install-failed', { version: current.version, error: cause });
  };
  const onError = (error: unknown) => {
    if (attempt) {
      track(abortInstall(errorText(error)));
      return;
    }
    if (isUnpublished(error)) {
      reason = null;
      return;
    }
    reason = `Lỗi kiểm cập nhật: ${errorText(error)}`;
    deps.log('warn', 'update-error', { error: errorText(error) });
    if (deps.store.get().updateState === 'downloading') track(setState('idle'));
  };

  const baseline = async (): Promise<string[]> => {
    const ids: string[] = [];
    try {
      for (const check of await deps.doctor()) if (check.status === 'fail') ids.push(check.id);
    } catch (error) {
      deps.log('warn', 'update-baseline-doctor-failed', { error: errorText(error) });
    }
    try {
      await deps.sendStatus();
    } catch {
      ids.push(SEND_STATUS_BASELINE_ID);
    }
    return ids;
  };

  const install = async (version: string): Promise<void> => {
    if (installing) return;
    installing = true;
    try {
      const ids = await baseline();
      await deps.store.update((s) => ({
        ...s,
        updateState: 'waiting-idle',
        update: { ...s.update, baseline: ids },
      }));
      const answer = await drainForUpdate({
        pause: () => deps.supervisor.pause(),
        resume: () => deps.supervisor.resume(),
        activeRuns: async () => (await deps.supervisor.activeRuns()).length,
        ask: (n) => deps.askDrain(n),
        sleep: (ms) => deps.sleep(ms),
        now: () => deps.now().getTime(),
      });
      if (answer === 'later') {
        deferred = version;
        deps.log('info', 'update-deferred', { version });
        return;
      }
      try {
        await deps.snapshotPrevious();
      } catch (error) {
        deps.log('error', 'update-install-aborted', { version, error: errorText(error) });
        await deps.supervisor.resume().catch(() => undefined);
        deferred = version;
        return;
      }
      deps.markers.writePending(version);
      deps.spawnRollback('watchdog', version);
      await deps.store.update((s) => ({
        ...s,
        updateState: 'installing',
        update: { ...s.update, from: deps.appVersion, to: version, installedAt: deps.now().toISOString() },
      }));
      deps.log('info', 'update-installing', { from: deps.appVersion, to: version });
      // Owner đã đồng ý ở bước drain: `before-quit` của Squirrel đi qua quit guard không hỏi lại.
      const revoke = deps.supervisor.allowQuitForUpdate();
      attempt = { version, revoke, cancelTimer: () => undefined };
      await deps.supervisor.stopForQuit().catch(() => undefined);
      const mine = attempt;
      mine.cancelTimer = deps.after(INSTALL_QUIT_TIMEOUT_MS, () => {
        if (attempt === mine)
          track(abortInstall(`app không thoát sau ${INSTALL_QUIT_TIMEOUT_MS / 60_000} phút`));
      });
      try {
        deps.autoUpdater().quitAndInstall(false, true);
      } catch (error) {
        await abortInstall(errorText(error));
      }
    } finally {
      installing = false;
    }
  };

  if (enabled) {
    const updater = deps.autoUpdater();
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;

    updater.on('update-available', (info) => {
      const verdict = judgeCandidate({
        current: deps.appVersion,
        candidate: info.version,
        badVersions: deps.store.get().update.badVersions,
        files: info.files,
      });
      if (verdict !== 'offer') {
        available = null;
        deps.log(
          verdict === 'bad-version' ? 'warn' : 'info',
          `update-skipped${verdict === 'bad-version' ? '-bad' : ''}`,
          {
            version: info.version,
            ...(verdict === 'bad-version' ? {} : { verdict }),
          },
        );
        return;
      }
      available = info.version;
      deps.log('info', 'update-available', { version: info.version });
      track(
        (async () => {
          if (deps.store.get().updateState !== 'waiting-idle') await setState('downloading');
          await updater.downloadUpdate();
        })().catch(onError),
      );
    });
    updater.on('update-not-available', () => {
      available = null;
    });
    updater.on('update-downloaded', (info) => {
      downloaded = info.version;
      available = info.version;
      deps.log('info', 'update-downloaded', { version: info.version });
      if (deferred === info.version) {
        track(setState('waiting-idle'));
        return;
      }
      track(install(info.version));
    });
    updater.on('error', onError);
  }

  const check = async (): Promise<void> => {
    if (!enabled || installing || BUSY.includes(deps.store.get().updateState)) return;
    reason = null;
    lastCheckedAt = deps.now().toISOString();
    try {
      await deps.autoUpdater().checkForUpdates();
    } catch (error) {
      onError(error);
    }
  };

  return {
    start() {
      if (!enabled || stopTimer) return;
      track(check());
      stopTimer = deps.every(CHECK_INTERVAL_MS, () => track(check()));
    },
    stop() {
      stopTimer?.();
      stopTimer = null;
      attempt?.cancelTimer();
    },
    check,
    async installWhenIdle() {
      if (!enabled || !downloaded) throw new Error('Chưa có bản mới đã tải');
      if (installing) return;
      deferred = null;
      track(install(downloaded));
    },
    async rollback() {
      const previous = deps.previousVersion();
      if (!previous) throw new Error('Chưa có bản trước');
      let runs: number | null;
      try {
        runs = (await deps.supervisor.activeRuns()).length;
      } catch {
        runs = null;
      }
      if (runs !== 0 && !(await deps.confirmRollback(runs))) return;
      await deps.store.update((s) => ({
        ...s,
        updateState: 'rolled-back',
        update: {
          ...s.update,
          badVersions: s.update.badVersions.includes(deps.appVersion)
            ? s.update.badVersions
            : [...s.update.badVersions, deps.appVersion],
        },
      }));
      deps.log('warn', 'update-rollback-requested', { from: deps.appVersion, to: previous });
      deps.spawnRollback('now', deps.appVersion);
      await deps.supervisor.stopForQuit().catch(() => undefined);
      deps.exit(0);
    },
    view: () => ({
      current: deps.appVersion,
      available,
      state: deps.store.get().updateState,
      previous: deps.previousVersion(),
      enabled,
      reason,
      lastCheckedAt,
    }),
    async idle() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
