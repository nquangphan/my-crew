import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Start at login: a macOS login item (runs in the owner's session, so the login Keychain works). */
export interface LoginItem {
  enabled(): boolean;
  set(enabled: boolean): boolean;
  /** This launch came from the login item: start in the menu bar without a window. */
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
      // `requires-approval`: macOS lists it in Login Items but the owner has not allowed it yet.
      return settings.openAtLogin && settings.status !== 'requires-approval';
    },
    set(enabled) {
      app.setLoginItemSettings({ openAtLogin: enabled });
      return this.enabled();
    },
    openedAtLogin: () => openedAtLogin,
  };
}

/**
 * Test mode: the setting lives in a file of the test home, so a test run never registers a real login item.
 * `CREW_TEST_OPENED_AT_LOGIN=1` simulates a launch at login.
 */
export function fileLoginItem(path: string, env: NodeJS.ProcessEnv = process.env): LoginItem {
  return {
    enabled: () => existsSync(path) && readFileSync(path, 'utf8').trim() === 'on',
    set(enabled) {
      writeFileSync(path, enabled ? 'on\n' : 'off\n');
      return enabled;
    },
    openedAtLogin: () => env.CREW_TEST_OPENED_AT_LOGIN === '1',
  };
}
