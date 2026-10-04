/**
 * Deterministic left→right hierarchy layout for the ticket map. Only parent edges shape the tree: columns follow
 * depth (card 320 + gap 100), leaves stack in sibling-ID order with a 24px row gap, and each parent sits in the
 * middle of its children. Dependency and repair edges are overlays and never move a node. Traversal is
 * iterative, so a pathological parent chain cannot overflow the stack; nodes unreachable from the root
 * (orphans, parent cycles) are laid out below the tree instead of being dropped.
 */
import type { Ticket } from '../contracts/tickets.ts';
import type { MapProjection } from './project.ts';

export type Point = { x: number; y: number };
export const cardWidth = 320;
export const cardHeight = 112;
export const columnGap = 100;
export const rowGap = 24;
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

/**
 * Occupied card slots, indexed by column so a free slot is found without scanning every card. Two cards clash
 * when their columns are closer than a card width and their rows closer than one pitch.
 */
class Occupancy {
  readonly #columns = new Map<number, number[]>();

  add(point: Point): void {
    const rows = this.#columns.get(point.x);
    if (!rows) {
      this.#columns.set(point.x, [point.y]);
      return;
    }
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((rows[mid] as number) < point.y) low = mid + 1;
      else high = mid;
    }
    rows.splice(low, 0, point.y);
  }

  /** Lowest row of a card that clashes with a card at `point`, or null when the slot is free. */
  clash(point: Point): number | null {
    let worst: number | null = null;
    for (const [x, rows] of this.#columns) {
      if (Math.abs(x - point.x) >= cardWidth) continue;
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if ((rows[mid] as number) <= point.y - pitch) low = mid + 1;
        else high = mid;
      }
      for (let index = low; index < rows.length && (rows[index] as number) < point.y + pitch; index++)
        worst = Math.max(worst ?? Number.NEGATIVE_INFINITY, rows[index] as number);
    }
    return worst;
  }

  /** First free slot at or below `point` in its column. */
  free(point: Point): Point {
    let y = point.y;
    for (
      let blocking = this.clash({ x: point.x, y });
      blocking !== null;
      blocking = this.clash({ x: point.x, y })
    )
      y = blocking + pitch;
    return { x: point.x, y };
  }
}

/**
 * Keeps every known position (realtime refetch, new child arriving while the map is open) and places only new
 * nodes: next
 * to their parent, below its lowest positioned child, or at their fresh layout position when the parent is
 * unknown; a slot taken by any visible card moves the new card down to the first free slot of its column.
 * Owner actions that change the structure use `relayoutAround`; “Sắp xếp lại” uses `layoutHierarchy`.
 */
export function placeNewNodes(
  previous: Readonly<Record<string, Point>>,
  input: MapProjection,
): Record<string, Point> {
  const { parent, children } = tree(input);
  const result: Record<string, Point> = {};
  const occupied = new Occupancy();
  for (const row of input.nodes) {
    const known = previous[row.id];
    if (!known) continue;
    result[row.id] = known;
    occupied.add(known);
  }
  const fresh = layoutHierarchy(input);
  const added = input.nodes
    .filter((row) => !result[row.id])
    .map((row) => ({ id: row.id, at: fresh[row.id] ?? { x: 0, y: 0 } }))
    .sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y || (a.id < b.id ? -1 : 1));
  for (const { id, at } of added) {
    const parentId = parent.get(id);
    const anchor = parentId === undefined ? undefined : result[parentId];
    let wanted = at;
    if (parentId !== undefined && anchor) {
      const siblings = (children.get(parentId) ?? [])
        .filter((sibling) => sibling !== id && result[sibling])
        .map((sibling) => (result[sibling] as Point).y);
      wanted = { x: anchor.x + column, y: siblings.length > 0 ? Math.max(...siblings) + pitch : anchor.y };
    }
    const placed = occupied.free(wanted);
    result[id] = placed;
    occupied.add(placed);
  }
  return result;
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
 * Structural change made by the owner (expand/collapse one step, expand/collapse all): lay the whole tree out
 * again, so every task sits beside its step, and move the viewport by the anchor's displacement so the anchor
 * stays exactly where it was on screen. Without an anchor present in both layouts the viewport is unchanged.
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
