import { isCrewListener } from '@crew/mac';

export interface ListenerProc {
  pid: number;
  /** `ps -o comm=`; sshd đổi tiêu đề nên có thể là `sshd: /usr/sbin/` hay `sshd-session: …`. */
  comm: string;
  /** `ps -o command=`. */
  command: string;
}
export type TakeoverPlan = { kind: 'spawn' } | { kind: 'replace'; pid: number };

/** Chỉ thay listener do crew-mac cấu hình; không bao giờ chọn sshd-session hay process khác. */
export function planListenerTakeover(input: {
  pidFromFile: number | null;
  proc: ListenerProc | null;
  sshdConfig: string;
}): TakeoverPlan {
  const { pidFromFile, proc, sshdConfig } = input;
  if (pidFromFile === null || proc === null || proc.pid !== pidFromFile) return { kind: 'spawn' };
  if (isCrewListener(proc.command, sshdConfig)) return { kind: 'replace', pid: proc.pid };
  return { kind: 'spawn' };
}
