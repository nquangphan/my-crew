/**
 * One ticket card on the map, following the owner-approved mockup: 280×48, dark neutral card, title line with a
 * status dot, then a secondary line (“level · status”, plus the pinned workflow when there is one). The dot is
 * decoration only: the status is always written in the secondary line and in the accessible label. The card is
 * a real `<button>` (Enter/Space open the shared ticket dialog, arrow keys move between cards). Steps with tasks
 * get an expand/collapse toggle and, when collapsed tasks have relations, a badge with their count. Handles
 * exist only so ReactFlow can attach edges; they are not connectable.
 */
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { Ticket, TicketStatus } from '../contracts/tickets.ts';
import { levelLabels, statusLabels } from '../tickets/status.ts';
import { cardHeight, cardWidth, type MapDirection } from './layout.ts';

export type TicketNodeData = {
  ticket: Ticket;
  isRoot: boolean;
  /** Fix task of a repair cycle (target of a repair link). */
  isFix: boolean;
  /** Number of child tasks a toggle would show; 0 means the node is not collapsible. */
  childCount: number;
  expanded: boolean;
  hiddenRelations: number;
  focused: boolean;
  actions: TicketNodeActions;
};
export type TicketNodeActions = {
  open(ticketId: string, trigger: HTMLElement): void;
  toggle(ticketId: string): void;
  navigate(ticketId: string, direction: MapDirection): void;
  focus(ticketId: string): void;
};
export type TicketFlowNode = Node<TicketNodeData, 'ticket'>;

/** Mockup palette: done green, active blue, waiting amber, not started grey. */
export const statusDotColors: Readonly<Record<TicketStatus, string>> = {
  done: '#3fb27f',
  running: '#4c9aff',
  needs_input: '#f0a24a',
  paused: '#f0a24a',
  pending: '#6b7280',
  ready: '#6b7280',
  cancelled: '#6b7280',
};

const workflowLabels: Readonly<Record<string, string>> = { bmad: 'BMAD', superpowers: 'Superpowers' };

const arrowKeys: Readonly<Record<string, MapDirection>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const cardStyle: CSSProperties = {
  position: 'relative',
  width: cardWidth,
  height: cardHeight,
  boxSizing: 'border-box',
  borderRadius: 4,
  background: '#1c1f23',
  color: '#e8e9eb',
  overflow: 'hidden',
};
const openStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 2,
  padding: '0 12px',
  minWidth: 0,
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};
const titleRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 };
const titleText: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const subline: CSSProperties = {
  fontSize: 11.5,
  color: '#9aa0a6',
  paddingLeft: 16,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const toggleStyle: CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 6,
  minHeight: 24,
  padding: '0 6px',
  font: 'inherit',
  fontSize: 11,
  color: '#9aa0a6',
  background: '#1c1f23',
  border: '1px solid #2b2f35',
  borderRadius: 4,
  cursor: 'pointer',
};
const badgeStyle: CSSProperties = {
  position: 'absolute',
  bottom: 3,
  right: 8,
  fontSize: 10.5,
  color: '#8ab4ff',
};
const hiddenHandle: CSSProperties = { opacity: 0, pointerEvents: 'none' };

export function ticketNodeLabel(ticket: Ticket): string {
  return `${levelLabels[ticket.level]}: ${ticket.title}. Trạng thái: ${statusLabels[ticket.status]}. Phiên bản ${ticket.revision}`;
}

/** Secondary line from producer fields only: level (or “Yêu cầu”/“Sửa”), pinned workflow, status. */
export function ticketSubline(ticket: Ticket, isRoot: boolean, isFix: boolean): string {
  const kind = isRoot ? 'Yêu cầu' : isFix ? 'Sửa' : levelLabels[ticket.level];
  const workflow = ticket.workflowPin ? workflowLabels[ticket.workflowPin.workflow] : undefined;
  return [kind, workflow, statusLabels[ticket.status]].filter(Boolean).join(' · ');
}

export function TicketNode({ data }: NodeProps<TicketFlowNode>) {
  const { ticket, isRoot, isFix, childCount, expanded, hiddenRelations, focused, actions } = data;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = arrowKeys[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    actions.navigate(ticket.id, direction);
  };
  const reserved = childCount > 0 ? 76 : hiddenRelations > 0 ? 40 : 12;
  return (
    <div
      style={{ ...cardStyle, border: focused ? '2px solid #8ab4ff' : '1px solid #2b2f35' }}
      data-level={ticket.level}
      data-root={isRoot ? '' : undefined}
      data-focused={focused ? 'true' : undefined}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={hiddenHandle} />
      <button
        type="button"
        className="nodrag nopan"
        style={{ ...openStyle, paddingRight: reserved }}
        data-map-node={ticket.id}
        data-revision={ticket.revision}
        aria-label={ticketNodeLabel(ticket)}
        onClick={(event) => actions.open(ticket.id, event.currentTarget)}
        onKeyDown={onKeyDown}
        onFocus={() => actions.focus(ticket.id)}
      >
        <span style={titleRow} data-line="title">
          <span
            aria-hidden="true"
            data-status-dot={ticket.status}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              flex: 'none',
              background: statusDotColors[ticket.status],
            }}
          />
          <span style={titleText}>{ticket.title}</span>
        </span>
        <span style={subline} data-line="meta">
          {ticketSubline(ticket, isRoot, isFix)}
        </span>
      </button>
      {childCount > 0 && (
        <button
          type="button"
          className="nodrag nopan"
          style={toggleStyle}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Thu gọn' : 'Mở'} công việc của ${ticket.title}`}
          onClick={() => actions.toggle(ticket.id)}
        >
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {childCount} việc
        </button>
      )}
      {hiddenRelations > 0 && (
        <span
          role="img"
          style={badgeStyle}
          aria-label={`${hiddenRelations} quan hệ tới công việc thu gọn`}
          title={`${hiddenRelations} quan hệ tới công việc thu gọn`}
        >
          ⇄ {hiddenRelations}
        </span>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} style={hiddenHandle} />
    </div>
  );
}
