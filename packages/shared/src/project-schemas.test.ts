import { describe, expect, it } from 'vitest';
import { SubmitReportRequest } from './api-schemas.js';
import {
  DEFAULT_UI_TEST_MCP,
  isTestKindSupported,
  McpServerName,
  TEST_KIND_INFO,
  TestKind,
  uiMcpsForTestKinds,
} from './project-schemas.js';

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

describe('TestKind', () => {
  it('has exactly one info row per kind, with a UI role only for ui_web/ui_mobile', () => {
    expect(Object.keys(TEST_KIND_INFO).sort()).toEqual([...TestKind.options].sort());
    expect(TEST_KIND_INFO.ui_web.uiRole).toBe('playwright');
    expect(TEST_KIND_INFO.ui_mobile.uiRole).toBe('maestro');
    for (const kind of ['static_review', 'unit', 'integration', 'api'] as const) {
      expect(TEST_KIND_INFO[kind].uiRole).toBeNull();
    }
  });
});

describe('isTestKindSupported', () => {
  it('lets ui_web run only on web and web_mobile projects', () => {
    expect(isTestKindSupported('ui_web', 'web')).toBe(true);
    expect(isTestKindSupported('ui_web', 'web_mobile')).toBe(true);
    expect(isTestKindSupported('ui_web', 'mobile')).toBe(false);
    expect(isTestKindSupported('ui_web', 'backend')).toBe(false);
  });

  it('lets ui_mobile run only on mobile and web_mobile projects', () => {
    expect(isTestKindSupported('ui_mobile', 'mobile')).toBe(true);
    expect(isTestKindSupported('ui_mobile', 'web_mobile')).toBe(true);
    expect(isTestKindSupported('ui_mobile', 'web')).toBe(false);
    expect(isTestKindSupported('ui_mobile', 'backend')).toBe(false);
  });

  it('lets a backend project run no UI kind, and lets every platform run non-UI kinds', () => {
    for (const platform of ['web', 'mobile', 'web_mobile', 'backend'] as const) {
      for (const kind of ['static_review', 'unit', 'integration', 'api'] as const) {
        expect(isTestKindSupported(kind, platform), `${kind} on ${platform}`).toBe(true);
      }
    }
    expect(isTestKindSupported('ui_web', 'backend')).toBe(false);
    expect(isTestKindSupported('ui_mobile', 'backend')).toBe(false);
  });
});

describe('uiMcpsForTestKinds', () => {
  it('needs no MCP server for a plan with only non-UI kinds', () => {
    expect(uiMcpsForTestKinds(['api', 'integration'], 'web', DEFAULT_UI_TEST_MCP)).toEqual([]);
    expect(uiMcpsForTestKinds(['api', 'integration'], 'web_mobile', DEFAULT_UI_TEST_MCP)).toEqual([]);
  });

  it("resolves ui_web to the project's own playwright name, even a non-default one", () => {
    const mapping = { maestro: 'maestro', playwright: 'e2e-playwright' };
    expect(uiMcpsForTestKinds(['ui_web'], 'web', mapping)).toEqual(['e2e-playwright']);
  });

  it('resolves both roles for a plan with ui_web and ui_mobile on a web_mobile project', () => {
    const mcps = uiMcpsForTestKinds(['ui_web', 'ui_mobile'], 'web_mobile', DEFAULT_UI_TEST_MCP);
    expect(mcps.sort()).toEqual(['maestro', 'playwright']);
  });

  it('drops a UI kind the platform does not support instead of resolving it', () => {
    expect(uiMcpsForTestKinds(['ui_mobile'], 'web', DEFAULT_UI_TEST_MCP)).toEqual([]);
  });
});
