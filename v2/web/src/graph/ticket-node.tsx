/**
 * One ticket card on the map. The card is a real `<button>` (Enter/Space open the shared ticket dialog, arrow
 * keys move between cards), labelled with level, title, status text and revision; status is shown as icon plus
 * text, never by colour alone. Steps with tasks get an expand/collapse toggle and a badge with the number of
 * dependency/repair relations that touch their collapsed tasks. Handles exist only so ReactFlow can attach
 * edges; they are not connectable.
 */
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { Ticket } from '../contracts/tickets.ts';
import { levelLabels, statusIcons, statusLabels } from '../tickets/status.ts';
import { cardHeight, cardWidth, type MapDirection } from './layout.ts';

export type TicketNodeData = {
  ticket: Ticket;
  isRoot: boolean;
  /** Number of child tasks a toggle would show; 0 means the node is not collapsible. */
  childCount: number;
  expanded: boolean;
  hiddenRelations: number;
  actions: TicketNodeActions;
};
export type TicketNodeActions = {
  open(ticketId: string, trigger: HTMLElement): void;
  toggle(ticketId: string): void;
  navigate(ticketId: string, direction: MapDirection): void;
  focus(ticketId: string): void;
};
export type TicketFlowNode = Node<TicketNodeData, 'ticket'>;

const arrowKeys: Readonly<Record<string, MapDirection>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const cardStyle: CSSProperties = {
  width: cardWidth,
  height: cardHeight,
  boxSizing: 'border-box',
  overflow: 'hidden',
  display: 'grid',
  gridTemplateRows: '1fr auto',
  gap: '0.25rem',
  padding: '0.5rem 0.65rem',
  borderRadius: '0.6rem',
  border: '1px solid #64748b',
  background: '#172235',
  color: '#e7edf7',
  fontSize: '0.85rem',
};
const openStyle: CSSProperties = {
  display: 'grid',
  gap: '0.15rem',
  minWidth: 0,
  padding: 0,
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};
const titleStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '0.95rem',
};
const footerStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' };
const smallButton: CSSProperties = {
  font: 'inherit',
  fontSize: '0.8rem',
  padding: '0.1rem 0.45rem',
  borderRadius: '0.4rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};
const hiddenHandle: CSSProperties = { opacity: 0, pointerEvents: 'none' };

export function ticketNodeLabel(ticket: Ticket): string {
  return `${levelLabels[ticket.level]}: ${ticket.title}. Trạng thái: ${statusLabels[ticket.status]}. Phiên bản ${ticket.revision}`;
}

export function TicketNode({ data }: NodeProps<TicketFlowNode>) {
  const { ticket, isRoot, childCount, expanded, hiddenRelations, actions } = data;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = arrowKeys[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    actions.navigate(ticket.id, direction);
  };
  return (
    <div
      style={{ ...cardStyle, borderWidth: isRoot ? 2 : 1 }}
      data-level={ticket.level}
      data-root={isRoot ? '' : undefined}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={hiddenHandle} />
      <button
        type="button"
        className="nodrag nopan"
        style={openStyle}
        data-map-node={ticket.id}
        data-revision={ticket.revision}
        aria-label={ticketNodeLabel(ticket)}
        onClick={(event) => actions.open(ticket.id, event.currentTarget)}
        onKeyDown={onKeyDown}
        onFocus={() => actions.focus(ticket.id)}
      >
        <span aria-hidden="true">
          {isRoot ? 'Yêu cầu gốc' : levelLabels[ticket.level]} · Phiên bản {ticket.revision}
        </span>
        <strong style={titleStyle} aria-hidden="true">
          {ticket.title}
        </strong>
        <span aria-hidden="true" data-status={ticket.status}>
          {statusIcons[ticket.status]} {statusLabels[ticket.status]}
        </span>
      </button>
      <div style={footerStyle}>
        {childCount > 0 && (
          <button
            type="button"
            className="nodrag nopan"
            style={smallButton}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Thu gọn' : 'Mở'} công việc của ${ticket.title}`}
            onClick={() => actions.toggle(ticket.id)}
          >
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {childCount} công việc
          </button>
        )}
        {hiddenRelations > 0 && <span>{`${hiddenRelations} quan hệ tới công việc thu gọn`}</span>}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} style={hiddenHandle} />
    </div>
  );
}
