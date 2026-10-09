import { describe, expect, it, vi } from 'vitest';
import {
  BOARD_KEY_SERVICE,
  createBoardKeyStore,
  type SecretCipher,
  type SecurityRunner,
} from '../src/main/paperclip/keychain.js';

const ORIGIN = 'https://crew.2p-solutions.com';
const KEY = 'pcp_board_khoa-gia-0123456789abcdef';

/** Mã hóa giả: đảo byte, đủ để thấy giá trị trong Keychain không phải key gốc. */
const cipher: SecretCipher = {
  encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString('utf8'),
};

function fakeSecurity() {
  const items = new Map<string, string>();
  const calls: string[][] = [];
  const run: SecurityRunner = async (args) => {
    calls.push(args);
    const service = args[args.indexOf('-s') + 1];
    const account = args[args.indexOf('-a') + 1];
    const id = `${service}|${account}`;
    if (args[0] === 'add-generic-password') {
      items.set(id, args[args.indexOf('-w') + 1] as string);
      return { code: 0, stdout: '' };
    }
    if (args[0] === 'find-generic-password') {
      const value = items.get(id);
      return value === undefined ? { code: 44, stdout: '' } : { code: 0, stdout: `${value}\n` };
    }
    if (args[0] === 'delete-generic-password') return { code: items.delete(id) ? 0 : 44, stdout: '' };
    return { code: 1, stdout: '' };
  };
  return { run: vi.fn(run), items, calls };
}

describe('board key trong Keychain', () => {
  it('service crew-mac-paperclip, account = origin; giá trị lưu là bản mã, không phải key', async () => {
    const sec = fakeSecurity();
    const store = createBoardKeyStore({ run: sec.run, cipher });
    await store.save(ORIGIN, KEY);
    expect(BOARD_KEY_SERVICE).toBe('crew-mac-paperclip');
    const add = sec.calls[0] as string[];
    expect(add.slice(0, 6)).toEqual(['add-generic-password', '-U', '-s', 'crew-mac-paperclip', '-a', ORIGIN]);
    expect(add).not.toContain('-A');
    // Key gốc không bao giờ nằm trên argv của `security` (ps thấy được).
    expect(JSON.stringify(sec.calls)).not.toContain(KEY);
    const stored = sec.items.get(`crew-mac-paperclip|${ORIGIN}`) as string;
    expect(stored.startsWith('v1:')).toBe(true);
    await expect(store.read(ORIGIN)).resolves.toBe(KEY);
    expect(sec.calls[1]).toEqual(['find-generic-password', '-s', 'crew-mac-paperclip', '-a', ORIGIN, '-w']);
  });

  it('chưa có mục (mã 44) → null', async () => {
    const store = createBoardKeyStore({ run: fakeSecurity().run, cipher });
    await expect(store.read(ORIGIN)).resolves.toBeNull();
  });

  it('mục cũ lưu key trần (không có tiền tố v1:) → null, bắt đăng nhập lại', async () => {
    const sec = fakeSecurity();
    sec.items.set(`crew-mac-paperclip|${ORIGIN}`, KEY);
    const store = createBoardKeyStore({ run: sec.run, cipher });
    await expect(store.read(ORIGIN)).resolves.toBeNull();
  });

  it('giải mã hỏng (khóa Safe Storage bị xóa hoặc owner từ chối) → null', async () => {
    const sec = fakeSecurity();
    const broken: SecretCipher = {
      encrypt: cipher.encrypt,
      decrypt: () => {
        throw new Error('Error while decrypting the ciphertext');
      },
    };
    const store = createBoardKeyStore({ run: sec.run, cipher: broken });
    await store.save(ORIGIN, KEY);
    await expect(store.read(ORIGIN)).resolves.toBeNull();
  });

  it('lỗi Keychain khác 44 thì ném, message không chứa key', async () => {
    const run: SecurityRunner = async () => ({ code: 51, stdout: '' });
    const store = createBoardKeyStore({ run, cipher });
    await expect(store.read(ORIGIN)).rejects.toThrow('mã 51');
    const error = (await store.save(ORIGIN, KEY).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('mã 51');
    expect(error.message).not.toContain(KEY);
  });

  it('remove: xóa mục; không có mục cũng không lỗi', async () => {
    const sec = fakeSecurity();
    const store = createBoardKeyStore({ run: sec.run, cipher });
    await store.save(ORIGIN, KEY);
    await store.remove(ORIGIN);
    await store.remove(ORIGIN);
    await expect(store.read(ORIGIN)).resolves.toBeNull();
    expect(sec.calls.at(-2)).toEqual(['delete-generic-password', '-s', 'crew-mac-paperclip', '-a', ORIGIN]);
  });

  it('key rỗng bị từ chối', async () => {
    const store = createBoardKeyStore({ run: fakeSecurity().run, cipher });
    await expect(store.save(ORIGIN, '')).rejects.toThrow();
  });
});
