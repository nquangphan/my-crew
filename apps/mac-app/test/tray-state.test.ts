import { describe, expect, it } from 'vitest';
import { effectiveColor, mergeTrayState, trayStatusLabel } from '../src/main/tray-state.js';

describe('tray-state', () => {
  it('mặc định xám, chưa rõ số run', () => {
    expect(trayStatusLabel(mergeTrayState(undefined, {}))).toBe('2P Crew · chưa rõ số run');
  });

  it('hiện số run đang chạy', () => {
    expect(trayStatusLabel({ color: 'green', runs: 3, waiting: false })).toBe('2P Crew · 3 run đang chạy');
  });

  it('khi quit guard đang chờ hiện "Đang chờ N run"', () => {
    expect(trayStatusLabel({ color: 'yellow', runs: 2, waiting: true })).toBe('2P Crew · Đang chờ 2 run');
    expect(trayStatusLabel({ color: 'yellow', runs: null, waiting: true })).toBe('2P Crew · Đang chờ run');
  });

  it('cập nhật từng phần không ghi đè phần khác', () => {
    const waiting = mergeTrayState(undefined, { color: 'yellow', runs: 2, waiting: true });
    const refreshed = mergeTrayState(waiting, { color: 'green', runs: 1 });
    expect(refreshed).toEqual({ color: 'green', runs: 1, waiting: true });
    expect(mergeTrayState(refreshed, { waiting: false }).waiting).toBe(false);
  });

  it('đang chờ thì chấm vàng, trừ khi máy đỏ', () => {
    expect(effectiveColor({ color: 'green', runs: 1, waiting: true })).toBe('yellow');
    expect(effectiveColor({ color: 'red', runs: 1, waiting: true })).toBe('red');
    expect(effectiveColor({ color: 'green', runs: 1, waiting: false })).toBe('green');
  });
});
