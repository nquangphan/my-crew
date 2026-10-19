import { comparablePath } from '../paths.js';
import type { WorkflowPin } from './pin.js';
import type { CertifiedWorkflow } from './registry.js';

/**
 * Skill và agent dựng sẵn của Claude Code CLI (đo trên claude 2.1.289, 07/10/2026): có mặt ở mọi run, kể cả khi
 * `--setting-sources local`, nên không chặn được và không phải nguồn của owner. CLI thêm skill mới thì bổ sung ở đây.
 */
export const BUILTIN_SKILLS: readonly string[] = [
  'deep-research',
  'design',
  'design-sync',
  'dataviz',
  'update-config',
  'verify',
  'debug',
  'code-review',
  'simplify',
  'batch',
  'fewer-permission-prompts',
  'doctor',
  'loop',
  'schedule',
  'claude-api',
  'workflow-authoring',
  'run',
  'run-skill-generator',
  'plugin-authoring',
];
export const BUILTIN_AGENTS: readonly string[] = [
  'claude',
  'Explore',
  'general-purpose',
  'Plan',
  'statusline-setup',
];

/** Nguồn MCP được phép: connector của tài khoản claude.ai (không đi qua settings) và `.mcp.json` của repo. */
const ALLOWED_MCP_SOURCES = new Set(['claudeai', 'project']);

/**
 * MCP mà Paperclip tự gắn vào mọi run `claude_local` (`source: "dynamic"`, đo trên log run thật 07/10/2026; tool
 * `mcp__Paperclip_projects__*`, `mcp__Paperclip_connections__*`). Chỉ đúng tên và đúng nguồn này; MCP `dynamic` khác
 * vẫn bị chặn.
 */
export const PAPERCLIP_DYNAMIC_MCP: readonly string[] = ['Paperclip projects', 'Paperclip connections'];

function mcpAllowed(name: string, source: string): boolean {
  return ALLOWED_MCP_SOURCES.has(source) || (source === 'dynamic' && PAPERCLIP_DYNAMIC_MCP.includes(name));
}

export interface InitAllowance {
  pin: WorkflowPin;
  pinDir: string;
  /** Khóa `name@marketplace` của plugin mà `.claude/settings.json` đã commit bật (nguồn `project`). */
  projectPlugins: string[];
  /** Tên skill của repo (`.claude/skills` đã commit) và của Paperclip (`.paperclip-runtime`). */
  skills: string[];
  /** Tên agent của repo (`.claude/agents` đã commit). */
  agents: string[];
  /** Checksum cây của một thư mục plugin, null khi không đọc được. */
  checksumOf: (dir: string) => string | null;
}

/** Dòng `system/init` đầu tiên của log stream-json; dòng đầu có thể là `system/hook_started`, dòng không phải JSON bỏ qua. */
export function findInitEvent(log: string): Record<string, unknown> | null {
  for (const line of log.split('\n')) {
    const text = line.trim();
    if (!text.startsWith('{')) continue;
    try {
      const event: unknown = JSON.parse(text);
      if (event !== null && typeof event === 'object') {
        const e = event as Record<string, unknown>;
        if (e.type === 'system' && e.subtype === 'init') return e;
      }
    } catch {
      // Dòng hỏng (log bị cắt): bỏ qua.
    }
  }
  return null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object')
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Workflow của run theo `system/init`: plugin không phải `@builtin` có tên là id của workflow đã chứng nhận. Không có
 * cái nào, hoặc có hơn một id khác nhau (nạp chéo), là vi phạm.
 */
export function selectInitWorkflow(
  init: Record<string, unknown>,
  workflows: readonly CertifiedWorkflow[],
): { workflow: CertifiedWorkflow } | { violation: string } {
  const names = new Set(
    records(init.plugins)
      .filter((p) => !String(p.source ?? '').endsWith('@builtin'))
      .map((p) => String(p.name ?? '')),
  );
  const found = workflows.filter((w) => names.has(w.id));
  if (found.length === 0) return { violation: 'không nạp workflow ghim nào' };
  if (found.length > 1)
    return {
      violation: `nạp nhiều hơn một workflow (${found
        .map((w) => w.id)
        .sort()
        .join(', ')})`,
    };
  return { workflow: found[0] as CertifiedWorkflow };
}

/**
 * So `system/init` của một run với danh sách cho phép. Trả các vi phạm (rỗng là đạt) và số skill của workflow ghim.
 * Không xét `slash_commands`: gồm cả lệnh dựng sẵn của CLI, thay đổi theo bản, và skill đã có trong `skills`.
 */
export function checkInitEvent(
  init: Record<string, unknown>,
  allow: InitAllowance,
): { violations: string[]; pinnedSkills: number } {
  const violations: string[] = [];
  const namespaces = new Set<string>([allow.pin.workflow]);
  const projectPlugins = new Set(allow.projectPlugins);
  let fromPin = false;
  for (const p of records(init.plugins)) {
    const name = String(p.name ?? '');
    const source = String(p.source ?? '');
    const path = String(p.path ?? '');
    if (source.endsWith('@builtin')) {
      namespaces.add(name);
    } else if (name === allow.pin.workflow) {
      const version = String(p.version ?? '');
      if (version === allow.pin.version && comparablePath(path) === comparablePath(allow.pinDir))
        fromPin = true;
      else if (version !== allow.pin.version || allow.checksumOf(path) !== allow.pin.checksum)
        violations.push(
          `plugin ${source} (${path}): WORKFLOW_SOURCE_MISMATCH, khác bản ghim ${allow.pin.version}`,
        );
    } else if (projectPlugins.has(source)) {
      namespaces.add(name);
    } else {
      violations.push(`plugin ${source} (${path}): ngoài danh sách cho phép`);
    }
  }
  if (!fromPin) violations.push(`không nạp ${allow.pin.workflow} từ bản ghim ${allow.pinDir}`);

  const allowedName = (value: string, plain: Set<string>) => {
    const sep = value.indexOf(':');
    return sep > 0 ? namespaces.has(value.slice(0, sep)) : plain.has(value);
  };
  const skills = new Set([...BUILTIN_SKILLS, ...allow.skills]);
  for (const s of strings(init.skills)) {
    if (!allowedName(s, skills))
      violations.push(
        `skill ${s}: không rõ nguồn (không dựng sẵn, không của repo, Paperclip hay plugin được phép)`,
      );
  }
  const agents = new Set([...BUILTIN_AGENTS, ...allow.agents]);
  for (const a of strings(init.agents)) {
    if (!allowedName(a, agents)) violations.push(`agent ${a}: không rõ nguồn`);
  }
  for (const m of records(init.mcp_servers)) {
    const source = String(m.source ?? '');
    if (!mcpAllowed(String(m.name ?? ''), source))
      violations.push(`mcp ${String(m.name ?? '')} (source=${source}): ngoài danh sách cho phép`);
  }
  const pinnedSkills = strings(init.skills).filter((s) => s.startsWith(`${allow.pin.workflow}:`)).length;
  return { violations, pinnedSkills };
}
