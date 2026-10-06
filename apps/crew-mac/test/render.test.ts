import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  ])('từ chối %s', (root, word) => {
    expect(forbiddenRootReason(home, root)).toContain(word);
  });

  it.each(['/Users/owner/crew-agents', '/Users/Shared/crew-agents', '/Users/owner/Desktopish'])(
    'cho phép %s',
    (root) => {
      expect(forbiddenRootReason(home, root)).toBeNull();
    },
  );
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
