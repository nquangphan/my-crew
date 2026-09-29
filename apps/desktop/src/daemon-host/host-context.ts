import { existsSync } from 'node:fs';
import {
  type ApiFailure,
  type Daemon,
  type DaemonConfig,
  type DaemonConfigInput,
  defaultTokenStore,
  homePaths,
  loadConfig,
  saveConfig,
  type TokenStore,
  VpsClient,
} from '@crew/daemon';
import type { AppLogEntry, HostEventName } from '@crew/shared';
import { awaitFolderAccess } from './folder-access.js';
import type { TestSeams } from './test-seams.js';

export interface HostDeps {
  /** Crew home (`~/.crew`, or `$CREW_HOME`). */
  home: string;
  /** The app executable; crew-docs hooks run it with ELECTRON_RUN_AS_NODE=1. */
  runtime: string;
  /** The crew-docs bundle shipped as an app resource. */
  crewDocsSource: string;
  appVersion: string;
  env: NodeJS.ProcessEnv;
  emit: (name: HostEventName, payload: unknown) => void;
  /** Sends one entry to the app log (`~/.crew/logs/app.log`, written by the main process). */
  log?: (entry: AppLogEntry) => void;
  fetch?: typeof fetch;
  tokenStore?: TokenStore;
  seams?: TestSeams;
}

/** A failure the UI shows as is (Vietnamese). */
export class HostError extends Error {
  constructor(
    message: string,
    readonly code = 'HOST',
  ) {
    super(message);
    this.name = 'HostError';
  }
}

/**
 * State shared by the host's operations. The config is re-read from disk on every call, so a `crewd` CLI
 * edit and the app never disagree; every save goes to the running daemon at once (no restart).
 */
export class HostContext {
  readonly paths: ReturnType<typeof homePaths>;
  readonly tokenStore: TokenStore;
  daemon: Daemon | null = null;

  /** One read per repo folder for the host's lifetime: later callers share it (and its wait) instead of piling up. */
  private readonly folderReads = new Map<string, Promise<void>>();

  constructor(readonly deps: HostDeps) {
    this.paths = homePaths(deps.home);
    this.tokenStore = deps.tokenStore ?? defaultTokenStore(this.paths.tokenFile, deps.env);
  }

  /**
   * Resolves once every project folder has answered a read (allowed or refused). Await it before synchronous
   * git work in the repos: see `awaitFolderAccess` for the macOS permission prompt this waits out.
   */
  async repoAccess(): Promise<void> {
    let config: DaemonConfig | null;
    try {
      config = this.config();
    } catch {
      return;
    }
    for (const project of config?.projects ?? []) {
      if (existsSync(project.repoPath)) await this.folderRead(project.repoPath);
    }
  }

  private folderRead(path: string): Promise<void> {
    let read = this.folderReads.get(path);
    if (!read) {
      read = awaitFolderAccess([path], {
        onWaiting: (folder) =>
          this.log('warn', 'folder-access-waiting', {
            path: folder,
            hint: 'macOS đang hỏi quyền cho 2P Crew đọc thư mục này: bấm "Allow" (Cho phép) trong hộp thoại.',
          }),
        onResolved: (folder, ms, error) =>
          this.log(error ? 'warn' : 'info', 'folder-access-resolved', { path: folder, ms, error }),
      });
      this.folderReads.set(path, read);
    }
    return read;
  }

  config(): DaemonConfig | null {
    return existsSync(this.paths.config)
      ? loadConfig(this.paths.config, (message, fields) =>
          this.log('warn', 'config-legacy-model', { message, ...fields }),
        )
      : null;
  }

  requireConfig(): DaemonConfig {
    const config = this.config();
    if (!config?.machineId || !this.tokenStore.get()) {
      throw new HostError('Máy chưa được ghép với server: làm bước "Ghép máy" trước.', 'NOT_PAIRED');
    }
    return config;
  }

  vps(apiUrl?: string): VpsClient {
    const url = apiUrl ?? this.requireConfig().apiUrl;
    return new VpsClient({
      apiUrl: url,
      token: () => this.tokenStore.get(),
      fetch: this.deps.fetch,
      onError: this.logApiError,
    });
  }

  /** One app-log entry from the daemon host (never tokens, cookies or pairing codes in `fields`). */
  log(level: AppLogEntry['level'], event: string, fields: Record<string, unknown> = {}): void {
    try {
      this.deps.log?.({ level, source: 'host', event, fields });
    } catch {
      // logging never breaks an operation
    }
  }

  /** Every API call that failed for good: method, path, status, error code and message. */
  readonly logApiError = ({ code, ...failure }: ApiFailure): void =>
    // `code` is a redacted field name in the app log (pairing codes); the API error code goes as `errorCode`.
    this.log('warn', 'api-error', { ...failure, errorCode: code });

  save(config: DaemonConfigInput): DaemonConfig {
    const saved = saveConfig(this.paths.config, config);
    this.daemon?.updateConfig(saved);
    return saved;
  }

  webUrl(path: string): string | null {
    const config = this.config();
    return config ? `${config.apiUrl.replace(/\/+$/, '')}${path}` : null;
  }
}
