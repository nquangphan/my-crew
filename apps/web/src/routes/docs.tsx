import { Link } from '@tanstack/react-router';
import { BookOpen } from 'lucide-react';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { DOCS_STATUS_LABEL } from '../lib/format';
import { useProjectByKey } from '../lib/queries';
import type { DocsSearch } from '../lib/search-params';

/**
 * Route slot for the project's Confluence-like docs space. The docs phase replaces this component
 * (route `/projects/$projectKey/docs`, search `{ flow?, path? }`, see `lib/docs-links.ts`).
 */
export function DocsPage({ projectKey, search }: { projectKey: string; search: DocsSearch }) {
  const { project } = useProjectByKey(projectKey);
  const target = search.flow ? `flow ${search.flow}` : search.path;
  return (
    <div className="flex flex-col gap-3.5 px-3 py-3 md:px-6 md:py-[18px]">
      <Breadcrumbs
        items={[
          { label: 'Dự án', link: { to: '/projects' } },
          { label: project?.name ?? projectKey },
          { label: 'Docs' },
        ]}
      />
      <h1 className="m-0 text-[22px] font-semibold">Docs · {project?.name ?? projectKey}</h1>
      <div className="flex max-w-xl flex-col items-start gap-2 rounded-md border border-line bg-panel p-5 text-sm">
        <BookOpen size={22} aria-hidden className="text-accent" />
        <p className="m-0">
          Không gian docs của dự án chưa có dữ liệu đồng bộ.
          {project && <> Trạng thái docs: {DOCS_STATUS_LABEL[project.docsStatus]}.</>}
        </p>
        {target && <p className="m-0 text-muted">Trang được yêu cầu: {target}</p>}
        <p className="m-0 text-muted">Docs chỉ đọc. Sửa bằng commit trong repo.</p>
        <Link to="/projects/$projectKey/board" params={{ projectKey }}>
          Về board
        </Link>
      </div>
    </div>
  );
}
