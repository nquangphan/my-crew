import type {
  ClaimRequest,
  EventEnvelope,
  Machine,
  Project,
  ProjectChangeRequest,
  ProjectTestSetup,
} from '@crew/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { ProjectBadge, projectKeyResolver } from '../components/project-badge';
import { ProjectFilterMenu, selectedProjects } from '../components/project-filter';
import { PLATFORM_LABEL } from '../components/project-form';
import { StatusLozenge } from '../components/status-lozenge';
import { TypeIcon } from '../components/type-icon';
import { Button } from '../components/ui/button';
import { useToast } from '../components/ui/toast';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { api } from '../lib/api-client';
import { cn } from '../lib/cn';
import {
  budgetKindLabel,
  errorMessage,
  formatFullDateTime,
  formatRelative,
  OPEN_STATUSES,
  STATUS_LABEL,
} from '../lib/format';
import { useInboxSummary } from '../lib/inbox';
import { keys, useMachineNames, useProjects, useTickets } from '../lib/queries';
import type { ProjectFilterSearch } from '../lib/search-params';

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="m-0 text-sm font-semibold">
        {title} <span className="text-muted">· {count}</span>
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">{children}</ul>
    </section>
  );
}

function Item({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warn' | 'bad' }) {
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-2.5 rounded-md border bg-panel px-3.5 py-3 text-sm',
        tone === 'default' && 'border-line',
        tone === 'warn' && 'border-warn-line',
        tone === 'bad' && 'border-bad',
      )}
    >
      {children}
    </li>
  );
}

const scopeText = (claim: { projectKey: string | null; assistant: boolean }) =>
  claim.assistant ? 'vai trò trợ lý' : `dự án ${claim.projectKey ?? '?'}`;

function ClaimItem({ claim, machines }: { claim: ClaimRequest; machines: Map<string, Machine> }) {
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const holder = claim.previousMachineId ? machines.get(claim.previousMachineId)?.name : null;
  return (
    <Item tone="warn">
      <span className="min-w-0 grow">
        <strong>{claim.machineName}</strong> muốn nhận {scopeText(claim)}
        {holder ? (
          <>
            {' '}
            đang do <strong>{holder}</strong> giữ
          </>
        ) : null}
        <span className="block text-xs text-muted">Gửi {formatRelative(claim.createdAt)}</span>
      </span>
      <Button variant="primary" onClick={() => setDecision('approve')}>
        Duyệt
      </Button>
      <Button onClick={() => setDecision('reject')}>Từ chối</Button>
      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(open) => !open && setDecision(null)}
        title={decision === 'approve' ? 'Duyệt chuyển máy' : 'Từ chối yêu cầu'}
        description={`${claim.machineName} → ${scopeText(claim)}. ${
          decision === 'approve'
            ? 'Ticket đang mở của phạm vi này sẽ chuyển sang máy mới.'
            : 'Máy giữ hiện tại không đổi.'
        }`}
        confirmLabel={decision === 'approve' ? 'Duyệt' : 'Từ chối'}
        confirmVariant={decision === 'approve' ? 'primary' : 'danger'}
        onConfirm={async () => {
          if (!decision) return;
          await api.decideClaim(claim.id, decision);
          setDecision(null);
          toast(decision === 'approve' ? 'Đã duyệt yêu cầu' : 'Đã từ chối yêu cầu', 'success');
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['claims'] }),
            queryClient.invalidateQueries({ queryKey: keys.machines }),
            queryClient.invalidateQueries({ queryKey: keys.projects }),
          ]);
        }}
      />
    </Item>
  );
}

/** "Web · test UI web playwright" for the parts QC uses on this platform. */
function setupText(setup: ProjectTestSetup): string {
  const parts = [PLATFORM_LABEL[setup.platform]];
  if (setup.platform === 'web' || setup.platform === 'web_mobile')
    parts.push(`test UI web ${setup.uiTestMcp.playwright}`);
  if (setup.platform === 'mobile' || setup.platform === 'web_mobile')
    parts.push(`test UI mobile ${setup.uiTestMcp.maestro}`);
  return parts.join(' · ');
}

function ProjectChangeItem({ change }: { change: ProjectChangeRequest }) {
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  return (
    <Item tone="warn">
      <span className="min-w-0 grow">
        <strong>{change.machineName}</strong> muốn đổi dự án <strong>{change.projectKey}</strong>:{' '}
        {setupText(change.current)} → <strong>{setupText(change.requested)}</strong>
        <span className="block text-xs text-muted">Gửi {formatRelative(change.createdAt)}</span>
      </span>
      <Button variant="primary" onClick={() => setDecision('approve')}>
        Duyệt
      </Button>
      <Button onClick={() => setDecision('reject')}>Từ chối</Button>
      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(open) => !open && setDecision(null)}
        title={decision === 'approve' ? 'Duyệt đổi loại dự án' : 'Từ chối đổi loại dự án'}
        description={`${change.projectKey}: ${setupText(change.requested)}. ${
          decision === 'approve'
            ? 'Ticket QC tạo từ giờ dùng MCP test UI mới.'
            : 'Dự án giữ nguyên loại và MCP test UI hiện tại.'
        }`}
        confirmLabel={decision === 'approve' ? 'Duyệt' : 'Từ chối'}
        confirmVariant={decision === 'approve' ? 'primary' : 'danger'}
        onConfirm={async () => {
          if (!decision) return;
          await api.decideProjectChange(change.id, decision);
          setDecision(null);
          toast(decision === 'approve' ? 'Đã duyệt thay đổi dự án' : 'Đã từ chối thay đổi dự án', 'success');
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['projectChanges'] }),
            queryClient.invalidateQueries({ queryKey: keys.projects }),
          ]);
        }}
      />
    </Item>
  );
}

function OfflineMachineItem({ machine }: { machine: Machine }) {
  const affected = useTickets({ machineId: machine.id, status: [...OPEN_STATUSES] });
  const list = affected.data ?? [];
  return (
    <Item tone="bad">
      <div className="flex min-w-0 grow flex-col gap-1.5">
        <span>
          <strong>{machine.name}</strong> đang offline
          {machine.lastSeenAt && (
            <span className="text-muted"> · lần cuối {formatRelative(machine.lastSeenAt)}</span>
          )}
        </span>
        {list.length > 0 ? (
          <span className="flex flex-wrap gap-2 text-[13px]">
            <span className="text-muted">Ticket bị ảnh hưởng:</span>
            {list.map((t) => (
              <Link key={t.id} to="/tickets/$ticketKey" params={{ ticketKey: t.key }} className="font-mono">
                {t.key}
              </Link>
            ))}
          </span>
        ) : (
          <span className="text-[13px] text-muted">Không có ticket đang mở trên máy này.</span>
        )}
      </div>
      <Link to="/machines" className="inline-flex min-h-11 items-center">
        Xem máy
      </Link>
    </Item>
  );
}

function describeNotice(
  event: EventEnvelope,
  machines: Map<string, Machine>,
  projects: Project[],
): ReactNode {
  const machineName = (id: string | null) =>
    id ? (machines.get(id)?.name ?? 'Máy đã xóa') : 'Không máy nào';
  const projectKey = (id: string | null) => (id ? (projects.find((p) => p.id === id)?.key ?? 'dự án') : null);
  const p = event.payload;
  switch (p.type) {
    case 'machine.claimed':
      return `${machineName(p.data.machineId)} đã nhận ${p.data.assistant ? 'vai trò trợ lý' : `dự án ${projectKey(p.data.projectId)}`}`;
    case 'claim.requested':
      return `${machineName(p.data.machineId)} xin nhận ${p.data.assistant ? 'vai trò trợ lý' : `dự án ${projectKey(p.data.projectId)}`}`;
    case 'machine.released':
      return `${machineName(p.data.machineId)} đã trả ${p.data.assistant ? 'vai trò trợ lý' : `dự án ${projectKey(p.data.projectId)}`}`;
    case 'project.created':
      return `${machineName(p.data.machineId)} tạo dự án mới ${projectKey(p.data.projectId)}`;
    case 'machine.offline':
      return `${machineName(p.data.machineId)} mất kết nối`;
    case 'machine.unhealthy':
      return `${machineName(p.data.machineId)} lỗi health: ${p.data.failing.map((f) => f.title).join(', ') || 'không rõ'}`;
    case 'budget.exceeded':
      return `Vượt giới hạn ${budgetKindLabel(p.data.kind)}`;
    case 'project.change_requested':
      return `${machineName(p.data.machineId)} xin đổi loại dự án ${projectKey(p.data.projectId)}`;
    case 'ticket.stuck':
      return `Ticket đứng yên ${p.data.idleMinutes} phút ở ${STATUS_LABEL[p.data.status]}, không máy nào đang xử lý`;
    default:
      return p.type;
  }
}

/**
 * The owner's "needs me" list: takeover requests (approve or reject with a confirm click), agents waiting for an
 * answer, cap and budget approvals, offline machines with the affected tickets, red health, unowned
 * projects, and the machine notice feed.
 */
export function InboxPage({ search = {} }: { search?: ProjectFilterSearch }) {
  const inbox = useInboxSummary();
  const machines = useMachineNames();
  const projects = useProjects();
  const navigate = useNavigate();
  const chosen = selectedProjects(projects.data, search.project);
  const filtering = chosen.length > 0;
  const chosenIds = new Set(chosen.map((p) => p.id));
  const chosenKeys = new Set(chosen.map((p) => p.key));
  const keyOf = projectKeyResolver(projects.data);
  // The server applies the same project filter as the boards: a request counts for the projects it was
  // routed or hinted to.
  const filteredNeedsInput = useTickets({ status: ['needs_input'], projectIds: [...chosenIds] }, filtering);
  const waiting = filtering ? (filteredNeedsInput.data ?? []) : inbox.needsInput;
  const inChosen = (projectKeys: readonly string[]) =>
    !filtering || projectKeys.some((key) => chosenKeys.has(key));
  const pendingClaims = inbox.pendingClaims.filter((c) => inChosen(c.projectKey ? [c.projectKey] : []));
  const pendingChanges = inbox.pendingChanges.filter((c) => inChosen([c.projectKey]));
  const offlineMachines = inbox.offlineMachines.filter((m) => inChosen(m.projectKeys));
  const unhealthyMachines = inbox.unhealthyMachines.filter((m) => inChosen(m.projectKeys));
  const unownedProjects = inbox.unownedProjects.filter((p) => inChosen([p.key]));
  const notices = inbox.notices.filter(
    (event) => !filtering || (event.projectId !== null && chosenIds.has(event.projectId)),
  );
  const needsAnswer = waiting.filter((t) => !t.budgetHold);
  const budgetHolds = waiting.filter((t) => t.budgetHold);
  const toast = useToast();
  /** Notices that were unread when the inbox was opened keep their dot during this visit. */
  const [openedUnread, setOpenedUnread] = useState<Set<string> | null>(null);
  const actionCount =
    pendingClaims.length +
    pendingChanges.length +
    waiting.length +
    offlineMachines.length +
    unhealthyMachines.length +
    unownedProjects.length;
  const hiddenNotices = inbox.notices.length - notices.length;
  const run = (task: Promise<void>) => task.catch((error: unknown) => toast(errorMessage(error), 'error'));

  // Opening the inbox marks the loaded notices read on the server (up to the newest one shown, so a
  // notice that arrives meanwhile stays unread), for every device.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mark once the notices are loaded
  useEffect(() => {
    if (openedUnread !== null || inbox.notices.length === 0) return;
    const unread = inbox.notices.filter((event) => !event.read);
    setOpenedUnread(new Set(unread.map((event) => event.id)));
    const newest = inbox.notices[0];
    if (unread.length > 0 && newest) void run(inbox.markAllRead(newest.id));
  }, [inbox.notices.length, openedUnread]);

  const ticketItem = (ticket: (typeof inbox.needsInput)[number], text: string) => {
    const projectKey = keyOf(ticket);
    return (
      <Item key={ticket.id} tone="warn">
        <TypeIcon type={ticket.type} />
        <Link to="/tickets/$ticketKey" params={{ ticketKey: ticket.key }} className="font-mono">
          {ticket.key}
        </Link>
        {projectKey && <ProjectBadge projectKey={projectKey} />}
        <span className="min-w-0 grow truncate">{ticket.title}</span>
        <StatusLozenge status={ticket.status} />
        <span className="w-full text-xs text-muted md:w-auto">{text}</span>
      </Item>
    );
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5 px-3 py-3 md:px-6 md:py-[18px]">
      <Breadcrumbs items={[{ label: 'Inbox' }]} />
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 grow text-[22px] font-semibold">Inbox</h1>
        <ProjectFilterMenu
          projects={projects.data ?? []}
          value={search.project}
          onChange={(project) => void navigate({ to: '/inbox', search: { project }, replace: true })}
        />
      </div>
      {inbox.isLoading && <p className="m-0 text-sm text-muted">Đang tải…</p>}
      {!inbox.isLoading && actionCount === 0 && (
        <p className="m-0 rounded-md border border-line bg-panel p-4 text-sm">
          {filtering
            ? `Không có việc nào của ${chosen.map((p) => p.key).join(', ')} cần bạn xử lý.`
            : 'Không có việc nào cần bạn xử lý.'}
        </p>
      )}

      <Group title="Yêu cầu chuyển máy cần duyệt" count={pendingClaims.length}>
        {pendingClaims.map((claim) => (
          <ClaimItem key={claim.id} claim={claim} machines={machines} />
        ))}
      </Group>
      <Group title="Yêu cầu đổi loại dự án cần duyệt" count={pendingChanges.length}>
        {pendingChanges.map((change) => (
          <ProjectChangeItem key={change.id} change={change} />
        ))}
      </Group>
      <Group title="Agent đang chờ bạn trả lời" count={needsAnswer.length}>
        {needsAnswer.map((t) => ticketItem(t, `Cập nhật ${formatRelative(t.updatedAt)}`))}
      </Group>
      <Group title="Duyệt vượt giới hạn" count={budgetHolds.length}>
        {budgetHolds.map((t) =>
          ticketItem(
            t,
            `Chạm giới hạn ${t.budgetHold === 'children' ? 'số ticket con' : 'chi phí'}; trả lời trong ticket để duyệt`,
          ),
        )}
      </Group>
      <Group title="Máy offline" count={offlineMachines.length}>
        {offlineMachines.map((m) => (
          <OfflineMachineItem key={m.id} machine={m} />
        ))}
      </Group>
      <Group title="Máy lỗi health" count={unhealthyMachines.length}>
        {unhealthyMachines.map((m) => (
          <Item key={m.id} tone="bad">
            <span className="min-w-0 grow">
              <strong>{m.name}</strong>: {m.health?.failing.map((f) => f.title).join(', ') || 'lỗi không rõ'}
            </span>
            <Link to="/machines" className="inline-flex min-h-11 items-center">
              Xem máy
            </Link>
          </Item>
        ))}
      </Group>
      <Group title="Dự án chưa có máy" count={unownedProjects.length}>
        {unownedProjects.map((p) => (
          <Item key={p.id}>
            <span className="font-mono text-xs text-muted">{p.key}</span>
            <span className="min-w-0 grow">{p.name}: chưa máy nào nhận, ticket của dự án sẽ không chạy.</span>
            <Link to="/projects" className="inline-flex min-h-11 items-center">
              Giao máy
            </Link>
          </Item>
        ))}
      </Group>

      <section aria-label="Thông báo" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-sm font-semibold">
            Thông báo từ máy
            {inbox.unreadNotices > 0 && <span className="text-muted"> · {inbox.unreadNotices} chưa đọc</span>}
          </h2>
          {inbox.unreadNotices > 0 && (
            <Button onClick={() => void run(inbox.markAllRead())}>Đánh dấu tất cả đã đọc</Button>
          )}
        </div>
        {filtering && hiddenNotices > 0 && (
          <p className="m-0 text-xs text-muted">Ẩn {hiddenNotices} thông báo không thuộc dự án đã chọn.</p>
        )}
        {notices.length === 0 ? (
          <p className="m-0 text-sm text-muted">Chưa có thông báo.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-line2 rounded-md border border-line bg-panel p-0">
            {notices.map((event) => {
              const dot = !event.read || (openedUnread?.has(event.id) ?? false);
              const projectKey = event.projectId ? keyOf({ projectId: event.projectId }) : undefined;
              return (
                <li key={event.id} className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm">
                  <span
                    aria-hidden
                    className={cn('size-2 shrink-0 rounded-full', dot ? 'bg-accent' : 'bg-transparent')}
                  />
                  {dot && <span className="sr-only">Chưa đọc:</span>}
                  {projectKey && <ProjectBadge projectKey={projectKey} className="shrink-0" />}
                  <span className="min-w-0 grow">
                    {describeNotice(event, machines, projects.data ?? [])}
                    {event.ticketId &&
                      (event.payload.type === 'budget.exceeded' || event.payload.type === 'ticket.stuck') && (
                        <>
                          {' · '}
                          <Link to="/tickets/$ticketKey" params={{ ticketKey: event.ticketId }}>
                            mở ticket
                          </Link>
                        </>
                      )}
                  </span>
                  <time
                    dateTime={event.createdAt}
                    title={formatFullDateTime(event.createdAt)}
                    className="shrink-0 text-xs text-muted"
                  >
                    {formatRelative(event.createdAt)}
                  </time>
                  {!event.read && (
                    <Button onClick={() => void run(inbox.markRead([event.id]))}>Đã đọc</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
