import type { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { HealthStatus } from '@crew/shared';
import type { VpsClient } from '../api/vps-client.js';
import type { DaemonConfig, homePaths } from '../config.js';
import type { TokenStore } from '../secrets.js';
import type { StateDb } from '../state-db.js';

export type HealthGroup = 'server' | 'claude' | 'mcp' | 'skills' | 'repos' | 'machine' | 'resources' | 'app';

/** One check's outcome, rendered by `crewd doctor` and by the desktop dashboard. Text is Vietnamese. */
export interface HealthCheckResult {
  /** Stable id, e.g. `claude.login` or `repos.WEB.hooks`; also sent in the heartbeat summary. */
  id: string;
  group: HealthGroup;
  title: string;
  status: HealthStatus;
  detail: string;
  /** A one-click fix the runner can apply (doctor applies it with `--fix`, the default). */
  fix?: { id: string; label: string };
  /** The fix ran during this check and the re-check passed. */
  fixed?: boolean;
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
