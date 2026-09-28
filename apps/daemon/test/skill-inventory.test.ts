import { fileURLToPath } from 'node:url';
import type { McpServerStatus, Query, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import {
  createToolLister,
  mcpServersFromStatus,
  probeInventory,
  skillsFromCommands,
} from '../src/skills/skill-inventory.js';

const ECHO = fileURLToPath(new URL('./fixtures/echo-mcp-server.mjs', import.meta.url));

const commands: SlashCommand[] = [
  { name: 'ak:scout', description: 'Tìm file liên quan nhanh. (project)', argumentHint: '' },
  { name: 'shop-domain', description: 'Nghiệp vụ cửa hàng (project)', argumentHint: '' },
  { name: 'my-notes', description: 'Ghi chú cá nhân (user)', argumentHint: '' },
  { name: 'synced-skill', description: 'Đồng bộ từ claude.ai (claude.ai sync)', argumentHint: '' },
  { name: 'claude-mem:mem-search', description: 'Tìm trong bộ nhớ', argumentHint: '' },
  { name: 'review', description: 'Built-in review', argumentHint: '', builtin: true },
];

describe('skill inventory', () => {
  it('maps commands to skills with description and source; built-ins are left out', () => {
    expect(skillsFromCommands(commands)).toEqual([
      { name: 'ak:scout', source: 'project', description: 'Tìm file liên quan nhanh.' },
      { name: 'claude-mem:mem-search', source: 'plugin', description: 'Tìm trong bộ nhớ' },
      { name: 'my-notes', source: 'user', description: 'Ghi chú cá nhân' },
      { name: 'shop-domain', source: 'project', description: 'Nghiệp vụ cửa hàng' },
      { name: 'synced-skill', source: 'user', description: 'Đồng bộ từ claude.ai' },
    ]);
  });

  it('records MCP servers with source, status and tool descriptions read over MCP', async () => {
    const statuses: McpServerStatus[] = [
      { name: 'tickets', status: 'connected', source: 'sdk' },
      {
        name: 'echo',
        status: 'connected',
        source: 'project',
        tools: [{ name: 'say' }],
        config: { type: 'stdio', command: process.execPath, args: [ECHO] },
      },
      { name: 'claude.ai Figma', status: 'connected', source: 'claudeai', tools: [{ name: 'get_file' }] },
      {
        name: 'broken',
        status: 'failed',
        source: 'user',
        config: { type: 'stdio', command: '/nonexistent' },
      },
    ];
    const servers = await mcpServersFromStatus(
      statuses,
      createToolLister({ cwd: process.cwd(), timeoutMs: 15_000 }),
    );
    expect(servers).toEqual([
      { name: 'broken', source: 'user', status: 'failed', tools: [] },
      { name: 'claude.ai Figma', source: 'connector', status: 'connected', tools: [{ name: 'get_file' }] },
      {
        name: 'echo',
        source: 'project',
        status: 'connected',
        tools: [{ name: 'say', description: 'Lặp lại một từ' }],
      },
    ]);
  });

  it('probes a session without sending a turn and approves the project servers it was given', async () => {
    let seen: Record<string, unknown> | undefined;
    let closed = false;
    const query = ((params: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
      seen = params.options;
      let statusCalls = 0;
      const iterator = {
        [Symbol.asyncIterator]: () => {
          const inner = params.prompt[Symbol.asyncIterator]();
          // The probe's prompt never yields; the session ends when it does.
          return { next: async () => ({ done: true as const, value: await inner.next() }) };
        },
      };
      return Object.assign(iterator, {
        initializationResult: async () => ({ commands, account: { subscriptionType: 'Claude Max' } }),
        mcpServerStatus: async () => {
          statusCalls += 1;
          return [
            {
              name: 'echo',
              status: statusCalls < 2 ? 'pending' : 'connected',
              source: 'project',
              tools: [{ name: 'say' }],
            },
          ];
        },
        close: () => {
          closed = true;
        },
      }) as unknown as Query;
    }) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;
    const result = await probeInventory({
      cwd: '/work',
      env: { PATH: '/bin' },
      query,
      enabledMcpjsonServers: ['echo'],
      listTools: null,
    });
    expect(seen).toMatchObject({
      cwd: '/work',
      settingSources: ['user', 'project', 'local'],
      settings: { enabledMcpjsonServers: ['echo'] },
    });
    expect(result.inventory.skills).toHaveLength(5);
    expect(result.inventory.mcpServers).toEqual([
      { name: 'echo', source: 'project', status: 'connected', tools: [{ name: 'say' }] },
    ]);
    expect(result.account?.subscriptionType).toBe('Claude Max');
    expect(closed).toBe(true);
  });
});
