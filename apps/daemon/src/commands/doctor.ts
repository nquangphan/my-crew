import type { HealthStatus } from '@crew/shared';
import { runHealthChecks } from '../health/health-runner.js';
import type { HealthCheckResult, HealthContext } from '../health/types.js';

const ICON: Record<HealthStatus, string> = { green: '[OK]  ', yellow: '[WARN]', red: '[LỖI] ' };
const GROUP_TITLE: Record<string, string> = {
  server: 'Server',
  claude: 'Claude',
  mcp: 'MCP',
  skills: 'Skill',
  repos: 'Repo',
  machine: 'Máy',
  resources: 'Tài nguyên',
  app: 'Dịch vụ',
};

/** Renders the shared health check results as text, grouped like the desktop dashboard. */
export function renderHealth(results: readonly HealthCheckResult[]): string {
  const lines: string[] = [];
  let group = '';
  for (const item of results) {
    if (item.group !== group) {
      group = item.group;
      lines.push('', `${GROUP_TITLE[group] ?? group}`);
    }
    const fixed = item.fixed ? ' (đã tự sửa)' : '';
    const fix = item.status !== 'green' && item.fix ? `  → sửa: ${item.fix.label}` : '';
    lines.push(`  ${ICON[item.status]} ${item.title}${fixed}: ${item.detail}${fix}`);
  }
  return lines.join('\n').trimStart();
}

/** `crewd doctor`: runs the shared checks, applies the one-click fixes (hooks, crew-docs), prints them. */
export async function doctor(ctx: HealthContext, options: { fix?: boolean } = {}) {
  const results = await runHealthChecks(ctx, { fix: options.fix ?? true });
  const exitCode = results.some((item) => item.status === 'red') ? 1 : 0;
  return { results, text: renderHealth(results), exitCode };
}
