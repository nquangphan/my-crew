import type { Ticket } from '@crew/shared';
import { cn } from '../lib/cn';
import { isOpen } from '../lib/format';
import { RoleAvatar } from './role-avatar';
import { StatusLozenge } from './status-lozenge';
import { TypeIcon } from './type-icon';

/** The QC bug loop stops after this many cycles per dev ticket (the server enforces it). */
export const BUG_CYCLE_CAP = 3;

export interface BugLink {
  bug: Ticket;
  /** The paired QC retest of the bug. */
  retest: Ticket | null;
}

export interface SubtaskGroup {
  ticket: Ticket;
  /** QC tickets paired with this one (dev↔QC). */
  qc: Ticket[];
  /** The bug chain filed against this dev ticket, by cycle. */
  bugs: BugLink[];
}

const byCreated = (a: Ticket, b: Ticket) => a.createdAt.localeCompare(b.createdAt);

/**
 * Groups sibling tickets into dev↔QC pairs with their bug chains: each bug hangs under its root dev
 * ticket (`originDevId`) with its retest QC (`pairsWith` = the bug). Anything unattached stays a root.
 */
export function buildSubtaskTree(tickets: readonly Ticket[]): SubtaskGroup[] {
  const ids = new Set(tickets.map((t) => t.id));
  const qcFor = (id: string) => tickets.filter((t) => t.type === 'qc' && t.pairsWith === id).sort(byCreated);

  const groups: SubtaskGroup[] = [];
  for (const ticket of [...tickets].sort(byCreated)) {
    if (ticket.type === 'qc' && ticket.pairsWith && ids.has(ticket.pairsWith)) continue;
    if (ticket.type === 'bug' && ticket.originDevId && ids.has(ticket.originDevId)) continue;
    const qc = qcFor(ticket.id);
    const bugs = tickets
      .filter((t) => t.type === 'bug' && t.originDevId === ticket.id)
      .sort((a, b) => a.bugCycle - b.bugCycle || byCreated(a, b))
      .map((bug) => ({ bug, retest: qcFor(bug.id)[0] ?? null }));
    groups.push({ ticket, qc, bugs });
  }
  return groups;
}

function Row({
  ticket,
  siblings,
  running,
  highlight,
  onOpen,
}: {
  ticket: Ticket;
  siblings: Map<string, Ticket>;
  running: Set<string>;
  highlight?: string;
  onOpen: (key: string) => void;
}) {
  const waitingOn = ticket.dependsOn
    .map((id) => siblings.get(id))
    .filter((dep): dep is Ticket => dep !== undefined && dep.status !== 'done');
  return (
    <button
      type="button"
      onClick={() => onOpen(ticket.key)}
      aria-current={highlight === ticket.id ? 'true' : undefined}
      className={cn(
        '-mt-px flex min-h-11 w-full items-center gap-2 border border-line2 bg-panel px-2.5 text-left text-sm first:mt-0 hover:bg-soft',
        highlight === ticket.id && 'outline-2 -outline-offset-2 outline-accent',
      )}
    >
      <TypeIcon type={ticket.type} />
      <span className="shrink-0 font-mono text-xs text-muted">{ticket.key}</span>
      <span className="min-w-0 grow truncate">
        {ticket.title}
        {ticket.type === 'bug' && (
          <span className="ml-1 text-xs text-muted">
            (vòng {ticket.bugCycle}/{BUG_CYCLE_CAP})
          </span>
        )}
      </span>
      {waitingOn.length > 0 && isOpen(ticket.status) ? (
        <StatusLozenge status="todo" label={`Chờ ${waitingOn.map((d) => d.key).join(', ')}`} />
      ) : (
        <StatusLozenge status={ticket.status} />
      )}
      <RoleAvatar
        agent={ticket.assigneeRole}
        size={24}
        running={running.has(ticket.id)}
        className="max-sm:hidden"
      />
    </button>
  );
}

/** Child issues: dev↔QC pairs, the bug chain with its cycle, and dependency waits. */
export function SubtaskTree({
  tickets,
  running = new Set(),
  highlightId,
  onOpen,
}: {
  tickets: readonly Ticket[];
  running?: Set<string>;
  highlightId?: string;
  onOpen: (key: string) => void;
}) {
  const siblings = new Map(tickets.map((t) => [t.id, t]));
  const groups = buildSubtaskTree(tickets);
  const row = (ticket: Ticket) => (
    <Row
      key={ticket.id}
      ticket={ticket}
      siblings={siblings}
      running={running}
      highlight={highlightId}
      onOpen={onOpen}
    />
  );
  return (
    <ul aria-label="Ticket con" className="m-0 flex list-none flex-col gap-2 p-0">
      {groups.map((group) => (
        <li key={group.ticket.id}>
          {row(group.ticket)}
          {(group.qc.length > 0 || group.bugs.length > 0) && (
            <div className="ml-[22px] border-l-2 border-line pl-2.5">
              {group.qc.map(row)}
              {group.bugs.map((link) => (
                <div key={link.bug.id}>
                  {row(link.bug)}
                  {link.retest && (
                    <div className="ml-[22px] border-l-2 border-line pl-2.5">{row(link.retest)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
