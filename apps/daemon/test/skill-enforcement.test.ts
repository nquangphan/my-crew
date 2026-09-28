import { describe, expect, it } from 'vitest';
import {
  capabilityGaps,
  capabilityUse,
  capabilityWarning,
  mergeChoices,
} from '../src/roles/skill-enforcement.js';
import type { ToolLogEntry } from '../src/state-db.js';

const entry = (tool: string, target: string | null, decision: 'allow' | 'deny' = 'allow'): ToolLogEntry => ({
  jobId: 'j',
  seq: 0,
  tool,
  target,
  decision,
  reason: null,
  at: '',
});

describe('skill enforcement', () => {
  const log = [
    entry('Skill', 'api-design'),
    entry('Skill', 'security-review', 'deny'),
    entry('mcp__playwright__browser_navigate', '{}'),
    entry('mcp__claude_ai_Figma__get_file', '{}', 'deny'),
  ];

  it('reads what a run really used from the tool log and slash commands', () => {
    const use = capabilityUse(log, ['/ak:plan'], ['playwright', 'claude.ai Figma']);
    expect(use.skillsUsed.sort()).toEqual(['ak:plan', 'api-design']);
    expect(use.mcpsUsed).toEqual(['playwright']);
  });

  it('flags required or selected skills and MCP servers that were never used', () => {
    const use = capabilityUse(log, [], ['playwright', 'claude.ai Figma']);
    const selected = mergeChoices([
      {
        skills: [{ name: 'brainstorm', reason: 'phân tích' }],
        mcps: [{ server: 'claude.ai Figma', reason: 'đọc thiết kế' }],
        noneReason: null,
      },
      { skills: [{ name: 'brainstorm', reason: 'lý do khác' }], mcps: [], noneReason: null },
    ]);
    expect(selected.skills).toEqual([{ name: 'brainstorm', reason: 'phân tích' }]);
    const gaps = capabilityGaps({
      required: { skills: ['api-design', 'security-review'], mcps: ['playwright'] },
      selected,
      used: use,
    });
    expect(gaps).toEqual({
      skillsMissing: ['security-review', 'brainstorm'],
      mcpsMissing: ['claude.ai Figma'],
    });
    const warning = capabilityWarning({
      gaps,
      preflightDone: true,
      required: { skills: ['api-design', 'security-review'], mcps: ['playwright'] },
    });
    expect(warning).toContain('Skill bắt buộc `security-review`');
    expect(warning).toContain('Skill đã chọn `brainstorm`');
    expect(warning).toContain('MCP server đã chọn `claude.ai Figma`');
  });

  it('warns about a run without a preflight and stays quiet when all is used', () => {
    const none = { skillsMissing: [], mcpsMissing: [] };
    expect(
      capabilityWarning({ gaps: none, preflightDone: true, required: { skills: [], mcps: [] } }),
    ).toBeNull();
    expect(
      capabilityWarning({ gaps: none, preflightDone: false, required: { skills: [], mcps: [] } }),
    ).toContain('select_capabilities');
    expect(mergeChoices([{ skills: [], mcps: [], noneReason: 'không có skill phù hợp' }]).noneReason).toBe(
      'không có skill phù hợp',
    );
  });
});
