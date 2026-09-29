import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { BoardView } from '../components/board-view';
import { selectedProjects } from '../components/project-filter';
import { Button } from '../components/ui/button';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { useShell } from '../layout/shell-context';
import { useProjects, useTickets } from '../lib/queries';
import type { AllBoardSearch } from '../lib/search-params';

/**
 * "Tất cả request của tôi": every request ticket the owner gave the assistant, on a board. The "Dự án"
 * filter keeps the requests routed or hinted to the chosen projects (a request belongs to no project).
 */
export function MyRequestsPage({ search }: { search: AllBoardSearch }) {
  const navigate = useNavigate();
  const shell = useShell();
  const projects = useProjects();
  const projectIds = selectedProjects(projects.data, search.project).map((p) => p.id);
  const tickets = useTickets(
    { type: ['request'], projectIds: projectIds.length > 0 ? projectIds : undefined },
    Boolean(projects.data) || !search.project,
  );
  const onSearch = (patch: Partial<AllBoardSearch>) =>
    void navigate({
      to: '/requests',
      search: (prev) => ({ ...prev, ...patch }),
      replace: !('selected' in patch),
    });
  return (
    <BoardView
      tickets={tickets.data}
      isLoading={tickets.isLoading}
      error={tickets.error}
      search={{ ...search, group: search.group ?? 'none' }}
      onSearch={onSearch}
      showTypeFilter={false}
      projectFilter={projects.data ?? []}
      header={
        <>
          <Breadcrumbs items={[{ label: 'Request của tôi' }]} />
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 grow text-[22px] font-semibold">Tất cả request của tôi</h1>
            <Button variant="primary" onClick={shell.openCreate}>
              <Plus size={16} aria-hidden /> Tạo request
            </Button>
          </div>
        </>
      }
    />
  );
}
