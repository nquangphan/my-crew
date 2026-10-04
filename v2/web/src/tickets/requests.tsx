/**
 * Request view: request roots of a project through the producer's `level=request` filter, paged with the
 * same “Tải thêm” as board/list. `requestRoots` re-checks the hierarchy (`level==='request' && id===rootId &&
 * parentId===null`) so a malformed row is never shown as a root. Selecting a request opens the shared ticket
 * dialog; “Tạo yêu cầu” opens the shared create form.
 */
import type { CSSProperties } from 'react';
import { useRuntime } from '../app-runtime.ts';
import { CreateRequestAction } from './create-request.tsx';
import { StatusBadge } from './detail.tsx';
import { TicketFilterBar, TicketPagination, type TicketViewProps } from './list.tsx';
import { requestListFilters, useTicketList } from './queries.ts';
import { kindLabels, requestRoots } from './status.ts';

const itemStyle: CSSProperties = {
  display: 'grid',
  gap: '0.25rem',
  padding: '0.6rem 0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid rgb(148 163 184 / 0.8)',
};
const openStyle: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'transparent',
  border: 'none',
  padding: 0,
  textAlign: 'left',
  textDecoration: 'underline',
  cursor: 'pointer',
  overflowWrap: 'anywhere',
};

export function RequestList({ filters, onFiltersChange, onOpenTicket }: TicketViewProps) {
  const list = useTicketList(useRuntime().client, requestListFilters(filters));
  const roots = requestRoots(list.tickets);
  return (
    <section
      aria-label="Danh sách yêu cầu"
      data-focus-fallback=""
      tabIndex={-1}
      style={{ display: 'grid', gap: '1rem', minWidth: 0 }}
    >
      <div>
        <CreateRequestAction projectId={filters.projectId} onOpenTicket={onOpenTicket} />
      </div>
      <TicketFilterBar filters={filters} onFiltersChange={onFiltersChange} levelFixed />
      {roots.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
          {roots.map((root) => (
            <li key={root.id} style={itemStyle} data-ticket-id={root.id} data-revision={root.revision}>
              <button
                type="button"
                style={openStyle}
                onClick={(event) => onOpenTicket(root.id, event.currentTarget)}
              >
                {root.title}
              </button>
              <span>
                <StatusBadge status={root.status} /> · {kindLabels[root.kind]} · Phiên bản {root.revision}
              </span>
            </li>
          ))}
        </ul>
      )}
      {list.query.isSuccess && roots.length === 0 && <p>Chưa có yêu cầu nào khớp bộ lọc.</p>}
      <TicketPagination list={list} />
    </section>
  );
}
