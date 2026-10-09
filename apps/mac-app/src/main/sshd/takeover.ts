export interface ListenerProc {
  pid: number;
  /** `ps -o comm=`; sshd đổi tiêu đề nên có thể là `sshd: /usr/sbin/` hay `sshd-session: …`. */
  comm: string;
  /** `ps -o command=`. */
  command: string;
}
export type TakeoverPlan = { kind: 'spawn' } | { kind: 'replace'; pid: number };

const SSHD_BINARY = '/usr/sbin/sshd';
/** Listener OpenSSH đổi tiêu đề thành `sshd: /usr/sbin/sshd -D -f … [listener] 0 of 10-100 startups`. */
const RETITLE_PREFIX = 'sshd: ';

/**
 * Process là listener sshd của đúng file cấu hình crew-mac: binary `/usr/sbin/sshd` (argv gốc hay tiêu đề đã đổi)
 * và argv có `-f <sshdConfig>` khớp nguyên token. Mọi `sshd-session` (phiên của run) đều không phải.
 */
export function isCrewSshdListener(
  proc: Pick<ListenerProc, 'comm' | 'command'>,
  sshdConfig: string,
): boolean {
  if (proc.comm.includes('sshd-session') || proc.command.includes('sshd-session')) return false;
  const command = proc.command.startsWith(RETITLE_PREFIX)
    ? proc.command.slice(RETITLE_PREFIX.length)
    : proc.command;
  const argv = command.trim().split(/\s+/);
  if (argv[0] !== SSHD_BINARY) return false;
  const fIndex = argv.indexOf('-f');
  return fIndex >= 0 && argv[fIndex + 1] === sshdConfig;
}

/** Chỉ thay listener do crew-mac cấu hình; không bao giờ chọn sshd-session hay process khác. */
export function planListenerTakeover(input: {
  pidFromFile: number | null;
  proc: ListenerProc | null;
  sshdConfig: string;
}): TakeoverPlan {
  const { pidFromFile, proc, sshdConfig } = input;
  if (pidFromFile === null || proc === null || proc.pid !== pidFromFile) return { kind: 'spawn' };
  if (isCrewSshdListener(proc, sshdConfig)) return { kind: 'replace', pid: proc.pid };
  return { kind: 'spawn' };
}
