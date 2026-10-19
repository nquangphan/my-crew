import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeIfChanged } from '../src/fs-util.js';
import { readManifest, writeManifest } from '../src/manifest.js';
import { forbiddenRootReason, macPaths } from '../src/paths.js';
import { renderPlist } from '../src/plist.js';
import { renderSshdConfig } from '../src/sshd-config.js';

describe('forbiddenRootReason', () => {
  const home = '/Users/owner';
  it.each([
    ['/Volumes/CORSAIR/agents', 'Volumes'],
    ['/Users/owner/Desktop/agents', 'Desktop'],
    ['/Users/owner/Downloads', 'Downloads'],
    ['relative/path', 'tuyệt đối'],
    ['/Users/owner', 'HOME'],
    ['/users/OWNER', 'HOME'],
    ['/Users', 'HOME'],
    ['/', 'HOME'],
  ])('từ chối %s', (root, word) => {
    expect(forbiddenRootReason(home, root)).toContain(word);
  });

  it.each(['/Users/owner/crew-agents', '/Users/Shared/crew-agents', '/Users/owner/Desktopish'])(
    'cho phép %s',
    (root) => {
      expect(forbiddenRootReason(home, root)).toBeNull();
    },
  );

  it('không lách được bằng chữ hoa thường (APFS không phân biệt)', () => {
    expect(forbiddenRootReason(home, '/volumes/corsair/agents')).toContain('Volumes');
    expect(forbiddenRootReason(home, '/Users/owner/desktop/agents')).toContain('Desktop');
    expect(forbiddenRootReason(home, '/Users/owner/DOWNLOADS')).toContain('Downloads');
  });

  it('không lách được bằng symlink trỏ vào vùng bị cấm', () => {
    const realHome = mkdtempSync(join(tmpdir(), 'crew-mac-home-'));
    mkdirSync(join(realHome, 'Desktop', 'agents'), { recursive: true });
    symlinkSync(join(realHome, 'Desktop', 'agents'), join(realHome, 'crew-agents'));
    expect(forbiddenRootReason(realHome, join(realHome, 'crew-agents'))).toContain('Desktop');
    expect(forbiddenRootReason(realHome, join(realHome, 'crew-agents', 'chua-co'))).toContain('Desktop');
    expect(forbiddenRootReason(realHome, join(realHome, 'that-su-an-toan'))).toBeNull();
  });
});

describe('renderSshdConfig', () => {
  it('chỉ nghe IP Tailscale, chỉ key, chỉ user này, phát hiện mất mạng sau khoảng 30 giây', () => {
    const text = renderSshdConfig({
      port: 2222,
      listenAddress: '100.102.189.67',
      hostKey: '/h/.crew-mac/sshd/host_ed25519',
      pidFile: '/h/.crew-mac/sshd/sshd.pid',
      authorizedKeysFile: '/h/.ssh/authorized_keys',
      user: 'owner',
    });
    expect(text.split('\n')).toEqual([
      '# Quản lý bởi crew-mac. Sửa bằng "crew-mac setup", không sửa tay.',
      'Port 2222',
      'ListenAddress 100.102.189.67',
      'HostKey /h/.crew-mac/sshd/host_ed25519',
      'PidFile /h/.crew-mac/sshd/sshd.pid',
      'AuthorizedKeysFile /h/.ssh/authorized_keys',
      'PubkeyAuthentication yes',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'UsePAM no',
      'StrictModes yes',
      'PermitRootLogin no',
      'AllowUsers owner',
      'ClientAliveInterval 15',
      'ClientAliveCountMax 2',
      '',
    ]);
  });
});

describe('renderPlist', () => {
  const xml = renderPlist({
    label: 'com.2p.crew-mac-sshd',
    programArguments: ['/usr/sbin/sshd', '-D', '-f', '/h/a&b/sshd_config'],
    keepAlive: true,
    aquaOnly: true,
    processType: 'Interactive',
  });

  it('có label, escape ký tự XML, giới hạn phiên Aqua', () => {
    expect(xml).toContain('<key>Label</key><string>com.2p.crew-mac-sshd</string>');
    expect(xml).toContain('<string>/h/a&amp;b/sshd_config</string>');
    expect(xml).toContain('<key>LimitLoadToSessionType</key><string>Aqua</string>');
    expect(xml).toContain('<key>KeepAlive</key><true/>');
    expect(xml).not.toContain('StartInterval');
  });

  it.runIf(process.platform === 'darwin')('plutil chấp nhận', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'crew-mac-plist-')), 'a.plist');
    writeFileSync(file, xml);
    expect(spawnSync('/usr/bin/plutil', ['-lint', file]).status).toBe(0);
  });
});

describe('writeIfChanged và manifest', () => {
  it('chỉ ghi khi nội dung đổi, đúng mode', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'crew-mac-fs-')), 'sub', 'x.txt');
    expect(writeIfChanged(file, 'a\n', 0o600)).toBe(true);
    expect(writeIfChanged(file, 'a\n', 0o600)).toBe(false);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(writeIfChanged(file, 'b\n', 0o600)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('b\n');
  });

  it('file của crew-mac bị đổi mode thì đặt lại dù nội dung không đổi', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'crew-mac-fs-')), 'wrapper');
    writeFileSync(file, 'a\n', { mode: 0o644 });
    expect(writeIfChanged(file, 'a\n', 0o755)).toBe(false);
    expect(statSync(file).mode & 0o777).toBe(0o755);
  });

  it('file có sẵn của owner giữ mode cũ, cả khi nội dung không đổi lẫn khi ghi lại', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'crew-mac-fs-')), 'zshenv');
    writeFileSync(file, 'a\n', { mode: 0o600 });
    expect(writeIfChanged(file, 'a\n', 0o644, { keepExistingMode: true })).toBe(false);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(writeIfChanged(file, 'b\n', 0o644, { keepExistingMode: true })).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toBe('b\n');
  });

  it('file chưa có thì tạo với mode yêu cầu, kể cả khi keepExistingMode', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'crew-mac-fs-')), 'moi');
    expect(writeIfChanged(file, 'a\n', 0o644, { keepExistingMode: true })).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o644);
  });

  it('đường dẫn là symlink thì ghi vào file đích, symlink giữ nguyên', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-mac-fs-'));
    const target = join(dir, 'dotfiles', 'zshenv');
    mkdirSync(join(dir, 'dotfiles'));
    writeFileSync(target, 'a\n', { mode: 0o600 });
    const link = join(dir, '.zshenv');
    symlinkSync(target, link);
    expect(writeIfChanged(link, 'b\n', 0o644, { keepExistingMode: true })).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('b\n');
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('đọc lại manifest đã ghi', () => {
    const paths = macPaths(mkdtempSync(join(tmpdir(), 'crew-mac-home-')));
    expect(readManifest(paths.manifest)).toBeNull();
    const manifest = {
      version: 1 as const,
      port: 2222,
      listenAddress: '100.102.189.67',
      worktreeRoot: '/Users/owner/crew-agents',
      paperclipKey: 'ssh-ed25519 AAAA',
      installedAt: '2026-10-06T07:00:00.000Z',
    };
    writeManifest(paths.manifest, manifest);
    expect(readManifest(paths.manifest)).toEqual(manifest);
  });
});
