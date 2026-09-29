import { z } from 'zod';
import { HealthStatus, HealthSummary } from './machine-schemas.js';

/** Groups of the health dashboard, in display order. `crewd doctor` prints the same groups. */
export const HealthGroup = z.enum([
  'server',
  'claude',
  'mcp',
  'skills',
  'repos',
  'machine',
  'resources',
  'app',
]);
export type HealthGroup = z.infer<typeof HealthGroup>;

export const HEALTH_GROUP_TITLES: Record<HealthGroup, string> = {
  server: 'Server',
  claude: 'Claude',
  mcp: 'MCP',
  skills: 'Skill',
  repos: 'Repo',
  machine: 'Máy',
  resources: 'Tài nguyên',
  app: 'Ứng dụng',
};

/**
 * Fix ids are fixed, whitelisted operations: `action`, optionally `:scope` (a project key or similar), then
 * optionally `:argument`. The argument is the rest of the id and may itself hold colons and spaces, because
 * MCP server names do (`plugin:engineering:google calendar`).
 */
export const HealthFixId = z
  .string()
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what the class excludes
  .regex(/^[a-z][a-z0-9-]{1,40}(:[A-Za-z0-9_.-]{1,64}(:[^\x00-\x1f\x7f]{1,200})?)?$/, 'unknown fix id');

export const HealthFix = z.object({ id: HealthFixId, label: z.string().min(1).max(100) });
export type HealthFix = z.infer<typeof HealthFix>;

/** One check's outcome. Text is Vietnamese; ids are stable (`claude.login`, `repos.WEB.hooks`). */
export const HealthCheckResult = z.object({
  id: z.string().min(1).max(200),
  group: HealthGroup,
  title: z.string().min(1).max(300),
  status: HealthStatus,
  detail: z.string().max(5_000),
  fix: HealthFix.optional(),
  /** The fix ran during this check and the re-check passed. */
  fixed: z.boolean().optional(),
});
export type HealthCheckResult = z.infer<typeof HealthCheckResult>;

export const HealthReport = z.object({
  generatedAt: z.iso.datetime(),
  results: z.array(HealthCheckResult),
  summary: HealthSummary,
});
export type HealthReport = z.infer<typeof HealthReport>;
