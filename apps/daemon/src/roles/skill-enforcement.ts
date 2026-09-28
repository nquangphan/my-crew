import { mcpServersUsed, skillsInvoked } from '../runner/skill-usage.js';
import type { CapabilityChoice, ToolLogEntry } from '../state-db.js';

export interface CapabilityUse {
  skillsUsed: string[];
  mcpsUsed: string[];
}

export interface CapabilityGaps {
  /** Required or selected skills that were never invoked. */
  skillsMissing: string[];
  /** Required or selected MCP servers none of whose tools was called. */
  mcpsMissing: string[];
}

const normalize = (name: string) => name.replace(/^\//, '').trim();

/** Skills and MCP servers actually used, from the tool log (Skill calls, `/skill` commands, `mcp__<server>__*`). */
export function capabilityUse(
  log: readonly ToolLogEntry[],
  slashCommands: readonly string[],
  knownServers: readonly string[],
): CapabilityUse {
  return { skillsUsed: skillsInvoked(log, slashCommands), mcpsUsed: mcpServersUsed(log, knownServers) };
}

/** Merges several preflight choices; the first reason for a name wins. */
export function mergeChoices(choices: readonly (CapabilityChoice | null | undefined)[]): CapabilityChoice {
  const skills = new Map<string, string>();
  const mcps = new Map<string, string>();
  let noneReason: string | null = null;
  for (const choice of choices) {
    if (!choice) continue;
    for (const skill of choice.skills) if (!skills.has(skill.name)) skills.set(skill.name, skill.reason);
    for (const mcp of choice.mcps) if (!mcps.has(mcp.server)) mcps.set(mcp.server, mcp.reason);
    noneReason = noneReason ?? choice.noneReason;
  }
  return {
    skills: [...skills].map(([name, reason]) => ({ name, reason })),
    mcps: [...mcps].map(([server, reason]) => ({ server, reason })),
    noneReason: skills.size + mcps.size === 0 ? noneReason : null,
  };
}

/** `required ∪ selected − used`, for skills and for MCP servers. */
export function capabilityGaps(input: {
  required: { skills: readonly string[]; mcps: readonly string[] };
  selected: CapabilityChoice;
  used: CapabilityUse;
}): CapabilityGaps {
  const usedSkills = new Set(input.used.skillsUsed.map(normalize));
  const usedMcps = new Set(input.used.mcpsUsed);
  const skills = [
    ...new Set([...input.required.skills, ...input.selected.skills.map((s) => s.name)].map(normalize)),
  ];
  const mcps = [...new Set([...input.required.mcps, ...input.selected.mcps.map((m) => m.server)])];
  return {
    skillsMissing: skills.filter((skill) => !usedSkills.has(skill)),
    mcpsMissing: mcps.filter((server) => !usedMcps.has(server)),
  };
}

/**
 * The warning comment for a run whose preflight picks or required capabilities went unused, or that never
 * ran the preflight. Null when there is nothing to warn about.
 */
export function capabilityWarning(input: {
  gaps: CapabilityGaps;
  preflightDone: boolean;
  required: { skills: readonly string[]; mcps: readonly string[] };
}): string | null {
  const lines: string[] = [];
  if (!input.preflightDone) {
    lines.push('- Lượt chạy không ghi lại bước kiểm tra skill/MCP (`select_capabilities`).');
  }
  for (const skill of input.gaps.skillsMissing) {
    const kind = input.required.skills.includes(skill) ? 'bắt buộc' : 'đã chọn';
    lines.push(`- Skill ${kind} \`${skill}\` chưa được gọi.`);
  }
  for (const server of input.gaps.mcpsMissing) {
    const kind = input.required.mcps.includes(server) ? 'bắt buộc' : 'đã chọn';
    lines.push(`- MCP server ${kind} \`${server}\` chưa được dùng.`);
  }
  if (lines.length === 0) return null;
  return [
    '⚠️ Cảnh báo skill/MCP (daemon ghi từ nhật ký công cụ):',
    ...lines,
    'PM sẽ từ chối khi nghiệm thu nếu không có giải thích hợp lý trong bình luận.',
  ].join('\n');
}
