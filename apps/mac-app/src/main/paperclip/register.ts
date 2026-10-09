import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { safeStorage, shell } from 'electron';
import type { AppContext } from '../app-context.js';
import { createLoginFlow } from './cli-auth.js';
import { createPaperclipClient } from './client.js';
import {
  type BoardKeyStore,
  createBoardKeyStore,
  type SecretCipher,
  type SecurityRunner,
} from './keychain.js';
import type { PaperclipClient } from './types.js';

/** `/usr/bin/security`; lỗi chỉ trả mã thoát (message của execFile chứa argv, không đưa ra ngoài). */
const runSecurity: SecurityRunner = (args) =>
  new Promise((resolve) => {
    execFile('/usr/bin/security', args, { timeout: 15_000, encoding: 'utf8' }, (error, stdout) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout: stdout ?? '' });
    });
  });

/** Khóa mã hóa nằm ở mục Keychain "2P Crew Safe Storage", ACL chỉ tin bản ký của app. */
const electronCipher: SecretCipher = {
  encrypt(plain) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('macOS chưa cho 2P Crew dùng Keychain để mã hóa');
    return safeStorage.encryptString(plain);
  },
  decrypt(data) {
    return safeStorage.decryptString(data);
  },
};

/** Board key theo origin. Chỉ dùng sau `app.whenReady()`. */
export const boardKeys: BoardKeyStore = createBoardKeyStore({ run: runSecurity, cipher: electronCipher });

/**
 * Client cho Paperclip đã đăng nhập (origin trong `app.json`). Key đọc lại từ Keychain cho mỗi request.
 * Ném "Chưa đăng nhập Paperclip" khi chưa có origin; key thiếu/hết hạn thành `PaperclipAuthError`.
 */
export function paperclipClient(ctx: AppContext): PaperclipClient {
  const origin = ctx.store.get().setup.paperclipOrigin;
  if (!origin) throw new Error('Chưa đăng nhập Paperclip');
  return createPaperclipClient(origin, {
    fetch: globalThis.fetch,
    readKey: () => boardKeys.read(origin),
    log: (event, fields) => ctx.log('debug', event, fields),
  });
}

/** Kênh `paperclip:*` (Interface I5): đăng nhập `cli-auth`, trạng thái chờ duyệt, danh sách company. */
export function registerPaperclip(ctx: AppContext): void {
  const flow = createLoginFlow({
    fetch: globalThis.fetch,
    hostname: hostname(),
    saveKey: (origin, key) => boardKeys.save(origin, key),
    onApproved: async (origin) => {
      await ctx.store.update((state) => ({
        ...state,
        setup: {
          ...state.setup,
          paperclipOrigin: origin,
          companyId: state.setup.paperclipOrigin === origin ? state.setup.companyId : null,
        },
      }));
    },
    log: (event, fields) => ctx.log('info', event, fields),
  });

  ctx.ipc.handle('paperclip:login', async (origin) => {
    const { approvalUrl } = await flow.start(origin);
    await shell.openExternal(approvalUrl);
    return { approvalUrl };
  });
  ctx.ipc.handle('paperclip:loginStatus', () => flow.poll());
  ctx.ipc.handle('paperclip:companies', async () =>
    (await paperclipClient(ctx).companies()).map(({ id, name }) => ({ id, name })),
  );
}
