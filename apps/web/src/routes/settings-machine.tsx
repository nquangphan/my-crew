import {
  BudgetSettings,
  type Machine,
  ModelSettings,
  ProjectFolders,
  ResourceSettings,
  type SettingsKeyInput,
  type SettingsOverviewResponse,
} from '@crew/shared';
import { useState } from 'react';
import {
  BudgetSettingsForm,
  budgetOf,
  issuesOf,
  ModelSettingsForm,
  parseResourceDraft,
  RESOURCE_LABELS,
  ResourceSettingsForm,
  resourceDraft,
} from '../components/model-settings-form';
import { activeOf, SettingEditor } from '../components/setting-editor';
import { Field, Input, Textarea } from '../components/ui/field';
import { errorMessage } from '../lib/format';
import { useMachines, useProjects } from '../lib/queries';
import { SettingsLayout, SettingsPickup, WithOverview } from './system-settings';

const machineKey = (
  kind: 'resources' | 'models' | 'budgets' | 'project_folders',
  machineId: string,
): SettingsKeyInput => ({
  kind,
  scope: 'machine',
  machineId,
});

function MachineResources({ overview, machine }: { overview: SettingsOverviewResponse; machine: Machine }) {
  const key = machineKey('resources', machine.id);
  const active = activeOf(overview.active, key);
  const current = ResourceSettings.safeParse(active?.content).data ?? overview.defaults.resources;
  const [draft, setDraft] = useState(resourceDraft(current));
  const parsed = parseResourceDraft(draft);
  return (
    <SettingEditor
      settingKey={key}
      active={active}
      draft={parsed.success ? parsed.data : null}
      errors={issuesOf(parsed, RESOURCE_LABELS)}
      dirty={!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(current)}
      resetLabel="Dùng mặc định của app"
      fallbackLabel="mặc định của app (2 job, 2 GB RAM trống, tải 1.5 mỗi CPU)"
    >
      <ResourceSettingsForm value={draft} onChange={setDraft} />
    </SettingEditor>
  );
}

/** A machine's own model map, or the shared one: the owner picks which, then edits the machine's copy. */
function MachineModels({ overview, machine }: { overview: SettingsOverviewResponse; machine: Machine }) {
  const key = machineKey('models', machine.id);
  const active = activeOf(overview.active, key);
  const shared =
    ModelSettings.safeParse(activeOf(overview.active, { kind: 'models', scope: 'global' })?.content).data ??
    overview.defaults.models;
  const own = ModelSettings.safeParse(active?.content).data ?? null;
  const [override, setOverride] = useState(own !== null);
  const [draft, setDraft] = useState(own ?? shared);
  return (
    <SettingEditor
      settingKey={key}
      active={active}
      draft={override ? draft : null}
      errors={override ? issuesOf(ModelSettings.safeParse(draft)) : []}
      dirty={override ? JSON.stringify(draft) !== JSON.stringify(own) : own !== null}
      resetLabel={null}
      fallbackLabel="bảng model chung"
    >
      <OverrideChoice override={override} onChange={setOverride} shared="Dùng bảng model chung" />
      {override && <ModelSettingsForm value={draft} onChange={setDraft} />}
    </SettingEditor>
  );
}

function MachineBudgets({ overview, machine }: { overview: SettingsOverviewResponse; machine: Machine }) {
  const key = machineKey('budgets', machine.id);
  const active = activeOf(overview.active, key);
  const own = BudgetSettings.safeParse(active?.content).data ?? null;
  const [override, setOverride] = useState(own !== null);
  const [text, setText] = useState(own?.perJobUsd == null ? '' : String(own.perJobUsd));
  const draft = budgetOf(text);
  return (
    <SettingEditor
      settingKey={key}
      active={active}
      draft={override ? draft : null}
      errors={override ? issuesOf(BudgetSettings.safeParse(draft), { perJobUsd: 'Chi phí tối đa' }) : []}
      dirty={override ? JSON.stringify(draft) !== JSON.stringify(own) : own !== null}
      resetLabel={null}
      fallbackLabel="ngân sách chung"
    >
      <OverrideChoice override={override} onChange={setOverride} shared="Dùng ngân sách chung" />
      {override && <BudgetSettingsForm value={text} onChange={setText} />}
    </SettingEditor>
  );
}

function OverrideChoice({
  override,
  onChange,
  shared,
}: {
  override: boolean;
  onChange: (override: boolean) => void;
  shared: string;
}) {
  return (
    <div role="radiogroup" aria-label="Phạm vi" className="flex flex-wrap gap-4 text-sm">
      {[
        [false, shared],
        [true, 'Riêng máy này'],
      ].map(([value, label]) => (
        <label key={String(value)} className="inline-flex min-h-11 items-center gap-1.5 xl:min-h-8">
          <input
            type="radio"
            className="size-4 accent-[var(--blue)]"
            checked={override === value}
            onChange={() => onChange(value as boolean)}
          />
          {label as string}
        </label>
      ))}
    </div>
  );
}

/** Folders compared regardless of order (a machine appends, the web sorts). */
const byKey = (list: readonly { key: string }[]) =>
  JSON.stringify([...list].sort((a, b) => a.key.localeCompare(b.key)));

interface FolderDraft {
  key: string;
  repoPath: string;
  sharedPaths: string;
}

/**
 * Where each project lives on this machine (and the untracked paths linked into its worktrees): the projects
 * the machine holds, plus any folder already set. The machine checks each folder itself and reports the ones
 * it cannot use; a project with no usable folder waits instead of running.
 */
function MachineFolders({ overview, machine }: { overview: SettingsOverviewResponse; machine: Machine }) {
  const key = machineKey('project_folders', machine.id);
  const active = activeOf(overview.active, key);
  const projects = useProjects();
  const current = ProjectFolders.safeParse(active?.content).data?.projects ?? [];
  const owned = (projects.data ?? [])
    .filter((project) => project.ownerMachineId === machine.id)
    .map((p) => p.key);
  const keys = [...new Set([...owned, ...current.map((entry) => entry.key)])].sort();
  const [drafts, setDrafts] = useState<FolderDraft[]>(() =>
    current.map((entry) => ({
      key: entry.key,
      repoPath: entry.repoPath,
      sharedPaths: entry.sharedPaths.join('\n'),
    })),
  );
  const draftOf = (projectKey: string) =>
    drafts.find((item) => item.key === projectKey) ?? { key: projectKey, repoPath: '', sharedPaths: '' };
  const set = (projectKey: string, patch: Partial<FolderDraft>) =>
    setDrafts((list) => [
      ...list.filter((item) => item.key !== projectKey),
      { ...draftOf(projectKey), ...patch },
    ]);
  const content = {
    projects: keys
      .map(draftOf)
      .filter((item) => item.repoPath.trim() !== '')
      .map((item) => ({
        key: item.key,
        repoPath: item.repoPath.trim(),
        sharedPaths: item.sharedPaths
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      })),
  };
  const parsed = ProjectFolders.safeParse(content);
  const errors = parsed.success
    ? []
    : parsed.error.issues.map((issue) => {
        const entry = typeof issue.path[1] === 'number' ? content.projects[issue.path[1]] : undefined;
        return `${entry ? `${entry.key}: ` : ''}${issue.message}`;
      });
  const problems = new Map(
    (machine.settings.reported?.rejected ?? [])
      .filter((line) => line.startsWith('project_folder:'))
      .map((line) => {
        const rest = line.slice('project_folder:'.length);
        const colon = rest.indexOf(':');
        return [rest.slice(0, colon), rest.slice(colon + 1).trim()] as const;
      }),
  );
  return (
    <SettingEditor
      settingKey={key}
      active={active}
      draft={parsed.success ? parsed.data : null}
      errors={errors}
      dirty={byKey(parsed.success ? parsed.data.projects : content.projects) !== byKey(current)}
      resetLabel={null}
      fallbackLabel="thư mục trong config.yaml của máy (chưa có trên server)"
    >
      {keys.length === 0 && <p className="m-0 text-sm text-muted">Máy chưa giữ dự án nào.</p>}
      <ul aria-label="Thư mục dự án" className="m-0 flex list-none flex-col gap-3 p-0">
        {keys.map((projectKey) => {
          const draft = draftOf(projectKey);
          return (
            <li
              key={projectKey}
              data-project={projectKey}
              className="flex flex-col gap-2 rounded border border-line2 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong className="font-mono">{projectKey}</strong>
                {!owned.includes(projectKey) && (
                  <span className="text-xs text-muted">máy không còn giữ dự án này</span>
                )}
                {problems.get(projectKey) && (
                  <span role="alert" className="text-xs text-bad">
                    Máy không dùng được thư mục này: {problems.get(projectKey)}
                  </span>
                )}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <Field
                  label={`Thư mục ${projectKey} trên máy`}
                  hint="Đường dẫn tuyệt đối tới thư mục gốc của repo."
                >
                  <Input
                    className="font-mono"
                    value={draft.repoPath}
                    placeholder="/Users/ten/Documents/du-an"
                    onChange={(e) => set(projectKey, { repoPath: e.target.value })}
                  />
                </Field>
                <Field
                  label={`Đường dẫn dùng chung của ${projectKey}`}
                  hint="Mỗi dòng một đường dẫn trong repo (không commit), được nối vào mọi worktree."
                >
                  <Textarea
                    rows={2}
                    className="font-mono text-xs"
                    value={draft.sharedPaths}
                    onChange={(e) => set(projectKey, { sharedPaths: e.target.value })}
                  />
                </Field>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="m-0 text-xs text-muted">
        Lệnh test của dự án không đặt ở đây: nó chạy như lệnh shell trên máy nên chỉ nằm trong config.yaml của
        máy.
      </p>
    </SettingEditor>
  );
}

/** One machine's server settings: resources, and its own model map or budget when it needs one. */
export function SettingsMachinePage({ machineId }: { machineId: string }) {
  const machines = useMachines();
  const machine = machines.data?.find((item) => item.id === machineId);
  return (
    <SettingsLayout
      title={machine ? `Máy ${machine.name}` : 'Máy'}
      crumbs={[{ label: 'Máy', link: { to: '/settings/machines' } }, { label: machine?.name ?? machineId }]}
    >
      {machines.isLoading && <p className="m-0 text-sm text-muted">Đang tải…</p>}
      {machines.isError && (
        <p role="alert" className="m-0 text-sm text-bad">
          {errorMessage(machines.error)}
        </p>
      )}
      {machines.data && !machine && (
        <p role="alert" className="m-0 text-sm text-bad">
          Không tìm thấy máy này.
        </p>
      )}
      {machine && (
        <WithOverview>
          {(overview) => (
            <>
              <p className="m-0">
                <SettingsPickup machine={machine} />
              </p>
              {machine.settings.reported && machine.settings.reported.rejected.length > 0 && (
                <p role="alert" className="m-0 text-sm text-bad">
                  Máy từ chối (không hợp lệ, dùng mặc định): {machine.settings.reported.rejected.join(', ')}
                </p>
              )}
              {(
                [
                  ['Thư mục dự án', 'project_folders', MachineFolders],
                  ['Tài nguyên', 'resources', MachineResources],
                  ['Bảng model', 'models', MachineModels],
                  ['Ngân sách mỗi lượt chạy', 'budgets', MachineBudgets],
                ] as const
              ).map(([title, kind, Editor]) => (
                <section key={kind} aria-label={title} className="rounded-md border border-line bg-panel p-4">
                  <h2 className="m-0 mb-3 text-base font-semibold">{title}</h2>
                  <Editor
                    key={activeOf(overview.active, machineKey(kind, machine.id))?.id ?? 'default'}
                    overview={overview}
                    machine={machine}
                  />
                </section>
              ))}
            </>
          )}
        </WithOverview>
      )}
    </SettingsLayout>
  );
}
