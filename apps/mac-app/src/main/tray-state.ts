export type DotColor = 'gray' | 'green' | 'yellow' | 'red';

export interface TrayState {
  color: DotColor;
  /** Số run đang chạy; `null` khi chưa biết. */
  runs: number | null;
  /** Quit guard đang chờ các run xong để thoát. */
  waiting: boolean;
}

export const INITIAL_TRAY_STATE: TrayState = { color: 'gray', runs: null, waiting: false };

/** Mỗi nguồn (sức khỏe, đếm run, quit guard) chỉ cập nhật phần của mình. */
export function mergeTrayState(current: TrayState | undefined, patch: Partial<TrayState>): TrayState {
  return { ...(current ?? INITIAL_TRAY_STATE), ...patch };
}

/** Đang chờ run thì chấm vàng, trừ khi máy đang lỗi. */
export function effectiveColor(state: TrayState): DotColor {
  return state.waiting && state.color !== 'red' ? 'yellow' : state.color;
}

export function trayStatusLabel(state: TrayState): string {
  if (state.waiting)
    return `2P Crew · ${state.runs === null ? 'Đang chờ run' : `Đang chờ ${state.runs} run`}`;
  return `2P Crew · ${state.runs === null ? 'chưa rõ số run' : `${state.runs} run đang chạy`}`;
}
