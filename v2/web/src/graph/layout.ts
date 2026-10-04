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

/**
 * Any change of the visible tree (owner expand/collapse, realtime data): lay the whole tree out again, so every
 * parent sits between its children and every task beside its step, and move the viewport by the anchor's
 * displacement so the anchor stays exactly where it was on screen. Without an anchor present in both layouts
 * the viewport is unchanged.
 */
export function relayoutAround(
  previous: Readonly<Record<string, Point>>,
  input: MapProjection,
  anchor: string | null,
  viewport: Viewport,
): { positions: Record<string, Point>; viewport: Viewport } {
  const positions = layoutHierarchy(input);
  const from = anchor === null ? undefined : previous[anchor];
  const to = anchor === null ? undefined : positions[anchor];
  if (!from || !to) return { positions, viewport };
  return { positions, viewport: followAnchor(from, to, viewport) };
}

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
