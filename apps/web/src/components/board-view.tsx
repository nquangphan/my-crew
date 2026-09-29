import type { AgentRole, Project, Ticket, TicketStatus, TicketType } from '@crew/shared';
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
import {
  type AllBoardSearch,
  type BoardSearch,
  parsePriorities,
  parseProjectKeys,
  parseRoles,
  parseTypes,
  toggleCsv,
} from '../lib/search-params';
import { stepIndex, useShortcuts } from '../lib/shortcuts';
import { useViewport } from '../lib/ui-state';
import { FilterMenu } from './filter-menu';
import { ProjectBadge, projectKeyResolver } from './project-badge';
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

export type LaneMode = NonNullable<BoardSearch['group']>;

export interface Lane {
  id: string;
  label: string | null;
  /** A pm_task's lane inside its request's lane (request grouping). */
  nested?: boolean;
  tickets: Ticket[];
}

/** The nearest ancestor of a type among the loaded tickets (the hierarchy is three levels deep). */
function ancestorOf(ticket: Ticket, type: TicketType, byId: ReadonlyMap<string, Ticket>): Ticket | undefined {
  let current: Ticket | undefined = ticket;
  for (let hops = 0; hops < 4 && current; hops++) {
    if (current.type === type) return current;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return undefined;
}

const titled = (ticket: Ticket) => `${ticket.key} · ${ticket.title}`;

/** Swimlanes by parent (the pm_task), in the order the parents first appear. */
function parentLanes(tickets: Ticket[], byId: ReadonlyMap<string, Ticket>): Lane[] {
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
            ? titled(parent)
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

/**
 * Request → pm_task lanes: a request's lane holds the request and its pm_tasks (every project it was
 * routed to), and each pm_task's children follow in a nested lane, so one request's work sits together.
 */
function requestLanes(tickets: Ticket[], byId: ReadonlyMap<string, Ticket>): Lane[] {
  const groups = new Map<string, { head: Lane; subs: Map<string, Lane> }>();
  for (const ticket of tickets) {
    const request = ancestorOf(ticket, 'request', byId);
    const groupId = request?.id ?? 'none';
    let group = groups.get(groupId);
    if (!group) {
      const head: Lane = {
        id: `request:${groupId}`,
        label: request ? titled(request) : 'Không thuộc request',
        tickets: [],
      };
      group = { head, subs: new Map() };
      groups.set(groupId, group);
    }
    if (ticket.type === 'request' || ticket.type === 'pm_task') {
      group.head.tickets.push(ticket);
      continue;
    }
    const pmTask = ancestorOf(ticket, 'pm_task', byId);
    const subId = pmTask?.id ?? 'other';
    let sub = group.subs.get(subId);
    if (!sub) {
      sub = {
        id: `${group.head.id}/${subId}`,
        label: pmTask ? titled(pmTask) : 'Ticket cha khác',
        nested: true,
        tickets: [],
      };
      group.subs.set(subId, sub);
    }
    sub.tickets.push(ticket);
  }
  return [...groups.values()].flatMap((group) => [group.head, ...group.subs.values()]);
}

/** One lane per project (by key); requests without a project come first. */
function projectLanes(tickets: Ticket[], projectOf: (ticket: Ticket) => Project | undefined): Lane[] {
  const lanes = new Map<string, Lane>();
  for (const ticket of tickets) {
    const project = projectOf(ticket);
    const id = project?.key ?? '';
    let lane = lanes.get(id);
    if (!lane) {
      lane = {
        id: `project:${id}`,
        label: project ? `${project.key} · ${project.name}` : 'Request',
        tickets: [],
      };
      lanes.set(id, lane);
    }
    lane.tickets.push(ticket);
  }
  return [...lanes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, lane]) => lane);
}

/** Swimlanes of one column. */
export function lanesOf(
  tickets: Ticket[],
  all: readonly Ticket[],
  mode: LaneMode,
  projects: readonly Project[] = [],
): Lane[] {
  if (mode === 'none') return [{ id: 'all', label: null, tickets }];
  const byId = new Map(all.map((t) => [t.id, t]));
  if (mode === 'request') return requestLanes(tickets, byId);
  if (mode === 'project') {
    const byProject = new Map(projects.map((p) => [p.id, p]));
    return projectLanes(tickets, (t) => (t.projectId ? byProject.get(t.projectId) : undefined));
  }
  return parentLanes(tickets, byId);
}

const GROUP_LABEL: Record<LaneMode, string> = {
  parent: 'PM task',
  request: 'Request → PM task',
  project: 'Dự án',
  none: 'Không',
};

function Column({
  status,
  tickets,
  all,
  mode,
  projects,
  projectKeyOf,
  selectedKey,
  focusedId,
  running,
  onOpen,
  phone,
}: {
  status: TicketStatus;
  tickets: Ticket[];
  all: readonly Ticket[];
  mode: LaneMode;
  projects?: readonly Project[];
  projectKeyOf?: (ticket: Ticket) => string | undefined;
  selectedKey?: string;
  focusedId?: string;
  running: Set<string>;
  onOpen: (ticket: Ticket) => void;
  phone: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const lanes = lanesOf(tickets, all, mode, projects);
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
        <div key={lane.id} className={cn('flex flex-col gap-2', lane.nested && 'ml-2')}>
          {lane.label && lanes.length > 0 && (
            <div
              data-lane={lane.id}
              className={cn(
                'truncate border-t border-dashed border-line px-1 pt-1.5 text-[11px] text-muted',
                lane.nested && 'border-dotted',
              )}
              title={lane.label}
            >
              {lane.nested ? `› ${lane.label}` : lane.label}
            </div>
          )}
          {lane.tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              selected={ticket.key === selectedKey}
              focused={ticket.id === focusedId}
              running={running.has(ticket.id)}
              projectKey={projectKeyOf?.(ticket)}
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
  search: AllBoardSearch;
  onSearch: (patch: Partial<AllBoardSearch>) => void;
  header: ReactNode;
  /** Hide filters that make no sense for the view (e.g. type on the requests board). */
  showTypeFilter?: boolean;
  /**
   * The all-projects board: project badges on cards, the project filter, and request → pm_task (default)
   * or project swimlanes.
   */
  projects?: readonly Project[];
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
  projects,
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
  const crossProject = projects !== undefined;
  const defaultMode: LaneMode = crossProject ? 'request' : 'parent';
  const mode: LaneMode = search.group ?? defaultMode;
  const groupModes: LaneMode[] = crossProject ? ['request', 'project', 'none'] : ['parent', 'none'];
  const projectKeyOf = useMemo(
    () => (crossProject ? projectKeyResolver(projects) : undefined),
    [crossProject, projects],
  );
  const projectKeys = parseProjectKeys(search.project);

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
      BOARD_COLUMNS.flatMap((s) =>
        lanesOf(byColumn.get(s) ?? [], all, mode, projects).flatMap((l) => l.tickets),
      ),
    [byColumn, all, mode, projects],
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
    projectKeys.length +
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
        {crossProject && (
          <FilterMenu
            label="Dự án"
            options={(projects ?? []).map((p) => p.key)}
            selected={projectKeys}
            render={(key) => (
              <>
                <ProjectBadge projectKey={key} /> {projects?.find((p) => p.key === key)?.name}
              </>
            )}
            onToggle={(key) => onSearch({ project: toggleCsv(search.project, key) })}
          />
        )}
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
              Nhóm theo: {GROUP_LABEL[mode]} <ChevronDown size={14} aria-hidden />
            </button>
          </MenuTrigger>
          <MenuContent>
            {groupModes.map((option) => (
              <MenuItem
                key={option}
                onSelect={() => onSearch({ group: option === defaultMode ? undefined : option })}
              >
                {option === 'parent'
                  ? 'PM task (ticket cha)'
                  : option === 'none'
                    ? 'Không nhóm'
                    : GROUP_LABEL[option]}
              </MenuItem>
            ))}
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
              mode={mode}
              projects={projects}
              projectKeyOf={projectKeyOf}
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
              <TicketCardFace
                ticket={dragging}
                running={running.has(dragging.id)}
                projectKey={projectKeyOf?.(dragging)}
              />
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
