import { join } from 'node:path';
import type { CommandRunner } from '@crew/mac';
import { isRecord, type StepRun } from './types.js';

/**
 * Gỡ app 2P Crew v2 (bước `v2`) và chuyển app mới vào Applications (bước `move`).
 *
 * Chỉ gỡ APP v2. Dữ liệu v2 của owner (cấu hình, log, bộ nhớ trợ lý, state...) được giữ nguyên: module này không
 * nhận đường dẫn HOME, không đọc, không xóa, không sửa, không nén bất kỳ file dữ liệu nào, và không đưa đường dẫn
 * dữ liệu vào đối số lệnh nào. Chỉ hai thứ bị đụng: bundle `2P Crew.app` của v2 (vào Thùng rác, khôi phục được) và
 * quyền TCC của bundle id v2.
 */

export const V2_BUNDLE_ID = 'com.2p-solutions.crew';
export const APP_BUNDLE_ID = 'com.2p-solutions.crew.mac';
const APP_NAME = '2P Crew.app';
export const LOGIN_ITEMS_SETTINGS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension';

export type V2Action = 'login-item' | 'trash' | 'tcc';
const ALL_ACTIONS: readonly V2Action[] = ['login-item', 'trash', 'tcc'];

export interface V2Deps {
  /** Thường là `/Applications`; test truyền thư mục giả. */
  applicationsDir: string;
  runner: CommandRunner;
  exists(path: string): boolean;
  /** `shell.trashItem`: Thùng rác, không xóa hẳn. */
  trashItem(path: string): Promise<void>;
  /** Pid của chính app mới, để không nhầm là app v2 đang chạy. */
  selfPid: number;
}

export interface V2Detection {
  /** Đường dẫn `2P Crew.app` trong Applications, `null` nếu không có. */
  appPath: string | null;
  bundleId: string | null;
  /** Bundle đó đúng là app v2. */
  isV2: boolean;
  running: boolean;
  /** Bundle đó chính là app mới (kéo dmg đè lên chỗ app v2). */
  isSelf: boolean;
}

export interface V2Removal {
  removed: string[];
  manual: string[];
  /** Không làm được vì app v2 còn chạy; owner thoát app rồi thử lại. */
  blocked: boolean;
}

const RUNNING_MESSAGE = 'Thoát app 2P Crew cũ (menu → Thoát) rồi bấm Thử lại';
const LOGIN_ITEM_MANUAL = 'Mở Cài đặt hệ thống → Cài đặt chung → Mục đăng nhập, tắt "2P Crew" cũ nếu còn';

export async function detectV2(deps: V2Deps): Promise<V2Detection> {
  const appPath = join(deps.applicationsDir, APP_NAME);
  if (!deps.exists(appPath))
    return { appPath: null, bundleId: null, isV2: false, running: false, isSelf: false };
  const plist = await deps.runner.run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleIdentifier',
    join(appPath, 'Contents', 'Info.plist'),
  ]);
  const bundleId = plist.code === 0 ? plist.stdout.trim() || null : null;
  const isV2 = bundleId === V2_BUNDLE_ID;
  let running = false;
  if (isV2) {
    const pgrep = await deps.runner.run('/usr/bin/pgrep', ['-f', `${appPath}/Contents/MacOS/`]);
    const pids = pgrep.code === 0 ? pgrep.stdout.split(/\s+/).filter(Boolean) : [];
    running = pids.some((pid) => Number(pid) !== deps.selfPid);
  }
  return { appPath, bundleId, isV2, running, isSelf: bundleId === APP_BUNDLE_ID };
}

/** Hành động có thể làm với những gì dò được. */
export function availableActions(found: V2Detection): V2Action[] {
  if (found.isV2) return [...ALL_ACTIONS];
  if (found.isSelf) return ['tcc'];
  return [];
}

/**
 * Làm đúng các hành động owner đã xác nhận (`actions`). Thứ tự: gỡ login item kiểu cũ, chuyển app vào Thùng rác,
 * reset quyền TCC của bundle v2. App v2 đang chạy thì không làm gì cả.
 */
export async function removeV2(deps: V2Deps, actions: readonly V2Action[]): Promise<V2Removal> {
  const found = await detectV2(deps);
  const allowed = new Set(availableActions(found).filter((action) => actions.includes(action)));
  const result: V2Removal = { removed: [], manual: [], blocked: false };
  if (!found.appPath || allowed.size === 0) return result;
  if (found.running) return { removed: [], manual: [RUNNING_MESSAGE], blocked: true };

  if (allowed.has('login-item') && found.isV2) {
    const script = `tell application "System Events" to delete (every login item whose path is "${found.appPath}")`;
    const out = await deps.runner.run('/usr/bin/osascript', ['-e', script]);
    if (out.code === 0) result.removed.push('Đã gỡ mục đăng nhập kiểu cũ của app 2P Crew cũ');
    else result.manual.push(LOGIN_ITEM_MANUAL);
  }
  if (allowed.has('trash') && found.isV2) {
    await deps.trashItem(found.appPath);
    result.removed.push('Đã chuyển app 2P Crew cũ vào Thùng rác (khôi phục được)');
  }
  if (allowed.has('tcc')) {
    const out = await deps.runner.run('/usr/bin/tccutil', ['reset', 'All', V2_BUNDLE_ID]);
    if (out.code === 0) result.removed.push('Đã xóa quyền macOS đã cấp cho app 2P Crew cũ');
    else result.manual.push(`Không xóa được quyền của app cũ (tccutil mã ${out.code})`);
  }
  // Mục đăng nhập kiểu SMAppService của bundle v2 không gỡ được từ app khác: luôn nhắc kiểm tay.
  if (
    found.isV2 &&
    (allowed.has('trash') || allowed.has('login-item')) &&
    !result.manual.includes(LOGIN_ITEM_MANUAL)
  ) {
    result.manual.push(LOGIN_ITEM_MANUAL);
  }
  return result;
}

function lines(...parts: string[][]): string {
  return parts.flat().join('\n');
}

/**
 * Bước `v2`. Không có gì để gỡ (hoặc chỉ là app mới ghi đè) thì đi tiếp. Có app v2 thì chỉ làm khi input mang
 * `confirm` (danh sách hành động owner đã tích trong UI); làm xong thì ở lại bước để hiện hướng dẫn, owner bấm
 * Tiếp thì dò lại và đi.
 */
export function createV2Step(deps: V2Deps): StepRun {
  return async (input) => {
    const found = await detectV2(deps);
    const confirm = isRecord(input) && Array.isArray(input.confirm) ? input.confirm : [];
    const actions = ALL_ACTIONS.filter((action) => confirm.includes(action));
    if (actions.length > 0 && availableActions(found).length > 0) {
      const result = await removeV2(deps, actions);
      if (result.blocked) return { ok: false, message: lines(result.manual) };
      return { ok: true, stay: true, message: lines(result.removed, result.manual) || 'Không có gì để gỡ.' };
    }
    if (found.isV2) {
      return { ok: false, message: 'Chọn việc cần làm với app 2P Crew cũ rồi bấm Gỡ.' };
    }
    return { ok: true, message: 'Không còn app 2P Crew cũ cần gỡ. Dữ liệu cũ trong máy được giữ nguyên.' };
  };
}

export interface MoveDeps {
  isPackaged: boolean;
  isInApplicationsFolder(): boolean;
  /** `app.moveToApplicationsFolder`: thành công thì app tự mở lại từ Applications. */
  moveToApplicationsFolder(options: { conflictHandler: (conflictType: string) => boolean }): boolean;
  detect(): Promise<V2Detection>;
}

/** Bước `move`: chuyển app vào Applications sau khi bước `v2` đã dọn chỗ trùng tên. */
export function createMoveStep(deps: MoveDeps): StepRun {
  return async (input) => {
    if (!deps.isPackaged) return { ok: true, message: 'Bản chạy thử chưa đóng gói, bỏ qua bước này.' };
    if (deps.isInApplicationsFolder()) return { ok: true, message: 'App đã nằm trong Applications.' };
    const found = await deps.detect();
    if (found.isV2) {
      return { ok: false, message: 'Gỡ app 2P Crew cũ ở bước trước rồi quay lại bước này.' };
    }
    if (found.appPath && !found.isSelf) {
      return {
        ok: false,
        message: `Applications đang có một "2P Crew.app" khác (${found.bundleId ?? 'không rõ bundle'}). Đổi tên hoặc gỡ nó rồi thử lại.`,
      };
    }
    if (!(isRecord(input) && input.confirm === true)) {
      return { ok: false, message: 'Bấm "Chuyển vào Applications" để xác nhận.' };
    }
    let blockedByRunning = false;
    const moved = deps.moveToApplicationsFolder({
      conflictHandler: (conflictType) => {
        if (conflictType === 'existsAndRunning') {
          blockedByRunning = true;
          return false;
        }
        return true;
      },
    });
    if (moved) return { ok: true, message: 'Đã chuyển vào Applications. App sẽ mở lại từ đó.' };
    return {
      ok: false,
      message: blockedByRunning
        ? 'Thoát bản 2P Crew đang chạy trong Applications rồi thử lại.'
        : 'Chưa chuyển được (bạn từ chối hoặc macOS không cho). Thử lại hoặc kéo app vào Applications bằng tay.',
    };
  };
}
