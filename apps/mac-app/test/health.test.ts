import type { CheckResult } from '@crew/mac';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHealth, HEALTH_INTERVAL_MS, worstStatus } from '../src/main/health.js';

const ok: CheckResult = { id: 'a', title: 'Mọi thứ', status: 'ok', detail: '' };
const warn: CheckResult = { id: 'b', title: 'Cảnh báo B', status: 'warn', detail: '' };
const fail1: CheckResult = { id: 'c', title: 'Lỗi C', status: 'fail', detail: '' };
const fail2: CheckResult = { id: 'd', title: 'Lỗi D', status: 'fail', detail: '' };

describe('worstStatus', () => {
  it('rỗng là ok, có warn là warn, có fail là fail', () => {
    expect(worstStatus([])).toBe('ok');
    expect(worstStatus([ok])).toBe('ok');
    expect(worstStatus([ok, warn])).toBe('warn');
    expect(worstStatus([warn, fail1, ok])).toBe('fail');
  });
});

function setup(sequence: CheckResult[][]) {
  const doctor = vi.fn(async (_opts: { probe: boolean; tccWindow: string; probeTimeoutSec: number }) => {
    return sequence.shift() ?? [];
  });
  const notify = vi.fn();
  const onResult = vi.fn();
  const health = createHealth({
    doctor,
    notify,
    onResult,
    now: () => new Date('2026-10-09T06:00:00.000Z'),
    log: () => undefined,
  });
  return { doctor, notify, onResult, health };
}

describe('lịch kiểm', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('khởi động kiểm một lần không probe rồi mỗi 15 phút', async () => {
    const { doctor, health } = setup([[ok], [ok], [ok]]);
    health.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(doctor).toHaveBeenCalledTimes(1);
    expect(doctor).toHaveBeenLastCalledWith({ probe: false, tccWindow: '24h', probeTimeoutSec: 90 });
    expect(HEALTH_INTERVAL_MS).toBe(15 * 60_000);
    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS);
    expect(doctor).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS);
    expect(doctor).toHaveBeenCalledTimes(3);
    health.stop();
    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS);
    expect(doctor).toHaveBeenCalledTimes(3);
  });

  it('run(true) gọi probe ngay', async () => {
    const { doctor, health } = setup([[ok]]);
    await health.run(true);
    expect(doctor).toHaveBeenCalledWith({ probe: true, tccWindow: '24h', probeTimeoutSec: 90 });
  });

  it('hai lần chồng nhau thì lần sau đợi, không chạy song song', async () => {
    let release: (value: CheckResult[]) => void = () => undefined;
    let running = 0;
    let maxRunning = 0;
    const doctor = vi.fn(
      () =>
        new Promise<CheckResult[]>((resolve) => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          release = (value) => {
            running -= 1;
            resolve(value);
          };
        }),
    );
    const health = createHealth({ doctor, notify: () => undefined, log: () => undefined });
    const first = health.run(false);
    const second = health.run(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(doctor).toHaveBeenCalledTimes(1);
    release([ok]);
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(doctor).toHaveBeenCalledTimes(2);
    release([ok]);
    await second;
    expect(maxRunning).toBe(1);
  });

  it('lỗi định kỳ được ghi log, không làm lịch dừng', async () => {
    const log = vi.fn();
    const doctor = vi.fn().mockRejectedValueOnce(new Error('utility chết')).mockResolvedValue([ok]);
    const health = createHealth({ doctor, notify: () => undefined, log });
    health.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledWith('warn', 'health-failed', { error: 'utility chết' });
    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS);
    expect(doctor).toHaveBeenCalledTimes(2);
    health.stop();
  });
});

describe('thông báo khi chuyển đỏ', () => {
  it('chuyển sang có fail thì báo đúng một lần, title của check fail đầu tiên', async () => {
    const { notify, health } = setup([[ok], [warn, fail1, fail2], [fail1], [fail2]]);
    await health.run(false);
    expect(notify).not.toHaveBeenCalled();
    await health.run(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith('2P Crew: máy có lỗi', 'Lỗi C');
    await health.run(false);
    await health.run(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('hết fail thì báo "máy đã ổn" một lần, rồi có fail lại thì báo lại', async () => {
    const { notify, health } = setup([[fail1], [warn], [warn], [fail2]]);
    await health.run(false);
    await health.run(false);
    expect(notify).toHaveBeenLastCalledWith('2P Crew: máy đã ổn', '');
    await health.run(false);
    expect(notify).toHaveBeenCalledTimes(2);
    await health.run(false);
    expect(notify).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenLastCalledWith('2P Crew: máy có lỗi', 'Lỗi D');
  });

  it('last() trả kết quả gần nhất với giờ ISO, onResult nhận màu', async () => {
    const { health, onResult } = setup([[warn]]);
    expect(health.last()).toBeNull();
    await health.run(false);
    expect(health.last()).toEqual({ at: '2026-10-09T06:00:00.000Z', results: [warn] });
    expect(onResult).toHaveBeenCalledWith('warn', [warn]);
  });
});
