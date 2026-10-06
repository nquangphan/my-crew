import { describe, expect, it } from 'vitest';
import { hasKeyComment, parsePublicKey, removeKeysByComment, upsertKey } from '../src/authorized-keys.js';
import { SetupError } from '../src/context.js';

const PAPERCLIP =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 paperclip@vps';
const OWNER = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOwnerMacBookKey0000000000000000000000000 owner@macbook';

describe('authorized_keys', () => {
  it('đọc type và body, bỏ comment gốc', () => {
    expect(parsePublicKey(PAPERCLIP)).toEqual({
      type: 'ssh-ed25519',
      body: 'AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000',
    });
  });

  it('từ chối thứ không phải public key', () => {
    expect(() => parsePublicKey('đây không phải public key')).toThrow(SetupError);
    expect(() => parsePublicKey('ssh-dss AAAAB3NzaC1kc3M')).toThrow(SetupError);
    expect(() => parsePublicKey('ssh-ed25519')).toThrow(SetupError);
  });

  it('thêm key với comment nhận diện, giữ key của owner, chạy lại không nhân đôi', () => {
    const once = upsertKey(`${OWNER}\n`, PAPERCLIP, 'crew-mac-paperclip');
    expect(once).toBe(
      `${OWNER}\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 crew-mac-paperclip\n`,
    );
    expect(upsertKey(once, PAPERCLIP, 'crew-mac-paperclip')).toBe(once);
    expect(hasKeyComment(once, 'crew-mac-paperclip')).toBe(true);
  });

  it('thay dòng cũ có cùng body nhưng comment khác (key spike)', () => {
    const spike =
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 crew-v3-spike-paperclip';
    const next = upsertKey(`${spike}\n`, PAPERCLIP, 'crew-mac-paperclip');
    expect(next).not.toContain('crew-v3-spike-paperclip');
    expect(next.trim().split('\n')).toHaveLength(1);
  });

  it('ghi options trước key', () => {
    const next = upsertKey('', PAPERCLIP, 'crew-mac-doctor', 'from="100.64.0.0/10",no-port-forwarding');
    expect(next).toBe(
      'from="100.64.0.0/10",no-port-forwarding ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPaperclipTestKey000000000000000000000000 crew-mac-doctor\n',
    );
  });

  it('gỡ theo comment, giữ dòng khác', () => {
    const text = upsertKey(`${OWNER}\n`, PAPERCLIP, 'crew-mac-paperclip');
    expect(removeKeysByComment(text, 'crew-mac-paperclip')).toBe(`${OWNER}\n`);
  });
});
