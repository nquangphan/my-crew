import { z } from 'zod';
import { BmadProfile } from './bmad-schemas.js';

/** Decides which UI-test MCP server QC tickets must use. */
export const ProjectPlatform = z.enum(['web', 'mobile', 'web_mobile', 'backend']);
export type ProjectPlatform = z.infer<typeof ProjectPlatform>;

export const DocsStatus = z.enum(['unknown', 'missing', 'initializing', 'ready']);
export type DocsStatus = z.infer<typeof DocsStatus>;

/** Reserved ticket-key scope for `request` tickets. */
export const REQUEST_KEY_SCOPE = 'AST';

export const ProjectKey = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'project keys are 2-10 upper-case letters or digits')
  .refine((key) => key !== REQUEST_KEY_SCOPE, `${REQUEST_KEY_SCOPE} is reserved for requests`);

/**
 * An MCP server name as Claude Code reports it in the inventory: plugin servers are namespaced
 * (`plugin:claude-mem:mcp-search`) and claude.ai connectors carry spaces (`claude.ai Figma`).
 */
export const McpServerName = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9 _.:@/-]{0,199}$/,
    'MCP server names are 1-200 chars of letters, digits, spaces and _ . : @ / -',
  )
  .refine((name) => name === name.trim(), 'MCP server names have no leading or trailing spaces');

/** Maps each UI-test role to the inventory server that plays it. */
export const UiTestMcp = z.object({
  maestro: McpServerName.default('maestro'),
  playwright: McpServerName.default('playwright'),
});
export type UiTestMcp = z.infer<typeof UiTestMcp>;
export const DEFAULT_UI_TEST_MCP: UiTestMcp = { maestro: 'maestro', playwright: 'playwright' };

const UI_TEST_ROLES: Record<ProjectPlatform, readonly (keyof UiTestMcp)[]> = {
  web: ['playwright'],
  mobile: ['maestro'],
  web_mobile: ['maestro', 'playwright'],
  backend: [],
};

/** The MCP servers every QC ticket of a project must carry; they cannot be removed. */
export function qcDefaultMcps(platform: ProjectPlatform, mapping: UiTestMcp): string[] {
  return UI_TEST_ROLES[platform].map((role) => mapping[role]);
}

/**
 * How a QC ticket will be verified. The PM picks one or more when creating (or re-planning) a QC subtask,
 * instead of always being forced onto the project's UI-test MCP servers.
 */
export const TestKind = z.enum(['static_review', 'unit', 'integration', 'api', 'ui_web', 'ui_mobile']);
export type TestKind = z.infer<typeof TestKind>;

/** One row per test kind: Vietnamese label, suggested tooling, and the UI-test MCP role it needs (if any). */
export interface TestKindInfo {
  label: string;
  tooling: string;
  /** The `UiTestMcp` role this kind needs; null when it needs no MCP server. */
  uiRole: keyof UiTestMcp | null;
}

/**
 * The single source of truth for every test kind: reused by the daemon (prompt/tooling hints) and the web
 * (labels, form options) instead of being copied there.
 */
export const TEST_KIND_INFO: Record<TestKind, TestKindInfo> = {
  static_review: {
    label: 'Xem code tĩnh',
    tooling: 'Đọc code, diff review; không chạy chương trình',
    uiRole: null,
  },
  unit: {
    label: 'Unit test',
    tooling: 'Test hàm/module riêng lẻ (vitest, jest, pytest, …)',
    uiRole: null,
  },
  integration: {
    label: 'Integration test',
    tooling: 'Test nhiều thành phần phối hợp (API + DB, service + service, …), không qua giao diện',
    uiRole: null,
  },
  api: {
    label: 'Kiểm thử API',
    tooling: 'Gọi trực tiếp API (script, curl, Postman, supertest, …)',
    uiRole: null,
  },
  ui_web: {
    label: 'Kiểm thử giao diện web',
    tooling: 'Trình duyệt tự động qua MCP Playwright',
    uiRole: 'playwright',
  },
  ui_mobile: {
    label: 'Kiểm thử giao diện mobile',
    tooling: 'Thiết bị/simulator qua MCP Maestro',
    uiRole: 'maestro',
  },
};

/** Platforms that can run a UI test kind; a kind absent here (every non-UI kind) has no platform restriction. */
const UI_TEST_KIND_PLATFORMS: Partial<Record<TestKind, readonly ProjectPlatform[]>> = {
  ui_web: ['web', 'web_mobile'],
  ui_mobile: ['mobile', 'web_mobile'],
};

/** Whether a project's `platform` supports running `kind` (always true for non-UI kinds). */
export function isTestKindSupported(kind: TestKind, platform: ProjectPlatform): boolean {
  const allowed = UI_TEST_KIND_PLATFORMS[kind];
  return !allowed || allowed.includes(platform);
}

/**
 * The UI-test MCP server names a test plan (`testKinds`) requires, per the project's platform and mapping.
 * A kind the platform does not support (see `isTestKindSupported`) contributes no MCP server here; callers
 * still validate platform support separately, to refuse the request instead of silently dropping the kind.
 */
export function uiMcpsForTestKinds(
  testKinds: readonly TestKind[],
  platform: ProjectPlatform,
  mapping: UiTestMcp,
): string[] {
  const roles = new Set(
    testKinds
      .filter((kind) => isTestKindSupported(kind, platform))
      .map((kind) => TEST_KIND_INFO[kind].uiRole)
      .filter((role): role is keyof UiTestMcp => role !== null),
  );
  return [...roles].map((role) => mapping[role]);
}

export const DEFAULT_MAX_CHILDREN_PER_TICKET = 12;

const RepoUrl = z
  .string()
  .max(500)
  .refine((url) => url.startsWith('https://') || url.startsWith('git@'), 'repo URL must be https:// or git@');
const BudgetUsd = z.number().positive().max(1_000_000).nullable();

export const CreateProjectRequest = z.object({
  key: ProjectKey,
  name: z.string().trim().min(1).max(120),
  /** Owner-entered; the only text the assistant uses for triage. */
  description: z.string().trim().min(1).max(10_000),
  repoUrl: RepoUrl,
  defaultBranch: z.string().trim().min(1).max(200).default('main'),
  platform: ProjectPlatform,
  uiTestMcp: UiTestMcp.default(DEFAULT_UI_TEST_MCP),
  maxChildrenPerTicket: z.number().int().min(1).max(200).default(DEFAULT_MAX_CHILDREN_PER_TICKET),
  ticketTreeBudgetUsd: BudgetUsd.default(null),
  dailyBudgetUsd: BudgetUsd.default(null),
});
export type CreateProjectRequest = z.input<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(10_000),
    repoUrl: RepoUrl,
    defaultBranch: z.string().trim().min(1).max(200),
    platform: ProjectPlatform,
    uiTestMcp: UiTestMcp,
    maxChildrenPerTicket: z.number().int().min(1).max(200),
    ticketTreeBudgetUsd: BudgetUsd,
    dailyBudgetUsd: BudgetUsd,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'at least one field is required');
export type UpdateProjectRequest = z.input<typeof UpdateProjectRequest>;

export const Project = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  repoUrl: z.string(),
  defaultBranch: z.string(),
  ownerMachineId: z.string().nullable(),
  docsStatus: DocsStatus,
  platform: ProjectPlatform,
  uiTestMcp: UiTestMcp,
  maxChildrenPerTicket: z.number().int(),
  ticketTreeBudgetUsd: z.number().nullable(),
  dailyBudgetUsd: z.number().nullable(),
  /** The BMAD setup the owning machine reported; read-only for the owner. */
  bmadProfile: BmadProfile.nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof Project>;

export const ProjectListResponse = z.object({ items: z.array(Project) });
export type ProjectListResponse = z.infer<typeof ProjectListResponse>;
