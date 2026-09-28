import type { DaemonProject, SkillInventory } from '@crew/shared';
import { type DaemonConfig, type ProjectConfig, saveConfig } from '../config.js';
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

/** Saves one project's local settings and applies them to the running daemon at once. */
export function updateProjectConfig(
  ctx: HealthContext,
  key: string,
  change: (project: ProjectConfig) => ProjectConfig,
): DaemonConfig | null {
  if (!ctx.config) return null;
  const projects = ctx.config.projects.map((project) => (project.key === key ? change(project) : project));
  const saved = saveConfig(ctx.paths.config, { ...ctx.config, projects });
  ctx.config = saved;
  ctx.daemon?.updateConfig(saved);
  return saved;
}
