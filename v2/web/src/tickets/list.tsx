/**
 * Ticket list view plus the filter bar and pagination shared with the board. Both views read the same
 * `useTicketList(client, filters)` query, so they show the same rows and revisions. Filters are exactly the
 * producer's (`projectId`, `status`, `kind`, `rootId`); the caller keeps them in the URL so switching views
 * preserves them. Pages load one at a time on “Tải thêm” until `nextCursor` is null.
 */
import type { CSSProperties } from 'react';
import { useRuntime } from '../app-runtime.ts';
import type { Ticket } from '../contracts/tickets.ts';
import { StatusBadge } from './detail.tsx';
import { failureText } from './history.tsx';
import { parseTicketFilters, type TicketFilters, useTicketList } from './queries.ts';
import { kindLabels, levelLabels, statusLabels, statusOrder } from './status.ts';

export type TicketViewProps = {
  filters: TicketFilters;
  onFiltersChange: (next: TicketFilters) => void;
  onOpenTicket: (ticketId: string, trigger: HTMLElement) => void;
};

const barStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'end' };
const buttonStyle: CSSProperties = {
  font: 'inherit',
  padding: '0.35rem 0.7rem',
  borderRadius: '0.5rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};
const openStyle: CSSProperties = {
  ...buttonStyle,
  border: 'none',
  padding: 0,
  textAlign: 'left',
  textDecoration: 'underline',
};

export function TicketFilterBar({
  filters,
  onFiltersChange,
}: Pick<TicketViewProps, 'filters' | 'onFiltersChange'>) {
  const update = (patch: Partial<Record<keyof TicketFilters, string>>) =>
    onFiltersChange(parseTicketFilters({ ...filters, ...patch }));
  return (
    <form style={barStyle} aria-label="Lọc ticket" onSubmit={(event) => event.preventDefault()}>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        Trạng thái
        <select value={filters.status ?? ''} onChange={(event) => update({ status: event.target.value })}>
          <option value="">Tất cả</option>
          {statusOrder.map((status) => (
            <option key={status} value={status}>
              {statusLabels[status]}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        Loại
        <select value={filters.kind ?? ''} onChange={(event) => update({ kind: event.target.value })}>
          <option value="">Tất cả</option>
          {(Object.keys(kindLabels) as Ticket['kind'][]).map((kind) => (
            <option key={kind} value={kind}>
              {kindLabels[kind]}
            </option>
          ))}
        </select>
      </label>
      {filters.rootId && (
        <button type="button" style={buttonStyle} onClick={() => update({ rootId: '' })}>
          Bỏ lọc theo yêu cầu gốc
        </button>
      )}
    </form>
  );
}

export function TicketPagination({ list }: { list: ReturnType<typeof useTicketList> }) {
  const { query, tickets } = list;
  if (query.isPending) return <p role="status">Đang tải ticket…</p>;
  return (
    <div style={barStyle} role="status">
      <span>Đã tải {tickets.length} ticket.</span>
      {query.hasNextPage ? (
        <>
          <span>Còn ticket chưa tải, danh sách chưa đầy đủ.</span>
          <button
            type="button"
            style={buttonStyle}
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </button>
        </>
      ) : (
        query.isSuccess && <span>Đã tải hết danh sách theo bộ lọc.</span>
      )}
      {query.error && (
        <span role="alert">
          Không tải được: {failureText(query.error)}{' '}
          <button type="button" style={buttonStyle} onClick={() => void query.refetch()}>
            Thử lại
          </button>
        </span>
      )}
    </div>
  );
}

export function TicketList({ filters, onFiltersChange, onOpenTicket }: TicketViewProps) {
  const list = useTicketList(useRuntime().client, filters);
  return (
    <section
      aria-label="Danh sách ticket"
      data-focus-fallback=""
      tabIndex={-1}
      style={{ display: 'grid', gap: '1rem', minWidth: 0 }}
    >
      <TicketFilterBar filters={filters} onFiltersChange={onFiltersChange} />
      {list.tickets.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'left' }}>
                  Tiêu đề
                </th>
                <th scope="col" style={{ textAlign: 'left' }}>
                  Trạng thái
                </th>
                <th scope="col" style={{ textAlign: 'left' }}>
                  Cấp
                </th>
                <th scope="col" style={{ textAlign: 'left' }}>
                  Loại
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Phiên bản
                </th>
              </tr>
            </thead>
            <tbody>
              {list.tickets.map((ticket) => (
                <tr key={ticket.id} data-ticket-id={ticket.id} data-revision={ticket.revision}>
                  <td>
                    <button
                      type="button"
                      style={openStyle}
                      onClick={(event) => onOpenTicket(ticket.id, event.currentTarget)}
                    >
                      {ticket.title}
                    </button>
                  </td>
                  <td>
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td>{levelLabels[ticket.level]}</td>
                  <td>{kindLabels[ticket.kind]}</td>
                  <td style={{ textAlign: 'right' }}>{ticket.revision}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.query.isSuccess && list.tickets.length === 0 && <p>Không có ticket nào khớp bộ lọc.</p>}
      <TicketPagination list={list} />
    </section>
  );
}
