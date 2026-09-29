import type { AgentRole } from '@crew/shared';
import { mcpToolPrefix } from '../runner/skill-usage.js';
import type { JobKind } from '../state-db.js';

/** Name of the in-process ticket MCP server; its tools reach the model as `mcp__tickets__<tool>`. */
export const TICKET_SERVER = 'tickets';

export const TICKET_TOOL_NAMES = [
  'get_ticket',
  'list_children',
  'comment',
  'ask_owner',
  'update_status',
  'submit_report',
  'docs_flow',
  'docs_where',
  'create_subtask',
  'rate_subtask',
  'retry_subtask',
  'resource_report',
  'cleanup_resources',
  'file_bug',
  'handoff_docs',
  'get_project_catalog',
  'create_pm_ticket',
  'select_capabilities',
  'return_to_dev',
  'reject_work',
  'merge_and_push',
] as const;
export type TicketToolName = (typeof TICKET_TOOL_NAMES)[number];

const EVERY_ROLE: readonly TicketToolName[] = [
  'get_ticket',
  'list_children',
  'comment',
  'ask_owner',
  'update_status',
  'submit_report',
  'docs_flow',
  'docs_where',
  'select_capabilities',
];

const ROLE_EXTRAS: Record<AgentRole, readonly TicketToolName[]> = {
  pm: [
    'create_subtask',
    'rate_subtask',
    'retry_subtask',
    'resource_report',
    'cleanup_resources',
    'reject_work',
    'merge_and_push',
  ],
  qc: ['file_bug'],
  // Dev and bug tickets are assigned to the dev role; the docs job takes over after `handoff_docs`.
  dev: ['handoff_docs', 'return_to_dev'],
  assistant: ['get_project_catalog', 'create_pm_ticket'],
};

/** Dev-role tools that only one job kind may see. */
const KIND_ONLY: Partial<Record<TicketToolName, JobKind>> = {
  // The dev run hands off to the docs job; the docs job hands a refused commit back to dev.
  handoff_docs: 'agent',
  return_to_dev: 'docs_update',
};

/** Ticket tools a run may see. The docs-init job neither hands off nor returns work. */
export function ticketToolsFor(role: AgentRole, kind: JobKind): TicketToolName[] {
  const extras = ROLE_EXTRAS[role].filter((name) => {
    const only = KIND_ONLY[name];
    return only === undefined || only === kind;
  });
  return [...EVERY_ROLE, ...extras];
}

const CODING_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'Skill',
  'Task',
  'Agent',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
];
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'Skill', 'Task', 'Agent', 'TodoWrite', 'WebFetch', 'WebSearch'];

/** Built-in tools pre-approved per role; the guard hook still checks every write and Bash call. */
export function builtinToolsFor(role: AgentRole): string[] {
  return role === 'assistant' ? [...READ_TOOLS] : [...CODING_TOOLS];
}

/**
 * The `allowedTools` of a run: the role's built-in tools, its ticket tools, and every tool of each enabled
 * MCP server in the inventory (a server the owner disabled for the project is left out, so `dontAsk`
 * denies its tools).
 */
export function allowedToolsFor(options: {
  role: AgentRole;
  kind: JobKind;
  mcpServers: readonly string[];
  disabledMcpServers?: readonly string[];
}): string[] {
  const disabled = new Set(options.disabledMcpServers ?? []);
  const ticket = ticketToolsFor(options.role, options.kind).map(
    (name) => `${mcpToolPrefix(TICKET_SERVER)}${name}`,
  );
  const mcp = options.mcpServers
    .filter((server) => server !== TICKET_SERVER && !disabled.has(server))
    .map((server) => `${mcpToolPrefix(server)}*`);
  return [...builtinToolsFor(options.role), ...ticket, ...mcp];
}
