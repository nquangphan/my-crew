import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { BoardView } from '../components/board-view';
import { Button } from '../components/ui/button';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { useShell } from '../layout/shell-context';
import { useTickets } from '../lib/queries';
import type { BoardSearch } from '../lib/search-params';

/** "Tất cả request của tôi": every request ticket the owner gave the assistant, on a board. */
export function MyRequestsPage({ search }: { search: BoardSearch }) {
  const navigate = useNavigate();
  const shell = useShell();
  const tickets = useTickets({ type: ['request'] });
  const onSearch = (patch: Partial<BoardSearch>) =>
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
