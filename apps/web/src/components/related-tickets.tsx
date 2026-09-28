import { Link } from '@tanstack/react-router';
import { errorMessage } from '../lib/format';
import { useFlowTickets } from '../lib/queries';
import { StatusLozenge } from './status-lozenge';

/** "Ticket liên quan": the most recently updated tickets whose flows include this flow. */
export function RelatedTickets({ projectId, flowId }: { projectId: string; flowId: string }) {
  const tickets = useFlowTickets(projectId, flowId);
  return (
    <section
      aria-label="Ticket liên quan"
      className="flex flex-col gap-2 rounded-md border border-line bg-panel px-3.5 py-3"
    >
      <h2 className="m-0 text-[13px] font-bold">Ticket liên quan</h2>
      {tickets.isLoading && <p className="m-0 text-[13px] text-muted">Đang tải…</p>}
      {tickets.isError && <p className="m-0 text-[13px] text-bad">{errorMessage(tickets.error)}</p>}
      {tickets.data?.length === 0 && (
        <p className="m-0 text-[13px] text-muted">Chưa có ticket nào chạm flow này.</p>
      )}
      {tickets.data && tickets.data.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {tickets.data.map((ticket) => (
            <li key={ticket.id}>
              <Link
                to="/tickets/$ticketKey"
                params={{ ticketKey: ticket.key }}
                className="flex min-h-11 items-center gap-2 rounded text-[13px] text-ink no-underline hover:bg-soft xl:min-h-8"
              >
                <span className="shrink-0 font-mono text-muted">{ticket.key}</span>
                <span className="min-w-0 grow truncate">{ticket.title}</span>
                <StatusLozenge status={ticket.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
