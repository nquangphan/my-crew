import type { BmadProfile } from '@crew/shared';
import { useState } from 'react';
import { ProjectForm, ReassignDialog } from '../components/project-form';
import { Button } from '../components/ui/button';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { formatDateTime } from '../lib/format';
import { useMachineNames, useProjectByKey } from '../lib/queries';
import { DocsStatusLozenge } from './projects';

/** The BMAD setup the owning machine reported; the desktop app's "Cài BMAD" installs it on another machine. */
function BmadProfileSection({ profile }: { profile: BmadProfile | null }) {
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
    </section>
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
      <BmadProfileSection profile={project.bmadProfile} />
      <div className="rounded-md border border-line bg-panel p-4">
        <ProjectForm key={project.updatedAt} project={project} />
      </div>
      <ReassignDialog project={project} open={moving} onOpenChange={setMoving} />
    </div>
  );
}
