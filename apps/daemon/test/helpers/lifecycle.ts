import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServerName, ProjectPlatform, RoleStage, TicketStatus } from '@crew/shared';
import { parse } from 'yaml';
import { z } from 'zod';
import { ticketReports, tickets } from '../../../api/src/db/schema.js';
import { claim } from '../../../api/src/services/claim-service.js';
import { createRequestTicket } from '../../../api/src/services/ticket-service.js';
import { pairTestMachine } from '../../../api/test/helpers/machines.js';
import { seedAndLogin } from '../../../api/test/helpers/owner-session.js';
import { createTestProject } from '../../../api/test/helpers/test-db.js';
import { rolePlanner } from '../../src/roles/role-planner.js';
import type { AgentRunner, RunAgentOptions } from '../../src/runner/agent-runner.js';
import { createScriptedRunner, ScriptedCrash, type ScriptInput } from '../../src/runner/scripted-runner.js';
import { runnableJobs } from '../../src/scheduler/scheduler.js';
import type { JobRow } from '../../src/state-db.js';
import { clearRating, commentsOf, type Fixture, ownerComment, ownerTransition, type useApi } from './api.js';
import { makeDaemon, sleep, type TestDaemon } from './daemon.js';
import { tempDir } from './git.js';
import { DOCS_FILES, makeWorkflowRepo, type WorkflowRepo } from './workflow.js';

// ---------------------------------------------------------------------------
// Scenario format (test/lifecycle/*.yaml)
// ---------------------------------------------------------------------------

const Step = z.record(z.string(), z.unknown());

const ScriptEntry = z.object({
  stage: RoleStage,
  /** Regex on the ticket title (case-insensitive). */
  title: z.string().optional(),
  /** The nth job of this stage on this ticket (1-based). */
  run: z.number().int().min(1).optional(),
  steps: z.array(Step),
  costUsd: z.number().min(0).default(0.01),
});

const TicketType = z.enum(['request', 'pm_task', 'dev', 'qc', 'bug', 'docs_init']);

const OwnerAction = z.object({
  when: z.object({
    title: z.string(),
    type: TicketType.optional(),
    status: TicketStatus.optional(),
    /** A job of this stage is running on the ticket. */
    running: RoleStage.optional(),
    /** The latest comment on the ticket matches this regex. */
    comment: z.string().optional(),
  }),
  /** The ticket the owner acts on (default: the one in `when`). */
  target: z.object({ title: z.string(), type: TicketType.optional() }).optional(),
  /** Removes the PM's rating first, like a ticket created before the rating was required. */
  clearRating: z.boolean().optional(),
  comment: z.string().min(1).optional(),
  cancel: z.boolean().optional(),
  unblock: z.boolean().optional(),
});

const ExpectTicket = z.object({
  title: z.string(),
  type: TicketType.optional(),
  status: TicketStatus,
  count: z.number().int().min(0).default(1),
});

export const Scenario = z.object({
  name: z.string(),
  description: z.string(),
  project: z
    .object({
      platform: ProjectPlatform.default('web'),
      docs: z.boolean().default(true),
      maxChildren: z.number().int().min(1).optional(),
      treeBudgetUsd: z.number().positive().optional(),
    })
    .prefault({}),
  inventory: z
    .object({
      skills: z.array(z.string()).default([]),
      mcpServers: z
        .array(z.object({ name: McpServerName, status: z.string().default('connected') }))
        .default([]),
    })
    .prefault({}),
  autoCloseRequests: z.boolean().default(false),
  request: z.object({ title: z.string(), description: z.string().default('') }),
  owner: z.array(OwnerAction).default([]),
  fastForwardBackoff: z.boolean().default(false),
  scripts: z.array(ScriptEntry),
  expect: z.object({ tickets: z.array(ExpectTicket) }),
  timeoutMs: z.number().int().default(120_000),
});
export type Scenario = z.infer<typeof Scenario>;

export function loadScenario(file: string): Scenario {
  return Scenario.parse(parse(readFileSync(file, 'utf8')));
}

// ---------------------------------------------------------------------------
// Macros: the common steps of each role, so the scenario files stay readable
// ---------------------------------------------------------------------------

type RawStep = Record<string, unknown>;
const t = (name: string, input: Record<string, unknown> = {}) => ({ tool: `mcp__tickets__${name}`, input });
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const titleRe = (title: string) => `^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;

function preflight(step: RawStep): RawStep {
  const skills = list(step.skills).map((name) => ({ name, reason: `hữu ích cho bước này: ${name}` }));
  const mcps = list(step.mcps).map((server) => ({ server, reason: `công cụ cho bước này: ${server}` }));
  return t('select_capabilities', {
    skills,
    mcps,
    ...(skills.length + mcps.length === 0
      ? { noneReason: 'không có skill hay MCP nào hợp với bước này' }
      : {}),
  });
}

const invokeSkills = (step: RawStep): RawStep[] =>
  list(step.invoke ?? step.skills).map((skill) => ({ skill }));
const readDocs = (flow = 'app'): RawStep[] => [
  { tool: 'Read', input: { file_path: 'docs/index.md' } },
  t('docs_flow', { id: flow }),
  { tool: 'Read', input: { file_path: 'docs/flows/app.md' } },
];

function devFinish(step: RawStep): RawStep[] {
  const file = String(step.file ?? 'src/feature.js');
  const name = file.replace(/^src\//, '').replace(/\.js$/, '');
  return [
    {
      write: {
        path: file,
        content: String(step.content ?? `exports.${name.replace(/\W/g, '_')} = () => 'ok';\n`),
      },
    },
    {
      write: {
        path: `test/${name}.test.js`,
        content: `const test = require('node:test');\nconst assert = require('node:assert');\ntest('${name}', () => assert.ok(require('../${file}')));\n`,
      },
    },
    { bash: 'node --test > "$TMPDIR/test.txt" 2>&1' },
    t('handoff_docs', {
      summaryMd: String(step.summary ?? `Thêm \`${file}\` và test của nó.`),
      files: [file, `test/${name}.test.js`],
      tests: ['node --test: đạt'],
      flows: ['app'],
    }),
  ];
}

function devStart(step: RawStep): RawStep[] {
  return [
    preflight(step),
    ...invokeSkills(step),
    t('update_status', { to: 'in_progress' }),
    ...readDocs(),
    { tool: 'Read', input: { file_path: 'src/app.js' } },
  ];
}

function docsUpdate(step: RawStep): RawStep[] {
  const files = list(step.files);
  const top = step.position !== 'bottom';
  const entries = files.map((file) => `      - ${file}\n`).join('');
  const docLines = files.map((file) => `- \`${file}\`: phần mới của flow.\n`).join('');
  const steps: RawStep[] = [
    preflight({ skills: step.skills }),
    ...invokeSkills({ skills: step.skills }),
    { tool: 'Read', input: { file_path: 'docs/index.md' } },
    { bash: 'git status --short && git diff --stat' },
    ...files.map((file) => t('docs_where', { file })),
    {
      tool: 'Edit',
      input: top
        ? {
            file_path: 'docs/flows.yaml',
            old_string: '    files:\n',
            new_string: `    files:\n${entries}`,
          }
        : {
            file_path: 'docs/flows.yaml',
            old_string: '      - src/store.js\n',
            new_string: `      - src/store.js\n${entries}`,
          },
    },
    {
      tool: 'Edit',
      input: top
        ? {
            file_path: 'docs/flows/app.md',
            old_string: '## Các bước\n\n',
            new_string: `## Các bước\n\n${docLines}\n`,
          }
        : {
            file_path: 'docs/flows/app.md',
            old_string: '## Tests\n\n',
            new_string: `## Tests\n\n${docLines}`,
          },
    },
    {
      bash: `crew-docs generate > /dev/null && git add -A && git commit -q -m "${String(step.message ?? 'feat: cập nhật flow app')}" > "$TMPDIR/hook.txt" 2>&1`,
    },
  ];
  if (step.reject) {
    steps.push(
      t('return_to_dev', {
        summaryMd: 'Hook từ chối commit vì lỗi trong code của dev.',
        output: '@{file:hook.txt}',
      }),
    );
    return steps;
  }
  steps.push(
    t('submit_report', {
      summaryMd: `Bàn giao của dev đã commit cùng docs: ${files.join(', ')}.`,
      filesChanged: files,
      testsRun: [{ name: 'node --test', passed: true }],
    }),
    t('update_status', { to: 'done' }),
  );
  return steps;
}

function qc(step: RawStep): RawStep[] {
  const mcps = list(step.mcps);
  const bugs = list(step.bugs);
  return [
    preflight(step),
    ...invokeSkills(step),
    t('update_status', { to: 'in_progress' }),
    ...readDocs(),
    { bash: 'node --test > "$TMPDIR/test.txt" 2>&1; git diff --stat main...HEAD' },
    ...mcps.map((server) => ({
      tool: `mcp__${server}__browser_navigate`,
      input: { url: 'http://127.0.0.1:4398/' },
    })),
    ...bugs.map((title) =>
      t('file_bug', { title, description: `Tái hiện: ${title}. Mong đợi: hoạt động đúng.` }),
    ),
    t('submit_report', {
      summaryMd:
        bugs.length > 0
          ? `Báo ${bugs.length} lỗi: ${bugs.join('; ')}.`
          : String(step.summary ?? 'pass: mọi tiêu chí đạt.'),
      testsRun: [
        { name: 'node --test', passed: true },
        ...mcps.map((server) => ({
          name: `UI qua ${server}`,
          passed: bugs.length === 0,
          summary: 'flow chính',
        })),
      ],
    }),
    t('update_status', { to: 'done' }),
  ];
}

function pmAnalyze(step: RawStep): RawStep[] {
  const head: RawStep[] = [
    preflight(step),
    ...invokeSkills(step),
    t('update_status', { to: 'triage' }),
    ...readDocs(),
  ];
  if (step.ask) {
    return [
      ...head,
      t('comment', { body: 'Yêu cầu chi tiết: mục tiêu, phạm vi, tiêu chí nghiệm thu (bản nháp).' }),
      t('ask_owner', { question: String(step.ask) }),
    ];
  }
  const subtasks = (Array.isArray(step.subtasks) ? step.subtasks : []) as RawStep[];
  const creates = subtasks.flatMap((sub) => {
    const title = String(sub.title);
    // The PM rates dev and QC separately; the fixtures name both ratings (there is no default model).
    if (!sub.complexity || !sub.qcComplexity) {
      throw new Error(`subtask "${title}" needs complexity and qcComplexity in the scenario`);
    }
    const dependsOn = list(sub.dependsOn).map((dep) => `@{ticket:${titleRe(dep)}}`);
    return [
      t('create_subtask', {
        type: 'dev',
        title,
        description: `Làm "${title}".\n\nTiêu chí nghiệm thu:\n1. Có test.\n\nSkill: ${list(sub.skills).join(', ') || 'không cần (không có skill phù hợp)'}.`,
        complexity: sub.complexity,
        complexityReason: String(sub.reason ?? 'Việc nhỏ: một file và test của nó'),
        ...(sub.model ? { model: sub.model } : {}),
        requiredSkills: list(sub.skills),
        requiredMcps: list(sub.mcps),
        dependsOn,
        flows: ['app'],
      }),
      ...(sub.crashAfter ? [{ crash: true }] : []),
      t('create_subtask', {
        type: 'qc',
        title: `QC: ${title}`,
        description: `Kiểm thử "${title}".`,
        pairsWith: `@{ticket:${titleRe(title)}}`,
        complexity: sub.qcComplexity,
        complexityReason: String(sub.qcReason ?? 'Một flow kiểm thử'),
        flows: ['app'],
      }),
    ];
  });
  // The PM re-rates subtasks it already created (by key), before they start.
  const rates = ((Array.isArray(step.rates) ? step.rates : []) as RawStep[]).map((rate) =>
    t('rate_subtask', {
      ticket: `@{key:${titleRe(String(rate.title))}}`,
      complexity: rate.complexity,
      complexityReason: String(rate.reason),
      ...(rate.model ? { model: rate.model } : {}),
    }),
  );
  return [
    ...head,
    ...(step.continued
      ? []
      : [t('comment', { body: 'Yêu cầu chi tiết: mục tiêu, phạm vi, tiêu chí nghiệm thu.' })]),
    ...(step.continued ? [] : [t('comment', { body: 'Requirement confirmed' })]),
    t('resource_report'),
    ...creates,
    ...rates,
    t('comment', { body: 'Kế hoạch thực thi: chạy song song trong số slot trống.' }),
    t('update_status', { to: 'in_progress' }),
  ];
}

function pmAccept(step: RawStep): RawStep[] {
  const head: RawStep[] = [
    preflight(step),
    ...invokeSkills(step),
    ...readDocs(),
    t('list_children'),
    t('resource_report'),
  ];
  const rejects = (Array.isArray(step.reject) ? step.reject : []) as RawStep[];
  if (rejects.length > 0) {
    return [
      ...head,
      // The merge tool refuses the rule violations itself; the PM then rejects the tickets.
      ...(step.tryMerge ? [t('merge_and_push', { acceptedExceptions: [] })] : []),
      ...rejects.map((r) =>
        t('reject_work', {
          ticketId: `@{ticket:${titleRe(String(r.title))}}`,
          title: String(r.bug),
          description: String(r.reason ?? 'Không đạt nghiệm thu.'),
        }),
      ),
      t('comment', { body: 'Đã từ chối và tạo bug; chờ bản sửa.' }),
    ];
  }
  const exceptions = list(step.exceptions).map((title) => ({
    ticketId: `@{ticket:${titleRe(title)}}`,
    reason: 'dev đã giải thích trong bình luận vì sao skill không áp dụng',
  }));
  return [
    ...head,
    t('merge_and_push', { acceptedExceptions: exceptions }),
    t('submit_report', {
      summaryMd: 'Nghiệm thu: mọi ticket đạt, đã merge và đẩy lên main.',
      commits: [],
    }),
    t('update_status', { to: 'in_review' }),
    t('update_status', { to: 'done' }),
  ];
}

function docsInit(step: RawStep): RawStep[] {
  return [
    preflight(step),
    ...invokeSkills(step),
    t('update_status', { to: 'in_progress' }),
    { tool: 'Read', input: { file_path: 'README.md' } },
    { bash: 'crew-docs init > "$TMPDIR/init.txt" 2>&1' },
    ...Object.entries(DOCS_FILES).map(([path, content]) => ({ write: { path, content } })),
    {
      bash: 'crew-docs generate > /dev/null && crew-docs check --all && crew-docs ci-workflow > /dev/null && git add -A && git commit -q -m "docs: khởi tạo docs" -m "Crew-Docs-Init: true" > "$TMPDIR/hook.txt" 2>&1',
    },
    t('submit_report', {
      summaryMd: 'Đã viết docs theo chuẩn: flow app.',
      filesChanged: Object.keys(DOCS_FILES),
    }),
    t('update_status', { to: 'done' }),
  ];
}

const MACROS: Record<string, (step: RawStep) => RawStep[]> = {
  preflight: (step) => [preflight(step), ...invokeSkills(step)],
  read_docs: () => readDocs(),
  dev: (step) => [...devStart(step), ...devFinish(step)],
  dev_start: devStart,
  dev_finish: devFinish,
  docs_update: docsUpdate,
  qc,
  pm_analyze: pmAnalyze,
  pm_accept: pmAccept,
  docs_init: docsInit,
  triage: (step) => [
    preflight(step),
    ...invokeSkills(step),
    t('update_status', { to: 'triage' }),
    t('get_project_catalog'),
    t('create_pm_ticket', {
      projectId: '@{project}',
      title: String(step.title),
      description:
        '**Mục tiêu:** làm theo yêu cầu.\n**Phạm vi:** dự án đã chọn.\n**Gợi ý nghiệm thu:** có test.',
    }),
    t('comment', { body: 'Định tuyến tới dự án duy nhất phù hợp mô tả.' }),
    t('update_status', { to: 'in_progress' }),
  ],
  pm_monitor: (step) => [
    preflight(step),
    ...invokeSkills(step),
    t('resource_report'),
    t('comment', { body: String(step.comment ?? 'Đã kiểm tra tài nguyên sau khi subtask kết thúc.') }),
  ],
  close: (step) => [
    preflight(step),
    ...invokeSkills(step),
    t('get_ticket'),
    // A pick that is not in this run's inventory is refused; the agent files the report again.
    ...(step.badPick
      ? [
          t('submit_report', {
            summaryMd: 'Báo cáo với lựa chọn sai.',
            skillsSelected: [{ name: String(step.badPick), reason: 'không có trong kho' }],
          }),
        ]
      : []),
    t('submit_report', { summaryMd: 'Yêu cầu đã hoàn thành theo report của PM.' }),
    t('update_status', { to: step.to ?? 'in_review' }),
  ],
};

function expand(steps: readonly RawStep[]): RawStep[] {
  return steps.flatMap((step) => {
    if (typeof step.macro !== 'string') return [step];
    const macro = MACROS[step.macro];
    if (!macro) throw new Error(`unknown macro ${step.macro}`);
    return macro(step);
  });
}

// ---------------------------------------------------------------------------
// Running a scenario
// ---------------------------------------------------------------------------

export interface RunRecord {
  jobId: string;
  ticketId: string;
  ticketKey: string;
  title: string;
  stage: string;
  kind: string;
  model: string;
  prompt: string;
  n: number;
}

export interface LifecycleResult {
  f: Fixture;
  repo: WorkflowRepo;
  daemon: TestDaemon;
  requestId: string;
  runs: RunRecord[];
  unmatched: RunRecord[];
}

type TicketRow = typeof tickets.$inferSelect;

/** Fake AWS key assembled at runtime, so no file of this repo holds a credential-shaped string. */
const FAKE_SECRET = ['AKIA', 'Z7QX4M2P', 'WL3KRB6D'].join('');

export async function runScenario(
  api: ReturnType<typeof useApi>,
  scenario: Scenario,
): Promise<LifecycleResult> {
  const db = api.db;
  const server = await api.server();
  const machine = await pairTestMachine(db, 'dev-mac');
  const project = await createTestProject(db, {
    ownerMachineId: machine.machineId,
    platform: scenario.project.platform,
    ...(scenario.project.maxChildren ? { maxChildrenPerTicket: scenario.project.maxChildren } : {}),
    ...(scenario.project.treeBudgetUsd ? { ticketTreeBudgetUsd: scenario.project.treeBudgetUsd } : {}),
  });
  const owner = await seedAndLogin(server.app, db);
  await db.transaction((tx) => claim(tx, machine.machineId, { hostsAssistant: true }));
  const f: Fixture = { server, machine, owner, projectId: project.id, projectKey: project.key };
  const repo = makeWorkflowRepo({ docs: scenario.project.docs });
  const home = tempDir('crewd-home-');

  const inventory = {
    skills: scenario.inventory.skills.map((name) => ({
      name,
      source: 'project' as const,
      description: `Skill ${name} của dự án`,
    })),
    mcpServers: scenario.inventory.mcpServers.map((server) => ({
      name: server.name,
      source: 'user' as const,
      status: server.status,
      tools: [{ name: 'browser_navigate', description: 'mở một URL' }],
    })),
  };

  const allTickets = async () =>
    (await db.select().from(tickets)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const byTitle = async (pattern: string, type?: TicketRow['type']): Promise<TicketRow | undefined> => {
    const re = new RegExp(pattern, 'i');
    return (await allTickets()).find((row) => re.test(row.title) && (!type || row.type === type));
  };

  const runs: RunRecord[] = [];
  const unmatched: RunRecord[] = [];
  const served = new Map<string, string[]>();
  /** Steps that end a run abnormally (crash, API error) happen once per job and step. */
  const once = new Set<string>();
  let crashed = false;

  const pick = async (run: RunAgentOptions): Promise<ScriptInput> => {
    const ticket = (await allTickets()).find((row) => row.id === run.ticketId) as TicketRow;
    const key = `${run.ticketId}|${run.stage}`;
    const jobs = served.get(key) ?? [];
    if (!jobs.includes(run.jobId)) jobs.push(run.jobId);
    served.set(key, jobs);
    const n = jobs.indexOf(run.jobId) + 1;
    const record: RunRecord = {
      jobId: run.jobId,
      ticketId: run.ticketId,
      ticketKey: run.ticketKey,
      title: ticket.title,
      stage: run.stage ?? '?',
      kind: run.kind,
      model: run.model,
      prompt: run.prompt,
      n,
    };
    runs.push(record);
    const entry = scenario.scripts.find(
      (candidate) =>
        candidate.stage === run.stage &&
        (!candidate.title || new RegExp(candidate.title, 'i').test(ticket.title)) &&
        (!candidate.run || candidate.run === n),
    );
    if (!entry) {
      unmatched.push(record);
      return { steps: [] };
    }
    const steps = expand(entry.steps).map((step, index) => {
      const mark = `${run.jobId}:${index}`;
      if ('crash' in step || 'apiErrorOnce' in step) {
        if (once.has(mark)) return { sleep: 0 };
        once.add(mark);
        return 'crash' in step ? { crash: true } : { apiError: String(step.apiErrorOnce) };
      }
      return step;
    });
    return {
      skills: scenario.inventory.skills,
      mcpServers: scenario.inventory.mcpServers.map((s) => ({ name: s.name, status: s.status })),
      steps: steps as ScriptInput['steps'],
      result: { costUsd: entry.costUsd },
    };
  };

  const resolveString = async (text: string, run: RunAgentOptions): Promise<string> => {
    const matches = [...text.matchAll(/@\{([^}]+)\}/g)];
    let out = text;
    for (const match of matches) {
      const [whole, expr] = match as unknown as [string, string];
      const [kind, ...rest] = expr.split(':');
      const arg = rest.join(':');
      let value: string;
      if (kind === 'project') value = project.id;
      else if (kind === 'self') value = run.ticketId;
      else if (kind === 'fakeSecret') value = FAKE_SECRET;
      else if (kind === 'remote') value = repo.remote;
      else if (kind === 'file') {
        try {
          value = readFileSync(join(String(run.env.TMPDIR), arg), 'utf8').trim() || '(trống)';
        } catch {
          value = '(không đọc được output)';
        }
      } else if (kind === 'ticket' || kind === 'key' || kind === 'head') {
        const row = await byTitle(arg);
        if (!row) throw new Error(`no ticket matches ${arg}`);
        if (kind === 'ticket') value = row.id;
        else if (kind === 'key') value = row.key;
        else {
          const report = (await db.select().from(ticketReports)).find(
            (entry) => entry.ticketId === row.id && entry.isCurrent,
          );
          value = report?.headSha ?? '';
        }
      } else throw new Error(`unknown template ${expr}`);
      out = out.replace(whole, value);
    }
    return out;
  };
  const resolveValue = async (value: unknown, run: RunAgentOptions): Promise<unknown> => {
    if (typeof value === 'string') return resolveString(value, run);
    if (Array.isArray(value)) return Promise.all(value.map((item) => resolveValue(item, run)));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = await resolveValue(v, run);
      return out;
    }
    return value;
  };

  const inner = createScriptedRunner({
    sessionsDir: join(home, 'scripted-sessions'),
    script: pick,
    resolve: async (input, run) => (await resolveValue(input, run)) as Record<string, unknown>,
  });
  const runner: AgentRunner = async (run) => {
    try {
      return await inner(run);
    } catch (error) {
      if (error instanceof ScriptedCrash) crashed = true;
      throw error;
    }
  };

  const start = async (): Promise<TestDaemon> => {
    const d = makeDaemon(f, {
      repoPath: repo.repo,
      home,
      config: {
        autoCloseRequests: scenario.autoCloseRequests,
        projects: [
          {
            key: project.key,
            repoPath: repo.repo,
            defaultBranch: 'main',
            testCommand: 'node --test',
            sharedPaths: [],
            disabledMcpServers: [],
          },
        ],
      },
      extra: { planner: rolePlanner, runner, inventory: true, probe: async () => inventory },
    });
    await d.daemon.start();
    await d.daemon.refreshInventory(null);
    await d.daemon.refreshInventory(project.key);
    return d;
  };

  let current = await start();
  const request = await createRequestTicket(db, {
    title: scenario.request.title,
    description: scenario.request.description,
  });

  const done = new Set<number>();
  const deadline = Date.now() + scenario.timeoutMs;
  let quiet = 0;
  for (;;) {
    if (Date.now() > deadline) {
      const rows = await allTickets();
      const notes: string[] = [];
      for (const row of rows.filter((r) => r.status !== 'done' && r.status !== 'cancelled')) {
        for (const c of (await commentsOf(db, row.id)).slice(-2))
          notes.push(`${row.key}: ${c.body.slice(0, 1500)}`);
      }
      throw new Error(
        `${notes.join('\n---\n')}\n` +
          `scenario ${scenario.name} did not settle: ${rows.map((r) => `${r.key}[${r.type}] ${r.status} "${r.title}"`).join('; ')}; jobs ${JSON.stringify(
            current.daemon.state
              .listJobs(['queued', 'running', 'backoff'])
              .map((j) => [j.ticketId, j.status, j.stage]),
          )}; unmatched ${JSON.stringify(unmatched.map((u) => [u.title, u.stage, u.n]))}`,
      );
    }
    if (crashed) {
      await sleep(200);
      await current.daemon.halt();
      crashed = false;
      current = await start();
    }
    const state = current.daemon.state;
    if (scenario.fastForwardBackoff) {
      for (const job of state.listJobs(['backoff'])) {
        if (job.retryAt && Date.parse(job.retryAt) > Date.now()) {
          state.updateJob(job.id, { retryAt: new Date(Date.now() - 1_000).toISOString() });
        }
      }
    }
    for (const [index, action] of scenario.owner.entries()) {
      if (done.has(index)) continue;
      const row = await byTitle(action.when.title, action.when.type);
      if (!row) continue;
      if (action.when.status && row.status !== action.when.status) continue;
      if (action.when.running) {
        const running = state.activeJob(row.id);
        if (running?.status !== 'running' || running.stage !== action.when.running) continue;
      }
      if (action.when.comment) {
        const latest = (await commentsOf(db, row.id)).at(-1);
        if (!latest || !new RegExp(action.when.comment, 'i').test(latest.body)) continue;
      }
      const target = action.target ? await byTitle(action.target.title, action.target.type) : row;
      if (!target) continue;
      done.add(index);
      if (action.clearRating) await clearRating(db, target.id);
      if (action.comment) await ownerComment(f, target.id, action.comment);
      if (action.cancel) await ownerTransition(f, target.id, 'cancelled');
      if (action.unblock) await ownerTransition(f, target.id, 'in_progress');
    }
    const settled =
      (await expectationsMet(await allTickets(), scenario)) &&
      state.listJobs(['running']).length === 0 &&
      runnableJobs(state).length === 0;
    quiet = settled ? quiet + 1 : 0;
    if (quiet >= 3) break;
    await sleep(150);
  }
  return { f, repo, daemon: current, requestId: request.id, runs, unmatched };
}

async function expectationsMet(rows: TicketRow[], scenario: Scenario): Promise<boolean> {
  return scenario.expect.tickets.every((expected) => {
    const re = new RegExp(expected.title, 'i');
    const matching = rows.filter(
      (row) => re.test(row.title) && (!expected.type || row.type === expected.type),
    );
    return matching.length === expected.count && matching.every((row) => row.status === expected.status);
  });
}

/** Tickets the owner has to act on next are not stuck. */
const WAITING_FOR_OWNER = new Set(['needs_input', 'blocked', 'in_review']);

/**
 * No non-terminal ticket is left without an active job (queued, running, waiting on dependencies or in
 * backoff with a `retry_at`) or pending owner input. A parent with open children waits on them (they are
 * checked themselves), and `children.all_done` wakes it when the last one closes.
 */
export async function stuckTickets(
  api: ReturnType<typeof useApi>,
  jobs: readonly JobRow[],
): Promise<string[]> {
  const rows = await api.db.select().from(tickets);
  const open = (row: TicketRow) => row.status !== 'done' && row.status !== 'cancelled';
  const active = new Set(
    jobs
      .filter(
        (job) =>
          job.status === 'queued' || job.status === 'running' || (job.status === 'backoff' && job.retryAt),
      )
      .map((job) => job.ticketId),
  );
  const waitingOnChildren = new Set(rows.filter(open).map((row) => row.parentId));
  return rows
    .filter(open)
    .filter(
      (row) => !WAITING_FOR_OWNER.has(row.status) && !active.has(row.id) && !waitingOnChildren.has(row.id),
    )
    .map((row) => `${row.key} ${row.status} "${row.title}"`);
}
