import { spawnSync } from 'node:child_process';
import type { UpdateStatus } from '@crew/shared';
import type { AppUpdater, UpdateInfo } from 'electron-updater';

/** GitHub Releases of the repo the release job publishes the dmg to. */
export const RELEASES_URL = 'https://github.com/nquangphan/my-crew/releases';

/**
 * Squirrel.Mac only installs updates into an app signed with a Developer ID. An unsigned or ad-hoc signed
 * build has no TeamIdentifier.
 */
export function isDeveloperIdSigned(appBundle: string): boolean {
  const run = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', appBundle], { encoding: 'utf8' });
  const info = `${run.stdout}${run.stderr}`;
  return run.status === 0 && /TeamIdentifier=(?!not set)\S+/.test(info);
}

export interface UpdaterDeps {
  /** Off in dev builds and in test mode. */
  enabled: boolean;
  updater: () => AppUpdater;
  signed: () => boolean;
  onStatus: (status: UpdateStatus) => void;
  openExternal: (url: string) => Promise<void>;
  /** Waits until no job runs (the daemon stops taking new jobs meanwhile). */
  waitForIdle: () => Promise<void>;
}

/**
 * `electron-updater` from GitHub Releases. Signed builds download and install in place once no job runs;
 * unsigned builds fall back to "a new version is available" with a link to the release page.
 */
export class Updater {
  private status: UpdateStatus;
  private readonly canAutoInstall: boolean;

  constructor(private readonly deps: UpdaterDeps) {
    this.canAutoInstall = deps.enabled && deps.signed();
    this.status = {
      state: deps.enabled ? 'idle' : 'disabled',
      version: null,
      canAutoInstall: this.canAutoInstall,
      downloadUrl: null,
      message: null,
    };
    if (!deps.enabled) return;
    const updater = deps.updater();
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on('update-available', (info: UpdateInfo) => {
      this.set({
        state: 'available',
        version: info.version,
        downloadUrl: `${RELEASES_URL}/tag/v${info.version}`,
      });
    });
    updater.on('update-not-available', () => this.set({ state: 'none', message: null }));
    updater.on('update-downloaded', () => this.set({ state: 'downloaded' }));
    updater.on('error', (error: Error) => this.set({ state: 'error', message: error.message }));
  }

  current(): UpdateStatus {
    return this.status;
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    this.deps.onStatus(this.status);
  }

  async check(): Promise<UpdateStatus> {
    if (!this.deps.enabled) return this.status;
    this.set({ state: 'checking', message: null });
    try {
      await this.deps.updater().checkForUpdates();
    } catch (error) {
      this.set({ state: 'error', message: (error as Error).message });
    }
    return this.status;
  }

  async install(): Promise<UpdateStatus> {
    if (this.status.state !== 'available' && this.status.state !== 'downloaded') return this.status;
    if (!this.canAutoInstall) {
      await this.deps.openExternal(this.status.downloadUrl ?? RELEASES_URL);
      return this.status;
    }
    const updater = this.deps.updater();
    if (this.status.state !== 'downloaded') await updater.downloadUpdate();
    await this.deps.waitForIdle();
    updater.quitAndInstall();
    return this.status;
  }
}
