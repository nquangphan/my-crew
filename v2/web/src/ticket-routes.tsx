/**
 * Route views for tickets: the project board/list with one shared dialog, and the ticket page used for deep
 * links and reloads. Both render the existing ticket components; this module only owns URL state (view and
 * producer filters in the search string), the dialog's open state and the not-found views.
 */
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { type CSSProperties, useState } from 'react';
import { parseTicketsSearch, routeUuid, type TicketView, useRuntime } from './app-runtime.ts';
import { TicketBoard } from './tickets/board.tsx';
import { TicketDetail } from './tickets/detail.tsx';
import { TicketDialog } from './tickets/dialog.tsx';
import { TicketList } from './tickets/list.tsx';
import { parseTicketFilters, type TicketFilters, useTicket } from './tickets/queries.ts';
import { RequestList } from './tickets/requests.tsx';

const toolbarStyle: CSSProperties = { display: 'flex', gap: '0.75rem', alignItems: 'center' };

const viewLabels: Record<TicketView, string> = {
  board: 'Dạng bảng',
  list: 'Dạng danh sách',
  requests: 'Yêu cầu',
};

/** One shared ticket dialog per page: open state plus the trigger that gets focus back on close. */
export function useTicketDialog() {
  const [open, setOpen] = useState<{ id: string | null; trigger: HTMLElement | null }>({
    id: null,
    trigger: null,
  });
  return {
    openTicket: (id: string, trigger: HTMLElement) => setOpen({ id, trigger }),
    dialog: (
      <TicketDialog
        ticketId={open.id}
        returnFocus={open.trigger}
        onClose={() => setOpen((current) => ({ id: null, trigger: current.trigger }))}
      />
    ),
  };
}

export function NotFoundView({ what }: { what: string }) {
  return (
    <section className="page-stack" aria-labelledby="not-found-heading">
      <div className="page-intro">
        <h1 id="not-found-heading">Không tìm thấy {what}</h1>
        <p>Đường dẫn không đúng hoặc bạn không có quyền xem.</p>
      </div>
      <Link className="nav-link" to="/">
        Về tổng quan
      </Link>
    </section>
  );
}

export function ProjectTicketsPage() {
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = routeUuid(params.projectId);
  const search = parseTicketsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const navigate = useNavigate();
  const { openTicket, dialog } = useTicketDialog();
  // Without a valid project id the list query would drop its project filter and show every project.
  if (!projectId) return <NotFoundView what="dự án" />;

  const { view, ...filters } = search;
  const go = (next: { view: TicketView } & Omit<TicketFilters, 'projectId'>) =>
    navigate({
      to: '/projects/$projectId/tickets',
      params: { projectId },
      search: next,
    });
  const viewProps = {
    filters: { ...filters, projectId },
    onFiltersChange: (next: TicketFilters) => {
      const { projectId: _path, ...rest } = parseTicketFilters(next);
      void go({ view, ...rest });
    },
    onOpenTicket: openTicket,
  };
  return (
    <section className="page-stack" aria-labelledby="tickets-heading">
      <div className="page-intro">
        <h1 id="tickets-heading">Ticket của dự án</h1>
      </div>
      <nav style={toolbarStyle} aria-label="Cách xem ticket">
        {(Object.keys(viewLabels) as TicketView[]).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={view === candidate}
            onClick={() => void go({ view: candidate, ...filters })}
          >
            {viewLabels[candidate]}
          </button>
        ))}
      </nav>
      {view === 'board' ? (
        <TicketBoard {...viewProps} />
      ) : view === 'list' ? (
        <TicketList {...viewProps} />
      ) : (
        <RequestList {...viewProps} />
      )}
      {dialog}
    </section>
  );
}

function TicketPageView({ ticketId }: { ticketId: string }) {
  const ticket = useTicket(useRuntime().client, ticketId);
  // Same query key as TicketDetail, so this adds no request; the link appears once the ticket is known.
  const projectId = ticket.data?.projectId;
  return (
    <section className="page-stack">
      {projectId && (
        <Link
          className="nav-link"
          to="/projects/$projectId/tickets"
          params={{ projectId }}
          search={{ view: 'board' }}
        >
          Quay lại danh sách ticket
        </Link>
      )}
      <TicketDetail ticketId={ticketId} presentation="page" />
    </section>
  );
}

export function TicketPage() {
  const params = useParams({ strict: false }) as { ticketId?: string };
  const ticketId = routeUuid(params.ticketId);
  if (!ticketId) return <NotFoundView what="ticket" />;
  return <TicketPageView ticketId={ticketId} />;
}
