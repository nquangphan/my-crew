import { z } from 'zod';
import { type Complexity, Effort, SelectableModel } from './agent-schemas.js';
import { McpServerName, ProjectKey } from './project-schemas.js';

/**
 * Server-managed settings: role prompts, the agent guard's path rules, the model map, machine resources,
 * budgets and per-project MCP switches. Each change is a new versioned revision (with author, time and a
 * change note) of one setting key; the newest revision of a key is the active one. The daemon fetches the
 * settings that apply to its machine (bundled default ← global ← machine or project override), caches the
 * last good copy and falls back to its bundled defaults for anything invalid or unreachable.
 *
 * Owner invariants stay in code and no setting can change them: docs work always runs on sonnet, Fable is
 * never used, and `AGENTS.md` / `CLAUDE.md` stay protected agent instructions.
 */

// ---------------------------------------------------------------------------
// Kinds and scopes
// ---------------------------------------------------------------------------

export const SettingsKind = z.enum([
  'prompt',
  'policy',
  'models',
  'budgets',
  'resources',
  'project_mcp',
  'project_folders',
]);
export type SettingsKind = z.infer<typeof SettingsKind>;

/** `global` applies to every machine; a `machine` or `project` revision overrides it for that scope. */
export const SettingsScope = z.enum(['global', 'machine', 'project']);
export type SettingsScope = z.infer<typeof SettingsScope>;

/** The scopes each kind may be saved at. */
export const KIND_SCOPES: Record<SettingsKind, readonly SettingsScope[]> = {
  prompt: ['global'],
  policy: ['global'],
  models: ['global', 'machine'],
  budgets: ['global', 'machine'],
  resources: ['machine'],
  project_mcp: ['project'],
  project_folders: ['machine'],
};

export const SETTINGS_KIND_LABEL: Record<SettingsKind, string> = {
  prompt: 'Prompt',
  policy: 'Quy tắc',
  models: 'Models',
  budgets: 'Ngân sách',
  resources: 'Tài nguyên máy',
  project_mcp: 'MCP của dự án',
  project_folders: 'Thư mục dự án trên máy',
};

// ---------------------------------------------------------------------------
// Role prompts
// ---------------------------------------------------------------------------

/**
 * Every role prompt and partial the daemon renders (`apps/daemon/src/roles/prompts/<name>.md`). A partial
 * (name starting with `_`) is included by a stage prompt with `{{> _name}}`; partials include nothing.
 */
export const PROMPT_CATALOG = [
  { name: 'assistant-triage', label: 'Trợ lý: định tuyến yêu cầu' },
  { name: 'assistant-close', label: 'Trợ lý: tổng hợp và đóng yêu cầu' },
  { name: 'pm-analyze', label: 'PM: phân tích và chia việc' },
  { name: 'pm-monitor', label: 'PM: theo dõi subtask' },
  { name: 'pm-accept', label: 'PM: nghiệm thu, merge và đẩy lên' },
  { name: 'dev', label: 'Dev: viết code và test' },
  { name: 'docs-update', label: 'Docs: cập nhật docs và commit' },
  { name: 'qc', label: 'QC: kiểm thử' },
  { name: 'docs-init', label: 'Docs: khởi tạo docs' },
  { name: '_shared-rules', label: 'Phần chung: luật dùng chung' },
  { name: '_capability-preflight', label: 'Phần chung: chọn skill và MCP' },
] as const;

export const PROMPT_NAMES = PROMPT_CATALOG.map((entry) => entry.name) as [
  (typeof PROMPT_CATALOG)[number]['name'],
  ...(typeof PROMPT_CATALOG)[number]['name'][],
];
export const PromptName = z.enum(PROMPT_NAMES);
export type PromptName = z.infer<typeof PromptName>;

export const isPartialPrompt = (name: string): boolean => name.startsWith('_');

/**
 * The variables every prompt may use (`{{name}}`); the daemon fills each one for every stage, empty when it
 * does not apply to the run. Descriptions are shown in the web editor's help.
 */
export const PROMPT_VARIABLES: Readonly<Record<string, string>> = {
  header: 'Đầu prompt: vai trò, ticket, dự án, lý do lượt chạy, tiêu đề và mô tả ticket',
  stage_label: 'Tên bước của vai trò (ví dụ "dev viết code và test")',
  required_capabilities: 'Skill và MCP ticket bắt buộc dùng',
  project_key: 'Key dự án',
  ticket_key: 'Key ticket',
  default_branch: 'Nhánh mặc định của dự án',
  complexity_map: 'Bảng độ phức tạp → model/effort và các model được phép',
  flows: 'Các flow docs của ticket',
  test_command: 'Lệnh test của dự án',
  close_status: 'Trạng thái trợ lý đặt khi đóng yêu cầu (done hoặc in_review)',
  standard: 'Đường dẫn chuẩn docs (STANDARD.md) cho docs-init',
  hooks_note: 'Ghi chú về hook git của docs-init',
  review_base: 'Nhánh QC so sánh khi review',
  ui_test: 'Yêu cầu test UI của QC (hoặc lý do không cần)',
  handoff: 'Bàn giao của dev cho job docs',
  paired_head: 'head_sha của ticket dev mà QC kiểm thử',
  paired_key: 'Key ticket dev mà QC kiểm thử',
  cleanup_notes: 'Nhật ký dọn tài nguyên của các subtask (PM)',
  notes: 'Ghi chú thêm của daemon (khởi động lại, lần thử lại, lời gọi @pm, …)',
};

/** `{{> _partial}}`: includes a partial (one level). Shared with the daemon's renderer. */
export const PROMPT_PARTIAL_PATTERN = /\{\{>\s*([_a-z0-9-]+)\s*\}\}/g;
/** `{{name}}`: a variable. Shared with the daemon's renderer. */
export const PROMPT_VARIABLE_PATTERN = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g;

export const PROMPT_MAX_CHARS = 100_000;

/**
 * Problems of one prompt text: empty or too long, an unknown variable, an unknown partial, or a partial that
 * includes another partial. An empty list means the daemon can render it.
 */
export function validatePromptTemplate(name: string, text: string): string[] {
  const errors: string[] = [];
  if (text.trim() === '') errors.push('Prompt không được để trống.');
  if (text.length > PROMPT_MAX_CHARS) errors.push(`Prompt dài quá ${PROMPT_MAX_CHARS} ký tự.`);
  for (const [, partial] of text.matchAll(PROMPT_PARTIAL_PATTERN)) {
    if (isPartialPrompt(name)) {
      errors.push(`Phần chung không được chèn phần chung khác ({{> ${partial}}}).`);
    } else if (!isPartialPrompt(partial ?? '') || !PROMPT_NAMES.includes(partial as PromptName)) {
      errors.push(`Không có phần chung "${partial}".`);
    }
  }
  const unknown = new Set<string>();
  for (const [, variable] of text.matchAll(PROMPT_VARIABLE_PATTERN)) {
    if (variable && !Object.hasOwn(PROMPT_VARIABLES, variable)) unknown.add(variable);
  }
  for (const variable of unknown) errors.push(`Không có biến {{${variable}}}.`);
  return [...new Set(errors)];
}

export const PromptContent = z.object({ text: z.string().max(PROMPT_MAX_CHARS) }).strict();
export type PromptContent = z.infer<typeof PromptContent>;

// ---------------------------------------------------------------------------
// Guard path rules
// ---------------------------------------------------------------------------

/**
 * A repo-relative path glob: `*` matches within one path segment, `?` one character, `**` any number of
 * segments, and `dir/**` also matches `dir` itself. Always relative to the repo root, never leaving it.
 */
export const PathGlob = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._\-/*?]+$/, 'chỉ gồm chữ, số và . _ - / * ?')
  .refine((glob) => !glob.startsWith('/') && !glob.endsWith('/'), 'không bắt đầu hay kết thúc bằng /')
  .refine((glob) => !glob.split('/').some((segment) => segment === '' || segment === '..'), {
    message: 'không có đoạn rỗng hay ..',
  });

const GlobList = z.array(PathGlob).max(100);

export const GuardPolicy = z
  .object({
    /** Docs paths: a dev run may not write them, and a diff touching only them needs no QC UI test. */
    docsPaths: GlobList,
    /** Paths no agent run except docs-init may write (mirrors crew-docs rule R6). */
    protectedPaths: GlobList,
    /** Everything the docs_update job may write. */
    docsUpdateWritePaths: GlobList,
    /** QC must run its UI-test MCP only when the change under test touches something outside `docsPaths`. */
    qcUiTestOnlyForNonDocs: z.boolean(),
  })
  .strict();
export type GuardPolicy = z.infer<typeof GuardPolicy>;

/** The rules the daemon shipped with (owner decisions of 2026-09-29), used when no revision exists. */
export const DEFAULT_GUARD_POLICY: GuardPolicy = {
  docsPaths: ['docs/**', '*.md'],
  protectedPaths: [
    '.claude/**',
    '.githooks/**',
    'CLAUDE.md',
    'AGENTS.md',
    '.husky/**',
    'lefthook.yml',
    'lefthook.yaml',
    '.lefthook.yml',
    '.lefthook.yaml',
    '.github/workflows/crew-docs.yml',
    '.github/crew-docs/**',
  ],
  docsUpdateWritePaths: ['docs/**', '*.md'],
  qcUiTestOnlyForNonDocs: true,
};

const globCache = new Map<string, RegExp>();

function globRegExp(glob: string): RegExp {
  const cached = globCache.get(glob);
  if (cached) return cached;
  const dirTail = glob.endsWith('/**');
  const body = dirTail ? glob.slice(0, -3) : glob;
  let source = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch === '*' && body[i + 1] === '*') {
      i++;
      if (body[i + 1] === '/') {
        i++;
        source += '(?:.*/)?';
      } else {
        source += '.*';
      }
    } else if (ch === '*') {
      source += '[^/]*';
    } else if (ch === '?') {
      source += '[^/]';
    } else {
      source += ch.replace(/[.+^${}()|[\]\\-]/g, '\\$&');
    }
  }
  const regexp = new RegExp(`^${source}${dirTail ? '(?:/.*)?' : ''}$`, 'i');
  globCache.set(glob, regexp);
  return regexp;
}

/** True when the repo-relative path (either separator) matches the glob, case-insensitively (like macOS). */
export function matchPathGlob(path: string, glob: string): boolean {
  const posix = path.replaceAll('\\', '/').replace(/^\.\//, '');
  return globRegExp(glob).test(posix);
}

export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchPathGlob(path, glob));
}

// ---------------------------------------------------------------------------
// Models, resources, budgets, project MCP
// ---------------------------------------------------------------------------

const ModelChoice = z.object({ model: SelectableModel, effort: Effort }).strict();

export const DEFAULT_COMPLEXITY_MAP: Record<Complexity, z.infer<typeof ModelChoice>> = {
  trivial: { model: 'haiku', effort: 'low' },
  small: { model: 'sonnet', effort: 'medium' },
  medium: { model: 'sonnet', effort: 'high' },
  large: { model: 'opus', effort: 'high' },
};

/** The models agent runs may use and the model each complexity rating maps to. Sonnet is always allowed. */
export const ModelSettings = z
  .object({
    allow: z
      .array(SelectableModel)
      .min(1)
      .refine((list) => list.includes('sonnet'), 'sonnet phải luôn được cho phép (docs chạy trên sonnet)')
      .refine((list) => new Set(list).size === list.length, 'model bị lặp'),
    complexityMap: z
      .object({ trivial: ModelChoice, small: ModelChoice, medium: ModelChoice, large: ModelChoice })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [level, choice] of Object.entries(value.complexityMap)) {
      if (!value.allow.includes(choice.model)) {
        ctx.addIssue({
          code: 'custom',
          path: ['complexityMap', level, 'model'],
          message: `model ${choice.model} chưa nằm trong danh sách được phép`,
        });
      }
    }
  });
export type ModelSettings = z.infer<typeof ModelSettings>;

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  allow: ['haiku', 'sonnet', 'opus'],
  complexityMap: DEFAULT_COMPLEXITY_MAP,
};

/** A machine's job slots and the load and memory limits above which no job starts. */
export const ResourceSettings = z
  .object({
    maxConcurrentJobs: z.number().int().min(1).max(64),
    minFreeMemGb: z.number().min(0).max(1_024),
    maxLoadPerCpu: z.number().positive().max(64),
  })
  .strict();
export type ResourceSettings = z.infer<typeof ResourceSettings>;

export const DEFAULT_RESOURCE_SETTINGS: ResourceSettings = {
  maxConcurrentJobs: 2,
  minFreeMemGb: 2,
  maxLoadPerCpu: 1.5,
};

/** The cost cap of one agent run (null: no cap). Ticket-tree and daily budgets stay on the project. */
export const BudgetSettings = z.object({ perJobUsd: z.number().positive().max(10_000).nullable() }).strict();
export type BudgetSettings = z.infer<typeof BudgetSettings>;

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = { perJobUsd: null };

/** MCP servers switched off for a project: their tools never reach an agent, and tickets cannot require them. */
export const ProjectMcpSettings = z
  .object({ disabledMcpServers: z.array(McpServerName).max(200) })
  .strict()
  .refine((value) => new Set(value.disabledMcpServers).size === value.disabledMcpServers.length, {
    message: 'MCP server bị lặp',
    path: ['disabledMcpServers'],
  });
export type ProjectMcpSettings = z.infer<typeof ProjectMcpSettings>;

/** An absolute folder on the machine: no `..` segment, no control character. */
export const AbsoluteFolderPath = z
  .string()
  .trim()
  .min(2)
  .max(1_024)
  .refine((path) => path.startsWith('/'), 'phải là đường dẫn tuyệt đối (bắt đầu bằng /)')
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what the check refuses
  .refine((path) => !/[\x00-\x1f\x7f]/.test(path), 'có ký tự điều khiển')
  .refine((path) => !path.split('/').includes('..'), 'không được có ..');

/** A path inside a repo (linked into every worktree): relative, never leaving the repo. */
export const RepoRelativePath = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((path) => !path.startsWith('/') && !path.split(/[\\/]/).includes('..'), 'phải nằm trong repo');

/**
 * Where one project lives on a machine and the untracked paths linked into its worktrees. The project's test
 * command is not here on purpose: it runs as a shell command on the machine, so it stays in the local config.
 */
export const ProjectFolderEntry = z
  .object({
    key: ProjectKey,
    repoPath: AbsoluteFolderPath,
    sharedPaths: z.array(RepoRelativePath).max(50).default([]),
  })
  .strict();
export type ProjectFolderEntry = z.output<typeof ProjectFolderEntry>;

/** A machine's project folders (edited on the web, or from the app's folder picker). */
export const ProjectFolders = z
  .object({ projects: z.array(ProjectFolderEntry).max(100) })
  .strict()
  .refine((value) => new Set(value.projects.map((entry) => entry.key)).size === value.projects.length, {
    message: 'mỗi dự án chỉ có một thư mục',
    path: ['projects'],
  });
export type ProjectFolders = z.output<typeof ProjectFolders>;

/** The folders as the daemon gets them: each with the project's default branch from the server. */
export const EffectiveProjectFolders = z.object({
  projects: z.array(
    z.object({
      key: ProjectKey,
      repoPath: AbsoluteFolderPath,
      sharedPaths: z.array(RepoRelativePath).max(50).default([]),
      defaultBranch: z.string().trim().min(1).max(200).default('main'),
    }),
  ),
});
export type EffectiveProjectFolders = z.output<typeof EffectiveProjectFolders>;

/** The content schema of each kind. */
export const SETTINGS_CONTENT: Record<SettingsKind, z.ZodType> = {
  prompt: PromptContent,
  policy: GuardPolicy,
  models: ModelSettings,
  budgets: BudgetSettings,
  resources: ResourceSettings,
  project_mcp: ProjectMcpSettings,
  project_folders: ProjectFolders,
};

/** Problems of one content value for a kind (and prompt name), as `{ path, message }` lines. */
export function validateSettingsContent(
  kind: SettingsKind,
  name: string,
  content: unknown,
): { path: string; message: string }[] {
  const parsed = SETTINGS_CONTENT[kind].safeParse(content);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  }
  if (kind === 'prompt') {
    return validatePromptTemplate(name, (parsed.data as PromptContent).text).map((message) => ({
      path: 'text',
      message,
    }));
  }
  return [];
}

// ---------------------------------------------------------------------------
// Revisions (owner API)
// ---------------------------------------------------------------------------

/**
 * One setting: its kind, scope and (for prompts) name. Machine and project scopes name the machine or the
 * project; the global scope names neither.
 */
export const SettingsKey = z
  .object({
    kind: SettingsKind,
    scope: SettingsScope,
    machineId: z.uuid().nullable().default(null),
    projectId: z.uuid().nullable().default(null),
    /** The prompt name; empty for every other kind. */
    name: z.string().max(100).default(''),
  })
  .superRefine((key, ctx) => {
    if (!KIND_SCOPES[key.kind].includes(key.scope)) {
      ctx.addIssue({
        code: 'custom',
        path: ['scope'],
        message: `${key.kind} không lưu ở phạm vi ${key.scope}`,
      });
    }
    if ((key.scope === 'machine') !== (key.machineId !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['machineId'],
        message: 'machineId chỉ dùng cho phạm vi machine',
      });
    }
    if ((key.scope === 'project') !== (key.projectId !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'projectId chỉ dùng cho phạm vi project',
      });
    }
    if (key.kind === 'prompt' ? !PROMPT_NAMES.includes(key.name as PromptName) : key.name !== '') {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'tên prompt không hợp lệ' });
    }
  });
export type SettingsKey = z.output<typeof SettingsKey>;
export type SettingsKeyInput = z.input<typeof SettingsKey>;

/** `GET /v1/settings/history`, `GET /v1/settings/diff`: the key fields as query parameters. */
export const SettingsKeyQuery = z.object({
  kind: SettingsKind,
  scope: SettingsScope,
  machineId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  name: z.string().max(100).optional(),
});

export const SettingsRevision = z.object({
  id: z.string(),
  kind: SettingsKind,
  scope: SettingsScope,
  machineId: z.string().nullable(),
  projectId: z.string().nullable(),
  name: z.string(),
  /** 1, 2, … per setting key; the highest is the active revision. */
  version: z.number().int().min(1),
  /** Null: the override was removed (the bundled default, or the global value, applies again). */
  content: z.unknown().nullable(),
  note: z.string(),
  /** `owner:<username>`, or `machine:<name>` for values a machine uploaded. */
  author: z.string(),
  /** The version this revision restored, when it was a restore. */
  restoredFrom: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
});
export type SettingsRevision = z.infer<typeof SettingsRevision>;

/**
 * `POST /v1/settings`: saves a new revision. `content: null` removes the override. `baseVersion` is the version
 * the editor started from (0 when there was none): a save on top of a newer revision is refused with 409.
 */
export const SaveSettingsRequest = z
  .object({
    key: SettingsKey,
    content: z.unknown().nullable(),
    note: z.string().trim().max(500).default(''),
    baseVersion: z.number().int().min(0).optional(),
  })
  .strict();
export type SaveSettingsRequest = z.input<typeof SaveSettingsRequest>;

export const ValidateSettingsRequest = z.object({ key: SettingsKey, content: z.unknown() }).strict();
export type ValidateSettingsRequest = z.input<typeof ValidateSettingsRequest>;

export const ValidateSettingsResponse = z.object({
  ok: z.boolean(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});
export type ValidateSettingsResponse = z.infer<typeof ValidateSettingsResponse>;

export const SaveSettingsResponse = z.object({
  revision: SettingsRevision,
  /** Machines the new revision applies to; their heartbeats tell when they picked it up. */
  affectedMachineIds: z.array(z.string()),
});
export type SaveSettingsResponse = z.infer<typeof SaveSettingsResponse>;

export const RestoreSettingsRequest = z.object({ note: z.string().trim().max(500).default('') }).strict();
export type RestoreSettingsRequest = z.input<typeof RestoreSettingsRequest>;

export const SettingsHistoryResponse = z.object({ items: z.array(SettingsRevision) });
export type SettingsHistoryResponse = z.infer<typeof SettingsHistoryResponse>;

export const DiffLine = z.object({ op: z.enum(['same', 'add', 'del']), text: z.string() });
export type DiffLine = z.infer<typeof DiffLine>;

/** `GET /v1/settings/diff?from=<revision id>&to=<revision id>`: `from` → `to`, line by line. */
export const SettingsDiffQuery = z.object({ from: z.uuid(), to: z.uuid() });
export const SettingsDiffResponse = z.object({
  from: SettingsRevision,
  to: SettingsRevision,
  lines: z.array(DiffLine),
});
export type SettingsDiffResponse = z.infer<typeof SettingsDiffResponse>;

/** Everything the owner's "Cài đặt hệ thống" pages show: bundled defaults, active revisions and machines. */
export const SettingsOverviewResponse = z.object({
  prompts: z.array(
    z.object({
      name: PromptName,
      label: z.string(),
      partial: z.boolean(),
      /** The prompt the daemon ships with; null when the server has no copy of the bundled prompts. */
      defaultText: z.string().nullable(),
    }),
  ),
  variables: z.array(z.object({ name: z.string(), description: z.string() })),
  defaults: z.object({
    policy: GuardPolicy,
    models: ModelSettings,
    budgets: BudgetSettings,
    resources: ResourceSettings,
  }),
  /** The active revision of every setting key that has one (including removed overrides). */
  active: z.array(SettingsRevision),
});
export type SettingsOverviewResponse = z.infer<typeof SettingsOverviewResponse>;

// ---------------------------------------------------------------------------
// Daemon API
// ---------------------------------------------------------------------------

/**
 * `GET /v1/daemon/settings` (ETag / If-None-Match): the settings that apply to the calling machine, already
 * merged global ← machine or project override. A null or missing part means "use the bundled default".
 * `revision` is a hash of the content: equal settings have equal revisions.
 */
export const EffectiveSettings = z.object({
  revision: z.string().min(1).max(100),
  /** Prompt overrides by name (unknown names from a newer server are ignored by the daemon). */
  prompts: z.record(z.string(), z.string()).default({}),
  policy: z.unknown().nullable().default(null),
  models: z.unknown().nullable().default(null),
  budgets: z.unknown().nullable().default(null),
  resources: z.unknown().nullable().default(null),
  /** Per project key, for the projects this machine owns that have an override. */
  projects: z.record(z.string(), z.unknown()).default({}),
  /** This machine's project folders (EffectiveProjectFolders); null until one was saved. */
  folders: z.unknown().nullable().default(null),
});
export type EffectiveSettings = z.infer<typeof EffectiveSettings>;

/**
 * `POST /v1/daemon/settings/import`: the one-time upload of a machine's local `config.yaml` values. The
 * server stores each as the machine's (or project's) override only when that setting has no revision yet.
 */
export const ImportLocalSettingsRequest = z
  .object({
    resources: ResourceSettings.optional(),
    models: ModelSettings.optional(),
    budgets: BudgetSettings.optional(),
    projects: z
      .array(z.object({ key: ProjectKey, disabledMcpServers: z.array(McpServerName).max(200) }).strict())
      .max(100)
      .default([]),
    /** The local config's project folders (and their shared paths). */
    folders: ProjectFolders.optional(),
  })
  .strict();
export type ImportLocalSettingsRequest = z.input<typeof ImportLocalSettingsRequest>;

export const ImportLocalSettingsResponse = z.object({
  /** The settings stored from this upload, e.g. `resources`, `project_mcp:WEB`. */
  created: z.array(z.string()),
  /** The settings that already had a revision on the server (left unchanged). */
  kept: z.array(z.string()),
});
export type ImportLocalSettingsResponse = z.infer<typeof ImportLocalSettingsResponse>;

/** `PUT /v1/daemon/settings/projects/:projectKey/mcp`: the owning machine switches MCP servers (health fix). */
export const PutProjectMcpRequest = z
  .object({
    disabledMcpServers: z.array(McpServerName).max(200),
    note: z.string().trim().max(500).default(''),
  })
  .strict();
export type PutProjectMcpRequest = z.input<typeof PutProjectMcpRequest>;

/**
 * `PUT /v1/daemon/settings/project-folders/:projectKey`: the machine sets one project's folder (the app's
 * folder picker, `crewd project add`). The rest of the machine's folders are kept.
 */
export const PutProjectFolderRequest = z
  .object({ repoPath: AbsoluteFolderPath, sharedPaths: z.array(RepoRelativePath).max(50).optional() })
  .strict();
export type PutProjectFolderRequest = z.input<typeof PutProjectFolderRequest>;

/** Where a daemon's settings came from: the server now, its cached copy, or its bundled defaults. */
export const SettingsSource = z.enum(['server', 'cache', 'bundled']);
export type SettingsSource = z.infer<typeof SettingsSource>;

/** Carried by the heartbeat: the settings revision the machine applies to new jobs. */
export const MachineSettingsState = z.object({
  revision: z.string().min(1).max(100),
  source: SettingsSource,
  /** Parts the daemon refused (invalid) and replaced with its bundled default, e.g. `prompt:dev`. */
  rejected: z.array(z.string().max(200)).max(100).default([]),
});
export type MachineSettingsState = z.infer<typeof MachineSettingsState>;

// ---------------------------------------------------------------------------
// Text view and line diff (web editor and diff route)
// ---------------------------------------------------------------------------

/** The text a revision's content is compared and shown as: the prompt itself, else indented JSON. */
export function settingsText(kind: SettingsKind, content: unknown): string {
  if (content === null || content === undefined) return '';
  if (kind === 'prompt') {
    const parsed = PromptContent.safeParse(content);
    return parsed.success ? parsed.data.text : JSON.stringify(content, null, 2);
  }
  return JSON.stringify(content, null, 2);
}

/** Longest-common-subsequence line diff; very large inputs fall back to "all removed, all added". */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  if (a.length * b.length > 4_000_000) {
    return [
      ...a.map((text) => ({ op: 'del' as const, text })),
      ...b.map((text) => ({ op: 'add' as const, text })),
    ];
  }
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? (table[(i + 1) * cols + j + 1] as number) + 1
          : Math.max(table[(i + 1) * cols + j] as number, table[i * cols + j + 1] as number);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] as string });
      i++;
      j++;
    } else if ((table[(i + 1) * cols + j] as number) >= (table[i * cols + j + 1] as number)) {
      out.push({ op: 'del', text: a[i] as string });
      i++;
    } else {
      out.push({ op: 'add', text: b[j] as string });
      j++;
    }
  }
  while (i < a.length) out.push({ op: 'del', text: a[i++] as string });
  while (j < b.length) out.push({ op: 'add', text: b[j++] as string });
  return out;
}
