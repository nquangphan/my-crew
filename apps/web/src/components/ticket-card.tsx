import type { Ticket } from '@crew/shared';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '../lib/cn';
import { RoleAvatar } from './role-avatar';
import { PriorityArrow, StatusLozenge } from './status-lozenge';
import { TypeIcon } from './type-icon';

export interface TicketCardProps {
  ticket: Ticket;
  selected?: boolean;
  /** Keyboard (`j`/`k`) cursor. */
  focused?: boolean;
  running?: boolean;
  onOpen?: (ticket: Ticket) => void;
}

/** A board card's face: type icon, key, title, priority, assignee role (spinner while running), badges. */
export function TicketCardFace({ ticket, running }: { ticket: Ticket; running?: boolean }) {
  const badge =
    ticket.status === 'needs_input' ? (
      <StatusLozenge status="needs_input" />
    ) : ticket.status === 'blocked' ? (
      <StatusLozenge status="blocked" />
    ) : null;
  return (
    <>
      <span className="text-sm leading-[1.35] break-words md:text-sm">{ticket.title}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1.5">
          <TypeIcon type={ticket.type} />
          <span className="font-mono text-xs whitespace-nowrap text-muted">{ticket.key}</span>
          <PriorityArrow priority={ticket.priority} />
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {ticket.budgetHold && <StatusLozenge status="blocked" label="Vượt giới hạn" />}
          {badge}
          <RoleAvatar agent={ticket.assigneeRole} size={26} running={running} />
        </span>
      </span>
    </>
  );
}

/**
 * Draggable board card. Mouse drags start after 6 px, touch drags after a long press, so taps open the
 * ticket and swipes scroll the board.
 */
export function TicketCard({ ticket, selected, focused, running, onOpen }: TicketCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: ticket.id,
    data: { ticket },
  });
  const attention = ticket.status === 'needs_input' || ticket.status === 'blocked';
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-ticket-key={ticket.key}
      {...listeners}
      aria-roledescription={attributes['aria-roledescription']}
      aria-describedby={attributes['aria-describedby']}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${ticket.key}: ${ticket.title}`}
      onClick={() => onOpen?.(ticket)}
      className={cn(
        'flex w-full min-h-11 touch-manipulation flex-col gap-2 rounded-md border border-line bg-panel px-3 py-2.5 text-left hover:border-accent',
        selected && 'outline-2 -outline-offset-1 outline-accent',
        focused && !selected && 'ring-2 ring-accent/50',
        attention && 'max-md:outline-2 max-md:-outline-offset-1 max-md:outline-warn-line',
        isDragging && 'opacity-40',
      )}
    >
      <TicketCardFace ticket={ticket} running={running} />
    </button>
  );
}
