import type { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type {
  HealthCheckResult,
  HealthGroup,
  HealthStatus,
  SkillInventory,
  UpdateStatus,
} from '@crew/shared';
import type { VpsClient } from '../api/vps-client.js';
import type { DaemonConfig, homePaths } from '../config.js';
import type { Daemon } from '../daemon.js';
import type { TokenStore } from '../secrets.js';
import type { StateDb } from '../state-db.js';

/**
 * One check's outcome, rendered by `crewd doctor` and by the desktop dashboard (the shared schema). Text is
 * Vietnamese; a `fix` is a one-click fix the runner can apply (doctor applies it with `--fix`, the default).
 */
export type { HealthCheckResult, HealthGroup };

/** What only the desktop app knows; without it the App group checks the user session (CLI). */
export interface HealthAppFacts {
  version: string;
  loginItem: boolean;
  update: UpdateStatus;
}

export interface HealthContext {
  config: DaemonConfig | null;
  paths: ReturnType<typeof homePaths>;
  tokenStore: TokenStore;
  vps: VpsClient | null;
  state: StateDb | null;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  query?: typeof sdkQuery;
  /** Skip the paid haiku probe (still checks the env and versions). */
  skipLoginProbe?: boolean;
  /** Runs a command and returns its stdout (injectable for tests). */
  exec: (command: string, args: string[]) => { code: number; stdout: string; stderr: string };
  /** The running daemon (desktop app): stream state, running jobs and inventory refresh. */
  daemon?: Daemon | null;
  app?: HealthAppFacts;
  /** crew-docs bundle to install and the runtime hooks call (the app binary with ELECTRON_RUN_AS_NODE=1). */
  crewDocs?: { source: string; runtime: string };
  /** Probes the skills a main checkout sees, compared with the job-worktree inventory. */
  probeCheckout?: (repoPath: string) => Promise<SkillInventory>;
  /** Scheduled run: skip the network and SDK probes (login, push access, checkout inventory). */
  quick?: boolean;
}

export interface HealthCheck {
  id: string;
  group: HealthGroup;
  run: (ctx: HealthContext) => Promise<HealthCheckResult[]>;
  /** Applies the fix a failing result offered, by fix id. */
  fix?: (ctx: HealthContext, fixId: string) => Promise<void>;
}

export const result = (
  id: string,
  group: HealthGroup,
  title: string,
  status: HealthStatus,
  detail: string,
  fix?: HealthCheckResult['fix'],
): HealthCheckResult => ({ id, group, title, status, detail, ...(fix ? { fix } : {}) });
