import type { AgentRole, Ticket, TicketStatus, TicketType } from '@crew/shared';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import {
  AGENT_ROLES,
  errorMessage,
  PRIORITIES,
  PRIORITY_META,
  ROLE_META,
  STATUS_LABEL,
  TICKET_TYPES,
  TYPE_META,
} from '../lib/format';
import { useRunningTicketIds, useTransition } from '../lib/queries';
import { type BoardSearch, parsePriorities, parseRoles, parseTypes, toggleCsv } from '../lib/search-params';
import { stepIndex, useShortcuts } from '../lib/shortcuts';
import { useViewport } from '../lib/ui-state';
import { FilterMenu } from './filter-menu';
import { RoleAvatar } from './role-avatar';
import { TicketCard, TicketCardFace } from './ticket-card';
import { TicketSidePanel } from './ticket-side-panel';
import { TypeIcon } from './type-icon';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from './ui/dropdown-menu';
import { useToast } from './ui/toast';

/** Board columns. Blocked tickets sit in "Đang làm" with a red badge, as in Jira. */
export const BOARD_COLUMNS: readonly TicketStatus[] = [
  'todo',
  'triage',
  'needs_input',
  'in_progress',
  'in_review',
  'done',
];

export function columnOf(status: TicketStatus): TicketStatus | null {
  if (status === 'blocked') return 'in_progress';
  return BOARD_COLUMNS.includes(status) ? status : null;
}

/** Tickets that wait for the owner: the board's "chỉ ticket của tôi" filter. */
export const waitsForOwner = (t: Ticket) =>
  t.status === 'needs_input' || t.status === 'blocked' || t.budgetHold !== null;

export function filterBoardTickets(tickets: readonly Ticket[], search: BoardSearch): Ticket[] {
  const types = parseTypes(search.type);
  const roles = parseRoles(search.role);
  const priorities = parsePriorities(search.priority);
  return tickets.filter(
    (t) =>
      columnOf(t.status) !== null &&
      (types.length === 0 || types.includes(t.type)) &&
      (roles.length === 0 || roles.includes(t.assigneeRole)) &&
      (priorities.length === 0 || priorities.includes(t.priority)) &&
      (!search.mine || waitsForOwner(t)),
  );
}

interface Lane {
  id: string;
  label: string | null;
  tickets: Ticket[];
}

/** Swimlanes by parent (the pm_task), in the order the parents first appear. */
function lanesOf(tickets: Ticket[], all: readonly Ticket[], grouped: boolean): Lane[] {
  if (!grouped) return [{ id: 'all', label: null, tickets }];
  const byId = new Map(all.map((t) => [t.id, t]));
  const lanes = new Map<string, Lane>();
  for (const ticket of tickets) {
    // pm_tasks share one lane; their children sit in the lane of their pm_task.
    const id = ticket.type === 'pm_task' ? 'pm_tasks' : (ticket.parentId ?? 'none');
    let lane = lanes.get(id);
    if (!lane) {
      const parent = ticket.parentId ? byId.get(ticket.parentId) : undefined;
      const label =
        id === 'pm_tasks'
          ? 'PM task'
          : parent
            ? `${parent.key} · ${parent.title}`
            : ticket.parentId
              ? 'Ticket cha khác'
              : 'Không có ticket cha';
      lane = { id, label, tickets: [] };
      lanes.set(id, lane);
    }
    lane.tickets.push(ticket);
  }
  return [...lanes.values()];
}

function Column({
  status,
  tickets,
  all,
  grouped,
  selectedKey,
  focusedId,
  running,
  onOpen,
  phone,
}: {
  status: TicketStatus;
  tickets: Ticket[];
  all: readonly Ticket[];
  grouped: boolean;
  selectedKey?: string;
  focusedId?: string;
  running: Set<string>;
  onOpen: (ticket: Ticket) => void;
  phone: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const lanes = lanesOf(tickets, all, grouped);
  return (
    <section
      ref={setNodeRef}
      aria-label={`${STATUS_LABEL[status]}, ${tickets.length} ticket`}
      data-column={status}
      className={cn(
        'flex flex-col gap-2 rounded-md bg-soft p-2.5',
        phone ? 'w-full shrink-0 snap-start' : 'min-w-[180px] flex-1 basis-0',
        isOver && 'ring-2 ring-accent',
      )}
    >
      <h2 className="m-0 px-1 py-0.5 text-xs font-bold tracking-[0.04em] text-neutral-ink uppercase">
        {STATUS_LABEL[status]} · {tickets.length}
      </h2>
      {lanes.map((lane) => (
        <div key={lane.id} className="flex flex-col gap-2">
          {lane.label && lanes.length > 0 && (
            <div
              className="truncate border-t border-dashed border-line px-1 pt-1.5 text-[11px] text-muted"
              title={lane.label}
            >
              {lane.label}
            </div>
          )}
          {lane.tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              selected={ticket.key === selectedKey}
              focused={ticket.id === focusedId}
              running={running.has(ticket.id)}
              onOpen={onOpen}
            />
          ))}
        </div>
      ))}
      {tickets.length === 0 && <p className="m-0 px-1 py-2 text-xs text-muted">Không có ticket.</p>}
    </section>
  );
}

export interface BoardViewProps {
  tickets: readonly Ticket[] | undefined;
  isLoading: boolean;
  error: unknown;
  search: BoardSearch;
  onSearch: (patch: Partial<BoardSearch>) => void;
  header: ReactNode;
  /** Hide filters that make no sense for the view (e.g. type on the requests board). */
  showTypeFilter?: boolean;
}

/**
 * Kanban by status with filters, swimlanes by parent, drag and drop between columns (owner transitions;
 * errors such as REPORT_REQUIRED snap the card back) and the ticket side panel.
 * On phones it shows one column per screen with swipe, snap and column tabs.
 */
export function BoardView({
  tickets,
  isLoading,
  error,
  search,
  onSearch,
  header,
  showTypeFilter = true,
}: BoardViewProps) {
  const viewport = useViewport();
  const phone = viewport === 'phone';
  const toast = useToast();
  const transition = useTransition();
  const running = useRunningTicketIds();
  const [dragging, setDragging] = useState<Ticket | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [activeColumn, setActiveColumn] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const grouped = (search.group ?? 'parent') === 'parent';

  const all = tickets ?? [];
  const visible = useMemo(() => filterBoardTickets(all, search), [all, search]);
  const byColumn = useMemo(() => {
    const map = new Map<TicketStatus, Ticket[]>(BOARD_COLUMNS.map((s) => [s, []]));
    for (const ticket of visible) {
      const column = columnOf(ticket.status);
      if (column) map.get(column)?.push(ticket);
    }
    return map;
  }, [visible]);
  /** Card order for `j`/`k`: column by column, top to bottom. */
  const order = useMemo(
    () =>
      BOARD_COLUMNS.flatMap((s) => lanesOf(byColumn.get(s) ?? [], all, grouped).flatMap((l) => l.tickets)),
    [byColumn, all, grouped],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 8 } }),
  );

  const open = (ticket: Ticket) => onSearch({ selected: ticket.key });

  useShortcuts({
    j: () => setFocusIndex((i) => stepIndex(i, order.length, 1)),
    k: () => setFocusIndex((i) => stepIndex(i, order.length, -1)),
    Enter: () => {
      const ticket = order[focusIndex];
      if (ticket) open(ticket);
    },
  });

  const onDragStart = (event: DragStartEvent) => {
    setDragging((event.active.data.current as { ticket: Ticket } | undefined)?.ticket ?? null);
  };
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const ticket = (event.active.data.current as { ticket: Ticket } | undefined)?.ticket;
    const to = event.over?.id as TicketStatus | undefined;
    if (!ticket || !to || columnOf(ticket.status) === to) return;
    transition.mutate(
      { ticket, to },
      {
        onSuccess: () => toast(`${ticket.key} → ${STATUS_LABEL[to]}`, 'success'),
        onError: (err) => toast(`${ticket.key}: ${errorMessage(err)}`, 'error'),
      },
    );
  };

  const scrollToColumn = (index: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
    setActiveColumn(index);
  };

  const roles = parseRoles(search.role);
  const activeFilters =
    parseTypes(search.type).length +
    roles.length +
    parsePriorities(search.priority).length +
    (search.mine ? 1 : 0);

  return (
    <div className="flex min-h-0 grow flex-col gap-3.5 px-3 py-3 md:px-6 md:py-[18px]">
      {header}
      {phone && (
        <button
          type="button"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
          className="inline-flex min-h-11 items-center gap-1 self-start rounded border border-line bg-panel px-3 text-sm"
        >
          Bộ lọc{activeFilters > 0 ? ` (${activeFilters})` : ''} <ChevronDown size={14} aria-hidden />
        </button>
      )}
      <div
        className={cn('flex flex-wrap items-center gap-2', phone && !filtersOpen && 'hidden')}
        role="toolbar"
        aria-label="Bộ lọc board"
      >
        {showTypeFilter && (
          <FilterMenu<TicketType>
            label="Loại"
            options={TICKET_TYPES}
            selected={parseTypes(search.type)}
            render={(t) => (
              <>
                <TypeIcon type={t} /> {TYPE_META[t].label}
              </>
            )}
            onToggle={(t) => onSearch({ type: toggleCsv(search.type, t) })}
          />
        )}
        <fieldset className="m-0 flex items-center gap-1 border-0 p-0" aria-label="Lọc theo vai trò">
          {AGENT_ROLES.map((role: AgentRole) => (
            <button
              key={role}
              type="button"
              aria-pressed={roles.includes(role)}
              aria-label={`Vai trò ${ROLE_META[role].label}`}
              onClick={() => onSearch({ role: toggleCsv(search.role, role) })}
              className={cn(
                'inline-flex size-11 items-center justify-center rounded-full xl:size-9',
                roles.includes(role) ? 'ring-2 ring-accent' : 'opacity-80 hover:opacity-100',
              )}
            >
              <RoleAvatar agent={role} size={28} />
            </button>
          ))}
        </fieldset>
        <FilterMenu
          label="Ưu tiên"
          options={PRIORITIES}
          selected={parsePriorities(search.priority)}
          render={(p) => `${PRIORITY_META[p].arrow} ${PRIORITY_META[p].label}`}
          onToggle={(p) => onSearch({ priority: toggleCsv(search.priority, p) })}
        />
        <button
          type="button"
          aria-pressed={Boolean(search.mine)}
          onClick={() => onSearch({ mine: search.mine ? undefined : true })}
          className={cn(
            'inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] xl:min-h-8',
            search.mine ? 'border-accent bg-accent-bg text-accent-ink' : 'border-line bg-panel',
          )}
        >
          Chỉ ticket của tôi
        </button>
        <MenuRoot>
          <MenuTrigger asChild>
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1 rounded border border-line bg-panel px-3 text-sm hover:bg-soft xl:min-h-8"
            >
              Nhóm theo: {grouped ? 'PM task' : 'Không'} <ChevronDown size={14} aria-hidden />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => onSearch({ group: undefined })}>PM task (ticket cha)</MenuItem>
            <MenuItem onSelect={() => onSearch({ group: 'none' })}>Không nhóm</MenuItem>
          </MenuContent>
        </MenuRoot>
      </div>

      {isLoading && <p className="m-0 text-sm text-muted">Đang tải board…</p>}
      {Boolean(error) && (
        <p role="alert" className="m-0 text-sm text-bad">
          {errorMessage(error)}
        </p>
      )}

      {phone && (
        <nav
          aria-label="Cột trạng thái"
          className="-mx-3 flex gap-1.5 overflow-x-auto border-b border-line2 bg-panel px-3 py-2.5"
        >
          {BOARD_COLUMNS.map((status, index) => (
            <button
              key={status}
              type="button"
              aria-current={index === activeColumn ? 'true' : undefined}
              onClick={() => scrollToColumn(index)}
              className={cn(
                'min-h-11 shrink-0 rounded-full border px-3 text-[13px]',
                index === activeColumn
                  ? 'border-accent bg-accent-bg font-semibold text-accent-ink'
                  : 'border-line bg-panel',
              )}
            >
              {STATUS_LABEL[status]} {byColumn.get(status)?.length ?? 0}
            </button>
          ))}
        </nav>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div
          ref={scroller}
          data-testid="board-columns"
          onScroll={
            phone
              ? (e) => {
                  const el = e.currentTarget;
                  setActiveColumn(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
                }
              : undefined
          }
          className={cn(
            'flex min-h-0 grow items-start gap-3 overflow-x-auto pb-2',
            phone && 'snap-x snap-mandatory gap-0 [scrollbar-width:none]',
          )}
        >
          {BOARD_COLUMNS.map((status) => (
            <Column
              key={status}
              status={status}
              tickets={byColumn.get(status) ?? []}
              all={all}
              grouped={grouped}
              selectedKey={search.selected}
              focusedId={order[focusIndex]?.id}
              running={running}
              onOpen={open}
              phone={phone}
            />
          ))}
        </div>
        <DragOverlay>
          {dragging && (
            <div className="flex w-[240px] rotate-1 flex-col gap-2 rounded-md border border-accent bg-panel px-3 py-2.5 shadow-xl">
              <TicketCardFace ticket={dragging} running={running.has(dragging.id)} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {phone && (
        <>
          <p className="m-0 text-center text-xs text-muted">
            Nhấn giữ để kéo card, hoặc đổi trạng thái trong ticket
          </p>
          <div className="flex justify-center gap-1.5" aria-hidden>
            {BOARD_COLUMNS.map((status, index) => (
              <span
                key={status}
                className={cn('size-[7px] rounded-full', index === activeColumn ? 'bg-accent' : 'bg-line')}
              />
            ))}
          </div>
        </>
      )}

      {search.selected && (
        <TicketSidePanel
          ticketKey={search.selected}
          onClose={() => onSearch({ selected: undefined })}
          onOpenTicket={(key) => onSearch({ selected: key })}
        />
      )}
    </div>
  );
}
