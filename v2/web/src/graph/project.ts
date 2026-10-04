/**
 * Pure projection of the producer's whole-root graph (`GET /v2/tickets/:id/graph`) onto the ticket map. Every
 * parent link, dependency and repair link becomes exactly one `MapEdge` with its real endpoints: nothing is
 * inferred (no synthetic sequence between siblings) and nothing is dropped. Edges touching a collapsed task are
 * moved to `hiddenEdges`, never re-attached to the step that contains it. Torn or malformed data is reported
 * as diagnostics while every node stays in the projection, so the map can fall back to a list.
 */
import type { Ticket, TicketGraph } from '../contracts/tickets.ts';
import { mergeTicketPages } from '../tickets/status.ts';

export type MapEdge = {
  id: string;
  source: string;
  target: string;
  kind: 'parent' | 'dependency' | 'repair';
  cycleId?: string;
};
export type MapProjection = {
  rootId: string;
  nodes: Ticket[];
  edges: MapEdge[];
  hiddenEdges: MapEdge[];
  diagnostics: string[];
};
export type NodeRelations = {
  parentId: string | null;
  children: string[];
  predecessors: string[];
  successors: string[];
  repairs: { cycleId: string; checkStepId: string; fixTicketId: string }[];
};

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sortStrings = (values: Iterable<string>) => [...values].sort();

/** Level a parent must have: steps hang under the request, tasks under a step. */
const parentLevel: Record<Ticket['level'], Ticket['level'] | null> = {
  request: null,
  step: 'request',
  task: 'step',
};

/** The request root of the graph: the given ID if it is a node, otherwise unchanged (reported as missing). */
export function resolveRootId(input: TicketGraph, id: string): string {
  return input.nodes.find((row) => row.id === id)?.rootId ?? id;
}

/** Every relation of the graph as one edge, ordered by edge ID. IDs: `parent:<parent>:<id>`, `dependency:<predecessor>:<ticket>`, `repair:<cycle>:<check>:<fix>`. */
export function canonicalEdges(input: TicketGraph): MapEdge[] {
  const edges: MapEdge[] = [];
  for (const row of input.nodes)
    if (row.parentId !== null)
      edges.push({
        id: `parent:${row.parentId}:${row.id}`,
        source: row.parentId,
        target: row.id,
        kind: 'parent',
      });
  for (const row of input.dependencies)
    edges.push({
      id: `dependency:${row.predecessorId}:${row.ticketId}`,
      source: row.predecessorId,
      target: row.ticketId,
      kind: 'dependency',
    });
  for (const row of input.repairLinks)
    edges.push({
      id: `repair:${row.cycleId}:${row.checkStepId}:${row.fixTicketId}`,
      source: row.checkStepId,
      target: row.fixTicketId,
      kind: 'repair',
      cycleId: row.cycleId,
    });
  const unique = new Map<string, MapEdge>();
  for (const edge of edges) if (!unique.has(edge.id)) unique.set(edge.id, edge);
  return [...unique.values()].sort(byId);
}

/** Nodes whose children can be shown or hidden: steps that have at least one task, by ID. */
export function expandableIds(input: TicketGraph): string[] {
  const nodes = new Map(mergeTicketPages([input.nodes]).map((row) => [row.id, row]));
  const ids = new Set<string>();
  for (const row of nodes.values()) {
    const parent = row.parentId === null ? undefined : nodes.get(row.parentId);
    if (parent && parent.level === 'step') ids.add(parent.id);
  }
  return sortStrings(ids);
}

/** Peels nodes with no remaining incoming edge (Kahn); returns the IDs that could not be peeled. */
function unpeeled(ids: Iterable<string>, edges: readonly (readonly [string, string])[]): Set<string> {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) indegree.set(id, 0);
  for (const [from, to] of edges) {
    if (!indegree.has(from) || !indegree.has(to)) continue;
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
    const list = outgoing.get(from);
    if (list) list.push(to);
    else outgoing.set(from, [to]);
  }
  const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  for (let index = 0; index < queue.length; index++)
    for (const next of outgoing.get(queue[index] as string) ?? []) {
      const count = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, count);
      if (count === 0) queue.push(next);
    }
  return new Set([...indegree].filter(([, count]) => count > 0).map(([id]) => id));
}

/**
 * Members of dependency cycles: peeling sources forwards leaves cycles plus whatever depends on them; peeling
 * the rest backwards removes those dependents, leaving only nodes on (or between) cycles.
 */
function dependencyCycleMembers(nodeIds: ReadonlySet<string>, input: TicketGraph): string[] {
  const forward = input.dependencies.map((row) => [row.predecessorId, row.ticketId] as const);
  const behind = unpeeled(nodeIds, forward);
  const backward = forward.map(([from, to]) => [to, from] as const);
  return sortStrings(unpeeled(behind, backward));
}

/** Nodes on a parent-chain cycle, found by an iterative walk with colouring (no recursion). */
function parentCycleMembers(nodes: ReadonlyMap<string, Ticket>): string[] {
  const state = new Map<string, 'walking' | 'done'>();
  const members = new Set<string>();
  for (const start of nodes.keys()) {
    if (state.has(start)) continue;
    const path: string[] = [];
    let current: string | null = start;
    while (current !== null && nodes.has(current) && !state.has(current)) {
      state.set(current, 'walking');
      path.push(current);
      current = nodes.get(current)?.parentId ?? null;
    }
    if (current !== null && state.get(current) === 'walking')
      for (let index = path.indexOf(current); index < path.length; index++)
        members.add(path[index] as string);
    for (const id of path) state.set(id, 'done');
  }
  return sortStrings(members);
}

function validate(
  input: TicketGraph,
  nodes: ReadonlyMap<string, Ticket>,
  rootId: string,
  edges: MapEdge[],
): string[] {
  const diagnostics: string[] = [];
  const seen = new Set<string>();
  for (const row of input.nodes) {
    if (seen.has(row.id)) diagnostics.push(`DUPLICATE_ID:${row.id}`);
    seen.add(row.id);
  }
  const root = nodes.get(rootId);
  if (root?.level !== 'request' || root.parentId !== null || root.rootId !== rootId)
    diagnostics.push(`ROOT_MISSING:${rootId}`);
  for (const row of nodes.values()) {
    if (row.id !== rootId && row.level === 'request' && row.parentId === null)
      diagnostics.push(`ROOT_MULTIPLE:${row.id}`);
    if (row.rootId !== rootId) diagnostics.push(`ROOT_MISMATCH:${row.id}`);
    if (root && row.projectId !== root.projectId) diagnostics.push(`PROJECT_MISMATCH:${row.id}`);
    if (row.parentId === null) {
      if (row.level !== 'request') diagnostics.push(`LEVEL_INVALID:${row.id}`);
      continue;
    }
    const parent = nodes.get(row.parentId);
    if (!parent) diagnostics.push(`PARENT_MISSING:${row.id}`);
    else if (parent.level !== parentLevel[row.level]) diagnostics.push(`LEVEL_INVALID:${row.id}`);
  }
  for (const id of parentCycleMembers(nodes)) diagnostics.push(`PARENT_CYCLE:${id}`);
  for (const id of dependencyCycleMembers(new Set(nodes.keys()), input))
    diagnostics.push(`DEPENDENCY_CYCLE:${id}`);
  for (const edge of edges) {
    if (nodes.has(edge.source) && nodes.has(edge.target)) continue;
    if (edge.kind === 'dependency') diagnostics.push(`DEPENDENCY_DANGLING:${edge.id}`);
    if (edge.kind === 'repair') diagnostics.push(`REPAIR_DANGLING:${edge.id}`);
  }
  return [...new Set(diagnostics)].sort();
}

/**
 * Hidden only when collapsing is meaningful: a task under an existing step that is not expanded. Malformed
 * rows (orphans, wrong level) stay visible so they are never silently dropped.
 */
function isVisible(row: Ticket, nodes: ReadonlyMap<string, Ticket>, expanded: ReadonlySet<string>): boolean {
  if (row.level !== 'task' || row.parentId === null) return true;
  const parent = nodes.get(row.parentId);
  return parent?.level !== 'step' || expanded.has(parent.id);
}

/** Projects the whole root: visible nodes by ID, edges split by endpoint visibility, sorted diagnostics. */
export function projectGraph(
  input: TicketGraph,
  rootId: string,
  expanded: ReadonlySet<string>,
): MapProjection {
  const root = resolveRootId(input, rootId);
  const nodes = new Map(mergeTicketPages([input.nodes]).map((row) => [row.id, row]));
  const edges = canonicalEdges(input);
  const visible = new Map(
    [...nodes.values()].filter((row) => isVisible(row, nodes, expanded)).map((row) => [row.id, row]),
  );
  const shown: MapEdge[] = [];
  const hidden: MapEdge[] = [];
  for (const edge of edges)
    (visible.has(edge.source) && visible.has(edge.target) ? shown : hidden).push(edge);
  return {
    rootId: root,
    nodes: [...visible.values()].sort(byId),
    edges: shown,
    hiddenEdges: hidden,
    diagnostics: validate(input, nodes, root, edges),
  };
}

/**
 * Badge counts: for every visible collapsed node, how many hidden dependency/repair relations touch work inside
 * it. A relation counts once per collapsed node even when both endpoints are inside it.
 */
export function hiddenRelationCounts(input: TicketGraph, projection: MapProjection): Record<string, number> {
  const nodes = new Map(mergeTicketPages([input.nodes]).map((row) => [row.id, row]));
  const visible = new Set(projection.nodes.map((row) => row.id));
  const holder = (id: string): string | null => {
    if (visible.has(id)) return null;
    const parentId = nodes.get(id)?.parentId ?? null;
    return parentId !== null && visible.has(parentId) ? parentId : null;
  };
  const counts: Record<string, number> = {};
  for (const edge of projection.hiddenEdges) {
    if (edge.kind === 'parent') continue;
    const holders = new Set([holder(edge.source), holder(edge.target)]);
    for (const id of holders) if (id !== null) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/** Full relation list of one node for the relations panel, every list ordered by ID (repairs by cycle). */
export function nodeRelations(input: TicketGraph, ticketId: string): NodeRelations {
  const row = mergeTicketPages([input.nodes]).find((candidate) => candidate.id === ticketId);
  return {
    parentId: row?.parentId ?? null,
    children: sortStrings(
      input.nodes.filter((child) => child.parentId === ticketId).map((child) => child.id),
    ),
    predecessors: sortStrings(
      input.dependencies.filter((dep) => dep.ticketId === ticketId).map((dep) => dep.predecessorId),
    ),
    successors: sortStrings(
      input.dependencies.filter((dep) => dep.predecessorId === ticketId).map((dep) => dep.ticketId),
    ),
    repairs: input.repairLinks
      .filter((link) => link.checkStepId === ticketId || link.fixTicketId === ticketId)
      .map((link) => ({
        cycleId: link.cycleId,
        checkStepId: link.checkStepId,
        fixTicketId: link.fixTicketId,
      }))
      .sort((a, b) =>
        a.cycleId < b.cycleId ? -1 : a.cycleId > b.cycleId ? 1 : a.fixTicketId < b.fixTicketId ? -1 : 1,
      ),
  };
}
