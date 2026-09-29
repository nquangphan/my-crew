import type { Ticket, TicketPriority, TicketStatus } from '@crew/shared';
import { type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { cn } from '../lib/cn';
import {
  formatFullDateTime,
  formatRelative,
  formatUsd,
  PRIORITIES,
  PRIORITY_META,
  PRIORITY_RANK,
  STATUS_ORDER,
  TYPE_META,
} from '../lib/format';
import type { ListSort } from '../lib/search-params';
import { useStoredState, type Viewport } from '../lib/ui-state';
import { ProjectBadge } from './project-badge';
import { RoleAvatar } from './role-avatar';
import { StatusDropdown } from './status-dropdown';
import { PriorityArrow } from './status-lozenge';
import { TypeIcon } from './type-icon';

interface Column {
  id: ListSort;
  label: string;
  width: number;
  /** Hidden below the desktop breakpoint (shown in the ticket instead). */
  desktopOnly?: boolean;
  /** Only on the all-projects list. */
  crossProject?: boolean;
}

const COLUMNS: readonly Column[] = [
  { id: 'key', label: 'Key', width: 96 },
  { id: 'project', label: 'Dự án', width: 88, crossProject: true },
  { id: 'type', label: 'Loại', width: 64 },
  { id: 'title', label: 'Tiêu đề', width: 360 },
  { id: 'status', label: 'Trạng thái', width: 150 },
  { id: 'role', label: 'Vai trò', width: 76 },
  { id: 'priority', label: 'Ưu tiên', width: 132 },
  { id: 'model', label: 'Model', width: 96, desktopOnly: true },
  { id: 'cost', label: 'Chi phí', width: 88, desktopOnly: true },
  { id: 'updatedAt', label: 'Cập nhật', width: 116, desktopOnly: true },
];

const keyNumber = (key: string) => Number(key.split('-')[1] ?? 0);

type Compare = (a: Ticket, b: Ticket) => number;

const COMPARE: Record<Exclude<ListSort, 'project'>, Compare> = {
  key: (a, b) =>
    a.key.split('-')[0]?.localeCompare(b.key.split('-')[0] ?? '') || keyNumber(a.key) - keyNumber(b.key),
  type: (a, b) => TYPE_META[a.type].label.localeCompare(TYPE_META[b.type].label),
  title: (a, b) => a.title.localeCompare(b.title, 'vi'),
  status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  role: (a, b) => a.assigneeRole.localeCompare(b.assigneeRole),
  priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  model: (a, b) => (a.model ?? '').localeCompare(b.model ?? ''),
  cost: (a, b) => a.costUsd - b.costUsd,
  updatedAt: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
};

/** Sorts in the client; `projectKeyOf` names each ticket's project for the project column. */
export function sortTickets(
  tickets: readonly Ticket[],
  sort: ListSort,
  order: 'asc' | 'desc',
  projectKeyOf: (ticket: Ticket) => string | undefined = () => undefined,
): Ticket[] {
  const compare: Compare =
    sort === 'project'
      ? (a, b) => (projectKeyOf(a) ?? '').localeCompare(projectKeyOf(b) ?? '')
      : COMPARE[sort];
  const sign = order === 'asc' ? 1 : -1;
  return [...tickets].sort((a, b) => sign * compare(a, b) || a.id.localeCompare(b.id));
}

export interface IssueTableProps {
  tickets: readonly Ticket[];
  sort: ListSort;
  order: 'asc' | 'desc';
  onSort: (sort: ListSort) => void;
  selected: ReadonlySet<string>;
  onSelect: (ids: string[], on: boolean) => void;
  focusedId?: string;
  running: ReadonlySet<string>;
  onOpen: (ticket: Ticket) => void;
  onStatus: (ticket: Ticket, to: TicketStatus) => void;
  onPriority: (ticket: Ticket, priority: TicketPriority) => void;
  viewport: Viewport;
  /** The all-projects list: a project column (a badge on phones). */
  projectKeyOf?: (ticket: Ticket) => string | undefined;
}

function PrioritySelect({
  ticket,
  onPriority,
}: {
  ticket: Ticket;
  onPriority: IssueTableProps['onPriority'];
}) {
  return (
    <span className="flex items-center gap-1">
      <PriorityArrow priority={ticket.priority} />
      <select
        aria-label={`Ưu tiên của ${ticket.key}`}
        value={ticket.priority}
        onChange={(e) => onPriority(ticket, e.target.value as TicketPriority)}
        className="min-h-11 min-w-0 rounded border border-transparent bg-transparent px-1 text-[13px] hover:border-line xl:min-h-7"
      >
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_META[p].label}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * The list/backlog table: sortable, resizable columns, row selection for bulk actions, and inline status
 * (legal moves only) and priority edits. Tablet hides model, cost and updated; phones get stacked cards.
 */
export function IssueTable(props: IssueTableProps) {
  const {
    tickets,
    sort,
    order,
    onSort,
    selected,
    onSelect,
    focusedId,
    running,
    onOpen,
    onStatus,
    onPriority,
    viewport,
    projectKeyOf,
  } = props;
  const [widths, setWidths] = useStoredState<Partial<Record<ListSort, number>>>('crew.list.widths', {});
  const drag = useRef<{ id: ListSort; startX: number; startWidth: number } | null>(null);
  const allSelected = tickets.length > 0 && tickets.every((t) => selected.has(t.id));
  const projectBadge = (ticket: Ticket) => {
    const key = projectKeyOf?.(ticket);
    return key ? <ProjectBadge projectKey={key} /> : null;
  };

  if (viewport === 'phone') {
    return (
      <ul aria-label="Danh sách ticket" className="m-0 flex list-none flex-col gap-2.5 p-0">
        {tickets.map((ticket) => (
          <li
            key={ticket.id}
            className={cn(
              'flex flex-col gap-2 rounded-lg border border-line bg-panel p-3',
              focusedId === ticket.id && 'ring-2 ring-accent/50',
            )}
          >
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                aria-label={`Chọn ${ticket.key}`}
                checked={selected.has(ticket.id)}
                onChange={(e) => onSelect([ticket.id], e.target.checked)}
                className="mt-1 size-5 shrink-0"
              />
              <button
                type="button"
                onClick={() => onOpen(ticket)}
                className="min-h-11 min-w-0 grow text-left text-[15px] leading-snug"
              >
                {ticket.title}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TypeIcon type={ticket.type} />
              <span className="font-mono text-xs text-muted">{ticket.key}</span>
              {projectBadge(ticket)}
              <StatusDropdown status={ticket.status} onSelect={(to) => onStatus(ticket, to)} />
              <PrioritySelect ticket={ticket} onPriority={onPriority} />
              <span className="grow" />
              <RoleAvatar agent={ticket.assigneeRole} size={28} running={running.has(ticket.id)} />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const columns = COLUMNS.filter(
    (c) => (viewport === 'desktop' || !c.desktopOnly) && (projectKeyOf !== undefined || !c.crossProject),
  );
  const widthOf = (c: Column) => widths[c.id] ?? c.width;

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>, column: Column) => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = { id: column.id, startX: event.clientX, startWidth: widthOf(column) };
    const onMove = (e: PointerEvent) => {
      const current = drag.current;
      if (!current) return;
      setWidths({
        ...widths,
        [current.id]: Math.max(56, Math.round(current.startWidth + e.clientX - current.startX)),
      });
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="max-w-full overflow-x-auto rounded border border-line">
      <table className="w-full table-fixed border-collapse bg-panel text-sm">
        <colgroup>
          <col style={{ width: 44 }} />
          {columns.map((c) => (
            <col
              key={c.id}
              style={{ width: c.id === 'title' && widths.title === undefined ? undefined : widthOf(c) }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="border-b border-line bg-soft px-2.5 py-2">
              <input
                type="checkbox"
                aria-label="Chọn tất cả"
                checked={allSelected}
                onChange={(e) =>
                  onSelect(
                    tickets.map((t) => t.id),
                    e.target.checked,
                  )
                }
                className="size-4"
              />
            </th>
            {columns.map((c) => (
              <th
                key={c.id}
                aria-sort={sort === c.id ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
                className="relative border-b border-line bg-soft p-0 text-left text-xs font-semibold whitespace-nowrap text-muted"
              >
                <button
                  type="button"
                  onClick={() => onSort(c.id)}
                  className="flex min-h-11 w-full items-center gap-1 px-2.5 text-left xl:min-h-9"
                >
                  {c.label}
                  <span aria-hidden>{sort === c.id ? (order === 'asc' ? '↑' : '↓') : '↕'}</span>
                </button>
                <span
                  aria-hidden
                  onPointerDown={(e) => startResize(e, c)}
                  className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-accent"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr
              key={ticket.id}
              data-ticket-key={ticket.key}
              className={cn('hover:bg-soft', focusedId === ticket.id && 'bg-accent-bg')}
            >
              <td className="border-b border-line2 px-2.5 py-1.5">
                <input
                  type="checkbox"
                  aria-label={`Chọn ${ticket.key}`}
                  checked={selected.has(ticket.id)}
                  onChange={(e) => onSelect([ticket.id], e.target.checked)}
                  className="size-4"
                />
              </td>
              {columns.map((c) => (
                <td key={c.id} className="truncate border-b border-line2 px-2.5 py-1.5 align-middle">
                  {c.id === 'key' && (
                    <button
                      type="button"
                      onClick={() => onOpen(ticket)}
                      className="min-h-9 font-mono text-accent hover:underline"
                    >
                      {ticket.key}
                    </button>
                  )}
                  {c.id === 'project' && (projectBadge(ticket) ?? <span className="text-muted">—</span>)}
                  {c.id === 'type' && <TypeIcon type={ticket.type} />}
                  {c.id === 'title' && (
                    <button
                      type="button"
                      onClick={() => onOpen(ticket)}
                      className="w-full truncate text-left"
                      title={ticket.title}
                    >
                      {ticket.title}
                    </button>
                  )}
                  {c.id === 'status' && (
                    <StatusDropdown status={ticket.status} onSelect={(to) => onStatus(ticket, to)} />
                  )}
                  {c.id === 'role' && (
                    <RoleAvatar agent={ticket.assigneeRole} size={24} running={running.has(ticket.id)} />
                  )}
                  {c.id === 'priority' && <PrioritySelect ticket={ticket} onPriority={onPriority} />}
                  {c.id === 'model' && (ticket.model ?? '—')}
                  {c.id === 'cost' && (ticket.costUsd > 0 ? formatUsd(ticket.costUsd) : '—')}
                  {c.id === 'updatedAt' && (
                    <time
                      dateTime={ticket.updatedAt}
                      title={formatFullDateTime(ticket.updatedAt)}
                      className="text-muted"
                    >
                      {formatRelative(ticket.updatedAt)}
                    </time>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
