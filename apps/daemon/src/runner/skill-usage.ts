import type { ToolLogEntry } from '../state-db.js';

/** Skill names invoked in a run: the Skill tool calls in the tool log plus `/skill` commands in prompts. */
export function skillsInvoked(log: readonly ToolLogEntry[], slashCommands: readonly string[] = []): string[] {
  const names = new Set<string>();
  for (const entry of log) {
    if (entry.tool === 'Skill' && entry.decision === 'allow' && entry.target) {
      names.add(entry.target.replace(/^\//, '').trim());
    }
  }
  for (const command of slashCommands) names.add(command.replace(/^\//, '').trim());
  names.delete('');
  return [...names];
}

/** `/name` commands found in a user message (`<command-name>/name</command-name>` or a leading `/name`). */
export function slashCommandsIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g))
    found.add(match[1] as string);
  const leading = /^\/([A-Za-z0-9][\w:.-]*)/.exec(text.trim());
  if (leading) found.add(leading[1] as string);
  return [...found];
}

/**
 * Normalizes an MCP server name the way Claude Code builds tool names (`mcp__<server>__<tool>`): every
 * character outside `[A-Za-z0-9_-]` becomes `_`.
 */
export function mcpToolPrefix(server: string): string {
  return `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}__`;
}

/** MCP servers (by inventory name) with at least one allowed call in the tool log. */
export function mcpServersUsed(log: readonly ToolLogEntry[], servers: readonly string[]): string[] {
  const used = new Set<string>();
  for (const server of servers) {
    const prefix = mcpToolPrefix(server);
    if (log.some((entry) => entry.decision === 'allow' && entry.tool.startsWith(prefix))) used.add(server);
  }
  return [...used];
}
