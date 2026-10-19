/** Nguồn gọi mở cửa sổ; ghi vào `app.log` để biết ai làm cửa sổ hiện lên. */
export type ShowTrigger = 'tray' | 'second-instance' | 'activate' | 'startup';

/** Phần của `BrowserWindow` mà controller dùng, để test không cần Electron. */
export interface ControlledWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  once(event: 'closed', listener: () => void): unknown;
  webContents: { isDestroyed(): boolean; send(channel: string): void };
}

export interface WindowControllerDeps<W extends ControlledWindow> {
  create(): W;
  log(level: 'info' | 'warn', event: string, fields?: Record<string, unknown>): void;
  /** Biểu tượng Dock (chỉ macOS). App tray: có cửa sổ thì hiện, đóng cửa sổ thì ẩn. */
  dock?: { show(): void; hide(): void };
}

export interface WindowController {
  /** Mở cửa sổ (tạo lại nếu đã đóng) hoặc đưa cửa sổ đang có lên trước. */
  show(trigger: ShowTrigger): void;
  /**
   * macOS bắn `activate` khi người dùng mở lại app (Finder, Spotlight, Dock), nên vẫn mở cửa sổ; chỉ ghi thêm
   * `hasVisibleWindows` vào nhật ký để phân biệt khi cần điều tra.
   */
  activate(hasVisibleWindows: boolean): void;
  /** Gửi một sự kiện không payload tới cửa sổ nếu còn sống; không bao giờ ném lỗi vì đối tượng đã bị hủy. */
  send(channel: string): void;
}

/** Gửi tới một cửa sổ còn sống; bỏ qua cửa sổ hoặc webContents đã bị hủy. */
export function sendIfAlive(win: ControlledWindow | null | undefined, channel: string): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel);
}

/**
 * Giữ đúng một cửa sổ. Cửa sổ đóng thì bỏ tham chiếu ngay (`closed`), để không ai gửi vào đối tượng đã hủy.
 */
export function createWindowController<W extends ControlledWindow>(
  deps: WindowControllerDeps<W>,
): WindowController {
  let window: W | null = null;

  const open = (): W => {
    const created = deps.create();
    window = created;
    created.once('closed', () => {
      if (window === created) {
        window = null;
        deps.dock?.hide();
      }
    });
    deps.dock?.show();
    return created;
  };

  const controller: WindowController = {
    show(trigger) {
      const recreate = !window || window.isDestroyed();
      deps.log('info', 'window-show', { trigger, recreate });
      if (recreate) {
        open();
        return;
      }
      const current = window as W;
      if (current.isMinimized()) current.restore();
      current.show();
      current.focus();
    },
    activate(hasVisibleWindows) {
      deps.log('info', 'window-activate', { hasVisibleWindows });
      controller.show('activate');
    },
    send(channel) {
      sendIfAlive(window, channel);
    },
  };
  return controller;
}
