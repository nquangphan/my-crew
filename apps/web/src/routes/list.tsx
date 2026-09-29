import type { Ticket, TicketPriority, TicketStatus } from '@crew/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CancelDialog } from '../components/cancel-dialog';
import { FilterMenu } from '../components/filter-menu';
import { IssueTable, sortTickets } from '../components/issue-table';
import { projectKeyResolver } from '../components/project-badge';
import { ProjectFilterMenu } from '../components/project-filter';
import { RoleAvatar } from '../components/role-avatar';
import { StatusLozenge } from '../components/status-lozenge';
import { TypeIcon } from '../components/type-icon';
import { Button } from '../components/ui/button';
import { DialogContent, DialogRoot } from '../components/ui/dialog';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/field';
import { useToast } from '../components/ui/toast';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { api } from '../lib/api-client';
import { cn } from '../lib/cn';
import {
  AGENT_ROLES,
  errorMessage,
  isOpen,
  OPEN_STATUSES,
  PRIORITIES,
  PRIORITY_META,
  ROLE_META,
  STATUS_LABEL,
  STATUS_ORDER,
  TICKET_TYPES,
  TYPE_META,
} from '../lib/format';
import {
  invalidateTicketData,
  useProjects,
  useRunningTicketIds,
  useTickets,
  useTransition,
  useUpdateTicket,
} from '../lib/queries';
import {
  type AllListSearch,
  type ListSort,
  parsePriorities,
  parseProjectKeys,
  parseRoles,
  parseStatuses,
  parseTypes,
  toggleCsv,
} from '../lib/search-params';
import { stepIndex, useShortcuts } from '../lib/shortcuts';
import { useViewport } from '../lib/ui-state';

const OPEN_CSV = OPEN_STATUSES.join(',');

/**
 * List/backlog view of one project, or of every project (`projectKey` null: project filter and column,
 * requests included). Every filter and the sort live in the URL, so any view can be bookmarked.
 */
export function ListPage({ projectKey, search }: { projectKey: string | null; search: AllListSearch }) {
  const navigate = useNavigate();
  const viewport = useViewport();
  const toast = useToast();
  const queryClient = useQueryClient();
  const projects = useProjects();
  const crossProject = projectKey === null;
  const project = crossProject ? undefined : projects.data?.find((p) => p.key === projectKey);
  const statuses = parseStatuses(search.status);
  const types = parseTypes(search.type);
  const roles = parseRoles(search.role);
  const priorities = parsePriorities(search.priority);
  const projectKeys = crossProject ? parseProjectKeys(search.project) : [];
  const projectIds = (projects.data ?? []).filter((p) => projectKeys.includes(p.key)).map((p) => p.id);
  const tickets = useTickets(
    {
      projectId: project?.id,
      projectIds: projectIds.length > 0 ? projectIds : undefined,
      status: statuses,
      type: types,
      role: roles,
      priority: priorities,
      q: search.q,
    },
    crossProject ? Boolean(projects.data) : Boolean(project),
  );
  const projectKeyOf = useMemo(
    () => (crossProject ? projectKeyResolver(projects.data) : undefined),
    [crossProject, projects.data],
  );
  const running = useRunningTicketIds();
  const transition = useTransition();
  const update = useUpdateTicket();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState(-1);
  const [cancelTicket, setCancelTicket] = useState<Ticket | null>(null);
  const [bulkCancel, setBulkCancel] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [qDraft, setQDraft] = useState(search.q ?? '');

  const sort: ListSort = search.sort ?? 'updatedAt';
  const order = search.order ?? (sort === 'updatedAt' || sort === 'priority' ? 'desc' : 'asc');
  const rows = useMemo(
    () => sortTickets(tickets.data ?? [], sort, order, projectKeyOf),
    [tickets.data, sort, order, projectKeyOf],
  );
  const chosen = rows.filter((t) => selected.has(t.id));

  const setSearch = (patch: Partial<AllListSearch>) =>
    void (projectKey
      ? navigate({
          to: '/projects/$projectKey/list',
          params: { projectKey },
          search: (prev) => ({ ...prev, ...patch }),
          replace: true,
        })
      : navigate({ to: '/list', search: (prev) => ({ ...prev, ...patch }), replace: true }));

  const openTicket = (ticket: Ticket) =>
    void navigate({ to: '/tickets/$ticketKey', params: { ticketKey: ticket.key } });

  useShortcuts({
    j: () => setFocusIndex((i) => stepIndex(i, rows.length, 1)),
    k: () => setFocusIndex((i) => stepIndex(i, rows.length, -1)),
    Enter: () => {
      const ticket = rows[focusIndex];
      if (ticket) openTicket(ticket);
    },
  });

  const onStatus = (ticket: Ticket, to: TicketStatus) => {
    if (to === 'cancelled') {
      transition.reset();
      setCancelTicket(ticket);
      return;
    }
    transition.mutate(
      { ticket, to },
      { onError: (err) => toast(`${ticket.key}: ${errorMessage(err)}`, 'error') },
    );
  };
  const onPriority = (ticket: Ticket, priority: TicketPriority) =>
    update.mutate(
      { ticket, patch: { priority } },
      { onError: (err) => toast(`${ticket.key}: ${errorMessage(err)}`, 'error') },
    );

  /** Runs one request per selected ticket and reports failures by key. */
  const runBulk = async (label: string, run: (ticket: Ticket) => Promise<unknown>, targets: Ticket[]) => {
    setBulkBusy(true);
    const results = await Promise.allSettled(targets.map(run));
    setBulkBusy(false);
    await invalidateTicketData(queryClient);
    const failed = targets.filter((_, i) => results[i]?.status === 'rejected');
    if (failed.length === 0) toast(`${label}: ${targets.length} ticket`, 'success');
    else toast(`${label}: lỗi ở ${failed.map((t) => t.key).join(', ')}`, 'error');
    setSelected(new Set(failed.map((t) => t.id)));
  };

  const bulkBar = chosen.length > 0 && (
    <div
      role="toolbar"
      aria-label="Thao tác hàng loạt"
      className={cn(
        'flex items-center gap-2 text-[13px]',
        viewport === 'phone' &&
          'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel px-3 py-2 shadow-[0_-6px_16px_rgba(23,32,51,0.12)]',
      )}
    >
      <span className="grow text-muted md:grow-0">{chosen.length} đã chọn</span>
      <MenuRoot>
        <MenuTrigger asChild>
          <Button disabled={bulkBusy}>
            Đổi ưu tiên <ChevronDown size={14} aria-hidden />
          </Button>
        </MenuTrigger>
        <MenuContent>
          {PRIORITIES.map((p) => (
            <MenuItem
              key={p}
              onSelect={() =>
                void runBulk(
                  `Đổi ưu tiên thành ${PRIORITY_META[p].label}`,
                  (t) => api.setPriority(t.id, p),
                  chosen,
                )
              }
            >
              {PRIORITY_META[p].arrow} {PRIORITY_META[p].label}
            </MenuItem>
          ))}
        </MenuContent>
      </MenuRoot>
      <Button
        disabled={bulkBusy || !chosen.some((t) => isOpen(t.status))}
        onClick={() => setBulkCancel(true)}
      >
        Hủy
      </Button>
      <Button variant="ghost" onClick={() => setSelected(new Set())}>
        Bỏ chọn
      </Button>
    </div>
  );

  if (!crossProject && !projects.isLoading && !project)
    return <p className="m-0 p-6 text-sm text-bad">Không tìm thấy dự án {projectKey}.</p>;
  const openOnly = search.status === OPEN_CSV;
  const cancellable = chosen.filter((t) => isOpen(t.status));

  return (
    <div
      className={cn(
        'flex flex-col gap-3.5 px-3 py-3 md:px-6 md:py-[18px]',
        viewport === 'phone' && chosen.length > 0 && 'pb-20',
      )}
    >
      {crossProject ? (
        <>
          <Breadcrumbs items={[{ label: 'Tất cả dự án' }, { label: 'Danh sách' }]} />
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 grow text-[22px] font-semibold">Danh sách ticket · Tất cả dự án</h1>
            <Link
              to="/board"
              search={{ project: search.project }}
              className="inline-flex min-h-11 items-center rounded border border-line bg-panel px-3 text-sm text-ink no-underline hover:bg-soft xl:min-h-8"
            >
              Xem board
            </Link>
          </div>
        </>
      ) : (
        <>
          <Breadcrumbs
            items={[
              { label: 'Dự án', link: { to: '/projects' } },
              { label: project?.name ?? projectKey },
              { label: 'Danh sách' },
            ]}
          />
          <h1 className="m-0 text-[22px] font-semibold">Danh sách ticket</h1>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Bộ lọc danh sách">
        <form
          className="w-full md:w-56"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch({ q: qDraft.trim() || undefined });
          }}
        >
          <Input
            aria-label="Lọc theo key hoặc tiêu đề"
            placeholder="Lọc theo key, tiêu đề…"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onBlur={() => setSearch({ q: qDraft.trim() || undefined })}
          />
        </form>
        <button
          type="button"
          aria-pressed={openOnly}
          onClick={() => setSearch({ status: openOnly ? undefined : OPEN_CSV })}
          className={cn(
            'inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] xl:min-h-8',
            openOnly ? 'border-accent bg-accent-bg text-accent-ink' : 'border-line bg-panel',
          )}
        >
          Trạng thái: chưa xong
        </button>
        {crossProject && (
          <ProjectFilterMenu
            projects={projects.data ?? []}
            value={search.project}
            onChange={(project) => setSearch({ project })}
          />
        )}
        <FilterMenu
          label="Trạng thái"
          options={STATUS_ORDER}
          selected={statuses}
          render={(s) => <StatusLozenge status={s} />}
          onToggle={(s) => setSearch({ status: toggleCsv(search.status, s) })}
        />
        <FilterMenu
          label="Loại"
          options={TICKET_TYPES}
          selected={types}
          render={(t) => (
            <>
              <TypeIcon type={t} /> {TYPE_META[t].label}
            </>
          )}
          onToggle={(t) => setSearch({ type: toggleCsv(search.type, t) })}
        />
        <FilterMenu
          label="Vai trò"
          options={AGENT_ROLES}
          selected={roles}
          render={(r) => (
            <>
              <RoleAvatar agent={r} size={20} /> {ROLE_META[r].label}
            </>
          )}
          onToggle={(r) => setSearch({ role: toggleCsv(search.role, r) })}
        />
        <FilterMenu
          label="Ưu tiên"
          options={PRIORITIES}
          selected={priorities}
          render={(p) => `${PRIORITY_META[p].arrow} ${PRIORITY_META[p].label}`}
          onToggle={(p) => setSearch({ priority: toggleCsv(search.priority, p) })}
        />
        <span className="grow" />
        {viewport !== 'phone' && bulkBar}
      </div>

      {(tickets.isLoading || projects.isLoading) && <p className="m-0 text-sm text-muted">Đang tải…</p>}
      {tickets.isError && (
        <p role="alert" className="m-0 text-sm text-bad">
          {errorMessage(tickets.error)}
        </p>
      )}
      {tickets.data && rows.length === 0 && (
        <p className="m-0 text-sm text-muted">Không có ticket khớp bộ lọc.</p>
      )}
      {rows.length > 0 && (
        <IssueTable
          tickets={rows}
          sort={sort}
          order={order}
          onSort={(next) =>
            setSearch({
              sort: next,
              order:
                next === sort
                  ? order === 'asc'
                    ? 'desc'
                    : 'asc'
                  : next === 'updatedAt' || next === 'priority'
                    ? 'desc'
                    : 'asc',
            })
          }
          selected={selected}
          onSelect={(ids, on) =>
            setSelected((prev) => {
              const next = new Set(prev);
              for (const id of ids) {
                if (on) next.add(id);
                else next.delete(id);
              }
              return next;
            })
          }
          focusedId={rows[focusIndex]?.id}
          running={running}
          onOpen={openTicket}
          onStatus={onStatus}
          onPriority={onPriority}
          viewport={viewport}
          projectKeyOf={projectKeyOf}
        />
      )}
      {viewport === 'phone' && bulkBar}

      {cancelTicket && (
        <CancelDialog
          ticket={cancelTicket}
          open
          onOpenChange={(open) => !open && setCancelTicket(null)}
          busy={transition.isPending}
          error={transition.error}
          onConfirm={() =>
            transition.mutate(
              { ticket: cancelTicket, to: 'cancelled' },
              { onSuccess: () => setCancelTicket(null) },
            )
          }
        />
      )}
      <DialogRoot open={bulkCancel} onOpenChange={setBulkCancel}>
        <DialogContent
          title={`Hủy ${cancellable.length} ticket?`}
          description="Các ticket con đang mở của chúng cũng bị hủy."
        >
          <ul className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0 text-sm">
            {cancellable.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">{t.key}</span>
                <span className="min-w-0 grow truncate">{t.title}</span>
                <span className="text-xs text-muted">{STATUS_LABEL[t.status]}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setBulkCancel(false)}>Không</Button>
            <Button
              variant="danger"
              disabled={bulkBusy}
              onClick={() => {
                setBulkCancel(false);
                void runBulk('Hủy', (t) => api.transition(t.id, 'cancelled'), cancellable);
              }}
            >
              Hủy {cancellable.length} ticket
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
