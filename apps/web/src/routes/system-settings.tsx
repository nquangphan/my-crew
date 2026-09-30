import {
  BudgetSettings,
  GuardPolicy,
  ModelSettings,
  type SettingsKeyInput,
  type SettingsOverviewResponse,
} from '@crew/shared';
import { Link, useRouterState } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { BudgetSettingsForm, budgetOf, issuesOf, ModelSettingsForm } from '../components/model-settings-form';
import { activeOf, authorLabel, SettingEditor } from '../components/setting-editor';
import { Field, Textarea } from '../components/ui/field';
import { Breadcrumbs, type Crumb } from '../layout/breadcrumbs';
import { cn } from '../lib/cn';
import { errorMessage, formatFullDateTime } from '../lib/format';
import { useMachines, useProjects, useSettingsOverview } from '../lib/queries';

const TABS = [
  { to: '/settings/prompts', label: 'Prompts' },
  { to: '/settings/rules', label: 'Quy tắc' },
  { to: '/settings/models', label: 'Models' },
  { to: '/settings/machines', label: 'Máy' },
  { to: '/settings/projects', label: 'MCP dự án' },
] as const;

/** "Cài đặt hệ thống": the tabs and the page title; every page loads the settings overview. */
export function SettingsLayout({
  title,
  crumbs = [],
  children,
}: {
  title: string;
  crumbs?: Crumb[];
  children: ReactNode;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex max-w-5xl flex-col gap-4 px-3 py-3 md:px-6 md:py-[18px]">
      <Breadcrumbs items={[{ label: 'Cài đặt hệ thống', link: { to: '/settings' } }, ...crumbs]} />
      <h1 className="m-0 text-[22px] font-semibold">{title}</h1>
      <nav aria-label="Mục cài đặt" className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line2 text-sm">
        {TABS.map((tab) => {
          const active = path.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px flex min-h-11 items-center border-b-2 border-transparent text-muted no-underline xl:min-h-9',
                active && 'border-accent font-semibold text-accent',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}

/** Loading and error states of the settings overview, then the page with its data. */
export function WithOverview({ children }: { children: (overview: SettingsOverviewResponse) => ReactNode }) {
  const overview = useSettingsOverview();
  if (overview.isLoading) return <p className="m-0 text-sm text-muted">Đang tải…</p>;
  if (overview.isError || !overview.data) {
    return (
      <p role="alert" className="m-0 text-sm text-bad">
        {errorMessage(overview.error)}
      </p>
    );
  }
  return <>{children(overview.data)}</>;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export function SettingsPromptsPage() {
  return (
    <SettingsLayout title="Cài đặt hệ thống">
      <p className="m-0 text-sm text-muted">
        Prompt của từng vai trò agent. Bản sửa ở đây thay bản đi kèm app cho job kế tiếp trên mọi máy, không
        cần cài lại app; job đang chạy giữ bản nó đã bắt đầu.
      </p>
      <WithOverview>
        {(overview) => (
          <ul aria-label="Danh sách prompt" className="m-0 flex list-none flex-col gap-2 p-0">
            {overview.prompts.map((prompt) => {
              const active = activeOf(overview.active, {
                kind: 'prompt',
                scope: 'global',
                name: prompt.name,
              });
              const edited = active !== null && active.content !== null;
              return (
                <li
                  key={prompt.name}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-panel p-3"
                >
                  <Link to="/settings/prompts/$name" params={{ name: prompt.name }} className="font-semibold">
                    {prompt.label}
                  </Link>
                  <code className="text-xs text-muted">{prompt.name}.md</code>
                  <span className="grow" />
                  <span className="text-[13px] text-muted">
                    {edited && active
                      ? `Đã sửa: bản ${active.version}, ${formatFullDateTime(active.createdAt)}, ${authorLabel(active.author)}`
                      : 'Mặc định'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </WithOverview>
    </SettingsLayout>
  );
}

// ---------------------------------------------------------------------------
// Guard and QC rules
// ---------------------------------------------------------------------------

const POLICY_KEY: SettingsKeyInput = { kind: 'policy', scope: 'global' };

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const POLICY_LABELS: Record<string, string> = {
  docsPaths: 'Đường dẫn docs',
  protectedPaths: 'Đường dẫn được bảo vệ',
  docsUpdateWritePaths: 'Job docs_update được ghi',
};

function issueLine(path: PropertyKey[], message: string): string {
  const [field, index] = path;
  const label = POLICY_LABELS[String(field)] ?? String(field);
  return typeof index === 'number' ? `${label}, dòng ${index + 1}: ${message}` : `${label}: ${message}`;
}

function RulesEditor({ overview }: { overview: SettingsOverviewResponse }) {
  const active = activeOf(overview.active, POLICY_KEY);
  const current = GuardPolicy.safeParse(active?.content).data ?? overview.defaults.policy;
  const [docs, setDocs] = useState(current.docsPaths.join('\n'));
  const [protectedText, setProtected] = useState(current.protectedPaths.join('\n'));
  const [docsJob, setDocsJob] = useState(current.docsUpdateWritePaths.join('\n'));
  const [qcRule, setQcRule] = useState(current.qcUiTestOnlyForNonDocs);
  const draft = {
    docsPaths: lines(docs),
    protectedPaths: lines(protectedText),
    docsUpdateWritePaths: lines(docsJob),
    qcUiTestOnlyForNonDocs: qcRule,
  };
  const parsed = GuardPolicy.safeParse(draft);
  const errors = parsed.success
    ? []
    : parsed.error.issues.map((issue) => issueLine(issue.path, issue.message));
  return (
    <SettingEditor
      settingKey={POLICY_KEY}
      active={active}
      draft={draft}
      errors={errors}
      dirty={JSON.stringify(draft) !== JSON.stringify(current)}
      resetLabel="Dùng quy tắc mặc định"
      fallbackLabel="quy tắc mặc định của app"
    >
      <p className="m-0 text-[13px] text-muted">
        Mỗi dòng một mẫu đường dẫn, tính từ gốc repo: <code>*</code> khớp trong một thư mục, <code>**</code>{' '}
        khớp mọi thư mục con, <code>thư-mục/**</code> gồm cả thư mục đó. <code>AGENTS.md</code> và{' '}
        <code>CLAUDE.md</code> luôn được bảo vệ và không bao giờ là docs (quyết định của chủ dự án), dù danh
        sách ghi gì.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field
          label="Đường dẫn docs"
          hint="Dev không được ghi; diff chỉ đụng các file này không cần test UI."
        >
          <Textarea
            rows={8}
            className="font-mono text-xs"
            value={docs}
            onChange={(e) => setDocs(e.target.value)}
          />
        </Field>
        <Field label="Đường dẫn được bảo vệ" hint="Chỉ job docs-init được ghi (như luật R6 của crew-docs).">
          <Textarea
            rows={8}
            className="font-mono text-xs"
            value={protectedText}
            onChange={(e) => setProtected(e.target.value)}
          />
        </Field>
        <Field label="Job docs_update được ghi" hint="Phạm vi ghi của job cập nhật docs (chạy trên sonnet).">
          <Textarea
            rows={8}
            className="font-mono text-xs"
            value={docsJob}
            onChange={(e) => setDocsJob(e.target.value)}
          />
        </Field>
      </div>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm xl:min-h-8">
        <input
          type="checkbox"
          className="size-4 accent-[var(--blue)]"
          checked={qcRule}
          onChange={(e) => setQcRule(e.target.checked)}
        />
        Với QC mà PM đã chọn kiểm thử UI, cờ này chỉ bắt buộc chạy khi thay đổi đụng file ngoài đường dẫn docs
      </label>
    </SettingEditor>
  );
}

export function SettingsRulesPage() {
  return (
    <SettingsLayout title="Cài đặt hệ thống" crumbs={[{ label: 'Quy tắc' }]}>
      <WithOverview>
        {(overview) => {
          const active = activeOf(overview.active, POLICY_KEY);
          return <RulesEditor key={active?.id ?? 'default'} overview={overview} />;
        }}
      </WithOverview>
    </SettingsLayout>
  );
}

// ---------------------------------------------------------------------------
// Models and budgets (global)
// ---------------------------------------------------------------------------

const MODELS_KEY: SettingsKeyInput = { kind: 'models', scope: 'global' };
const BUDGETS_KEY: SettingsKeyInput = { kind: 'budgets', scope: 'global' };

function GlobalModels({ overview }: { overview: SettingsOverviewResponse }) {
  const active = activeOf(overview.active, MODELS_KEY);
  const current = ModelSettings.safeParse(active?.content).data ?? overview.defaults.models;
  const [draft, setDraft] = useState(current);
  return (
    <SettingEditor
      settingKey={MODELS_KEY}
      active={active}
      draft={draft}
      errors={issuesOf(ModelSettings.safeParse(draft))}
      dirty={JSON.stringify(draft) !== JSON.stringify(current)}
      resetLabel="Dùng bảng mặc định"
      fallbackLabel="bảng model mặc định của app"
    >
      <ModelSettingsForm value={draft} onChange={setDraft} />
    </SettingEditor>
  );
}

function GlobalBudgets({ overview }: { overview: SettingsOverviewResponse }) {
  const active = activeOf(overview.active, BUDGETS_KEY);
  const current = BudgetSettings.safeParse(active?.content).data ?? overview.defaults.budgets;
  const [text, setText] = useState(current.perJobUsd === null ? '' : String(current.perJobUsd));
  const draft = budgetOf(text);
  return (
    <SettingEditor
      settingKey={BUDGETS_KEY}
      active={active}
      draft={draft}
      errors={issuesOf(BudgetSettings.safeParse(draft), { perJobUsd: 'Chi phí tối đa' })}
      dirty={JSON.stringify(draft) !== JSON.stringify(current)}
      resetLabel="Bỏ giới hạn chung"
      fallbackLabel="không giới hạn"
    >
      <BudgetSettingsForm value={text} onChange={setText} />
    </SettingEditor>
  );
}

export function SettingsModelsPage() {
  return (
    <SettingsLayout title="Cài đặt hệ thống" crumbs={[{ label: 'Models' }]}>
      <WithOverview>
        {(overview) => (
          <>
            <section aria-label="Bảng model chung" className="rounded-md border border-line bg-panel p-4">
              <h2 className="m-0 mb-3 text-base font-semibold">Bảng model chung</h2>
              <p className="m-0 mb-3 text-[13px] text-muted">
                Áp dụng cho mọi máy, trừ máy có bảng riêng (Cài đặt hệ thống → Máy).
              </p>
              <GlobalModels
                key={activeOf(overview.active, MODELS_KEY)?.id ?? 'default'}
                overview={overview}
              />
            </section>
            <section aria-label="Ngân sách chung" className="rounded-md border border-line bg-panel p-4">
              <h2 className="m-0 mb-3 text-base font-semibold">Ngân sách mỗi lượt chạy</h2>
              <GlobalBudgets
                key={activeOf(overview.active, BUDGETS_KEY)?.id ?? 'default'}
                overview={overview}
              />
            </section>
          </>
        )}
      </WithOverview>
    </SettingsLayout>
  );
}

// ---------------------------------------------------------------------------
// Machines and projects (lists)
// ---------------------------------------------------------------------------

export function SettingsMachinesPage() {
  const machines = useMachines();
  const live = (machines.data ?? []).filter((machine) => machine.revokedAt === null);
  return (
    <SettingsLayout title="Cài đặt hệ thống" crumbs={[{ label: 'Máy' }]}>
      <p className="m-0 text-sm text-muted">
        Tài nguyên (số job, RAM, tải) của từng máy, và bảng model hay ngân sách riêng nếu máy cần khác cài đặt
        chung.
      </p>
      {machines.isLoading && <p className="m-0 text-sm text-muted">Đang tải…</p>}
      {machines.data && live.length === 0 && <p className="m-0 text-sm">Chưa có máy nào.</p>}
      <ul aria-label="Máy" className="m-0 flex list-none flex-col gap-2 p-0">
        {live.map((machine) => (
          <li
            key={machine.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-panel p-3"
          >
            <Link
              to="/settings/machines/$machineId"
              params={{ machineId: machine.id }}
              className="font-semibold"
            >
              {machine.name}
            </Link>
            <span className="grow" />
            <SettingsPickup machine={machine} />
          </li>
        ))}
      </ul>
    </SettingsLayout>
  );
}

/** "Cài đặt: bản x (đã nhận)" for one machine, from its latest heartbeat. */
export function SettingsPickup({
  machine,
}: {
  machine: {
    online: boolean;
    settings: { reported: { revision: string; source: string } | null; current: boolean };
  };
}) {
  const reported = machine.settings.reported;
  if (!reported) return <span className="text-[13px] text-muted">Máy chưa báo cài đặt (bản app cũ?)</span>;
  return (
    <span className={cn('text-[13px]', machine.settings.current ? 'text-ok-ink' : 'text-warn-ink')}>
      Cài đặt bản <code>{reported.revision}</code>
      {reported.source !== 'server'
        ? ` (${reported.source === 'cache' ? 'bản lưu trên máy' : 'mặc định'})`
        : ''}
      {machine.settings.current ? ' · mới nhất' : ' · chưa nhận bản mới nhất'}
    </span>
  );
}

export function SettingsProjectsPage() {
  const projects = useProjects();
  return (
    <SettingsLayout title="Cài đặt hệ thống" crumbs={[{ label: 'MCP dự án' }]}>
      <p className="m-0 text-sm text-muted">
        MCP server tắt cho từng dự án: agent không bao giờ nhận tool của chúng, và ticket không được bắt buộc
        dùng chúng. Áp dụng trên máy đang giữ dự án.
      </p>
      {projects.isLoading && <p className="m-0 text-sm text-muted">Đang tải…</p>}
      <ul aria-label="Dự án" className="m-0 flex list-none flex-col gap-2 p-0">
        {(projects.data ?? []).map((project) => (
          <li
            key={project.id}
            className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel p-3"
          >
            <Link
              to="/settings/projects/$projectKey"
              params={{ projectKey: project.key }}
              className="font-semibold"
            >
              {project.key}
            </Link>
            <span className="text-[13px] text-muted">{project.name}</span>
          </li>
        ))}
      </ul>
    </SettingsLayout>
  );
}
