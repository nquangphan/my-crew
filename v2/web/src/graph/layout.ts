/**
 * Deterministic left→right hierarchy layout for the ticket map. Only parent edges shape the tree: columns follow
 * depth (card 280 + gap 56), leaves stack in sibling-ID order with a 10px row gap, and each parent sits in the
 * middle of its children. Dependency and repair edges are overlays and never move a node. Traversal is
 * iterative, so a pathological parent chain cannot overflow the stack; nodes unreachable from the root
 * (orphans, parent cycles) are laid out below the tree instead of being dropped.
 */
import type { Ticket } from '../contracts/tickets.ts';
import type { MapProjection } from './project.ts';

export type Point = { x: number; y: number };
/** Density of the owner-approved mockup: 280×48 two-line cards, 10px rows, 56px between columns. */
export const cardWidth = 280;
export const cardHeight = 48;
export const columnGap = 56;
export const rowGap = 10;
const column = cardWidth + columnGap;
const pitch = cardHeight + rowGap;
const levelDepth: Record<Ticket['level'], number> = { request: 0, step: 1, task: 2 };

type Tree = { parent: Map<string, string>; children: Map<string, string[]> };

function tree(input: MapProjection): Tree {
  const visible = new Set(input.nodes.map((row) => row.id));
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const edge of input.edges) {
    if (edge.kind !== 'parent' || !visible.has(edge.source) || !visible.has(edge.target)) continue;
    parent.set(edge.target, edge.source);
    const list = children.get(edge.source);
    if (list) list.push(edge.target);
    else children.set(edge.source, [edge.target]);
  }
  for (const list of children.values()) list.sort();
  return { parent, children };
}

export function layoutHierarchy(input: MapProjection): Record<string, Point> {
  const { parent, children } = tree(input);
  const positions: Record<string, Point> = {};
  const visited = new Set<string>();
  let cursor = 0;

  const place = (start: string, startDepth: number) => {
    type Frame = { id: string; depth: number; next: number; placed: string[] };
    const stack: Frame[] = [{ id: start, depth: startDepth, next: 0, placed: [] }];
    visited.add(start);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as Frame;
      const list = children.get(frame.id) ?? [];
      if (frame.next < list.length) {
        const child = list[frame.next++] as string;
        if (visited.has(child)) continue;
        visited.add(child);
        frame.placed.push(child);
        stack.push({ id: child, depth: frame.depth + 1, next: 0, placed: [] });
        continue;
      }
      stack.pop();
      const x = frame.depth * column;
      const first = frame.placed[0];
      const last = frame.placed[frame.placed.length - 1];
      if (first === undefined || last === undefined) {
        positions[frame.id] = { x, y: cursor };
        cursor += pitch;
      } else {
        positions[frame.id] = { x, y: ((positions[first]?.y ?? 0) + (positions[last]?.y ?? 0)) / 2 };
      }
    }
  };

  const byId = new Map(input.nodes.map((row) => [row.id, row]));
  if (byId.has(input.rootId)) place(input.rootId, 0);
  const rest = input.nodes.filter((row) => !visited.has(row.id));
  if (rest.length > 0 && cursor > 0) cursor += pitch;
  for (const row of rest) {
    if (visited.has(row.id)) continue;
    // Climb to the top of this detached fragment; the walk stops on a parent cycle.
    const seen = new Set([row.id]);
    let top = row.id;
    for (
      let up = parent.get(top);
      up !== undefined && !visited.has(up) && !seen.has(up);
      up = parent.get(up)
    ) {
      seen.add(up);
      top = up;
    }
    place(top, levelDepth[byId.get(top)?.level ?? 'request']);
  }
  return positions;
}

export type MapDirection = 'left' | 'right' | 'up' | 'down';

/** Arrow-key traversal: left = parent, right = first child (top-most), up/down = nearest node in the column. */
export function neighbourInDirection(
  input: MapProjection,
  positions: Readonly<Record<string, Point>>,
  id: string,
  direction: MapDirection,
): string | null {
  const { parent, children } = tree(input);
  const here = positions[id];
  if (!here) return null;
  if (direction === 'left') {
    const up = parent.get(id);
    return up !== undefined && positions[up] ? up : null;
  }
  const order = (a: string, b: string) =>
    (positions[a]?.y ?? 0) - (positions[b]?.y ?? 0) || (a < b ? -1 : a > b ? 1 : 0);
  if (direction === 'right')
    return (children.get(id) ?? []).filter((child) => positions[child]).sort(order)[0] ?? null;
  const sameColumn = input.nodes
    .map((row) => row.id)
    .filter((other) => other !== id && positions[other]?.x === here.x)
    .sort(order);
  const above = sameColumn.filter((other) => (positions[other]?.y ?? 0) < here.y);
  const below = sameColumn.filter((other) => (positions[other]?.y ?? 0) > here.y);
  return (direction === 'up' ? above[above.length - 1] : below[0]) ?? null;
}

export type Viewport = { x: number; y: number; zoom: number };

/** Viewport that keeps a node moved from `from` to `to` (flow coordinates) at the same screen position. */
export function followAnchor(from: Point, to: Point, viewport: Viewport): Viewport {
  return {
    x: viewport.x - (to.x - from.x) * viewport.zoom,
    y: viewport.y - (to.y - from.y) * viewport.zoom,
    zoom: viewport.zoom,
  };
}

/** Opening view of a root seen for the first time: 1:1, root 24px from the left edge, centred vertically. */
export function initialViewport(root: Point | undefined, frameHeight: number): Viewport {
  if (!root) return { x: 24, y: 24, zoom: 1 };
  return { x: 24 - root.x, y: frameHeight / 2 - (root.y + cardHeight / 2), zoom: 1 };
}

export type Frame = { width: number; height: number };

/**
 * Anchor of a realtime relayout, i.e. what the owner is looking at: the focused card if it is inside the frame,
 * otherwise the card whose centre is nearest the frame centre, otherwise the root. Only cards present before
 * and after the change qualify. Positions are flow coordinates of the layout the owner was looking at.
 */
export function chooseRealtimeAnchor(input: {
  positions: Readonly<Record<string, Point>>;
  viewport: Viewport;
  frame: Frame;
  focusedId: string | null;
  rootId: string;
  present: ReadonlySet<string>;
}): string | null {
  const { positions, viewport, frame, focusedId, rootId, present } = input;
  const centre = (id: string) => {
    const at = positions[id] as Point;
    return {
      x: (at.x + cardWidth / 2) * viewport.zoom + viewport.x,
      y: (at.y + cardHeight / 2) * viewport.zoom + viewport.y,
    };
  };
  const inView = (id: string) => {
    const point = centre(id);
    return point.x >= 0 && point.x <= frame.width && point.y >= 0 && point.y <= frame.height;
  };
  const candidates = Object.keys(positions).filter((id) => present.has(id));
  if (focusedId !== null && candidates.includes(focusedId) && inView(focusedId)) return focusedId;
  let best: { id: string; distance: number } | null = null;
  for (const id of candidates.filter(inView).sort()) {
    const point = centre(id);
    const distance = Math.hypot(point.x - frame.width / 2, point.y - frame.height / 2);
    if (!best || distance < best.distance) best = { id, distance };
  }
  if (best) return best.id;
  return present.has(rootId) && positions[rootId] ? rootId : null;
}

/** Orthogonal route of a dependency/repair edge, plus where its label would sit. */
export type SideRoute = { points: Point[]; label: Point };
/** Horizontal run from a parent card to the vertical trunk of its bracket (mirrors the parent edge renderer). */
export const bracketRun = 28;
const laneStep = 6;
const maxLanes = 6;

/**
 * X offset of a lane inside a column gap. Offsets skip the parent-bracket trunk (`bracketRun`) so a vertical
 * run never sits on a bracket body; the highest lane still stays inside the gap (10 + maxLanes * laneStep ≤ gap).
 */
const laneOffset = (lane: number) => {
  const offset = 10 + lane * laneStep;
  return offset >= bracketRun ? offset + laneStep : offset;
};

/**
 * Short orthogonal routes like the mockup, never diagonal across a column: within one column the edge leaves
 * and enters on the right edges and runs down the gap to the right; across columns it runs down the gap
 * between the two columns. Overlapping vertical runs in one gap get separate lanes (6px apart, skipping the
 * bracket trunk).
 */
export function sideRoutes(
  edges: readonly { id: string; source: string; target: string; kind: string }[],
  positions: Readonly<Record<string, Point>>,
): Record<string, SideRoute> {
  type Run = { id: string; gap: number; top: number; bottom: number; s: Point; t: Point };
  const runs: Run[] = [];
  for (const edge of [...edges].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const s = positions[edge.source];
    const t = positions[edge.target];
    if (!s || !t) continue;
    const gap = s.x === t.x ? s.x + cardWidth : Math.min(s.x, t.x) + cardWidth;
    const sy = s.y + cardHeight / 2;
    const ty = t.y + cardHeight / 2;
    runs.push({ id: edge.id, gap, top: Math.min(sy, ty), bottom: Math.max(sy, ty), s, t });
  }
  const lanesByGap = new Map<number, number[]>();
  const routes: Record<string, SideRoute> = {};
  for (const run of runs.sort((a, b) => a.gap - b.gap || a.top - b.top || (a.id < b.id ? -1 : 1))) {
    const lanes = lanesByGap.get(run.gap) ?? [];
    let lane = lanes.findIndex((bottom) => bottom < run.top);
    if (lane < 0) lane = lanes.length < maxLanes ? lanes.length : lanes.indexOf(Math.min(...lanes));
    lanes[lane] = run.bottom;
    lanesByGap.set(run.gap, lanes);
    const x = run.gap + laneOffset(lane);
    const sy = run.s.y + cardHeight / 2;
    const ty = run.t.y + cardHeight / 2;
    const sameColumn = run.s.x === run.t.x;
    const startX = sameColumn || run.s.x < run.t.x ? run.s.x + cardWidth : run.s.x;
    const endX = sameColumn || run.t.x < run.s.x ? run.t.x + cardWidth : run.t.x;
    routes[run.id] = {
      points: [
        { x: startX, y: sy },
        { x, y: sy },
        { x, y: ty },
        { x: endX, y: ty },
      ],
      label: { x: x + 4, y: (sy + ty) / 2 },
    };
  }
  return routes;
}

export type LabelBox = { id: string; x: number; y: number; width: number; height: number };
const labelHeight = 14;
const labelStep = 16;

/**
 * Visible edge labels without overlaps: labels of the focused card are always shown (moved down until free of
 * other labels); any other label is shown only where it covers neither a card nor another label (it may slide
 * up or down a little), otherwise it is left to the edge's accessible label.
 */
export function placeEdgeLabels(
  labels: readonly { id: string; at: Point; text: string; endpoints: readonly string[] }[],
  positions: Readonly<Record<string, Point>>,
  focusedId: string | null,
): LabelBox[] {
  const cards = Object.values(positions).map((at) => ({
    x: at.x,
    y: at.y,
    width: cardWidth,
    height: cardHeight,
  }));
  const hit = (a: Omit<LabelBox, 'id'>, b: Omit<LabelBox, 'id'>) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const placed: LabelBox[] = [];
  const own = (label: (typeof labels)[number]) => focusedId !== null && label.endpoints.includes(focusedId);
  const ordered = [...labels].sort(
    (a, b) => Number(own(b)) - Number(own(a)) || a.at.y - b.at.y || (a.id < b.id ? -1 : 1),
  );
  for (const label of ordered) {
    const width = label.text.length * 6 + 6;
    const box = (dy: number) => ({
      x: label.at.x,
      y: label.at.y - labelHeight / 2 + dy,
      width,
      height: labelHeight,
    });
    if (own(label)) {
      let dy = 0;
      while (placed.some((other) => hit(box(dy), other))) dy += labelStep;
      placed.push({ id: label.id, ...box(dy) });
      continue;
    }
    const offset = [0, labelStep, -labelStep, 2 * labelStep, -2 * labelStep].find(
      (dy) => !cards.some((card) => hit(box(dy), card)) && !placed.some((other) => hit(box(dy), other)),
    );
    if (offset !== undefined) placed.push({ id: label.id, ...box(offset) });
  }
  return placed;
}
