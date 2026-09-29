import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DESKTOP_EVENT_CHANNEL,
  DESKTOP_INVOKE_CHANNEL,
  type HealthReport,
  type UpdateStatus,
} from '@crew/shared';
import type { AppUpdater } from 'electron-updater';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DesktopStateStore } from '../src/main/desktop-state.js';
import { dispatchDesktopRequest, ipcLogEntry, isTrustedSender } from '../src/main/ipc-handlers.js';
import { fileLoginItem } from '../src/main/login-item.js';
import { Notifier } from '../src/main/notifications.js';
import { decideQuit, QUIT_BUTTONS, quitMessage } from '../src/main/quit-guard.js';
import { recordingTerminalLauncher } from '../src/main/terminal-launcher.js';
import { trayView } from '../src/main/tray-view.js';
import {
  dmgAssetName,
  isDeveloperIdSigned,
  isUnpublished,
  RELEASES_URL,
  Updater,
} from '../src/main/updater.js';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-desktop-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('quit guard', () => {
  it('quits at once without running jobs, and asks while jobs run', async () => {
    const asked: number[] = [];
    const ask = async (count: number) => {
      asked.push(count);
      return 'cancel' as const;
    };
    expect(await decideQuit(0, ask)).toBe('requeue');
    expect(asked).toEqual([]);
    expect(await decideQuit(2, ask)).toBe('cancel');
    expect(asked).toEqual([2]);
    expect(await decideQuit(1, async () => 'wait')).toBe('drain');
    expect(await decideQuit(1, async () => 'stop')).toBe('requeue');
    expect(quitMessage(3).message).toBe('Có 3 job đang chạy trên máy này.');
    expect(QUIT_BUTTONS).toHaveLength(3);
  });
});

describe('typed IPC boundary', () => {
  const main = { 'app.setLoginItem': async ({ enabled }: { enabled: boolean }) => enabled };

  it('rejects unknown methods and invalid input before anything runs', async () => {
    const forwarded: string[] = [];
    const forward = async (method: string) => {
      forwarded.push(method);
      return 'ok';
    };
    expect(await dispatchDesktopRequest('shell.exec', {}, main, forward)).toEqual({
      ok: false,
      error: 'Thao tác không hợp lệ.',
    });
    const bad = await dispatchDesktopRequest('folder.inspect', { path: 'relative/path' }, main, forward);
    expect(bad).toMatchObject({ ok: false });
    const noSonnet = await dispatchDesktopRequest(
      'config.saveResources',
      {
        resources: { maxConcurrentJobs: 2, minFreeMemGb: 2, maxLoadPerCpu: 1.5 },
        models: {
          allow: ['haiku', 'opus'],
          complexityMap: {
            trivial: { model: 'haiku', effort: 'low' },
            small: { model: 'haiku', effort: 'low' },
            medium: { model: 'opus', effort: 'high' },
            large: { model: 'opus', effort: 'high' },
          },
        },
      },
      main,
      forward,
    );
    expect(noSonnet).toMatchObject({ ok: false });
    expect((noSonnet as { error: string }).error).toContain('sonnet');
    const extraKey = await dispatchDesktopRequest(
      'health.fix',
      { group: 'repos', fixId: 'x; rm -rf /' },
      main,
      forward,
    );
    expect(extraKey).toMatchObject({ ok: false });
    expect(forwarded).toEqual([]);
  });

  it('answers main-process calls itself, forwards the rest, and turns errors into messages', async () => {
    const forward = async (method: string, input: unknown) => ({ method, input });
    expect(await dispatchDesktopRequest('app.setLoginItem', { enabled: true }, main, forward)).toEqual({
      ok: true,
      result: true,
    });
    expect(await dispatchDesktopRequest('jobs.list', {}, main, forward)).toEqual({
      ok: true,
      result: { method: 'jobs.list', input: {} },
    });
    const failing = async () => {
      throw new Error('Máy chưa được ghép');
    };
    expect(await dispatchDesktopRequest('projects.list', {}, main, failing)).toEqual({
      ok: false,
      error: 'Máy chưa được ghép',
    });
  });

  it('logs every call with its outcome and duration, never its input', () => {
    expect(ipcLogEntry('projects.create', { ok: true, result: { status: 'granted' } }, 35)).toEqual({
      level: 'info',
      source: 'main',
      event: 'ipc',
      fields: { method: 'projects.create', outcome: 'ok', ms: 35 },
    });
    expect(ipcLogEntry('setup.pair', { ok: false, error: 'Mã ghép đã hết hạn.' }, 20)).toEqual({
      level: 'warn',
      source: 'main',
      event: 'ipc',
      fields: { method: 'setup.pair', outcome: 'error', ms: 20, error: 'Mã ghép đã hết hạn.' },
    });
    expect(ipcLogEntry({ evil: true }, { ok: false, error: 'x' }, 1).fields).toMatchObject({
      method: 'invalid',
    });
  });

  it('accepts only the bundled renderer as the caller', () => {
    const renderer = 'file:///Applications/2P%20Crew.app/Contents/Resources/app/out/renderer/index.html';
    expect(isTrustedSender(`${renderer}#/health`, renderer)).toBe(true);
    expect(isTrustedSender('https://evil.example/index.html', renderer)).toBe(false);
    expect(isTrustedSender('file:///tmp/other.html', renderer)).toBe(false);
    expect(isTrustedSender(undefined, renderer)).toBe(false);
  });

  it('keeps the preload channel names in sync with the shared contract', () => {
    const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
    expect(preload).toContain(`const INVOKE = '${DESKTOP_INVOKE_CHANNEL}'`);
    expect(preload).toContain(`const EVENT = '${DESKTOP_EVENT_CHANNEL}'`);
  });
});

const report = (status: 'green' | 'yellow' | 'red'): HealthReport => ({
  generatedAt: new Date().toISOString(),
  results: [{ id: 'claude.login', group: 'claude', title: 'Đăng nhập gói Claude', status, detail: '' }],
  summary: {
    status,
    failing: status === 'green' ? [] : [{ id: 'claude.login', title: 'Đăng nhập gói Claude' }],
  },
});

describe('notifications, tray and state', () => {
  it('notifies once when health turns red and when a job is blocked', () => {
    const shown: string[] = [];
    const notifier = new Notifier((title, body) => shown.push(`${title} | ${body}`));
    notifier.onHealth(report('green'));
    notifier.onHealth(report('red'));
    notifier.onHealth(report('red'));
    notifier.onHealth(report('yellow'));
    notifier.onHealth(report('red'));
    expect(shown).toEqual([
      '2P Crew: sức khỏe máy chuyển đỏ | Đăng nhập gói Claude',
      '2P Crew: sức khỏe máy chuyển đỏ | Đăng nhập gói Claude',
    ]);
    notifier.onJobBlocked({ ticketId: 'x', ticketKey: 'WEB-7', error: null });
    expect(shown.at(-1)).toContain('WEB-7 bị chặn');
  });

  it('shows the health dot, the running-job count and the pause label in the menu bar', () => {
    const base = {
      health: 'green' as const,
      runningJobs: 2,
      paused: false,
      daemon: 'running' as const,
      setupComplete: true,
    };
    expect(trayView(base)).toMatchObject({ color: 'green', title: ' 2', pauseLabel: 'Tạm dừng nhận việc' });
    expect(trayView({ ...base, paused: true, runningJobs: 0 })).toMatchObject({
      title: '',
      pauseLabel: 'Tiếp tục nhận việc',
    });
    expect(trayView({ ...base, daemon: 'crashed' })).toMatchObject({ color: 'red' });
    expect(trayView({ ...base, setupComplete: false })).toMatchObject({ color: 'gray' });
    expect(trayView(base).statusLabel).toContain('2 job đang chạy');
  });

  it('keeps setup completion and the pause across restarts; the test login item never touches macOS', async () => {
    const home = temp();
    const store = new DesktopStateStore(home);
    expect(store.read()).toEqual({ setupCompletedAt: null, paused: false });
    store.update({ paused: true });
    expect(new DesktopStateStore(home).read().paused).toBe(true);

    const item = fileLoginItem(join(home, 'login'), {});
    expect(item.enabled()).toBe(false);
    expect(item.set(true)).toBe(true);
    expect(item.enabled()).toBe(true);
    expect(fileLoginItem(join(home, 'login'), { CREW_TEST_OPENED_AT_LOGIN: '1' }).openedAtLogin()).toBe(true);

    const launches = join(home, 'launches');
    await recordingTerminalLauncher(launches)();
    expect(readFileSync(launches, 'utf8')).toMatch(/claude\n$/);
  });
});

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  downloads = 0;
  installs = 0;
  async checkForUpdates() {
    this.emit('update-available', { version: '0.2.0' });
    return null;
  }
  async downloadUpdate() {
    this.downloads += 1;
    this.emit('update-downloaded', {});
    return [];
  }
  quitAndInstall() {
    this.installs += 1;
  }
}

describe('updater', () => {
  const make = (signed: boolean) => {
    const fake = new FakeUpdater();
    const statuses: UpdateStatus[] = [];
    const opened: string[] = [];
    let idleWaits = 0;
    const updater = new Updater({
      enabled: true,
      updater: () => fake as unknown as AppUpdater,
      signed: () => signed,
      onStatus: (status) => statuses.push(status),
      openExternal: async (url) => {
        opened.push(url);
      },
      waitForIdle: async () => {
        idleWaits += 1;
      },
      arch: 'arm64',
    });
    return { fake, updater, statuses, opened, idleWaits: () => idleWaits };
  };

  it('names each architecture dmg and zip as electron-builder does', () => {
    const config = parse(readFileSync(join(import.meta.dirname, '..', 'electron-builder.yml'), 'utf8'));
    expect(config.mac.target).toEqual([
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ]);
    const expand = (pattern: unknown, macros: Record<string, string>) =>
      String(pattern).replace(/\$\{(\w+)\}/g, (_, key: string) => macros[key] ?? '');
    for (const arch of ['arm64', 'x64']) {
      expect(expand(config.dmg.artifactName, { version: '0.2.0', arch, ext: 'dmg' })).toBe(
        dmgAssetName('0.2.0', arch),
      );
      // Distinct per architecture, with `arm64` in the Apple Silicon name (electron-updater picks by it).
      expect(expand(config.mac.artifactName, { version: '0.2.0', arch, ext: 'zip' })).toBe(
        `2P-Crew-0.2.0-${arch}-mac.zip`,
      );
    }
  });

  it('unsigned builds link to this architecture dmg instead of installing', async () => {
    const { fake, updater, opened } = make(false);
    expect(fake.autoDownload).toBe(false);
    expect(await updater.check()).toMatchObject({
      state: 'available',
      version: '0.2.0',
      canAutoInstall: false,
    });
    await updater.install();
    expect(opened).toEqual([`${RELEASES_URL}/download/v0.2.0/2P-Crew-0.2.0-arm64.dmg`]);
    expect(fake.installs).toBe(0);
  });

  it('signed builds download, wait until no job runs, then install', async () => {
    const { fake, updater, idleWaits } = make(true);
    await updater.check();
    await updater.install();
    expect(fake.downloads).toBe(1);
    expect(idleWaits()).toBe(1);
    expect(fake.installs).toBe(1);
  });

  it('reports a repo without any release as unpublished (not an error) and keeps real errors', async () => {
    const { fake, updater } = make(false);
    const failWith = (error: Error & { code?: string }) => {
      fake.checkForUpdates = async () => {
        // electron-updater emits `error` and rejects the check.
        fake.emit('error', error);
        throw error;
      };
    };
    const coded = (message: string, code: string) => Object.assign(new Error(message), { code });
    for (const error of [
      coded('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'),
      coded('Unable to find latest version on GitHub', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND'),
      new Error('Cannot find latest-mac.yml in the latest release artifacts: HttpError: 404'),
    ]) {
      failWith(error);
      expect(await updater.check()).toMatchObject({ state: 'unpublished', message: null });
    }
    failWith(new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(await updater.check()).toMatchObject({
      state: 'error',
      message: 'net::ERR_INTERNET_DISCONNECTED',
    });
    expect(isUnpublished(new Error('getaddrinfo ENOTFOUND github.com'))).toBe(false);
  });

  it('is disabled in dev and test builds, and detects the missing Developer ID', async () => {
    const disabled = new Updater({
      enabled: false,
      updater: () => {
        throw new Error('not used');
      },
      signed: () => true,
      onStatus: () => {},
      openExternal: async () => {},
      waitForIdle: async () => {},
    });
    expect(await disabled.check()).toMatchObject({ state: 'disabled', canAutoInstall: false });
    expect(isDeveloperIdSigned(temp())).toBe(false);
  });
});
