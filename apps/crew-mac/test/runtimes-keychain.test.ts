import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  keychainHasKey,
  keychainKeyFingerprint,
  keychainKeyState,
  SECURITY_BIN,
} from '../src/runtimes/keychain.js';
import { fakeMac } from './helpers/fake-mac.js';

const KEY = 'MOC-KEY-7Q4ZK-r24';

function withSecurity(code: number) {
  const mac = fakeMac();
  mac.runner.on(SECURITY_BIN, (args) => {
    if (code !== 0) return { code, stderr: 'The specified item could not be found in the keychain.' };
    // Không -w thì security in thuộc tính của mục, không in key.
    return args.includes('-w') ? { stdout: `${KEY}\n` } : { stdout: 'keychain: "login.keychain-db"\n' };
  });
  return mac;
}

describe('Keychain key OpenCode Go', () => {
  it('service crew.opencode-go, account crew', () => {
    expect(KEYCHAIN_SERVICE).toBe('crew.opencode-go');
    expect(KEYCHAIN_ACCOUNT).toBe('crew');
  });

  it('kiểm có key mà không đọc key (không -w)', async () => {
    const mac = withSecurity(0);
    expect(await keychainHasKey(mac.ctx)).toBe(true);
    expect(mac.runner.calls.map((c) => c.args)).toEqual([
      ['find-generic-password', '-s', 'crew.opencode-go', '-a', 'crew'],
    ]);
  });

  it('mã 44 là không có key; mã lạ là không rõ', async () => {
    expect(await keychainKeyState(withSecurity(44).ctx)).toBe(false);
    expect(await keychainHasKey(withSecurity(44).ctx)).toBe(false);
    expect(await keychainKeyState(withSecurity(51).ctx)).toBeNull();
    expect(await keychainHasKey(withSecurity(51).ctx)).toBe(false);
  });

  it('fingerprint là 12 hex đầu của sha256(key), không trả key', async () => {
    const mac = withSecurity(0);
    const fp = await keychainKeyFingerprint(mac.ctx);
    expect(fp).toBe(createHash('sha256').update(KEY).digest('hex').slice(0, 12));
    expect(fp).not.toContain('MOC');
  });

  it('fingerprint khi chưa có key là null; Keychain lỗi thì ném lỗi không kèm stdout', async () => {
    expect(await keychainKeyFingerprint(withSecurity(44).ctx)).toBeNull();
    const mac = fakeMac();
    mac.runner.on(SECURITY_BIN, () => ({ code: 36, stdout: KEY }));
    await expect(keychainKeyFingerprint(mac.ctx)).rejects.toThrow(/mã 36/);
    await expect(keychainKeyFingerprint(mac.ctx)).rejects.not.toThrow(/MOC/);
  });
});
