/**
 * Board API key trong Keychain, chỉ app đọc được.
 *
 * Agent Paperclip chạy cùng user macOS với app, nên mục Keychain tạo bằng `security add-generic-password` (ACL tin
 * `/usr/bin/security`) thì agent đọc được bằng `security find-generic-password -w` mà không có hộp thoại. Vì vậy key
 * được mã hóa bằng `safeStorage` của Electron trước khi vào mục `crew-mac-paperclip`: khóa giải mã nằm ở mục
 * "2P Crew Safe Storage" do chính process app tạo, ACL chỉ tin app (theo designated requirement của bản ký) và
 * partition của team. Process khác đọc mục `crew-mac-paperclip` chỉ thấy bản mã; đọc mục Safe Storage thì macOS
 * bật hộp thoại xin quyền. Key gốc không bao giờ nằm trên argv của `security`.
 */

export const BOARD_KEY_SERVICE = 'crew-mac-paperclip';
const FORMAT = 'v1:';
const NOT_FOUND = 44;

export interface SecurityResult {
  code: number;
  stdout: string;
}

/** Chạy `/usr/bin/security <args>`. */
export type SecurityRunner = (args: string[]) => Promise<SecurityResult>;

/** Mã hóa gắn với danh tính ký của app (Electron `safeStorage`). */
export interface SecretCipher {
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export interface BoardKeyStore {
  /** `null` khi chưa đăng nhập, mục cũ không mã hóa, hoặc không giải mã được (cần đăng nhập lại). */
  read(origin: string): Promise<string | null>;
  save(origin: string, key: string): Promise<void>;
  remove(origin: string): Promise<void>;
}

export function createBoardKeyStore(deps: { run: SecurityRunner; cipher: SecretCipher }): BoardKeyStore {
  return {
    async read(origin) {
      const found = await deps.run(['find-generic-password', '-s', BOARD_KEY_SERVICE, '-a', origin, '-w']);
      if (found.code === NOT_FOUND) return null;
      if (found.code !== 0) throw new Error(`Không đọc được Keychain (mã ${found.code})`);
      const stored = found.stdout.trim();
      // Mục không đúng định dạng (vd. key trần do cách lưu cũ): không dùng, bắt đăng nhập lại.
      if (!stored.startsWith(FORMAT)) return null;
      try {
        const key = deps.cipher.decrypt(Buffer.from(stored.slice(FORMAT.length), 'base64'));
        return key || null;
      } catch {
        return null;
      }
    },

    async save(origin, key) {
      if (!key) throw new Error('Board key rỗng');
      const sealed = `${FORMAT}${deps.cipher.encrypt(key).toString('base64')}`;
      const added = await deps.run([
        'add-generic-password',
        '-U',
        '-s',
        BOARD_KEY_SERVICE,
        '-a',
        origin,
        '-w',
        sealed,
      ]);
      if (added.code !== 0) throw new Error(`Không lưu được vào Keychain (mã ${added.code})`);
    },

    async remove(origin) {
      const removed = await deps.run(['delete-generic-password', '-s', BOARD_KEY_SERVICE, '-a', origin]);
      if (removed.code !== 0 && removed.code !== NOT_FOUND) {
        throw new Error(`Không xóa được mục Keychain (mã ${removed.code})`);
      }
    },
  };
}
