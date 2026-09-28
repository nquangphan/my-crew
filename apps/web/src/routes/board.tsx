import { useNavigate } from '@tanstack/react-router';
import { BoardView } from '../components/board-view';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { useProjectByKey, useTickets } from '../lib/queries';
import type { BoardSearch } from '../lib/search-params';

/** Project board: every ticket of the project (pm_tasks and their children) by status. */
export function BoardPage({ projectKey, search }: { projectKey: string; search: BoardSearch }) {
  const navigate = useNavigate();
  const { project, isLoading: projectLoading } = useProjectByKey(projectKey);
  const tickets = useTickets({ projectId: project?.id }, Boolean(project));
  const onSearch = (patch: Partial<BoardSearch>) =>
    void navigate({
      to: '/projects/$projectKey/board',
      params: { projectKey },
      search: (prev) => ({ ...prev, ...patch }),
      replace: !('selected' in patch),
    });

  if (!projectLoading && !project) {
    return <p className="m-0 p-6 text-sm text-bad">Không tìm thấy dự án {projectKey}.</p>;
  }

  return (
    <BoardView
      tickets={tickets.data}
      isLoading={projectLoading || tickets.isLoading}
      error={tickets.error}
      search={search}
      onSearch={onSearch}
      header={
        <>
          <Breadcrumbs
            items={[
              { label: 'Dự án', link: { to: '/projects' } },
              { label: project?.name ?? projectKey },
              { label: 'Board' },
            ]}
          />
          <h1 className="m-0 text-[22px] font-semibold">Board {projectKey}</h1>
        </>
      }
    />
  );
}
