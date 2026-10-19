export interface SshdSpec {
  port: number;
  listenAddress: string;
  hostKey: string;
  pidFile: string;
  authorizedKeysFile: string;
  user: string;
}

export function renderSshdConfig(spec: SshdSpec): string {
  return [
    '# Quản lý bởi crew-mac. Sửa bằng "crew-mac setup", không sửa tay.',
    `Port ${spec.port}`,
    `ListenAddress ${spec.listenAddress}`,
    `HostKey ${spec.hostKey}`,
    `PidFile ${spec.pidFile}`,
    `AuthorizedKeysFile ${spec.authorizedKeysFile}`,
    'PubkeyAuthentication yes',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'UsePAM no',
    'StrictModes yes',
    'PermitRootLogin no',
    `AllowUsers ${spec.user}`,
    // Mất mạng thì sshd-session thoát sau khoảng 30 giây; reaper nhận ra process mồ côi từ đó.
    'ClientAliveInterval 15',
    'ClientAliveCountMax 2',
    '',
  ].join('\n');
}
