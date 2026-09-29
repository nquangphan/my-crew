import type { DocsSpaceResponse, Project } from '@crew/shared';
import { Link } from '@tanstack/react-router';
import { BookOpen, FileQuestion, Menu } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { DocsPageTree } from '../components/docs-page-tree';
import { DocsPageView } from '../components/docs-page-view';
import { DocsProjectSwitcher } from '../components/docs-project-switcher';
import { FileLookup } from '../components/file-lookup';
import { FlowFiles } from '../components/flow-view';
import { RelatedTickets } from '../components/related-tickets';
import { Button } from '../components/ui/button';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { ApiRequestError } from '../lib/api-client';
import { DOCS_INDEX, docsHome } from '../lib/docs-links';
import { DOCS_HOME_PATH, type DocsTarget, resolveDocsTarget } from '../lib/docs-space';
import { DOCS_STATUS_LABEL, errorMessage } from '../lib/format';
import { useDocsPage, useDocsSpace, useProjectByKey } from '../lib/queries';
import type { DocsSearch } from '../lib/search-params';
import { useViewport } from '../lib/ui-state';

function Frame({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3.5 px-3 py-3 md:px-6 md:py-[18px]">{children}</div>;
}

/**
 * Before the first sync: what the docs status of the project is, and that docs come from the repo. The
 * switcher still leads to the other projects' docs.
 */
function EmptySpace({ project, search }: { project: Project; search: DocsSearch }) {
  const target = search.flow ? `flow ${search.flow}` : search.path;
  return (
    <Frame>
      <Breadcrumbs
        items={[{ label: 'Tài liệu', link: DOCS_INDEX }, { label: project.name }, { label: 'Docs' }]}
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 grow text-[22px] font-semibold">Docs · {project.name}</h1>
        <DocsProjectSwitcher project={project} currentPath={search.path ?? null} className="w-full md:w-72" />
      </div>
      <div className="flex max-w-xl flex-col items-start gap-2 rounded-md border border-line bg-panel p-5 text-sm">
        <BookOpen size={22} aria-hidden className="text-accent" />
        <p className="m-0">
          Không gian docs của dự án chưa có dữ liệu đồng bộ. Trạng thái docs:{' '}
          {DOCS_STATUS_LABEL[project.docsStatus]}.
        </p>
        {target && <p className="m-0 text-muted">Trang được yêu cầu: {target}</p>}
        <p className="m-0 text-muted">Docs chỉ đọc. Sửa bằng commit trong repo.</p>
        <Link to="/docs" className="inline-flex min-h-11 items-center xl:min-h-0">
          Xem docs của các dự án khác
        </Link>
        <Link
          to="/projects/$projectKey/board"
          params={{ projectKey: project.key }}
          className="inline-flex min-h-11 items-center xl:min-h-0"
        >
          Về board
        </Link>
      </div>
    </Frame>
  );
}

/** A flow or path the snapshot does not have (an old link, or a page removed in the latest commit). */
function MissingPage({
  project,
  target,
}: {
  project: Project;
  target: Extract<DocsTarget, { kind: 'missing' }>;
}) {
  return (
    <div className="flex max-w-[780px] flex-col gap-3">
      <Breadcrumbs
        items={[
          { label: 'Tài liệu', link: DOCS_INDEX },
          { label: project.name, link: docsHome(project.key) },
          { label: 'Không tìm thấy' },
        ]}
      />
      <h1 className="m-0 text-[22px] font-semibold">Không tìm thấy trang</h1>
      <div className="flex flex-col items-start gap-2 rounded-md border border-line bg-panel p-5 text-sm">
        <FileQuestion size={22} aria-hidden className="text-muted" />
        <p className="m-0">
          {target.what === 'flow' ? 'Flow ' : 'Trang '}
          <code className="font-mono break-all">{target.value}</code>{' '}
          {target.what === 'flow'
            ? 'không có trong docs/flows.yaml của lần đồng bộ mới nhất.'
            : 'không có trong lần đồng bộ mới nhất.'}
        </p>
        {target.value !== DOCS_HOME_PATH && <Link {...docsHome(project.key)}>Về Tổng quan</Link>}
      </div>
    </div>
  );
}

function PageBody({
  project,
  space,
  target,
  compact,
}: {
  project: Project;
  space: DocsSpaceResponse;
  target: DocsTarget;
  compact: boolean;
}) {
  const path = target.kind === 'page' ? target.page.path : null;
  const page = useDocsPage(project.id, path);
  if (target.kind === 'missing') return <MissingPage project={project} target={target} />;
  if (page.isLoading) return <p className="m-0 text-sm text-muted">Đang tải trang…</p>;
  if (page.isError || !page.data) {
    if (page.error instanceof ApiRequestError && page.error.status === 404) {
      return (
        <MissingPage project={project} target={{ kind: 'missing', what: 'path', value: target.page.path }} />
      );
    }
    return <p className="m-0 text-sm text-bad">{errorMessage(page.error)}</p>;
  }
  const { page: current, snapshot } = page.data;
  const flowId = current.kind === 'flow' ? current.flowId : null;
  return (
    <DocsPageView
      projectKey={project.key}
      spaceName={project.name}
      page={current}
      snapshot={snapshot}
      pages={space.pages}
      repoUrl={project.repoUrl}
      compact={compact}
      before={
        current.kind === 'files' && space.manifest ? (
          <FileLookup projectKey={project.key} manifest={space.manifest} />
        ) : undefined
      }
      after={
        flowId && space.manifest ? (
          <FlowFiles
            manifest={space.manifest}
            flowId={flowId}
            repoUrl={project.repoUrl}
            commit={snapshot.commit}
          />
        ) : undefined
      }
      aside={flowId ? <RelatedTickets projectId={project.id} flowId={flowId} /> : undefined}
    />
  );
}

/**
 * The project's read-only, Confluence-like docs space: page tree on the left (a drawer on phone and tablet),
 * the page with its table of contents, and flow extras. `?flow=` opens a flow's page, `?path=` any page,
 * neither the space home (`docs/index.md`).
 */
export function ProjectDocsPage({ projectKey, search }: { projectKey: string; search: DocsSearch }) {
  const viewport = useViewport();
  const compact = viewport !== 'desktop';
  const { project, isLoading } = useProjectByKey(projectKey);
  const space = useDocsSpace(project?.id);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const target = space.data?.snapshot && resolveDocsTarget(space.data.pages, space.data.manifest, search);
  const currentPath = target && target.kind === 'page' ? target.page.path : null;

  // Every page opens at its top, and a page change closes the drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the page changes only
  useEffect(() => {
    scroller.current?.scrollTo?.({ top: 0 });
    setDrawerOpen(false);
  }, [currentPath, search.flow, search.path]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  if (isLoading || (project && space.isLoading)) {
    return <p className="m-0 p-6 text-sm text-muted">Đang tải…</p>;
  }
  if (!project) {
    return (
      <Frame>
        <h1 className="m-0 text-[22px] font-semibold">Không tìm thấy dự án {projectKey}</h1>
        <Link to="/docs">Xem docs của mọi dự án</Link>
      </Frame>
    );
  }
  if (space.isError || !space.data) {
    return (
      <Frame>
        <p className="m-0 text-sm text-bad">{errorMessage(space.error)}</p>
      </Frame>
    );
  }
  if (!space.data.snapshot || !target) return <EmptySpace project={project} search={search} />;

  const tree = (onNavigate?: () => void, className?: string) => (
    <DocsPageTree
      projectKey={project.key}
      projectId={project.id}
      spaceName={project.name}
      pages={space.data.pages}
      currentPath={currentPath}
      onNavigate={onNavigate}
      className={className}
      switcher={<DocsProjectSwitcher project={project} currentPath={currentPath} className="grow" />}
    />
  );

  return (
    <div className="flex min-h-0 grow">
      {!compact && tree()}
      {compact && drawerOpen && (
        <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Trang docs">
          <div className="h-full shadow-xl">{tree(() => setDrawerOpen(false), 'w-[min(300px,85vw)]')}</div>
          <button
            type="button"
            aria-label="Đóng trang docs"
            className="grow bg-[rgba(9,14,25,0.45)]"
            onClick={() => setDrawerOpen(false)}
          />
        </div>
      )}
      <div ref={scroller} data-docs-scroll className="min-w-0 grow overflow-y-auto">
        {compact && (
          <div className="flex items-center gap-2 border-b border-line2 bg-panel px-2 md:px-4">
            <Button variant="ghost" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen}>
              <Menu size={20} aria-hidden /> Trang docs
            </Button>
            <DocsProjectSwitcher
              project={project}
              currentPath={currentPath}
              className="ml-auto max-w-[60%]"
            />
          </div>
        )}
        <div className="px-3 py-3 md:px-6 md:py-5 xl:px-8 xl:py-[22px]">
          <PageBody project={project} space={space.data} target={target} compact={compact} />
        </div>
      </div>
    </div>
  );
}
