import { randomUUID } from 'node:crypto';
import type { DaemonProject, SkillInventory } from '@crew/shared';
import type { HealthContext } from './types.js';

/** The server's view of the projects (repo URL, type, MCP mapping); empty when the server is unreachable. */
export async function serverProjects(ctx: HealthContext): Promise<Map<string, DaemonProject>> {
  if (!ctx.vps || !ctx.tokenStore.get()) return new Map();
  try {
    const view = await ctx.vps.listProjects();
    return new Map(view.items.map((item) => [item.key, item]));
  } catch {
    return new Map();
  }
}

/** The inventory the daemon last probed inside the project's job-like worktree (kept in the state DB). */
export function storedInventory(ctx: HealthContext, projectKey: string | null): SkillInventory | null {
  const raw = ctx.state?.getMeta(`inventory:${projectKey ?? ''}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SkillInventory;
  } catch {
    return null;
  }
}

/**
 * Switches MCP servers of a project this machine owns: a new revision of the project's server setting
 * (through the running daemon, which applies it at once, or straight to the server from the CLI).
 */
export async function updateProjectMcp(
  ctx: HealthContext,
  key: string,
  change: (disabled: readonly string[]) => string[],
): Promise<void> {
  const project = ctx.config?.projects.find((item) => item.key === key);
  if (!project) return;
  const next = [...new Set(change(project.disabledMcpServers))];
  const note = 'Sửa từ bảng sức khỏe của máy';
  if (ctx.daemon) {
    await ctx.daemon.setProjectMcp(key, next, note);
  } else if (ctx.vps) {
    await ctx.vps.putProjectMcp(
      key,
      { disabledMcpServers: next, note },
      `project-mcp:${key}:${randomUUID()}`,
    );
  } else {
    throw new Error('Không kết nối được server: MCP của dự án được lưu trên server.');
  }
  if (ctx.config) {
    ctx.config = {
      ...ctx.config,
      projects: ctx.config.projects.map((item) =>
        item.key === key ? { ...item, disabledMcpServers: next } : item,
      ),
    };
  }
}
