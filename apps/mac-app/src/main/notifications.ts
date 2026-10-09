export type Notify = (title: string, body: string) => void;

export interface NotifierDeps {
  isSupported(): boolean;
  create(options: { title: string; body: string }): { show(): void };
}

/** Thông báo hệ thống; lỗi khi hiện không được làm hỏng vòng kiểm sức khỏe. */
export function createNotifier(deps: NotifierDeps): Notify {
  return (title, body) => {
    try {
      if (!deps.isSupported()) return;
      deps.create({ title, body }).show();
    } catch {
      // Thông báo chỉ là phần thêm; trạng thái vẫn có trên tray và màn hình Sức khỏe.
    }
  };
}
