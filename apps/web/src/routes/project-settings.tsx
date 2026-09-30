import {
  BmadCommandResult,
  type BmadProfile,
  type Machine,
  type Project,
  ProjectMcpSettings,
} from '@crew/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMachineCommand } from '../components/machine-control';
import { ProjectForm, ReassignDialog } from '../components/project-form';
import { activeOf } from '../components/setting-editor';
import { Button } from '../components/ui/button';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { formatDateTime } from '../lib/format';
import { useMachineNames, useProjectByKey, useSettingsOverview } from '../lib/queries';
import { DocsStatusLozenge } from './projects';

/**
 * "Cài BMAD" on the machine that holds the project: installs the reported profile into its folder there
 * (never over an existing install), as a remote action the machine runs and reports back.
 */
function BmadInstallButton({ project, machine }: { project: Project; machine: Machine }) {
  const { command, busy, error, run } = useMachineCommand(machine.id);
  const result = command?.status === 'done' ? BmadCommandResult.safeParse(command.result).data : undefined;
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <div>
        <Button
          size="sm"
          disabled={busy || !machine.online}
          onClick={() => void run({ action: 'bmad.install', projectKey: project.key })}
        >
          Cài BMAD trên máy {machine.name}
        </Button>
      </div>
      {!machine.online && <p className="m-0 text-xs text-muted">Máy đang offline.</p>}
      {busy && command && <p className="m-0 text-xs text-muted">Đang cài trên máy…</p>}
      {result && <p className="m-0 text-[13px]">{result.message}</p>}
      {(command?.status === 'failed' || command?.status === 'expired' || error) && (
        <p role="alert" className="m-0 text-[13px] text-bad">
          {error ?? command?.error ?? 'Máy không nhận thao tác trong 10 phút.'}
        </p>
      )}
    </div>
  );
}

/** The BMAD setup the owning machine reported, and the button that installs it on that machine. */
function BmadProfileSection({
  profile,
  project,
  owner,
}: {
  profile: BmadProfile | null;
  project: Project;
  owner: Machine | undefined;
}) {
  const rows: [string, string][] = profile
    ? [
        ['Phiên bản', `${profile.version} (cài lúc ${formatDateTime(profile.lastUpdated)})`],
        ['Module', profile.modules.join(', ')],
        ['Công cụ', profile.tools.join(', ') || '—'],
        ['Ngôn ngữ trò chuyện', profile.communicationLanguage ?? 'mặc định'],
        ['Ngôn ngữ tài liệu', profile.documentOutputLanguage ?? 'mặc định'],
        ['Thư mục kết quả', profile.outputFolder ?? 'mặc định'],
        ['Cấu hình module', `${profile.settings.length} giá trị`],
      ]
    : [];
  return (
    <section aria-label="BMAD" className="rounded-md border border-line bg-panel p-4 text-sm">
      <h2 className="m-0 mb-2 text-sm font-semibold">BMAD</h2>
      {profile ? (
        <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="m-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 text-muted">Chưa có cấu hình BMAD (máy đang giữ project chưa có BMAD).</p>
      )}
      {profile && owner && <BmadInstallButton project={project} machine={owner} />}
    </section>
  );
}

/** The MCP servers switched off for the project (its server setting), or "không có". */
function ProjectMcpSummary({ projectId }: { projectId: string }) {
  const overview = useSettingsOverview();
  if (!overview.data) return <span className="text-muted">…</span>;
  const active = activeOf(overview.data.active, { kind: 'project_mcp', scope: 'project', projectId });
  const disabled = ProjectMcpSettings.safeParse(active?.content).data?.disabledMcpServers ?? [];
  return disabled.length === 0 ? (
    <strong>không có</strong>
  ) : (
    <strong className="font-mono text-[13px]">{disabled.join(', ')}</strong>
  );
}

/** "Cài đặt project": the project form plus the owning machine, for the project in the sidebar. */
export function ProjectSettingsPage({ projectKey }: { projectKey: string }) {
  const { project, isLoading } = useProjectByKey(projectKey);
  const machines = useMachineNames();
  const [moving, setMoving] = useState(false);
  if (isLoading) return <p className="m-0 p-6 text-sm text-muted">Đang tải…</p>;
  if (!project) return <p className="m-0 p-6 text-sm text-bad">Không tìm thấy dự án {projectKey}.</p>;
  const owner = project.ownerMachineId ? machines.get(project.ownerMachineId) : undefined;
  return (
    <div className="flex max-w-3xl flex-col gap-4 px-3 py-3 md:px-6 md:py-[18px]">
      <Breadcrumbs
        items={[{ label: 'Dự án', link: { to: '/projects' } }, { label: project.name }, { label: 'Cài đặt' }]}
      />
      <h1 className="m-0 text-[22px] font-semibold">Cài đặt {project.key}</h1>
      <section
        aria-label="Máy sở hữu"
        className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel p-4 text-sm"
      >
        <span className="grow">
          Máy: {owner ? <strong>{owner.name}</strong> : <strong className="text-bad">chưa có máy</strong>}
        </span>
        <DocsStatusLozenge status={project.docsStatus} />
        <Button size="sm" onClick={() => setMoving(true)}>
          {owner ? 'Chuyển máy' : 'Giao máy'}
        </Button>
      </section>
      <section
        aria-label="MCP server"
        className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel p-4 text-sm"
      >
        <span className="grow">
          MCP server tắt cho dự án: <ProjectMcpSummary projectId={project.id} />
        </span>
        <Link
          to="/settings/projects/$projectKey"
          params={{ projectKey: project.key }}
          className="inline-flex min-h-11 items-center rounded border border-line bg-panel px-2.5 text-[13px] text-ink no-underline hover:bg-soft xl:min-h-7"
        >
          Sửa MCP
        </Link>
      </section>
      <BmadProfileSection profile={project.bmadProfile} project={project} owner={owner} />
      <div className="rounded-md border border-line bg-panel p-4">
        <ProjectForm key={project.updatedAt} project={project} />
      </div>
      <ReassignDialog project={project} open={moving} onOpenChange={setMoving} />
    </div>
  );
}
