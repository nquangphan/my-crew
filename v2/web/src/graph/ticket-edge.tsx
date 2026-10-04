/**
 * The three relation kinds of the map, distinguishable without colour: parent links are solid neutral
 * step lines, dependencies are dashed with an arrow and the text “phải xong trước”, repair links are curved
 * dotted lines labelled with their cycle. A repair link usually joins the same check step and fix task as a
 * parent link, so it bends away from the straight parent line instead of hiding behind it.
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

const neutral = '#94a3b8';
const labelStyle: CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  padding: '0.05rem 0.35rem',
  borderRadius: '0.35rem',
  fontSize: '0.75rem',
  background: '#101827',
  color: '#e7edf7',
  border: `1px solid ${neutral}`,
  whiteSpace: 'nowrap',
};
/** How far the repair curve bows below the straight line between its endpoints. */
const repairBow = 56;

function Label({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <EdgeLabelRenderer>
      <span style={{ ...labelStyle, transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
        {text}
      </span>
    </EdgeLabelRenderer>
  );
}

export function ParentEdge(props: EdgeProps<TicketFlowEdge>) {
  const [path] = getSmoothStepPath(props);
  return <BaseEdge path={path} style={{ stroke: neutral, strokeWidth: 1.5 }} />;
}

export function DependencyEdge(props: EdgeProps<TicketFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath(props);
  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={props.markerEnd}
        style={{ stroke: '#e2e8f0', strokeWidth: 1.5, strokeDasharray: '8 5' }}
      />
      <Label x={labelX} y={labelY} text="phải xong trước" />
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
        style={{ stroke: '#fcd34d', strokeWidth: 1.5, strokeDasharray: '2 4' }}
      />
      <Label x={labelX} y={labelY} text={`Vòng sửa ${cycle}`} />
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
