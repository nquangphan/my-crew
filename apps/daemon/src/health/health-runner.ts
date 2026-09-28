import { spawnSync } from 'node:child_process';
import type { HealthGroup, HealthStatus, HealthSummary } from '@crew/shared';
import { serviceChecks } from './checks/app.js';
import { claudeChecks } from './checks/claude.js';
import { machineChecks } from './checks/machine.js';
import { mcpChecks } from './checks/mcp.js';
import { repoChecks } from './checks/repos.js';
import { resourceChecks } from './checks/resources.js';
import { serverChecks } from './checks/server.js';
import { skillChecks } from './checks/skills.js';
import type { HealthCheck, HealthCheckResult, HealthContext } from './types.js';

/** Every check, in dashboard order; `crewd doctor` and the desktop app run the same list. */
export const HEALTH_CHECKS: readonly HealthCheck[] = [
  serverChecks,
  claudeChecks,
  mcpChecks,
  skillChecks,
  repoChecks,
  machineChecks,
  resourceChecks,
  serviceChecks,
];

/**
 * Applies one fix a dashboard row offered (a fixed, whitelisted operation of that group's check). Fixes that
 * need the app itself (Terminal login, login item, update, re-pair) are handled by the desktop app instead.
 */
export async function applyHealthFix(
  ctx: HealthContext,
  group: HealthGroup,
  fixId: string,
  checks: readonly HealthCheck[] = HEALTH_CHECKS,
): Promise<void> {
  const check = checks.find((item) => item.group === group);
  if (!check?.fix) throw new Error(`nhóm ${group} không có cách sửa tự động`);
  await check.fix(ctx, fixId);
}

/** Runs a command without a shell; a missing binary reads as exit code 127. */
export function execCommand(command: string, args: string[]) {
  const run = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 });
  if (run.error) return { code: 127, stdout: '', stderr: run.error.message };
  return { code: run.status ?? 1, stdout: run.stdout, stderr: run.stderr };
}

/**
 * Runs every check. With `fix`, a failing result that offers a fix gets it applied once and is checked
 * again (e.g. reinstall the crew-docs hooks of a repo).
 */
export async function runHealthChecks(
  ctx: HealthContext,
  options: { fix?: boolean; checks?: readonly HealthCheck[] } = {},
): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];
  for (const check of options.checks ?? HEALTH_CHECKS) {
    let found: HealthCheckResult[];
    try {
      found = await check.run(ctx);
    } catch (error) {
      found = [
        {
          id: check.id,
          group: check.group,
          title: check.id,
          status: 'red',
          detail: `kiểm tra bị lỗi: ${(error as Error).message}`,
        },
      ];
    }
    const failing = found.filter((item) => item.status !== 'green' && item.fix);
    if (options.fix && check.fix && failing.length > 0) {
      for (const item of failing) {
        try {
          await check.fix(ctx, item.fix?.id ?? '');
        } catch {
          // the re-check below reports the state
        }
      }
      const again = await check.run(ctx).catch(() => found);
      const before = new Map(found.map((item) => [item.id, item]));
      found = again.map((item) => {
        const old = before.get(item.id);
        return old && old.status !== 'green' && old.fix && item.status === 'green'
          ? { ...item, fixed: true }
          : item;
      });
    }
    results.push(...found);
  }
  return results;
}

const RANK: Record<HealthStatus, number> = { green: 0, yellow: 1, red: 2 };

/** The heartbeat summary: the worst status plus every check that is not green. */
export function summarize(results: readonly HealthCheckResult[]): HealthSummary {
  const worst = results.reduce<HealthStatus>(
    (status, item) => (RANK[item.status] > RANK[status] ? item.status : status),
    'green',
  );
  return {
    status: worst,
    failing: results
      .filter((item) => item.status !== 'green')
      .map((item) => ({ id: item.id, title: item.title })),
  };
}
