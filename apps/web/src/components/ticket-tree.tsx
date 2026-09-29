import type { Ticket } from '@crew/shared';
import { cn } from '../lib/cn';
import { isOpen } from '../lib/format';
import { AgentActivityMark } from './agent-activity';
import { ProjectBadge } from './project-badge';
import { RoleAvatar } from './role-avatar';
import { StatusLozenge } from './status-lozenge';
import { BUG_CYCLE_CAP, buildSubtaskTree } from './subtask-tree';
import { TypeIcon } from './type-icon';

export interface TicketTreeProps {
  /** The ticket whose descendants are shown (a request or a pm_task). */
  rootId: string;
  /** Every descendant, in any order; each hangs under its `parentId`. */
  items: readonly Ticket[];
  running?: ReadonlySet<string>;
  projectKeyOf: (ticket: Ticket) => string | undefined;
  onOpen: (key: string) => void;
}

function TreeRow({
  ticket,
  byId,
  running,
  projectKey,
  onOpen,
}: {
  ticket: Ticket;
  byId: ReadonlyMap<string, Ticket>;
  running: boolean;
  projectKey: string | undefined;
  onOpen: (key: string) => void;
}) {
  const waitingOn = ticket.dependsOn
    .map((id) => byId.get(id))
    .filter((dep): dep is Ticket => dep !== undefined && dep.status !== 'done');
  return (
    <button
      type="button"
      data-ticket-key={ticket.key}
      onClick={() => onOpen(ticket.key)}
      className="-mt-px flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-0.5 border border-line2 bg-panel px-2.5 py-1 text-left text-sm first:mt-0 hover:bg-soft sm:flex-nowrap"
    >
      <TypeIcon type={ticket.type} />
      <span className="shrink-0 font-mono text-xs text-muted">{ticket.key}</span>
      {projectKey && <ProjectBadge projectKey={projectKey} />}
      <span className="order-last min-w-0 basis-full truncate sm:order-none sm:basis-auto sm:grow">
        {ticket.title}
        {ticket.type === 'bug' && (
          <span className="ml-1 text-xs text-muted">
            (vòng {ticket.bugCycle}/{BUG_CYCLE_CAP})
          </span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {waitingOn.length > 0 && isOpen(ticket.status) ? (
          <StatusLozenge status="todo" label={`Chờ ${waitingOn.map((d) => d.key).join(', ')}`} />
        ) : (
          <StatusLozenge status={ticket.status} />
        )}
        <AgentActivityMark ticket={ticket} />
        <RoleAvatar
          agent={ticket.assigneeRole}
          size={22}
          running={running || ticket.agentActivity?.status === 'running'}
        />
      </span>
    </button>
  );
}

/**
 * "Cây ticket": the whole descendant tree of a request or pm_task — pm_tasks per project, then their
 * dev/qc/bug/docs_init children (dev↔QC pairs and bug chains grouped as in the subtask tree) — each row
 * with its project, status and agent activity. Closed tickets are included.
 */
export function TicketTree({ rootId, items, running = new Set(), projectKeyOf, onOpen }: TicketTreeProps) {
  const byId = new Map(items.map((t) => [t.id, t]));
  const childrenOf = new Map<string, Ticket[]>();
  for (const ticket of items) {
    if (!ticket.parentId) continue;
    const siblings = childrenOf.get(ticket.parentId);
    if (siblings) siblings.push(ticket);
    else childrenOf.set(ticket.parentId, [ticket]);
  }

  const node = (ticket: Ticket, depth: number) => (
    <div key={ticket.id}>
      <TreeRow
        ticket={ticket}
        byId={byId}
        running={running.has(ticket.id)}
        projectKey={projectKeyOf(ticket)}
        onOpen={onOpen}
      />
      {level(ticket.id, depth + 1)}
    </div>
  );

  function level(parentId: string, depth: number) {
    const kids = childrenOf.get(parentId);
    // The hierarchy is three levels deep; the bound only guards against a malformed cycle.
    if (!kids || depth > 4) return null;
    return (
      <ul
        aria-label={depth === 0 ? 'Cây ticket' : undefined}
        className={cn(
          'm-0 flex list-none flex-col p-0',
          depth === 0 ? 'gap-2' : 'mt-px ml-[22px] border-l-2 border-line pl-2.5',
        )}
      >
        {buildSubtaskTree(kids).map((group) => (
          <li key={group.ticket.id}>
            {node(group.ticket, depth)}
            {(group.qc.length > 0 || group.bugs.length > 0) && (
              <div className="ml-[22px] border-l-2 border-line pl-2.5">
                {group.qc.map((qc) => node(qc, depth))}
                {group.bugs.map((link) => (
                  <div key={link.bug.id}>
                    {node(link.bug, depth)}
                    {link.retest && (
                      <div className="ml-[22px] border-l-2 border-line pl-2.5">
                        {node(link.retest, depth)}
                      </div>
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

  return level(rootId, 0);
}
