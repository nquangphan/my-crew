import type { DocsOverviewItem, Project } from '@crew/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { BookOpen, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DocsSearchHits } from '../components/docs-page-tree';
import { ProjectBadge } from '../components/project-badge';
import { ProjectFilterMenu, selectedProjects } from '../components/project-filter';
import { StatusLozenge } from '../components/status-lozenge';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { docsHome } from '../lib/docs-links';
import { errorMessage, formatDateTime } from '../lib/format';
import { useDocsOverview, useDocsSearchAcross, useProjects } from '../lib/queries';
import type { DocsHomeSearch } from '../lib/search-params';
import { useDebounced } from '../lib/ui-state';
import { DocsStatusLozenge } from './projects';

/** Why a project has no docs yet, from its newest docs_init ticket and whether a machine holds it. */
export function noDocsReason(project: Project, status: DocsOverviewItem | undefined): string {
  const init = status?.docsInit;
  if (init) {
    switch (init.status) {
      case 'blocked':
        return 'Khởi tạo docs đang bị chặn.';
      case 'needs_input':
        return 'Khởi tạo docs đang chờ bạn trả lời.';
      case 'done':
        return 'Đã khởi tạo docs, đang chờ máy giữ dự án đồng bộ.';
      case 'cancelled':
        return 'Ticket khởi tạo docs đã bị hủy.';
      default:
        return 'Đang khởi tạo docs.';
    }
  }
  if (project.ownerMachineId === null) return 'Dự án chưa có máy giữ, nên chưa ai khởi tạo hay đồng bộ docs.';
  return 'Máy giữ dự án chưa đồng bộ docs, và chưa có ticket khởi tạo docs.';
}

function ProjectDocsCard({ project, status }: { project: Project; status: DocsOverviewItem | undefined }) {
  const snapshot = status?.snapshot ?? null;
  return (
    <li
      aria-label={`Docs dự án ${project.key}`}
      data-project={project.key}
      className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-panel p-4"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ProjectBadge projectKey={project.key} />
        <h2 className="m-0 min-w-0 truncate text-base font-semibold">
          {snapshot ? (
            <Link {...docsHome(project.key)} className="text-ink">
              {project.name}
            </Link>
          ) : (
            project.name
          )}
        </h2>
        <DocsStatusLozenge status={snapshot ? 'ready' : project.docsStatus} />
      </div>
      {snapshot ? (
        <p className="m-0 text-[13px] text-muted">
          {status?.fileCount ?? 0} file · commit{' '}
          <code className="font-mono">{snapshot.commit.slice(0, 7)}</code> ({snapshot.branch}) · đồng bộ lúc{' '}
          {formatDateTime(snapshot.syncedAt)}
        </p>
      ) : (
        <div className="flex flex-col gap-1 text-[13px]">
          <p className="m-0 font-semibold">Chưa có docs</p>
          <p className="m-0 text-muted">{noDocsReason(project, status)}</p>
          {status?.docsInit && (
            <p className="m-0 flex flex-wrap items-center gap-1.5">
              <Link
                to="/tickets/$ticketKey"
                params={{ ticketKey: status.docsInit.key }}
                className="inline-flex min-h-11 items-center font-mono xl:min-h-0"
              >
                {status.docsInit.key}
              </Link>
              <StatusLozenge status={status.docsInit.status} />
            </p>
          )}
        </div>
      )}
      {snapshot && (
        <Link
          {...docsHome(project.key)}
          className="inline-flex min-h-11 items-center self-start text-sm xl:min-h-0"
        >
          Mở docs
        </Link>
      )}
    </li>
  );
}

function SearchResultsAcross({
  q,
  projectIds,
  enabled,
}: {
  q: string;
  projectIds: readonly string[];
  enabled: boolean;
}) {
  const search = useDocsSearchAcross(q, projectIds, enabled);
  if (!enabled || search.isLoading) return <p className="m-0 text-sm text-muted">Đang tìm…</p>;
  if (search.isError) return <p className="m-0 text-sm text-bad">{errorMessage(search.error)}</p>;
  const items = search.data?.items ?? [];
  if (items.length === 0) return <p className="m-0 text-sm text-muted">Không có trang nào khớp “{q}”.</p>;
  return (
    <div className="rounded-md border border-line bg-panel p-1.5">
      <DocsSearchHits items={items} showProject label="Kết quả tìm docs" />
    </div>
  );
}

/**
 * The docs home (`/docs`): every project with its docs status (ready with commit, time and file count, or
 * why there are no docs yet with the docs-init ticket), and a docs search across projects. The "Dự án"
 * filter (`?project=`) narrows both.
 */
export function DocsHomePage({ search }: { search: DocsHomeSearch }) {
  const navigate = useNavigate();
  const projects = useProjects();
  const overview = useDocsOverview();
  const [text, setText] = useState(search.q ?? '');
  const q = useDebounced(text.trim(), 250);
  const chosen = selectedProjects(projects.data, search.project);
  const shown = chosen.length > 0 ? chosen : (projects.data ?? []);
  const statusOf = new Map((overview.data?.items ?? []).map((item) => [item.projectId, item]));
  const setSearch = (patch: Partial<DocsHomeSearch>) =>
    void navigate({ to: '/docs', search: (prev) => ({ ...prev, ...patch }), replace: true });

  // Keep the search text in the URL, so a search can be shared and survives going back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: writes the debounced text only
  useEffect(() => {
    if ((search.q ?? '') !== q) setSearch({ q: q || undefined });
  }, [q]);

  const ready = shown.filter((p) => statusOf.get(p.id)?.snapshot).length;

  return (
    <div className="flex max-w-5xl flex-col gap-4 px-3 py-3 md:px-6 md:py-[18px]">
      <Breadcrumbs items={[{ label: 'Tài liệu' }]} />
      <div className="flex flex-wrap items-center gap-2.5">
        <BookOpen size={22} aria-hidden className="text-accent" />
        <h1 className="m-0 grow text-[22px] font-semibold">Tài liệu · Tất cả dự án</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Bộ lọc tài liệu">
        <div className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded border border-line bg-bg px-2.5 text-muted focus-within:border-accent md:w-80 xl:min-h-8">
          <Search size={16} aria-hidden />
          <input
            aria-label="Tìm trong docs của mọi dự án"
            placeholder="Tìm trong docs…"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setText('');
            }}
            className="min-w-0 grow bg-transparent text-sm text-ink outline-none"
          />
          {text && (
            <button
              type="button"
              aria-label="Xóa tìm kiếm"
              onClick={() => setText('')}
              className="-mr-1 inline-flex size-9 items-center justify-center xl:size-6"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>
        <ProjectFilterMenu
          projects={projects.data ?? []}
          value={search.project}
          onChange={(project) => setSearch({ project })}
        />
      </div>

      {q && (
        <section aria-label="Tìm docs" className="flex flex-col gap-2">
          <h2 className="m-0 text-sm font-semibold">
            Kết quả trong {chosen.length > 0 ? chosen.map((p) => p.key).join(', ') : 'mọi dự án'}
          </h2>
          <SearchResultsAcross
            q={q}
            projectIds={chosen.map((p) => p.id)}
            // Wait for the projects before searching with a filter, so no unfiltered results flash.
            enabled={Boolean(projects.data) || !search.project}
          />
        </section>
      )}

      {(projects.isLoading || overview.isLoading) && <p className="m-0 text-sm text-muted">Đang tải…</p>}
      {(projects.isError || overview.isError) && (
        <p role="alert" className="m-0 text-sm text-bad">
          {errorMessage(projects.error ?? overview.error)}
        </p>
      )}
      {projects.data && projects.data.length === 0 && (
        <p className="m-0 rounded-md border border-line bg-panel p-4 text-sm">
          Chưa có dự án nào. Tạo dự án trong mục <Link to="/projects">Dự án</Link>.
        </p>
      )}
      {projects.data && projects.data.length > 0 && (
        <section aria-label="Docs theo dự án" className="flex flex-col gap-2">
          <h2 className="m-0 text-sm font-semibold">
            Docs theo dự án{' '}
            <span className="text-muted">
              · {ready}/{shown.length} có docs
            </span>
          </h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((project) => (
              <ProjectDocsCard key={project.id} project={project} status={statusOf.get(project.id)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
