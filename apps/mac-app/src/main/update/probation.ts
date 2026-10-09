import type { CheckResult, InstallCrewMacResult } from '@crew/mac';
import type { AppContext } from '../app-context.js';
import type { AppStateStore } from '../app-state.js';
import type { SshdSupervisor } from '../sshd/supervisor.js';
import type { ProbationMarkers } from './rollback.js';

/**
 * Hạn của từng bước thử bản mới, đếm riêng (một bước chậm không ăn vào hạn bước sau):
 * listener lên (tới 5 phút, Squirrel vừa mở lại app), doctor (tới 6 phút: check TCC đọc `log show` có thể mất
 * 30–240 giây khi máy vừa khởi động), gửi bản tin máy (thử lại tới 5 phút). Tổng tối đa `PROBATION_MAX_MS` (16 phút);
 * watchdog của helper chờ 20 phút từ lúc bản mới ghi `.started`.
 */
export const PROBATION_LISTENER_MS = 5 * 60_000;
export const PROBATION_DOCTOR_MS = 6 * 60_000;
export const PROBATION_SEND_MS = 5 * 60_000;
export const PROBATION_MAX_MS = PROBATION_LISTENER_MS + PROBATION_DOCTOR_MS + PROBATION_SEND_MS;
const LISTENER_POLL_MS = 5_000;
/** Gửi bản tin máy hỏng thì thử lại sau 30 giây (mạng chập chờn không đáng quay lui). */
const SEND_RETRY_MS = 30_000;
/** Chờ máy rảnh để cài `crew-mac` mang theo: kiểm mỗi 10 phút. */
export const CREW_MAC_IDLE_POLL_MS = 10 * 60_000;
/** Id giả trong `update.baseline`: bản tin máy đã không gửi được từ trước khi cài. */
export const SEND_STATUS_BASELINE_ID = 'send-status';

export type ProbationOutcome = 'skipped' | 'passed' | 'failed' | 'rolled-back-detected' | 'install-missing';

export interface ProbationDeps {
  appVersion: string;
  store: Pick<AppStateStore, 'get' | 'update'>;
  supervisor: Pick<SshdSupervisor, 'status' | 'stopForQuit'>;
  /** `doctor({ probe: false })` qua utilityProcess (cửa sổ TCC ngắn, xem `register.ts`). */
  doctor(): Promise<CheckResult[]>;
  sendStatus(): Promise<void>;
  markers: Omit<ProbationMarkers, 'writeCancelled' | 'writePending'>;
  hasPrevious(): boolean;
  /** Sinh helper `now` chờ chính process này thoát rồi thay app bằng `previous/`. */
  spawnRollbackNow(toVersion: string): void;
  exit(code: number): void;
  sleep(ms: number): Promise<void>;
  now(): Date;
  /** Hẹn giờ một lần (hạn của doctor); trả hàm hủy. */
  after(ms: number, fn: () => void): () => void;
  log: AppContext['log'];
}

const addUnique = (list: readonly string[], value: string) =>
  list.includes(value) ? [...list] : [...list, value];

const DOCTOR_TIMEOUT = Symbol('doctor-timeout');

/** Doctor có hạn `PROBATION_DOCTOR_MS`: treo quá hạn là hỏng thật (mỗi check đã có timeout riêng ngắn hơn). */
async function doctorWithin(deps: ProbationDeps): Promise<CheckResult[] | typeof DOCTOR_TIMEOUT> {
  let cancel: () => void = () => undefined;
  const timeout = new Promise<typeof DOCTOR_TIMEOUT>((resolve) => {
    cancel = deps.after(PROBATION_DOCTOR_MS, () => resolve(DOCTOR_TIMEOUT));
  });
  try {
    return await Promise.race([deps.doctor(), timeout]);
  } finally {
    cancel();
  }
}

/** Lý do hỏng, null khi bản mới khỏe. */
async function examine(deps: ProbationDeps, baseline: readonly string[]): Promise<string | null> {
  // 1. Listener: chế độ CLI (manifest giao sshd cho launchd) thì app không giữ listener, bỏ qua.
  const listenerDeadline = deps.now().getTime() + PROBATION_LISTENER_MS;
  for (;;) {
    const state = deps.supervisor.status().state;
    if (state === 'running' || state === 'disabled') break;
    if (deps.now().getTime() >= listenerDeadline) return 'sshd không lên';
    await deps.sleep(LISTENER_POLL_MS);
  }
  // 2. doctor --no-probe không có fail mới so với lúc tải bản này.
  try {
    const checks = await doctorWithin(deps);
    if (checks === DOCTOR_TIMEOUT) return `doctor không xong sau ${PROBATION_DOCTOR_MS / 60_000} phút`;
    const fresh = checks
      .filter((check) => check.status === 'fail' && !baseline.includes(check.id))
      .map((check) => check.id);
    if (fresh.length > 0) return `doctor có lỗi mới: ${fresh.join(', ')}`;
  } catch (error) {
    return `không chạy được doctor: ${error instanceof Error ? error.message : String(error)}`;
  }
  // 3. Bản tin máy gửi được (trừ khi vốn đã không gửi được), thử lại tới hết hạn của bước này.
  if (baseline.includes(SEND_STATUS_BASELINE_ID)) return null;
  const sendDeadline = deps.now().getTime() + PROBATION_SEND_MS;
  for (;;) {
    try {
      await deps.sendStatus();
      return null;
    } catch {
      if (deps.now().getTime() + SEND_RETRY_MS > sendDeadline) return 'không gửi được bản tin máy';
      await deps.sleep(SEND_RETRY_MS);
    }
  }
}

/**
 * Chạy ngay khi app mở (sau `supervisor.start()`):
 * - helper vừa quay lui (marker `rolled-back`): ghi `update-rolled-back`, đưa bản đó vào `badVersions`;
 * - app vừa được cài (`updateState: installing`, `update.to` = bản đang chạy), hoặc marker `pending` = bản đang chạy
 *   (lần cài trước báo lỗi nhưng ShipIt vẫn cài lúc app thoát): ghi `.started`, tự kiểm theo hạn từng bước. Khỏe thì
 *   ghi `.ok` (watchdog thôi) và về `idle`. Hỏng thì đưa bản này vào `badVersions`, sinh helper `now`, dừng listener
 *   (phiên đang chạy vẫn sống) và thoát để helper thay app bằng `previous/`.
 */
export async function runProbation(deps: ProbationDeps): Promise<ProbationOutcome> {
  const rolledBack = deps.markers.readRolledBack();
  if (rolledBack) {
    await deps.store.update((s) => ({
      ...s,
      updateState: 'rolled-back',
      update: { ...s.update, badVersions: addUnique(s.update.badVersions, rolledBack) },
    }));
    deps.markers.clearRolledBack();
    deps.markers.clearPending();
    deps.log('warn', 'update-rolled-back', { from: rolledBack, to: deps.appVersion });
    return 'rolled-back-detected';
  }

  const state = deps.store.get();
  const pending = deps.markers.readPending();
  const inFlight = state.updateState === 'installing' || state.updateState === 'probation';
  if (!inFlight) {
    if (pending === null) return 'skipped';
    if (pending !== deps.appVersion) {
      // Squirrel không cài bản đó lúc app thoát: bỏ marker cũ.
      deps.markers.clearPending();
      return 'skipped';
    }
    deps.log('warn', 'update-installed-late', { version: deps.appVersion });
  }
  const target = inFlight ? state.update.to : pending;
  if (target !== deps.appVersion) {
    // Squirrel không thay được bundle, app cũ mở lại: không có gì để thử, gỡ watchdog.
    if (target) deps.markers.writeFailed(target);
    deps.markers.clearPending();
    await deps.store.update((s) => ({ ...s, updateState: 'idle' }));
    deps.log('warn', 'update-install-missing', { expected: target, running: deps.appVersion });
    return 'install-missing';
  }

  deps.markers.writeStarted(deps.appVersion);
  await deps.store.update((s) => ({ ...s, updateState: 'probation' }));
  const reason = await examine(deps, state.update.baseline);
  deps.markers.clearPending();
  if (reason === null) {
    deps.markers.writeOk(deps.appVersion);
    await deps.store.update((s) => ({ ...s, updateState: 'idle' }));
    deps.log('info', 'update-installed', { from: state.update.from, to: deps.appVersion });
    return 'passed';
  }

  const canRollBack = deps.hasPrevious();
  await deps.store.update((s) => ({
    ...s,
    updateState: canRollBack ? 'rolled-back' : 'idle',
    update: { ...s.update, badVersions: addUnique(s.update.badVersions, deps.appVersion) },
  }));
  deps.log('error', 'update-probation-failed', {
    version: deps.appVersion,
    reason,
    ...(canRollBack ? {} : { note: 'không có bản trước để quay lui, giữ bản này' }),
  });
  if (!canRollBack) {
    // Thoát mà helper không có gì để chép thì máy mất app: giữ bản này chạy, gỡ watchdog.
    deps.markers.writeFailed(deps.appVersion);
    return 'failed';
  }
  deps.spawnRollbackNow(deps.appVersion);
  await deps.supervisor.stopForQuit().catch(() => undefined);
  deps.exit(0);
  return 'failed';
}

export interface CrewMacInstallDeps {
  activeRuns(): Promise<number>;
  /** `installCrewMacFrom(<resources>/crew-mac)` qua utilityProcess. */
  install(): Promise<InstallCrewMacResult>;
  sleep(ms: number): Promise<void>;
  log: AppContext['log'];
}

/**
 * Sau khi bản mới qua probation: chờ máy rảnh rồi cài bản `crew-mac` mang theo vào `~/.crew/app/crew-mac`
 * (`crew-mac` tự từ chối khi còn run; khi đó chờ tiếp). Chỉ một lần cho mỗi lần mở app.
 */
export async function installCrewMacWhenIdle(deps: CrewMacInstallDeps): Promise<void> {
  for (;;) {
    let runs: number | null;
    try {
      runs = await deps.activeRuns();
    } catch {
      runs = null;
    }
    if (runs === 0) {
      try {
        const result = await deps.install();
        if (result.installed) {
          deps.log('info', 'crew-mac-installed', { version: result.version, backup: result.backup });
          return;
        }
        if (!result.reason || !/run/i.test(result.reason)) {
          if (result.reason) deps.log('warn', 'crew-mac-install-skipped', { reason: result.reason });
          return;
        }
      } catch (error) {
        deps.log('warn', 'crew-mac-install-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
    await deps.sleep(CREW_MAC_IDLE_POLL_MS);
  }
}
