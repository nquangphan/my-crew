import type { TicketStatus } from '@crew/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { BOARD_COLUMNS, BoardView } from '../components/board-view';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { useProjects, useTickets } from '../lib/queries';
import { type AllBoardSearch, parseProjectKeys } from '../lib/search-params';

/** Every status the board shows (blocked sits in "Đang làm"); cancelled tickets stay in the list only. */
const BOARD_STATUSES: TicketStatus[] = [...BOARD_COLUMNS, 'blocked'];

/**
 * "Tất cả dự án": the tickets of every project plus the owner's requests on one board, in request →
 * pm_task swimlanes by default, so a request routed to several projects shows all its work together.
 */
export function AllProjectsBoardPage({ search }: { search: AllBoardSearch }) {
  const navigate = useNavigate();
  const projects = useProjects();
  const projectKeys = parseProjectKeys(search.project);
  const projectIds = (projects.data ?? []).filter((p) => projectKeys.includes(p.key)).map((p) => p.id);
  const tickets = useTickets(
    { projectIds: projectIds.length > 0 ? projectIds : undefined, status: BOARD_STATUSES },
    Boolean(projects.data),
  );
  const onSearch = (patch: Partial<AllBoardSearch>) =>
    void navigate({
      to: '/board',
      search: (prev) => ({ ...prev, ...patch }),
      replace: !('selected' in patch),
    });

  return (
    <BoardView
      tickets={tickets.data}
      isLoading={projects.isLoading || tickets.isLoading}
      error={projects.error ?? tickets.error}
      search={search}
      onSearch={onSearch}
      projects={projects.data ?? []}
      header={
        <>
          <Breadcrumbs items={[{ label: 'Tất cả dự án' }, { label: 'Board' }]} />
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 grow text-[22px] font-semibold">Board · Tất cả dự án</h1>
            <Link
              to="/list"
              search={{ project: search.project }}
              className="inline-flex min-h-11 items-center rounded border border-line bg-panel px-3 text-sm text-ink no-underline hover:bg-soft xl:min-h-8"
            >
              Xem danh sách
            </Link>
          </div>
        </>
      }
    />
  );
}
