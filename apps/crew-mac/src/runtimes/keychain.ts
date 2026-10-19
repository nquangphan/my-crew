import { createHash } from 'node:crypto';
import type { MacContext } from '../context.js';

/**
 * Key OpenCode Go nằm trong login Keychain của owner. `crew-opencode-run` đọc bằng
 * `security find-generic-password -s crew.opencode-go -a crew -w` ngay trước khi chạy opencode; crew-mac chỉ kiểm có
 * hay không (không `-w`) và tính fingerprint, không bao giờ in, ghi file hay truyền key qua argv.
 */
export const KEYCHAIN_SERVICE = 'crew.opencode-go';
export const KEYCHAIN_ACCOUNT = 'crew';
export const SECURITY_BIN = '/usr/bin/security';
/** `errSecItemNotFound`: security thoát 44 khi không có mục. */
const NOT_FOUND = 44;
const TIMEOUT_MS = 15_000;

const ITEM = ['-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT] as const;

/** Lệnh lưu key: `-w` đứng cuối không giá trị nên security tự hỏi key (gõ ẩn, hai lần) trên Terminal. */
export const SAVE_KEY_ARGS: readonly string[] = ['add-generic-password', '-U', ...ITEM, '-w'];

/** true có key, false không có, null khi Keychain báo lỗi khác (vd. đang khóa). */
export async function keychainKeyState(ctx: MacContext): Promise<boolean | null> {
  const result = await ctx.runner.run(SECURITY_BIN, ['find-generic-password', ...ITEM], {
    timeoutMs: TIMEOUT_MS,
  });
  if (result.code === 0) return true;
  if (result.code === NOT_FOUND) return false;
  return null;
}

export async function keychainHasKey(ctx: MacContext): Promise<boolean> {
  return (await keychainKeyState(ctx)) === true;
}

/**
 * 12 hex đầu của sha256(key) để owner so key giữa hai lần kiểm; null khi chưa có key. Key chỉ ở trong bộ nhớ của
 * process này; lỗi ném ra không kèm đầu ra của security.
 */
export async function keychainKeyFingerprint(ctx: MacContext): Promise<string | null> {
  const result = await ctx.runner.run(SECURITY_BIN, ['find-generic-password', ...ITEM, '-w'], {
    timeoutMs: TIMEOUT_MS,
  });
  if (result.code === NOT_FOUND) return null;
  if (result.code !== 0) throw new Error(`Không đọc được Keychain (mã ${result.code})`);
  const key = result.stdout.replace(/\r?\n$/, '');
  if (key === '') return null;
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}
