import type { CheckResult, InstallCrewMacResult } from '@crew/mac';
import type { AppContext } from '../app-context.js';
import type { AppStateStore } from '../app-state.js';
import type { SshdSupervisor } from '../sshd/supervisor.js';
import type { ProbationMarkers } from './rollback.js';

/** Bản mới có 5 phút để chứng minh khỏe. Watchdog của helper chờ 6 phút. */
export const PROBATION_MS = 5 * 60_000;
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
  /** `doctor({ probe: false })` qua utilityProcess. */
  doctor(): Promise<CheckResult[]>;
  sendStatus(): Promise<void>;
  markers: ProbationMarkers;
  hasPrevious(): boolean;
  /** Sinh helper `now` chờ chính process này thoát rồi thay app bằng `previous/`. */
  spawnRollbackNow(toVersion: string): void;
  exit(code: number): void;
  sleep(ms: number): Promise<void>;
  now(): Date;
  log: AppContext['log'];
}

const addUnique = (list: readonly string[], value: string) =>
  list.includes(value) ? [...list] : [...list, value];

/** Lý do hỏng, null khi bản mới khỏe. */
async function examine(deps: ProbationDeps, baseline: readonly string[]): Promise<string | null> {
  const deadline = deps.now().getTime() + PROBATION_MS;
  // 1. Listener: chế độ CLI (manifest giao sshd cho launchd) thì app không giữ listener, bỏ qua.
  for (;;) {
    const state = deps.supervisor.status().state;
    if (state === 'running' || state === 'disabled') break;
    if (deps.now().getTime() >= deadline) return 'sshd không lên';
    await deps.sleep(LISTENER_POLL_MS);
  }
  // 2. doctor --no-probe không có fail mới so với lúc tải bản này.
  try {
    const fresh = (await deps.doctor())
      .filter((check) => check.status === 'fail' && !baseline.includes(check.id))
      .map((check) => check.id);
    if (fresh.length > 0) return `doctor có lỗi mới: ${fresh.join(', ')}`;
  } catch (error) {
    return `không chạy được doctor: ${error instanceof Error ? error.message : String(error)}`;
  }
  // 3. Bản tin máy gửi được (trừ khi vốn đã không gửi được), thử lại tới hết 5 phút.
  if (baseline.includes(SEND_STATUS_BASELINE_ID)) return null;
  for (;;) {
    try {
      await deps.sendStatus();
      return null;
    } catch {
      if (deps.now().getTime() + SEND_RETRY_MS > deadline) return 'không gửi được bản tin máy';
      await deps.sleep(SEND_RETRY_MS);
    }
  }
}

/**
 * Chạy ngay khi app mở (sau `supervisor.start()`):
 * - helper vừa quay lui (marker `rolled-back`): ghi `update-rolled-back`, đưa bản đó vào `badVersions`;
 * - app vừa được cài (`updateState: installing`, `update.to` = bản đang chạy): tự kiểm tối đa 5 phút. Khỏe thì
 *   ghi marker `.ok` (watchdog thôi) và về `idle`. Hỏng thì đưa bản này vào `badVersions`, sinh helper `now`, dừng
 *   listener (phiên đang chạy vẫn sống) và thoát để helper thay app bằng `previous/`.
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
    deps.log('warn', 'update-rolled-back', { from: rolledBack, to: deps.appVersion });
    return 'rolled-back-detected';
  }

  const state = deps.store.get();
  if (state.updateState !== 'installing' && state.updateState !== 'probation') return 'skipped';
  const target = state.update.to;
  if (target !== deps.appVersion) {
    // Squirrel không thay được bundle, app cũ mở lại: không có gì để thử, gỡ watchdog.
    if (target) deps.markers.writeFailed(target);
    await deps.store.update((s) => ({ ...s, updateState: 'idle' }));
    deps.log('warn', 'update-install-missing', { expected: target, running: deps.appVersion });
    return 'install-missing';
  }

  await deps.store.update((s) => ({ ...s, updateState: 'probation' }));
  const reason = await examine(deps, state.update.baseline);
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
