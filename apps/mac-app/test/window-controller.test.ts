import { describe, expect, it, vi } from 'vitest';
import { type ControlledWindow, createWindowController, sendIfAlive } from '../src/main/window-controller.js';

class FakeWindow implements ControlledWindow {
  destroyed = false;
  contentsDestroyed = false;
  minimized = false;
  calls: string[] = [];
  sent: string[] = [];
  closedListener: (() => void) | undefined;
  webContents = {
    isDestroyed: () => this.contentsDestroyed,
    send: (channel: string) => {
      if (this.contentsDestroyed) throw new Error('Object has been destroyed');
      this.sent.push(channel);
    },
  };
  isDestroyed = () => this.destroyed;
  isMinimized = () => this.minimized;
  restore = () => this.calls.push('restore');
  show = () => this.calls.push('show');
  focus = () => this.calls.push('focus');
  once(_event: 'closed', listener: () => void) {
    this.closedListener = listener;
  }
  /** Người dùng đóng cửa sổ: Electron bắn `closed` rồi webContents bị hủy. */
  userClose() {
    this.destroyed = true;
    this.contentsDestroyed = true;
    this.closedListener?.();
  }
}

function win(windows: FakeWindow[], index: number): FakeWindow {
  const found = windows[index];
  if (!found) throw new Error(`thiếu cửa sổ ${index}`);
  return found;
}

function setup() {
  const windows: FakeWindow[] = [];
  const log = vi.fn();
  const dock = { show: vi.fn(), hide: vi.fn() };
  const controller = createWindowController({
    create: () => {
      const win = new FakeWindow();
      windows.push(win);
      return win;
    },
    log,
    dock,
  });
  return { windows, log, dock, controller };
}

describe('createWindowController', () => {
  it('lần đầu tạo cửa sổ và hiện biểu tượng Dock', () => {
    const { windows, controller, dock } = setup();
    controller.show('startup');
    expect(windows).toHaveLength(1);
    expect(dock.show).toHaveBeenCalledTimes(1);
  });

  it('cửa sổ còn sống thì chỉ đưa lên trước, khôi phục nếu đang thu nhỏ', () => {
    const { windows, controller } = setup();
    controller.show('startup');
    win(windows, 0).minimized = true;
    controller.show('tray');
    expect(windows).toHaveLength(1);
    expect(win(windows, 0).calls).toEqual(['restore', 'show', 'focus']);
  });

  it('ghi mỗi lần mở cùng nguồn gọi ở mức info', () => {
    const { controller, log } = setup();
    controller.show('tray');
    controller.show('second-instance');
    controller.activate(false);
    expect(log).toHaveBeenCalledWith('info', 'window-show', { trigger: 'tray', recreate: true });
    expect(log).toHaveBeenCalledWith('info', 'window-show', { trigger: 'second-instance', recreate: false });
    expect(log).toHaveBeenCalledWith('info', 'window-activate', { hasVisibleWindows: false });
    expect(log).toHaveBeenCalledWith('info', 'window-show', { trigger: 'activate', recreate: false });
  });

  it('đóng cửa sổ thì bỏ tham chiếu, ẩn Dock và không gửi vào đối tượng đã hủy', () => {
    const { windows, controller, dock } = setup();
    controller.show('startup');
    win(windows, 0).userClose();
    expect(dock.hide).toHaveBeenCalledTimes(1);
    expect(() => controller.send('state:changed')).not.toThrow();
    expect(win(windows, 0).sent).toEqual([]);
  });

  it('mở lại từ tray sau khi đóng thì tạo cửa sổ mới', () => {
    const { windows, controller, dock } = setup();
    controller.show('startup');
    win(windows, 0).userClose();
    controller.show('tray');
    expect(windows).toHaveLength(2);
    expect(dock.show).toHaveBeenCalledTimes(2);
    controller.send('state:changed');
    expect(win(windows, 1).sent).toEqual(['state:changed']);
  });

  it('sự kiện closed của cửa sổ cũ không xóa tham chiếu cửa sổ mới', () => {
    const { windows, controller, dock } = setup();
    controller.show('startup');
    win(windows, 0).destroyed = true; // bị hủy mà chưa kịp bắn closed
    controller.show('activate');
    expect(windows).toHaveLength(2);
    win(windows, 0).closedListener?.();
    expect(dock.hide).not.toHaveBeenCalled();
    controller.send('state:changed');
    expect(win(windows, 1).sent).toEqual(['state:changed']);
  });

  it('chạy được khi không có Dock (không phải macOS)', () => {
    const win = new FakeWindow();
    const controller = createWindowController({ create: () => win, log: vi.fn() });
    controller.show('startup');
    win.userClose();
    expect(() => controller.show('tray')).not.toThrow();
  });
});

describe('sendIfAlive', () => {
  it('bỏ qua null, cửa sổ đã hủy và webContents đã hủy', () => {
    const win = new FakeWindow();
    sendIfAlive(null, 'x');
    win.contentsDestroyed = true;
    expect(() => sendIfAlive(win, 'x')).not.toThrow();
    win.contentsDestroyed = false;
    win.destroyed = true;
    sendIfAlive(win, 'x');
    expect(win.sent).toEqual([]);
  });

  it('gửi khi còn sống', () => {
    const win = new FakeWindow();
    sendIfAlive(win, 'x');
    expect(win.sent).toEqual(['x']);
  });
});
