import { isAbsolute, join, resolve } from 'node:path';

export const SSHD_LABEL = 'com.2p.crew-mac-sshd';
export const REAPER_LABEL = 'com.2p.crew-mac-reaper';
export const SPIKE_LABEL = 'com.2p.crew-spike-sshd';
export const PAPERCLIP_KEY_COMMENT = 'crew-mac-paperclip';
export const DOCTOR_KEY_COMMENT = 'crew-mac-doctor';
export const SPIKE_KEY_COMMENT = 'crew-v3-spike-paperclip';
export const DEFAULT_PORT = 2222;
export const TAILSCALE_CANDIDATES = [
  'tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
] as const;

export function macPaths(home: string) {
  const root = join(home, '.crew-mac');
  const agents = join(home, 'Library', 'LaunchAgents');
  return {
    root,
    manifest: join(root, 'manifest.json'),
    sshdDir: join(root, 'sshd'),
    sshdConfig: join(root, 'sshd', 'sshd_config'),
    hostKey: join(root, 'sshd', 'host_ed25519'),
    sshdPid: join(root, 'sshd', 'sshd.pid'),
    sshdLog: join(root, 'sshd', 'sshd.log'),
    doctorKey: join(root, 'doctor_ed25519'),
    knownHosts: join(root, 'known_hosts'),
    reaperDir: join(root, 'reaper'),
    reaperState: join(root, 'reaper', 'state.json'),
    reaperLog: join(root, 'reaper', 'reaper.log'),
    sshdPlist: join(agents, `${SSHD_LABEL}.plist`),
    reaperPlist: join(agents, `${REAPER_LABEL}.plist`),
    spikePlist: join(agents, `${SPIKE_LABEL}.plist`),
    spikeDir: join(home, '.crew-spike-sshd'),
    authorizedKeys: join(home, '.ssh', 'authorized_keys'),
    zshenv: join(home, '.zshenv'),
    /** Dùng chung thư mục ~/.crew với crewd v2: chỉ được đụng tới bin/crew-claude-run. */
    crewBin: join(home, '.crew', 'bin'),
    wrapper: join(home, '.crew', 'bin', 'crew-claude-run'),
    defaultWorktreeRoot: join(home, 'crew-agents'),
  };
}

export type MacPaths = ReturnType<typeof macPaths>;

/** Lý do không được đặt worktree ở `root`, hoặc null nếu được. */
export function forbiddenRootReason(home: string, root: string): string | null {
  if (!isAbsolute(root)) return 'thư mục gốc worktree phải là đường dẫn tuyệt đối';
  const abs = resolve(root);
  const under = (base: string) => abs === base || abs.startsWith(`${base}/`);
  if (under('/Volumes')) return 'không đặt dưới /Volumes: macOS hỏi quyền ổ ngoài và agent treo im lặng';
  if (under(join(home, 'Desktop'))) return 'không đặt dưới ~/Desktop: thư mục được macOS bảo vệ (TCC)';
  if (under(join(home, 'Downloads'))) return 'không đặt dưới ~/Downloads: thư mục được macOS bảo vệ (TCC)';
  return null;
}
