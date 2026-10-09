import { closeSync, openSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StepOutcome } from './types.js';

/** Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Truy cập toàn bộ ổ đĩa. */
export const FULL_DISK_ACCESS_PANE =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

export type FullDiskAccessState = 'granted' | 'denied' | 'unknown' | 'unsupported';

/** Một lần đọc chỉ Full Disk Access mới mở được; không có quyền thì macOS trả EPERM ngay, không hiện hộp thoại. */
export type Probe = () => void;

/** Hai nơi có trên mọi Mac và không bao giờ nằm trong hộp thoại xin quyền theo thư mục. */
export function defaultProbes(home: string): Probe[] {
  return [
    () => void readdirSync(join(home, 'Library', 'Safari')),
    () => closeSync(openSync(join(home, 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db'), 'r')),
  ];
}

/** Đọc được một nơi: `granted`. Bị từ chối (EPERM/EACCES) và không nơi nào đọc được: `denied`. Còn lại `unknown`. */
export function detectFullDiskAccess(
  probes: readonly Probe[],
  platform: NodeJS.Platform = process.platform,
): FullDiskAccessState {
  if (platform !== 'darwin') return 'unsupported';
  let denied = false;
  for (const probe of probes) {
    try {
      probe();
      return 'granted';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') denied = true;
    }
  }
  return denied ? 'denied' : 'unknown';
}

const MESSAGES: Record<FullDiskAccessState, string> = {
  granted: 'Đã cấp quyền ổ đĩa cho 2P Crew.',
  denied:
    'Chưa cấp quyền ổ đĩa cho 2P Crew. Chưa cấp thì lần đầu agent đụng thư mục được bảo vệ, macOS hỏi trên màn hình và run treo cho tới khi có người bấm. Bật 2P Crew trong Cài đặt hệ thống rồi bấm Kiểm tra lại; nếu đã bật mà vẫn báo chưa cấp, thoát và mở lại 2P Crew.',
  unknown: 'Chưa xác định được quyền ổ đĩa (không đọc được nơi dùng để dò). Kiểm tra trong Cài đặt hệ thống.',
  unsupported: 'Máy này không phải macOS nên bỏ qua quyền ổ đĩa.',
};

/**
 * Kết quả hiển thị cho một trạng thái. Bấm "Tiếp" thì `denied` và `unknown` vẫn cho đi tiếp (doctor ở bước cuối sẽ
 * nhắc lại). `recheck` (mở bước, cửa sổ focus lại) chỉ dò: `ok` = đã cấp, không đi tiếp.
 */
export function diskAccessOutcome(state: FullDiskAccessState, recheck = false): StepOutcome {
  if (recheck) return { ok: state === 'granted', message: MESSAGES[state], state, stay: true };
  return { ok: true, message: MESSAGES[state], state };
}
