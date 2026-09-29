import type { Machine, Project, Ticket, TicketPriority, TicketStatus } from '@crew/shared';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '../lib/cn';
import {
  formatFullDateTime,
  formatRelative,
  formatUsd,
  PRIORITIES,
  PRIORITY_META,
  ROLE_META,
} from '../lib/format';
import { RoleAvatar, Spinner } from './role-avatar';
import { StatusDropdown } from './status-dropdown';
import { PriorityArrow } from './status-lozenge';

export interface DetailsBoxProps {
  ticket: Ticket;
  parent: Ticket | null;
  /** Siblings, to show dependencies by key. */
  siblings: readonly Ticket[];
  machine: Machine | undefined;
  project: Project | undefined;
  running: boolean;
  onStatus: (to: TicketStatus) => void;
  onPriority: (priority: TicketPriority) => void;
  busy?: boolean;
  /** Phone layout: a one-line summary that expands into the full box. */
  collapsible?: boolean;
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="m-0 text-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </>
  );
}

/** Budget the ticket's cost counts against: the project's tree budget for pm_tasks and their children. */
function budgetOf(ticket: Ticket, project: Project | undefined): number | null {
  if (!project || ticket.type === 'request') return null;
  return project.ticketTreeBudgetUsd;
}

const modelText = (model: string | null, effort: string | null) =>
  model ? `${model}${effort ? ` · ${effort}` : ''}` : '—';

/**
 * The Jira "Details" box: status (legal owner moves only), assignee role and machine, priority, planned
 * and actual model, complexity and the PM's reason for it, required skills and MCP servers, dependencies, cost against budget, and
 * timestamps.
 */
export function DetailsBox(props: DetailsBoxProps) {
  const { ticket, parent, siblings, machine, project, running, onStatus, onPriority, busy, collapsible } =
    props;
  const [expanded, setExpanded] = useState(false);
  const budget = budgetOf(ticket, project);
  const deps = ticket.dependsOn.map((id) => siblings.find((s) => s.id === id)?.key ?? id.slice(0, 8));
  const role = ROLE_META[ticket.assigneeRole];

  const status = <StatusDropdown status={ticket.status} onSelect={onStatus} disabled={busy} />;

  const full = (
    <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2.5 px-3.5 py-3 text-[13px] xl:grid-cols-[130px_minmax(0,1fr)]">
      {!collapsible && <Item label="Trạng thái">{status}</Item>}
      <Item label="Người xử lý">
        <span className="flex items-center gap-2">
          <RoleAvatar agent={ticket.assigneeRole} size={22} running={running} />
          {role.label}
        </span>
      </Item>
      <Item label="Máy">{machine ? machine.name : <span className="text-muted">Chưa có máy</span>}</Item>
      {parent && (
        <Item label={parent.type === 'request' ? 'Request gốc' : 'Ticket cha'}>
          <Link to="/tickets/$ticketKey" params={{ ticketKey: parent.key }} className="font-mono">
            {parent.key}
          </Link>
        </Item>
      )}
      <Item label="Ưu tiên">
        <span className="flex items-center gap-1.5">
          <PriorityArrow priority={ticket.priority} />
          <select
            aria-label="Ưu tiên"
            value={ticket.priority}
            disabled={busy}
            onChange={(e) => onPriority(e.target.value as TicketPriority)}
            className="min-h-11 rounded border border-transparent bg-transparent px-1 text-[13px] hover:border-line xl:min-h-7"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </select>
        </span>
      </Item>
      <Item label="Độ phức tạp">
        {ticket.complexity ?? '—'}
        {ticket.complexityReason && (
          <span className="block text-xs text-muted">Lý do: {ticket.complexityReason}</span>
        )}
      </Item>
      <Item label="Model">
        {modelText(ticket.model, ticket.effort)}
        {ticket.agentModel && (
          <span className="block text-xs text-muted">
            Lượt chạy gần nhất: {modelText(ticket.agentModel, ticket.agentEffort)}
          </span>
        )}
      </Item>
      <Item label="Skill bắt buộc">
        {ticket.requiredSkills.length > 0 ? (
          <span className="font-mono text-xs">{ticket.requiredSkills.join(', ')}</span>
        ) : (
          '—'
        )}
      </Item>
      <Item label="MCP bắt buộc">
        {ticket.requiredMcps.length > 0 ? (
          <span className="font-mono text-xs">{ticket.requiredMcps.join(', ')}</span>
        ) : (
          '—'
        )}
      </Item>
      <Item label="Phụ thuộc">
        {deps.length > 0 ? <span className="font-mono">{deps.join(', ')}</span> : '—'}
      </Item>
      <Item label="Chi phí">
        {formatUsd(ticket.costUsd)}
        {budget !== null && <span className="text-muted"> / ngân sách {formatUsd(budget)}</span>}
        {ticket.budgetHold && (
          <span className="block text-xs text-bad">Đang chờ bạn duyệt vượt giới hạn</span>
        )}
      </Item>
      {ticket.allowConfigChange && <Item label="Config">Cho phép sửa config</Item>}
      <Item label="Tạo lúc">{formatFullDateTime(ticket.createdAt)}</Item>
      <Item label="Cập nhật">
        <time dateTime={ticket.updatedAt} title={formatFullDateTime(ticket.updatedAt)}>
          {formatRelative(ticket.updatedAt)}
        </time>
      </Item>
    </dl>
  );

  if (collapsible) {
    return (
      <section aria-label="Chi tiết" className="rounded-md border border-line2 bg-panel">
        <div className="flex flex-wrap items-center gap-2 p-2.5 text-[13px]">
          {status}
          <span>
            {role.short}
            {ticket.model ? ` · ${ticket.model}` : ''}
          </span>
          {ticket.complexity && <span>{ticket.complexity}</span>}
          <span>{formatUsd(ticket.costUsd)}</span>
          {running && <Spinner label="Agent đang chạy" />}
          <span className="grow" />
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex min-h-11 items-center gap-1 text-accent"
          >
            Chi tiết {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          </button>
        </div>
        {expanded && <div className="border-t border-line2">{full}</div>}
      </section>
    );
  }

  return (
    <section aria-label="Chi tiết" className={cn('rounded-md border border-line bg-panel')}>
      <h2 className="m-0 border-b border-line2 px-3.5 py-2.5 text-[13px] font-bold">Chi tiết</h2>
      {full}
    </section>
  );
}
