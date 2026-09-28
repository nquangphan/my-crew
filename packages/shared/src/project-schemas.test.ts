import { describe, expect, it } from 'vitest';
import { SubmitReportRequest } from './api-schemas.js';
import { McpServerName } from './project-schemas.js';

describe('McpServerName', () => {
  it('accepts server names as Claude Code reports them in the inventory', () => {
    for (const name of [
      'playwright',
      'maestro',
      'plugin:claude-mem:mcp-search',
      'claude.ai Figma',
      'MCP_DOCKER',
    ]) {
      expect(McpServerName.safeParse(name).success, name).toBe(true);
    }
  });

  it('refuses empty names, padding and control characters', () => {
    for (const name of ['', ' playwright', 'playwright ', 'a\nb', ':x', 'x'.repeat(201)]) {
      expect(McpServerName.safeParse(name).success, JSON.stringify(name)).toBe(false);
    }
  });

  it('lets a report record the MCP servers a run really used, plugin and connector servers included', () => {
    const report = SubmitReportRequest.safeParse({
      summaryMd: 'ok',
      docsFirst: true,
      mcpsUsed: ['plugin:claude-mem:mcp-search', 'claude.ai Claude Docs'],
      mcpsSelected: [{ server: 'claude.ai Figma', reason: 'đọc thiết kế' }],
    });
    expect(report.success).toBe(true);
  });
});
