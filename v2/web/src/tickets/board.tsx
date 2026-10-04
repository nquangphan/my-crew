/**
 * Status board: one column per producer status with text label and icon. Cards open the shared ticket
 * dialog; there is no drag-and-drop because status changes only through producer signals.
 */
import type { CSSProperties } from 'react';
import { useRuntime } from '../app-runtime.ts';
import { CreateRequestAction } from './create-request.tsx';
import { TicketFilterBar, TicketPagination, type TicketViewProps } from './list.tsx';
import { useTicketList } from './queries.ts';
import { groupByStatus, kindLabels, levelLabels, statusIcons, statusLabels, statusOrder } from './status.ts';

const boardStyle: CSSProperties = {
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(15rem, 1fr)',
  gap: '0.75rem',
  overflowX: 'auto',
  alignItems: 'start',
  paddingBottom: '0.5rem',
};
const columnStyle: CSSProperties = {
  display: 'grid',
  gap: '0.5rem',
  padding: '0.75rem',
  borderRadius: '0.75rem',
  border: '1px solid rgb(148 163 184 / 0.6)',
};
const cardStyle: CSSProperties = {
  display: 'grid',
  gap: '0.3rem',
  width: '100%',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
  background: 'Canvas',
  padding: '0.6rem 0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid rgb(148 163 184 / 0.8)',
  cursor: 'pointer',
};

export function TicketBoard({ filters, onFiltersChange, onOpenTicket }: TicketViewProps) {
  const list = useTicketList(useRuntime().client, filters);
  const groups = groupByStatus(list.tickets);
  return (
    <section
      aria-label="Bảng ticket"
      data-focus-fallback=""
      tabIndex={-1}
      style={{ display: 'grid', gap: '1rem', minWidth: 0 }}
    >
      <div>
        <CreateRequestAction projectId={filters.projectId} onOpenTicket={onOpenTicket} />
      </div>
      <TicketFilterBar filters={filters} onFiltersChange={onFiltersChange} />
      <div style={boardStyle}>
        {statusOrder.map((status) => (
          <section key={status} aria-labelledby={`board-${status}`} style={columnStyle} data-status={status}>
            <h2 id={`board-${status}`} style={{ margin: 0, fontSize: '1rem' }}>
              <span aria-hidden="true">{statusIcons[status]}</span> {statusLabels[status]}{' '}
              <span>({groups[status].length})</span>
            </h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
              {groups[status].map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    style={cardStyle}
                    data-ticket-id={ticket.id}
                    data-revision={ticket.revision}
                    onClick={(event) => onOpenTicket(ticket.id, event.currentTarget)}
                  >
                    <strong style={{ overflowWrap: 'anywhere' }}>{ticket.title}</strong>
                    <span>
                      {levelLabels[ticket.level]} · {kindLabels[ticket.kind]} · Phiên bản {ticket.revision}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <TicketPagination list={list} />
    </section>
  );
}
