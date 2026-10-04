/**
 * The three relation kinds of the map (owner-approved mockup), distinguishable without colour: parent links are
 * square 1px grey brackets 28px from the parent; dependencies (dashed blue, arrow, “phải xong trước”) and repair
 * links (dotted amber, “sửa vòng <cycle>”) are short orthogonal runs beside the cards (`sideRoutes`), never
 * diagonals across a column. Labels are placed by `placeEdgeLabels` so they never overlap; a label without room
 * is omitted and the relation stays readable through the edge's accessible label and the relations panel.
 */
import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { Point } from './layout.ts';
import type { MapEdge } from './project.ts';

export type TicketEdgeData = {
  cycleId?: string;
  /** Orthogonal route in flow coordinates (dependency/repair). */
  points?: Point[];
  /** Top-left corner of the label when it is shown. */
  label?: Point | null;
};
export type TicketFlowEdge = Edge<TicketEdgeData, MapEdge['kind']>;

export const edgeColors = { parent: '#3a3f46', dependency: '#8ab4ff', repair: '#d4a72c' } as const;
const labelStyle: CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  padding: '0 3px',
  fontSize: 11,
  lineHeight: '14px',
  background: '#17191c',
  whiteSpace: 'nowrap',
};
/** Horizontal run from the parent to the vertical trunk of its bracket. */
const bracketRun = 28;

function Label({ at, text, color }: { at: Point; text: string; color: string }) {
  return (
    <EdgeLabelRenderer>
      <span style={{ ...labelStyle, color, transform: `translate(${at.x}px, ${at.y}px)` }}>{text}</span>
    </EdgeLabelRenderer>
  );
}

function routePath(props: EdgeProps<TicketFlowEdge>): string {
  const points = props.data?.points;
  if (points && points.length > 1)
    return points.map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
  return `M ${props.sourceX},${props.sourceY} L ${props.targetX},${props.targetY}`;
}

export function ParentEdge(props: EdgeProps<TicketFlowEdge>) {
  const [path] = getSmoothStepPath({ ...props, borderRadius: 0, centerX: props.sourceX + bracketRun });
  return <BaseEdge path={path} style={{ stroke: edgeColors.parent, strokeWidth: 1 }} />;
}

export function DependencyEdge(props: EdgeProps<TicketFlowEdge>) {
  const label = props.data?.label;
  return (
    <>
      <BaseEdge
        path={routePath(props)}
        markerEnd={props.markerEnd}
        style={{ stroke: edgeColors.dependency, strokeWidth: 1, strokeDasharray: '4 3' }}
      />
      {label && <Label at={label} text="phải xong trước" color={edgeColors.dependency} />}
    </>
  );
}

export function repairLabel(cycleId: string | undefined): string {
  return `sửa vòng ${cycleId?.slice(0, 8) ?? 'không rõ'}`;
}

export function RepairEdge(props: EdgeProps<TicketFlowEdge>) {
  const label = props.data?.label;
  return (
    <>
      <BaseEdge
        path={routePath(props)}
        markerEnd={props.markerEnd}
        style={{ stroke: edgeColors.repair, strokeWidth: 2, strokeDasharray: '2 3' }}
      />
      {label && <Label at={label} text={repairLabel(props.data?.cycleId)} color={edgeColors.repair} />}
    </>
  );
}

export const ticketEdgeTypes = { parent: ParentEdge, dependency: DependencyEdge, repair: RepairEdge };

const kindLabels: Record<MapEdge['kind'], string> = {
  parent: 'thuộc',
  dependency: 'phải xong trước',
  repair: 'vòng sửa',
};

/** Accessible description of one relation, e.g. “Bước A phải xong trước Bước B”. */
export function edgeLabel(edge: MapEdge, titleOf: (id: string) => string): string {
  if (edge.kind === 'parent') return `${titleOf(edge.target)} ${kindLabels.parent} ${titleOf(edge.source)}`;
  if (edge.kind === 'dependency')
    return `${titleOf(edge.source)} ${kindLabels.dependency} ${titleOf(edge.target)}`;
  return `${titleOf(edge.target)} sửa cho ${titleOf(edge.source)}, ${kindLabels.repair} ${edge.cycleId ?? ''}`.trim();
}
