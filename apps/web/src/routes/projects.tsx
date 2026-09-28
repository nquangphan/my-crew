import type { Project } from '@crew/shared';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PLATFORM_LABEL, ProjectForm, ReassignDialog } from '../components/project-form';
import { TONE_CLASS } from '../components/status-lozenge';
import { Button } from '../components/ui/button';
import { DialogContent, DialogRoot } from '../components/ui/dialog';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { cn } from '../lib/cn';
import { DOCS_STATUS_LABEL, errorMessage, formatUsd, type Tone } from '../lib/format';
import { useMachineNames, useProjects } from '../lib/queries';

const DOCS_TONE: Record<string, Tone> = {
  unknown: 'neutral',
  missing: 'block',
  initializing: 'progress',
  ready: 'done',
};

export function DocsStatusLozenge({ status }: { status: Project['docsStatus'] }) {
  return (
    <span
      className={cn(
        'rounded-[3px] px-1.5 py-0.5 text-[11px] font-bold uppercase',
        TONE_CLASS[DOCS_TONE[status] ?? 'neutral'],
      )}
    >
      Docs: {DOCS_STATUS_LABEL[status]}
    </span>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const machines = useMachineNames();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const owner = project.ownerMachineId ? machines.get(project.ownerMachineId) : undefined;
  return (
    <li
      aria-label={`Dự án ${project.key}`}
      className="flex flex-col gap-2.5 rounded-md border border-line bg-panel p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex size-8 items-center justify-center rounded-md bg-accent-bg text-[13px] font-bold text-accent">
          {project.key.slice(0, 2)}
        </span>
        <h2 className="m-0 text-base font-semibold">
          <Link to="/projects/$projectKey/board" params={{ projectKey: project.key }} className="text-ink">
            {project.name}
          </Link>
        </h2>
        <span className="font-mono text-xs text-muted">{project.key}</span>
        <DocsStatusLozenge status={project.docsStatus} />
      </div>
      <p className="m-0 line-clamp-3 text-sm whitespace-pre-line">{project.description}</p>
      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted">Máy</dt>
        <dd className="m-0">
          {owner ? owner.name : <span className="font-semibold text-bad">Chưa có máy</span>}
        </dd>
        <dt className="text-muted">Repo</dt>
        <dd className="m-0 truncate font-mono text-xs">
          {project.repoUrl} · {project.defaultBranch}
        </dd>
        <dt className="text-muted">Nền tảng</dt>
        <dd className="m-0">{PLATFORM_LABEL[project.platform]}</dd>
        <dt className="text-muted">Giới hạn</dt>
        <dd className="m-0">
          {project.maxChildrenPerTicket} ticket con · PM task{' '}
          {formatUsd(project.ticketTreeBudgetUsd) === '—'
            ? 'không giới hạn'
            : formatUsd(project.ticketTreeBudgetUsd)}{' '}
          · ngày {project.dailyBudgetUsd === null ? 'không giới hạn' : formatUsd(project.dailyBudgetUsd)}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setEditing(true)}>
          Sửa
        </Button>
        <Button size="sm" onClick={() => setMoving(true)}>
          {owner ? 'Chuyển máy' : 'Giao máy'}
        </Button>
      </div>
      <DialogRoot open={editing} onOpenChange={setEditing}>
        <DialogContent title={`Sửa dự án ${project.key}`} wide>
          <ProjectForm project={project} onDone={() => setEditing(false)} />
        </DialogContent>
      </DialogRoot>
      <ReassignDialog project={project} open={moving} onOpenChange={setMoving} />
    </li>
  );
}

/** Projects: list, create, edit (the description drives routing), budgets and caps, owning machine. */
export function ProjectsPage() {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex max-w-5xl flex-col gap-4 px-3 py-3 md:px-6 md:py-[18px]">
      <Breadcrumbs items={[{ label: 'Dự án' }]} />
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 grow text-[22px] font-semibold">Dự án</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden /> Tạo dự án
        </Button>
      </div>
      {projects.isLoading && <p className="m-0 text-sm text-muted">Đang tải…</p>}
      {projects.isError && (
        <p role="alert" className="m-0 text-sm text-bad">
          {errorMessage(projects.error)}
        </p>
      )}
      {projects.data?.length === 0 && (
        <p className="m-0 rounded-md border border-line bg-panel p-4 text-sm">
          Chưa có dự án. Tạo ở đây, hoặc tạo từ một thư mục trong app 2P Crew trên máy.
        </p>
      )}
      <ul className="m-0 grid list-none gap-3 p-0 xl:grid-cols-2">
        {(projects.data ?? []).map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </ul>
      <DialogRoot open={creating} onOpenChange={setCreating}>
        <DialogContent
          title="Tạo dự án"
          description="Dự án chưa có máy cho tới khi một máy nhận nó trong app 2P Crew."
          wide
        >
          <ProjectForm project={null} onDone={() => setCreating(false)} />
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
