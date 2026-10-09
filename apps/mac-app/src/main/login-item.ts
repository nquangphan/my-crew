/** Mở cùng máy: login item macOS (chạy trong phiên của owner nên Keychain đăng nhập dùng được). */
export interface LoginItem {
  enabled(): boolean;
  set(enabled: boolean): boolean;
  /** Lần mở này do login item: chỉ hiện tray, không mở cửa sổ. */
  openedAtLogin(): boolean;
}

interface LoginItemApp {
  getLoginItemSettings(): { openAtLogin: boolean; wasOpenedAtLogin?: boolean; status?: string };
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
}

export function electronLoginItem(app: LoginItemApp): LoginItem {
  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin === true;
  return {
    enabled: () => {
      const settings = app.getLoginItemSettings();
      // `requires-approval`: đã có trong Login Items nhưng owner chưa cho phép.
      return settings.openAtLogin && settings.status !== 'requires-approval';
    },
    set(enabled) {
      app.setLoginItemSettings({ openAtLogin: enabled });
      return this.enabled();
    },
    openedAtLogin: () => openedAtLogin,
  };
}
