/**
 * The three relation kinds of the map (owner-approved mockup), distinguishable without colour: parent links are
 * square 1px grey brackets 28px from the parent, dependencies are dashed blue with an arrow and the text “phải
 * xong trước”, repair links are dotted amber curves labelled “sửa vòng <cycle>”. A repair link usually joins the
 * same check step and fix task as a parent link, so it bows away from the bracket instead of hiding behind it.
 */
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
} from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { MapEdge } from './project.ts';

export type TicketEdgeData = { cycleId?: string };
export type TicketFlowEdge = Edge<TicketEdgeData, MapEdge['kind']>;

export const edgeColors = { parent: '#3a3f46', dependency: '#8ab4ff', repair: '#d4a72c' } as const;
const labelStyle: CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  padding: '0 3px',
  fontSize: 11,
  background: '#17191c',
  whiteSpace: 'nowrap',
};
/** Horizontal run from the parent to the vertical trunk of its bracket. */
const bracketRun = 28;
/** How far the repair curve bows below the straight line between its endpoints. */
const repairBow = 56;

function Label({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  return (
    <EdgeLabelRenderer>
      <span style={{ ...labelStyle, color, transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
        {text}
      </span>
    </EdgeLabelRenderer>
  );
}

export function ParentEdge(props: EdgeProps<TicketFlowEdge>) {
  const [path] = getSmoothStepPath({ ...props, borderRadius: 0, centerX: props.sourceX + bracketRun });
  return <BaseEdge path={path} style={{ stroke: edgeColors.parent, strokeWidth: 1 }} />;
}

export function DependencyEdge(props: EdgeProps<TicketFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath(props);
  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={props.markerEnd}
        style={{ stroke: edgeColors.dependency, strokeWidth: 1, strokeDasharray: '4 3' }}
      />
      <Label x={labelX} y={labelY} text="phải xong trước" color={edgeColors.dependency} />
    </>
  );
}

export function RepairEdge(props: EdgeProps<TicketFlowEdge>) {
  const { sourceX, sourceY, targetX, targetY } = props;
  const controlX = (sourceX + targetX) / 2;
  const controlY = Math.max(sourceY, targetY) + repairBow;
  const path = `M ${sourceX},${sourceY} Q ${controlX},${controlY} ${targetX},${targetY}`;
  // Midpoint of the quadratic curve (t = 0.5).
  const labelX = (sourceX + 2 * controlX + targetX) / 4;
  const labelY = (sourceY + 2 * controlY + targetY) / 4;
  const cycle = props.data?.cycleId?.slice(0, 8) ?? 'không rõ';
  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={props.markerEnd}
        style={{ stroke: edgeColors.repair, strokeWidth: 2, strokeDasharray: '2 3' }}
      />
      <Label x={labelX} y={labelY} text={`sửa vòng ${cycle}`} color={edgeColors.repair} />
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
