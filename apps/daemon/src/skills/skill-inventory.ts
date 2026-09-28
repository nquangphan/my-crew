import { randomUUID } from 'node:crypto';
import {
  type McpServerStatus,
  type SDKUserMessage,
  type SlashCommand,
  query as sdkQuery,
} from '@anthropic-ai/claude-agent-sdk';
import type { InventoryMcpServer, InventorySkill, SkillInventory } from '@crew/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { JOB_TAG } from '../runner/resource-tracker.js';
import { TICKET_SERVER } from '../tools/tool-scopes.js';

/** Trailing source marker Claude Code appends to command descriptions, e.g. ` (project)`. */
const SOURCE_SUFFIX = /\s*\((project|user|claude\.ai sync)\)\s*$/;

/**
 * One inventory skill per non-built-in command the session offers. The description is the SKILL.md (or
 * command file) frontmatter `description`; the source comes from Claude Code's marker, and a namespaced
 * name without a marker is a plugin skill (`plugin:skill`).
 */
export function skillsFromCommands(commands: readonly SlashCommand[]): InventorySkill[] {
  const skills = new Map<string, InventorySkill>();
  for (const command of commands) {
    if (command.builtin) continue;
    const marker = SOURCE_SUFFIX.exec(command.description)?.[1];
    const source: InventorySkill['source'] =
      marker === 'project'
        ? 'project'
        : marker !== undefined
          ? 'user'
          : command.name.includes(':')
            ? 'plugin'
            : 'user';
    const description = command.description.replace(SOURCE_SUFFIX, '').trim().slice(0, 5_000);
    skills.set(command.name, { name: command.name.slice(0, 200), source, description });
  }
  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const MCP_SOURCES: Record<string, InventoryMcpServer['source']> = {
  user: 'user',
  local: 'local',
  project: 'project',
  plugin: 'plugin',
  dynamic: 'plugin',
  claudeai: 'connector',
  managed: 'user',
  enterprise: 'user',
};

export type ToolLister = (
  status: McpServerStatus,
) => Promise<{ name: string; description?: string }[] | null>;

/**
 * Lists a server's tools with descriptions through an MCP client (stdio and http/sse servers the daemon
 * can reach directly). Returns null when the server cannot be reached; connectors keep names only.
 */
export function createToolLister(
  options: { cwd: string; timeoutMs?: number } = { cwd: process.cwd() },
): ToolLister {
  return async (status) => {
    const config = status.config as Record<string, unknown> | undefined;
    if (!config || status.status !== 'connected') return null;
    const type = (config.type as string | undefined) ?? 'stdio';
    let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;
    if (type === 'stdio' && typeof config.command === 'string') {
      transport = new StdioClientTransport({
        command: config.command,
        args: Array.isArray(config.args) ? config.args.map(String) : [],
        env: {
          ...(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<
            string,
            string
          >),
          ...((config.env as Record<string, string> | undefined) ?? {}),
          [JOB_TAG]: `inventory-${randomUUID()}`,
        },
        cwd: options.cwd,
        stderr: 'ignore',
      });
    } else if ((type === 'http' || type === 'sse') && typeof config.url === 'string') {
      const init = { headers: (config.headers as Record<string, string> | undefined) ?? {} };
      transport =
        type === 'http'
          ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit: init })
          : new SSEClientTransport(new URL(config.url), { requestInit: init });
    } else {
      return null;
    }
    const client = new Client({ name: '2p-crew-inventory', version: '1.0.0' });
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), options.timeoutMs ?? 10_000),
    );
    try {
      const listed = await Promise.race([
        (async () => {
          await client.connect(transport);
          const { tools } = await client.listTools();
          return tools.map((t) => ({
            name: t.name,
            ...(t.description ? { description: t.description.slice(0, 5_000) } : {}),
          }));
        })(),
        timeout,
      ]);
      return listed;
    } catch {
      return null;
    } finally {
      await client.close().catch(() => undefined);
    }
  };
}

export async function mcpServersFromStatus(
  statuses: readonly McpServerStatus[],
  listTools: ToolLister | null,
): Promise<InventoryMcpServer[]> {
  const servers: InventoryMcpServer[] = [];
  for (const status of statuses) {
    if (status.source === 'sdk' || status.name === TICKET_SERVER) continue;
    const source = MCP_SOURCES[status.source ?? status.scope ?? 'user'] ?? 'user';
    const described = source === 'connector' || !listTools ? null : await listTools(status);
    const names = (status.tools ?? []).map((t) => ({ name: t.name.slice(0, 200) }));
    const tools = described ?? names;
    servers.push({
      name: status.name.slice(0, 200),
      source,
      status: status.status,
      tools: tools.slice(0, 1_000),
    });
  }
  return servers.sort((a, b) => a.name.localeCompare(b.name));
}

export interface ProbeOptions {
  /** A probe worktree prepared like a job worktree, so the inventory matches what agents really see. */
  cwd: string;
  env: Record<string, string | undefined>;
  query?: typeof sdkQuery;
  /** Project `.mcp.json` servers to approve for the probe. */
  enabledMcpjsonServers?: string[];
  listTools?: ToolLister | null;
  timeoutMs?: number;
  pathToClaudeCodeExecutable?: string;
}

export interface ProbeResult {
  inventory: SkillInventory;
  account: { subscriptionType?: string; apiProvider?: string; apiKeySource?: string } | null;
}

const withTimeout = <T>(promise: Promise<T>, ms: number, what: string) =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms),
    ),
  ]);

/**
 * Reads the skill and MCP inventory from a real SDK session without sending a turn (no model cost): the
 * session's command list (with SKILL.md descriptions) and its MCP server status, then closes it.
 */
export async function probeInventory(options: ProbeOptions): Promise<ProbeResult> {
  const query = options.query ?? sdkQuery;
  const timeoutMs = options.timeoutMs ?? 60_000;
  let release: () => void = () => {};
  const idle = new Promise<void>((resolve) => {
    release = resolve;
  });
  // A prompt stream that never yields a message: the session initializes but never calls the model.
  const noTurn: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await idle;
        return { done: true, value: undefined };
      },
    }),
  };
  const q = query({
    prompt: noTurn,
    options: {
      cwd: options.cwd,
      env: options.env,
      settingSources: ['user', 'project', 'local'],
      permissionMode: 'dontAsk',
      ...(options.enabledMcpjsonServers
        ? { settings: { enabledMcpjsonServers: options.enabledMcpjsonServers } }
        : {}),
      ...(options.pathToClaudeCodeExecutable
        ? { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable }
        : {}),
    },
  });
  const drain = (async () => {
    for await (const _message of q) {
      // hook and status messages only; no turn is sent
    }
  })().catch(() => undefined);
  try {
    const init = await withTimeout(q.initializationResult(), timeoutMs, 'SDK initialize');
    let statuses: McpServerStatus[] = [];
    const deadline = Date.now() + Math.min(timeoutMs, 30_000);
    for (;;) {
      statuses = await withTimeout(q.mcpServerStatus(), timeoutMs, 'MCP status');
      if (!statuses.some((s) => s.status === 'pending') || Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const listTools =
      options.listTools === undefined ? createToolLister({ cwd: options.cwd }) : options.listTools;
    return {
      inventory: {
        skills: skillsFromCommands(init.commands),
        mcpServers: await mcpServersFromStatus(statuses, listTools),
      },
      account: init.account ?? null,
    };
  } finally {
    release();
    q.close();
    await drain;
  }
}
