import { describe, expect, it, vi } from 'vitest';
import { createNotifier } from '../src/main/notifications.js';

describe('createNotifier', () => {
  it('hiện thông báo với title và body', () => {
    const show = vi.fn();
    const create = vi.fn(() => ({ show }));
    createNotifier({ isSupported: () => true, create })('2P Crew: máy có lỗi', 'Lỗi C');
    expect(create).toHaveBeenCalledWith({ title: '2P Crew: máy có lỗi', body: 'Lỗi C' });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('hệ thống không hỗ trợ thì bỏ qua, không ném', () => {
    const create = vi.fn();
    expect(() => createNotifier({ isSupported: () => false, create })('t', 'b')).not.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('lỗi khi hiện không làm hỏng vòng kiểm', () => {
    const notify = createNotifier({
      isSupported: () => true,
      create: () => {
        throw new Error('boom');
      },
    });
    expect(() => notify('t', 'b')).not.toThrow();
  });
});
