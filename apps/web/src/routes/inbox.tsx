import type { ClaimRequest, EventEnvelope, Machine, Project } from '@crew/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { StatusLozenge } from '../components/status-lozenge';
import { TotpDialog } from '../components/totp-dialog';
import { TypeIcon } from '../components/type-icon';
import { Button } from '../components/ui/button';
import { useToast } from '../components/ui/toast';
import { Breadcrumbs } from '../layout/breadcrumbs';
import { api } from '../lib/api-client';
import { cn } from '../lib/cn';
import {
  budgetKindLabel,
  formatFullDateTime,
  formatRelative,
  OPEN_STATUSES,
  STATUS_LABEL,
} from '../lib/format';
import { useInboxSummary } from '../lib/inbox';
import { keys, useMachineNames, useProjects, useTickets } from '../lib/queries';

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
      <TotpDialog
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
        onConfirm={async (code) => {
          if (!decision) return;
          await api.decideClaim(claim.id, decision, code);
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
    case 'ticket.stuck':
      return `Ticket đứng yên ${p.data.idleMinutes} phút ở ${STATUS_LABEL[p.data.status]}, không máy nào đang xử lý`;
    default:
      return p.type;
  }
}

/**
 * The owner's "needs me" list: takeover requests (approve or reject with TOTP), agents waiting for an
 * answer, cap and budget approvals, offline machines with the affected tickets, red health, unowned
 * projects, and the machine notice feed.
 */
export function InboxPage() {
  const inbox = useInboxSummary();
  const machines = useMachineNames();
  const projects = useProjects();
  const needsAnswer = inbox.needsInput.filter((t) => !t.budgetHold);
  const budgetHolds = inbox.needsInput.filter((t) => t.budgetHold);
  /** Unread count when the inbox was opened; those notices keep their dot during this visit. */
  const [readBefore, setReadBefore] = useState<number | null>(null);
  const actionCount = inbox.badge - inbox.unreadNotices;

  // Opening the inbox marks the notices as read, once they are loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mark once the notices are loaded
  useEffect(() => {
    if (readBefore !== null || inbox.notices.length === 0) return;
    setReadBefore(inbox.unreadNotices);
    inbox.markRead();
  }, [inbox.notices.length, readBefore]);

  const ticketItem = (ticket: (typeof inbox.needsInput)[number], text: string) => (
    <Item key={ticket.id} tone="warn">
      <TypeIcon type={ticket.type} />
      <Link to="/tickets/$ticketKey" params={{ ticketKey: ticket.key }} className="font-mono">
        {ticket.key}
      </Link>
      <span className="min-w-0 grow truncate">{ticket.title}</span>
      <StatusLozenge status={ticket.status} />
      <span className="w-full text-xs text-muted md:w-auto">{text}</span>
    </Item>
  );

  return (
    <div className="flex max-w-4xl flex-col gap-5 px-3 py-3 md:px-6 md:py-[18px]">
      <Breadcrumbs items={[{ label: 'Inbox' }]} />
      <h1 className="m-0 text-[22px] font-semibold">Inbox</h1>
      {inbox.isLoading && <p className="m-0 text-sm text-muted">Đang tải…</p>}
      {!inbox.isLoading && actionCount === 0 && (
        <p className="m-0 rounded-md border border-line bg-panel p-4 text-sm">
          Không có việc nào cần bạn xử lý.
        </p>
      )}

      <Group title="Yêu cầu chuyển máy cần duyệt" count={inbox.pendingClaims.length}>
        {inbox.pendingClaims.map((claim) => (
          <ClaimItem key={claim.id} claim={claim} machines={machines} />
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
      <Group title="Máy offline" count={inbox.offlineMachines.length}>
        {inbox.offlineMachines.map((m) => (
          <OfflineMachineItem key={m.id} machine={m} />
        ))}
      </Group>
      <Group title="Máy lỗi health" count={inbox.unhealthyMachines.length}>
        {inbox.unhealthyMachines.map((m) => (
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
      <Group title="Dự án chưa có máy" count={inbox.unownedProjects.length}>
        {inbox.unownedProjects.map((p) => (
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
        <h2 className="m-0 text-sm font-semibold">Thông báo từ máy</h2>
        {inbox.notices.length === 0 ? (
          <p className="m-0 text-sm text-muted">Chưa có thông báo.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-line2 rounded-md border border-line bg-panel p-0">
            {inbox.notices.map((event, index) => (
              <li key={event.id} className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm">
                <span
                  aria-hidden
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    index < (readBefore ?? 0) ? 'bg-accent' : 'bg-transparent',
                  )}
                />
                {index < (readBefore ?? 0) && <span className="sr-only">Chưa đọc:</span>}
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
