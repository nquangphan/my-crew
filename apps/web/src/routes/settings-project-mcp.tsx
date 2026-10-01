import {
  McpServerName,
  type Project,
  ProjectMcpSettings,
  qcDefaultMcps,
  type SettingsKeyInput,
  type SettingsOverviewResponse,
} from '@crew/shared';
import { type FormEvent, useState } from 'react';
import { activeOf, SettingEditor } from '../components/setting-editor';
import { Button } from '../components/ui/button';
import { Field, Input } from '../components/ui/field';
import { cn } from '../lib/cn';
import { useMachine, useProjectByKey } from '../lib/queries';
import { SettingsLayout, WithOverview } from './system-settings';

export const projectMcpKey = (projectId: string): SettingsKeyInput => ({
  kind: 'project_mcp',
  scope: 'project',
  projectId,
});

/**
 * The project's MCP switches: every server the owning machine reported for the project (and machine-wide),
 * plus any switched off that it no longer reports. A server QC must use for the project type is marked.
 */
function ProjectMcpEditor({ overview, project }: { overview: SettingsOverviewResponse; project: Project }) {
  const key = projectMcpKey(project.id);
  const active = activeOf(overview.active, key);
  const current = ProjectMcpSettings.safeParse(active?.content).data?.disabledMcpServers ?? [];
  const [disabled, setDisabled] = useState<string[]>(current);
  const [adding, setAdding] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const machine = useMachine(project.ownerMachineId);
  const reported = (machine.data?.inventories ?? [])
    .filter((inventory) => inventory.projectKey === project.key || inventory.projectKey === null)
    .flatMap((inventory) => inventory.mcpServers);
  const required = new Set(qcDefaultMcps(project.platform, project.uiTestMcp));
  const names = [...new Set([...reported.map((server) => server.name), ...disabled])].sort();
  const statusOf = (name: string) => reported.find((server) => server.name === name)?.status ?? null;
  const toggle = (name: string, enabled: boolean) =>
    setDisabled((list) => (enabled ? list.filter((item) => item !== name) : [...new Set([...list, name])]));
  const add = (event: FormEvent) => {
    event.preventDefault();
    const parsed = McpServerName.safeParse(adding.trim());
    if (!parsed.success) {
      setAddError(parsed.error.issues[0]?.message ?? 'Tên MCP không hợp lệ');
      return;
    }
    setAddError(null);
    toggle(parsed.data, false);
    setAdding('');
  };
  const draft = { disabledMcpServers: disabled };
  const parsed = ProjectMcpSettings.safeParse(draft);
  return (
    <SettingEditor
      settingKey={key}
      active={active}
      draft={draft}
      errors={parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)}
      dirty={JSON.stringify([...disabled].sort()) !== JSON.stringify([...current].sort())}
      resetLabel="Bật lại tất cả"
      fallbackLabel="mọi MCP server đều bật"
    >
      {!project.ownerMachineId && (
        <p className="m-0 text-sm text-muted">
          Dự án chưa có máy: danh sách MCP hiện khi một máy nhận dự án.
        </p>
      )}
      {names.length === 0 && project.ownerMachineId && (
        <p className="m-0 text-sm text-muted">Máy của dự án chưa báo MCP server nào.</p>
      )}
      <ul aria-label="MCP server của dự án" className="m-0 flex list-none flex-col gap-1 p-0">
        {names.map((name) => {
          const status = statusOf(name);
          return (
            <li key={name}>
              <label className="inline-flex min-h-11 flex-wrap items-center gap-2 text-sm xl:min-h-8">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--blue)]"
                  checked={!disabled.includes(name)}
                  onChange={(e) => toggle(name, e.target.checked)}
                  aria-label={`Bật ${name}`}
                />
                <code>{name}</code>
                <span className={cn('text-xs', status === 'connected' ? 'text-muted' : 'text-bad')}>
                  {status ?? 'máy không còn báo server này'}
                </span>
                {required.has(name) && (
                  <span className="text-xs text-warn-ink">
                    QC dùng server này khi PM chọn kiểm thử UI cho loại dự án này
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Tắt thêm server theo tên">
          <Input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="plugin:figma:figma"
          />
        </Field>
        <Button type="submit">Thêm</Button>
        {addError && (
          <span role="alert" className="text-xs text-bad">
            {addError}
          </span>
        )}
      </form>
    </SettingEditor>
  );
}

/** One project's MCP switches (a server setting; the machine holding the project applies it). */
export function SettingsProjectMcpPage({ projectKey }: { projectKey: string }) {
  const { project, isLoading } = useProjectByKey(projectKey);
  return (
    <SettingsLayout
      title={`MCP của ${projectKey}`}
      crumbs={[
        { label: 'MCP dự án', link: { to: '/settings/projects' } },
        { label: projectKey, mono: true },
      ]}
    >
      {isLoading && <p className="m-0 text-sm text-muted">Đang tải…</p>}
      {!isLoading && !project && (
        <p role="alert" className="m-0 text-sm text-bad">
          Không tìm thấy dự án {projectKey}.
        </p>
      )}
      {project && (
        <WithOverview>
          {(overview) => (
            <ProjectMcpEditor
              key={activeOf(overview.active, projectMcpKey(project.id))?.id ?? 'default'}
              overview={overview}
              project={project}
            />
          )}
        </WithOverview>
      )}
    </SettingsLayout>
  );
}
