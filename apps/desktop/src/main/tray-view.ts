import type { DaemonRuntime, HealthStatus } from '@crew/shared';

export interface TrayState {
  health: HealthStatus | null;
  runningJobs: number;
  paused: boolean;
  daemon: DaemonRuntime['state'];
  setupComplete: boolean;
}

export interface TrayActions {
  openDashboard: () => void;
  togglePause: () => void;
  runHealth: () => void;
  quit: () => void;
}

export type DotColor = 'green' | 'yellow' | 'red' | 'gray';

export const RGB: Record<DotColor, [number, number, number]> = {
  green: [0x1f, 0x84, 0x5a],
  yellow: [0xe0, 0xa1, 0x00],
  red: [0xc9, 0x37, 0x2c],
  gray: [0x8a, 0x93, 0xa3],
};

const STATUS_TEXT: Record<DotColor, string> = {
  green: 'Mọi kiểm tra đều ổn',
  yellow: 'Có cảnh báo',
  red: 'Có lỗi cần sửa',
  gray: 'Chưa cài đặt xong',
};

/** What the menu bar shows for a state: the dot color, the running-job count and the menu labels. */
export function trayView(state: TrayState) {
  const down = state.setupComplete && state.daemon !== 'running';
  const color: DotColor = !state.setupComplete ? 'gray' : down ? 'red' : (state.health ?? 'gray');
  const status = down ? 'Daemon không chạy' : STATUS_TEXT[color];
  return {
    color,
    title: state.runningJobs > 0 ? ` ${state.runningJobs}` : '',
    statusLabel: `${status}${state.paused ? ' · đang tạm dừng' : ''} · ${state.runningJobs} job đang chạy`,
    pauseLabel: state.paused ? 'Tiếp tục nhận việc' : 'Tạm dừng nhận việc',
  };
}
