import { type ProjectPlatform, qcDefaultMcps, type UiTestMcp } from '@crew/shared';
import { serverProjects, storedInventory, updateProjectMcp } from '../project-views.js';
import {
  type HealthCheck,
  type HealthCheckResult,
  type HealthContext,
  parseFixId,
  result,
} from '../types.js';

/** The official server behind each UI-test role, installed machine-wide so every job worktree sees it. */
export const OFFICIAL_UI_TEST_SERVERS: Record<keyof UiTestMcp, { command: string[]; note: string }> = {
  playwright: { command: ['npx', '-y', '@playwright/mcp@latest'], note: 'Playwright MCP (@playwright/mcp)' },
  maestro: { command: ['maestro', 'mcp'], note: 'Maestro MCP (cần Maestro CLI)' },
};

const needsDevice = (platform: ProjectPlatform) => platform === 'mobile' || platform === 'web_mobile';

/** A booted iOS simulator or a connected Android emulator/device, for Maestro. */
function deviceReady(ctx: HealthContext): string | null {
  const simulators = ctx.exec('xcrun', ['simctl', 'list', 'devices', 'booted']);
  const booted =
    simulators.code === 0 ? /^\s+(.+?) \([0-9A-F-]{36}\) \(Booted\)/m.exec(simulators.stdout) : null;
  if (booted) return `simulator ${booted[1]}`;
  const adb = ctx.exec('adb', ['devices']);
  const device = adb.code === 0 ? /^(\S+)\tdevice$/m.exec(adb.stdout) : null;
  return device ? `thiết bị Android ${device[1]}` : null;
}

export const mcpChecks: HealthCheck = {
  id: 'mcp',
  group: 'mcp',
  async run(ctx) {
    const projects = ctx.config?.projects ?? [];
    if (projects.length === 0) {
      return [result('mcp.projects', 'mcp', 'MCP server', 'green', 'Máy này chưa chạy project nào.')];
    }
    const results: HealthCheckResult[] = [];
    const server = await serverProjects(ctx);
    for (const project of projects) {
      const key = project.key;
      const inventory = storedInventory(ctx, key);
      const refresh = { id: `refresh-inventory:${key}`, label: 'Dò lại MCP' };
      if (!inventory) {
        results.push(
          result(
            `mcp.${key}.inventory`,
            'mcp',
            `MCP của ${key}`,
            'yellow',
            'Chưa dò MCP server trong worktree của project (daemon chưa chạy hoặc đang dò).',
            refresh,
          ),
        );
        continue;
      }
      const disabled = new Set(project.disabledMcpServers);
      for (const mcp of inventory.mcpServers) {
        if (disabled.has(mcp.name)) continue;
        results.push(
          mcp.status === 'connected'
            ? result(
                `mcp.${key}.${mcp.name}`,
                'mcp',
                `${mcp.name} (${key})`,
                'green',
                `Kết nối được trong worktree, ${mcp.tools.length} tool, nguồn ${mcp.source}.`,
              )
            : result(
                `mcp.${key}.${mcp.name}`,
                'mcp',
                `${mcp.name} (${key})`,
                'red',
                `Server báo trạng thái "${mcp.status}" khi chạy như một job: xem cấu hình của server, hoặc tắt nó cho project này.`,
                { id: `mcp-disable:${key}:${mcp.name}`, label: 'Tắt cho project này' },
              ),
        );
      }

      const view = server.get(key);
      if (!view) continue;
      for (const role of Object.keys(OFFICIAL_UI_TEST_SERVERS) as (keyof UiTestMcp)[]) {
        const name = view.uiTestMcp[role];
        if (!qcDefaultMcps(view.platform, view.uiTestMcp).includes(name)) continue;
        const found = inventory.mcpServers.find((mcp) => mcp.name === name);
        const id = `mcp.${key}.qc-${role}`;
        const title = `MCP test UI ${name} (${key})`;
        if (!found) {
          results.push(
            result(
              id,
              'mcp',
              title,
              'red',
              `Project loại ${view.platform} cần ${OFFICIAL_UI_TEST_SERVERS[role].note} tên "${name}" cho QC, nhưng agent không thấy server này.`,
              { id: `mcp-install:${key}:${role}`, label: `Cài ${name}` },
            ),
          );
        } else if (disabled.has(name)) {
          results.push(
            result(
              id,
              'mcp',
              title,
              'red',
              `Server "${name}" đang bị tắt cho project, nhưng QC bắt buộc dùng nó.`,
              {
                id: `mcp-enable:${key}:${name}`,
                label: 'Bật lại',
              },
            ),
          );
        } else {
          results.push(
            result(
              id,
              'mcp',
              title,
              found.status === 'connected' ? 'green' : 'red',
              `QC test UI bằng "${name}".`,
            ),
          );
        }
      }
      if (needsDevice(view.platform)) {
        const device = deviceReady(ctx);
        results.push(
          device
            ? result(
                `mcp.${key}.device`,
                'mcp',
                `Thiết bị test mobile (${key})`,
                'green',
                `Đang có ${device}.`,
              )
            : result(
                `mcp.${key}.device`,
                'mcp',
                `Thiết bị test mobile (${key})`,
                'yellow',
                'Không có simulator iOS nào đang chạy và không có emulator Android nào kết nối: QC mobile sẽ bị chặn.',
                ctx.platform === 'darwin' ? { id: 'open-simulator', label: 'Mở Simulator' } : undefined,
              ),
        );
      }
    }
    return results;
  },
  async fix(ctx, fixId) {
    const { action, key, arg } = parseFixId(fixId);
    if (action === 'open-simulator') {
      ctx.exec('open', ['-a', 'Simulator']);
      return;
    }
    if (!ctx.config?.projects.some((project) => project.key === key)) return;
    if (action === 'mcp-disable' || action === 'mcp-enable') {
      const known = (storedInventory(ctx, key)?.mcpServers ?? []).map((mcp) => mcp.name);
      // An older build cut `plugin:<plugin>:<server>` at the first colon and stored `plugin`: drop such a
      // fragment (a prefix of a known server that is no server itself) whenever the list is saved again.
      const fragment = (name: string) =>
        !known.includes(name) && known.some((server) => server.startsWith(`${name}:`));
      await updateProjectMcp(ctx, key, (disabled) => {
        const kept = disabled.filter((name) => !fragment(name));
        return action === 'mcp-disable' ? [...kept, arg] : kept.filter((name) => name !== arg);
      });
    } else if (action === 'mcp-install' && arg in OFFICIAL_UI_TEST_SERVERS) {
      const view = (await serverProjects(ctx)).get(key);
      const role = arg as keyof UiTestMcp;
      const name = view?.uiTestMcp[role] ?? role;
      // Already configured (e.g. added by hand, or for another project): nothing to add, only a stale inventory.
      if (ctx.exec('claude', ['mcp', 'get', name]).code !== 0) {
        const added = ctx.exec('claude', [
          'mcp',
          'add',
          '--scope',
          'user',
          name,
          '--',
          ...OFFICIAL_UI_TEST_SERVERS[role].command,
        ]);
        if (added.code !== 0)
          throw new Error(`claude mcp add thất bại: ${added.stderr.trim() || added.stdout.trim()}`);
      }
      // A user-scope server shows up in every project, so every stored inventory is now stale.
      for (const project of ctx.config.projects) await ctx.daemon?.refreshInventory(project.key);
      return;
    } else if (action !== 'refresh-inventory') {
      return;
    }
    await ctx.daemon?.refreshInventory(key);
  },
};
