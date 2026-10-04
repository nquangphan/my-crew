import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Dependency, RepairLink, Ticket, TicketGraph } from '../src/contracts/tickets.ts';
import {
  cardHeight,
  cardWidth,
  columnGap,
  initialViewport,
  layoutHierarchy,
  neighbourInDirection,
  relayoutAround,
  rowGap,
} from '../src/graph/layout.ts';
import {
  canonicalEdges,
  expandableIds,
  hiddenRelationCounts,
  type MapEdge,
  type MapProjection,
  nodeRelations,
  projectGraph,
  resolveRootId,
} from '../src/graph/project.ts';

const projectId = '11111111-1111-4111-8111-111111111111';
const otherProject = '99999999-9999-4999-8999-999999999999';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cycle = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const root = id(1);
const pitch = cardHeight + rowGap;
const column = cardWidth + columnGap;

function ticket(
  n: number,
  level: Ticket['level'],
  parent: number | null,
  overrides: Partial<Ticket> = {},
): Ticket {
  return {
    id: id(n),
    projectId,
    parentId: parent === null ? null : id(parent),
    rootId: root,
    level,
    kind: 'code',
    title: `Ticket ${n}`,
    description: '',
    mandatory: true,
    criteria: {},
    inputs: {},
    outputs: {},
    skill: null,
    workflowPin: null,
    status: 'pending',
    revision: 1,
    waitReason: null,
    repairCycles: 0,
    mergedCommit: null,
    ...overrides,
  };
}

const dep = (ticketN: number, predecessorN: number): Dependency => ({
  ticketId: id(ticketN),
  predecessorId: id(predecessorN),
});
const repair = (check: number, fix: number, c: number): RepairLink => ({
  checkStepId: id(check),
  fixTicketId: id(fix),
  cycleId: cycle(c),
});

/**
 * Root 1 → steps 10 and 11 run in parallel, step 12 joins both (fork/join). Tasks: 100,101 under 10; 110 under
 * 11; 120 under 12. Task dependencies: 101 after 100 (same step), 120 after 101 and 110 (cross-step join).
 */
function forkJoin(): TicketGraph {
  return {
    nodes: [
      ticket(1, 'request', null),
      ticket(10, 'step', 1),
      ticket(11, 'step', 1),
      ticket(12, 'step', 1),
      ticket(100, 'task', 10),
      ticket(101, 'task', 10),
      ticket(110, 'task', 11),
      ticket(120, 'task', 12),
    ],
    dependencies: [dep(12, 10), dep(12, 11), dep(101, 100), dep(120, 101), dep(120, 110)],
    repairLinks: [],
  };
}

/** Check step 20 with five fix tasks (repair cycles 1–5); fix 205 is also a predecessor of the check. */
function repairCycles(): TicketGraph {
  const fixes = [201, 202, 203, 204, 205];
  return {
    nodes: [ticket(1, 'request', null), ticket(20, 'step', 1), ...fixes.map((n) => ticket(n, 'task', 20))],
    dependencies: [dep(20, 205)],
    repairLinks: fixes.map((fix, index) => repair(20, fix, index + 1)),
  };
}

function allEdges(projection: MapProjection): MapEdge[] {
  return [...projection.edges, ...projection.hiddenEdges];
}

function pairs(edges: readonly MapEdge[], kind: MapEdge['kind']): string[] {
  return edges
    .filter((edge) => edge.kind === kind)
    .map((edge) => `${edge.source}>${edge.target}`)
    .sort();
}

function shuffled<T>(rows: readonly T[]): T[] {
  return [...rows].reverse();
}

test('root→hai bước song song→join: mọi cặp dependency giữ nguyên, không có chuỗi tự suy, task thu gọn vào hiddenEdges', () => {
  const graph = forkJoin();
  const projection = projectGraph(graph, root, new Set());
  assert.deepEqual(projection.diagnostics, []);
  assert.equal(projection.rootId, root);
  assert.deepEqual(
    projection.nodes.map((row) => row.id),
    [id(1), id(10), id(11), id(12)],
    'root và bước hiện mặc định, task ẩn khi bước thu gọn',
  );
  const expected = graph.dependencies.map((row) => `${row.predecessorId}>${row.ticketId}`).sort();
  assert.deepEqual(pairs(allEdges(projection), 'dependency'), expected, 'đủ và không thêm cạnh dependency');
  assert.deepEqual(pairs(projection.edges, 'dependency'), [`${id(10)}>${id(12)}`, `${id(11)}>${id(12)}`]);
  for (const edge of projection.edges) {
    assert.ok(projection.nodes.some((row) => row.id === edge.source));
    assert.ok(projection.nodes.some((row) => row.id === edge.target));
  }
  assert.ok(
    projection.hiddenEdges.some((edge) => edge.id === `dependency:${id(110)}:${id(120)}`),
    'cạnh task giữ đúng đầu mút thật, không gán sang bước',
  );
  assert.ok(
    !allEdges(projection).some(
      (edge) =>
        edge.kind === 'dependency' &&
        edge.source === id(11) &&
        edge.target === id(12) &&
        edge.id.includes(id(110)),
    ),
  );
  const ids = allEdges(projection).map((edge) => edge.id);
  assert.equal(new Set(ids).size, ids.length, 'edge ID duy nhất');
  assert.ok(ids.includes(`parent:${id(1)}:${id(10)}`));
  assert.ok(ids.includes(`dependency:${id(10)}:${id(12)}`));
  assert.equal(allEdges(projection).filter((edge) => edge.kind === 'parent').length, graph.nodes.length - 1);
});

test('mở một bước chỉ hiện đúng task của bước đó; cạnh liên bước vẫn ẩn tới khi mở đủ hai đầu; mở tất cả không còn cạnh ẩn', () => {
  const graph = forkJoin();
  const one = projectGraph(graph, root, new Set([id(10)]));
  assert.deepEqual(
    one.nodes.map((row) => row.id),
    [id(1), id(10), id(11), id(12), id(100), id(101)],
  );
  assert.ok(one.edges.some((edge) => edge.id === `dependency:${id(100)}:${id(101)}`));
  assert.ok(one.hiddenEdges.some((edge) => edge.id === `dependency:${id(101)}:${id(120)}`));
  const all = projectGraph(graph, root, new Set(expandableIds(graph)));
  assert.deepEqual(expandableIds(graph), [id(10), id(11), id(12)]);
  assert.equal(all.nodes.length, graph.nodes.length);
  assert.deepEqual(all.hiddenEdges, []);
  assert.deepEqual(
    pairs(all.edges, 'dependency'),
    graph.dependencies.map((row) => `${row.predecessorId}>${row.ticketId}`).sort(),
  );
});

test('badge đếm quan hệ dependency/repair tới công việc đang thu gọn theo bước chứa nó', () => {
  const graph = forkJoin();
  const collapsed = projectGraph(graph, root, new Set());
  assert.deepEqual(hiddenRelationCounts(graph, collapsed), {
    [id(10)]: 2, // 100→101 (trong bước) và 101→120
    [id(11)]: 1, // 110→120
    [id(12)]: 2, // 101→120, 110→120
  });
  const repaired = repairCycles();
  assert.deepEqual(hiddenRelationCounts(repaired, projectGraph(repaired, root, new Set())), { [id(20)]: 6 });
  assert.deepEqual(hiddenRelationCounts(graph, projectGraph(graph, root, new Set(expandableIds(graph)))), {});
});

test('repair check→fix chu kỳ 1–5: cạnh repair riêng, cùng đầu mút với parent vẫn giữ cả hai, vòng repair/dependency không làm layout lặp', () => {
  const graph = repairCycles();
  const projection = projectGraph(graph, root, new Set([id(20)]));
  assert.deepEqual(projection.diagnostics, [], 'vòng chỉ qua repair không phải lỗi DAG');
  const repairs = projection.edges.filter((edge) => edge.kind === 'repair');
  assert.equal(repairs.length, 5);
  for (let index = 1; index <= 5; index++) {
    const fix = id(200 + index);
    const edge = repairs.find((row) => row.target === fix);
    assert.deepEqual(edge, {
      id: `repair:${cycle(index)}:${id(20)}:${fix}`,
      source: id(20),
      target: fix,
      kind: 'repair',
      cycleId: cycle(index),
    });
    assert.ok(projection.edges.some((row) => row.id === `parent:${id(20)}:${fix}`));
  }
  assert.ok(projection.edges.some((row) => row.id === `dependency:${id(205)}:${id(20)}`));
  const positions = layoutHierarchy(projection);
  assert.equal(Object.keys(positions).length, projection.nodes.length);
  const withoutOverlay = layoutHierarchy({
    ...projection,
    edges: projection.edges.filter((edge) => edge.kind === 'parent'),
  });
  assert.deepEqual(positions, withoutOverlay, 'dependency/repair không ép thứ tự layout');
});

test('graph đọc từ ticket con vẫn chiếu cả root: rootId thừa kế từ node', () => {
  const graph = forkJoin();
  assert.equal(resolveRootId(graph, id(110)), root);
  assert.equal(resolveRootId(graph, root), root);
  const projection = projectGraph(graph, id(110), new Set());
  assert.equal(projection.rootId, root);
  assert.deepEqual(projection.diagnostics, []);
  assert.deepEqual(
    projection.nodes.map((row) => row.id),
    [id(1), id(10), id(11), id(12)],
  );
});

test('kết quả không phụ thuộc thứ tự input: node, cạnh và vị trí giống nhau', () => {
  const graph = forkJoin();
  const reversed: TicketGraph = {
    nodes: shuffled(graph.nodes),
    dependencies: shuffled(graph.dependencies),
    repairLinks: shuffled(graph.repairLinks),
  };
  const expanded = new Set(expandableIds(graph));
  const a = projectGraph(graph, root, expanded);
  const b = projectGraph(reversed, root, expanded);
  assert.deepEqual(b, a);
  assert.deepEqual(layoutHierarchy(b), layoutHierarchy(a));
  assert.deepEqual(canonicalEdges(reversed), canonicalEdges(graph));
});

test('layout trái→phải: cột theo độ sâu (320+100), anh em theo ID, cha nằm giữa cây con, hàng cách 24', () => {
  const graph = forkJoin();
  const projection = projectGraph(
    { ...graph, nodes: shuffled(graph.nodes) },
    root,
    new Set(expandableIds(graph)),
  );
  const at = layoutHierarchy(projection);
  assert.equal(at[id(1)]?.x, 0);
  for (const n of [10, 11, 12]) assert.equal(at[id(n)]?.x, column);
  for (const n of [100, 101, 110, 120]) assert.equal(at[id(n)]?.x, 2 * column);
  // Leaves stacked by sibling ID order: 100, 101, 110, 120.
  assert.deepEqual(
    [100, 101, 110, 120].map((n) => at[id(n)]?.y),
    [0, pitch, 2 * pitch, 3 * pitch],
  );
  assert.equal(at[id(10)]?.y, pitch / 2, 'bước giữa hai task con');
  assert.equal(at[id(11)]?.y, 2 * pitch);
  assert.equal(at[id(12)]?.y, 3 * pitch);
  assert.equal(at[id(1)]?.y, (pitch / 2 + 3 * pitch) / 2, 'root giữa con đầu và con cuối');
});

test('dữ liệu hỏng có diagnostic, không bỏ node mồ côi, không lặp vô hạn', () => {
  const graph: TicketGraph = {
    nodes: [
      ticket(1, 'request', null),
      ticket(10, 'step', 1),
      ticket(10, 'step', 1, { revision: 3, title: 'Bản mới' }),
      ticket(11, 'step', 404), // cha không tồn tại
      ticket(12, 'task', 1), // task gắn trực tiếp vào yêu cầu
      ticket(13, 'step', 14), // chuỗi cha vòng 13↔14
      ticket(14, 'step', 13),
      ticket(15, 'step', 1, { rootId: id(999) }),
      ticket(16, 'step', 1, { projectId: otherProject }),
      ticket(17, 'request', null, { rootId: id(17) }),
      ticket(18, 'step', 1),
      ticket(19, 'step', 1),
    ],
    dependencies: [dep(18, 19), dep(19, 18), dep(10, 777)],
    repairLinks: [repair(10, 888, 1)],
  };
  const projection = projectGraph(graph, root, new Set());
  const codes = projection.diagnostics;
  for (const code of [
    `DUPLICATE_ID:${id(10)}`,
    `PARENT_MISSING:${id(11)}`,
    `LEVEL_INVALID:${id(12)}`,
    `PARENT_CYCLE:${id(13)}`,
    `PARENT_CYCLE:${id(14)}`,
    `ROOT_MISMATCH:${id(15)}`,
    `PROJECT_MISMATCH:${id(16)}`,
    `ROOT_MULTIPLE:${id(17)}`,
    `DEPENDENCY_CYCLE:${id(18)}`,
    `DEPENDENCY_DANGLING:dependency:${id(777)}:${id(10)}`,
    `REPAIR_DANGLING:repair:${cycle(1)}:${id(10)}:${id(888)}`,
  ])
    assert.ok(codes.includes(code), `thiếu ${code}: ${codes.join(', ')}`);
  assert.equal(
    projection.nodes.find((row) => row.id === id(10))?.title,
    'Bản mới',
    'ID trùng giữ revision mới',
  );
  for (const n of [11, 12, 13, 14, 15, 16, 17])
    assert.ok(
      projection.nodes.some((row) => row.id === id(n)),
      `không bỏ node ${n}`,
    );
  assert.ok(
    projection.hiddenEdges.some((edge) => edge.id === `dependency:${id(777)}:${id(10)}`),
    'cạnh treo vẫn được giữ trong hiddenEdges',
  );
  const positions = layoutHierarchy(projection);
  for (const row of projection.nodes) assert.ok(positions[row.id], `có vị trí cho ${row.id}`);
  const occupied = new Set(Object.values(positions).map((point) => `${point.x}:${point.y}`));
  assert.equal(occupied.size, projection.nodes.length, 'không chồng node');
});

test('thiếu root: diagnostic ROOT_MISSING, mọi node vẫn được chiếu và có vị trí', () => {
  const graph: TicketGraph = {
    nodes: [ticket(10, 'step', 1), ticket(100, 'task', 10)],
    dependencies: [],
    repairLinks: [],
  };
  const projection = projectGraph(graph, root, new Set());
  assert.ok(projection.diagnostics.includes(`ROOT_MISSING:${root}`));
  assert.equal(projection.nodes.length, 1, 'task vẫn ẩn sau bước thu gọn');
  assert.equal(Object.keys(layoutHierarchy(projection)).length, 1);
});

test('chuỗi cha rất sâu (20 000) không tràn stack ở chiếu và layout', () => {
  const nodes = [ticket(1, 'request', null), ticket(2, 'step', 1)];
  for (let n = 3; n < 20_003; n++) nodes.push(ticket(n, 'task', n - 1));
  const graph: TicketGraph = { nodes, dependencies: [], repairLinks: [] };
  const expanded = new Set(nodes.map((row) => row.id));
  const projection = projectGraph(graph, root, expanded);
  assert.equal(projection.nodes.length, nodes.length);
  const positions = layoutHierarchy(projection);
  assert.equal(positions[id(20_002)]?.x, 20_001 * column);
});

test('200 bước / 600 task: giữ mọi cặp dependency, layout xác định và trong ngân sách thời gian', () => {
  const nodes = [ticket(1, 'request', null)];
  const dependencies: Dependency[] = [];
  for (let s = 0; s < 200; s++) {
    const step = 1000 + s;
    nodes.push(ticket(step, 'step', 1));
    if (s > 0) dependencies.push(dep(step, step - 1));
    for (let t = 0; t < 3; t++) {
      const task = 10_000 + s * 3 + t;
      nodes.push(ticket(task, 'task', step));
      if (t > 0) dependencies.push(dep(task, task - 1));
    }
  }
  const graph: TicketGraph = { nodes, dependencies, repairLinks: [] };
  const started = performance.now();
  const collapsed = projectGraph(graph, root, new Set());
  const expanded = projectGraph(graph, root, new Set(expandableIds(graph)));
  const positions = layoutHierarchy(expanded);
  const elapsed = performance.now() - started;
  assert.equal(collapsed.nodes.length, 201);
  assert.equal(expanded.nodes.length, 801);
  const expected = dependencies.map((row) => `${row.predecessorId}>${row.ticketId}`).sort();
  assert.deepEqual(pairs(allEdges(collapsed), 'dependency'), expected);
  assert.deepEqual(pairs(expanded.edges, 'dependency'), expected);
  assert.equal(Object.keys(positions).length, 801);
  assert.deepEqual(layoutHierarchy(expanded), positions);
  assert.ok(elapsed < 500, `chiếu+layout 801 node mất ${elapsed.toFixed(1)}ms`);
});

/** Two cards overlap when they share a column band and their rows are closer than one pitch. */
function overlaps(positions: Record<string, { x: number; y: number }>): string[] {
  const entries = Object.entries(positions);
  const found: string[] = [];
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const [a, pa] = entries[i] as [string, { x: number; y: number }];
      const [b, pb] = entries[j] as [string, { x: number; y: number }];
      if (Math.abs(pa.x - pb.x) < cardWidth && Math.abs(pa.y - pb.y) < pitch) found.push(`${a}~${b}`);
    }
  return found;
}

/** Every visible task sits inside its step's band: at most (tasks - 1) / 2 rows from the step. */
function tasksBesideParents(
  projection: MapProjection,
  positions: Record<string, { x: number; y: number }>,
): string[] {
  const far: string[] = [];
  const parents = new Map<string, string[]>();
  for (const edge of projection.edges)
    if (edge.kind === 'parent') parents.set(edge.source, [...(parents.get(edge.source) ?? []), edge.target]);
  for (const [parent, kids] of parents) {
    // Only steps with tasks: the root's children are subtrees, spaced by subtree height.
    if (kids.some((kid) => parents.has(kid))) continue;
    const band = ((kids.length - 1) / 2) * pitch;
    for (const kid of kids) {
      const dy = Math.abs((positions[kid]?.y ?? 0) - (positions[parent]?.y ?? 0));
      const dx = (positions[kid]?.x ?? 0) - (positions[parent]?.x ?? 0);
      if (dy > band + 1e-6 || dx !== column) far.push(`${kid} cách ${parent} ${dy}`);
    }
  }
  return far;
}

const screen = (
  point: { x: number; y: number } | undefined,
  view: { x: number; y: number; zoom: number },
) => ({
  x: (point?.x ?? 0) * view.zoom + view.x,
  y: (point?.y ?? 0) * view.zoom + view.y,
});

test('mở tất cả: bố cục lại cả cây, task nằm liền bước cha, node neo (root) đứng yên trên màn hình', () => {
  const graph = repairCycles();
  graph.nodes.push(ticket(21, 'step', 1), ticket(210, 'task', 21), ticket(211, 'task', 21));
  const collapsed = layoutHierarchy(projectGraph(graph, root, new Set()));
  const view = { x: 37, y: -120, zoom: 0.8 };
  const expanded = projectGraph(graph, root, new Set(expandableIds(graph)));
  const result = relayoutAround(collapsed, expanded, root, view);
  assert.deepEqual(result.positions, layoutHierarchy(expanded), 'bố cục toàn bộ như Sắp xếp lại');
  assert.deepEqual(tasksBesideParents(expanded, result.positions), []);
  assert.deepEqual(overlaps(result.positions), []);
  const before = screen(collapsed[root], view);
  const after = screen(result.positions[root], result.viewport);
  assert.ok(Math.abs(after.x - before.x) <= 1e-6 && Math.abs(after.y - before.y) <= 1e-6, 'root đứng yên');
  assert.equal(result.viewport.zoom, view.zoom);
});

test('mở/thu gọn một bước: bước vừa bấm đứng yên trên màn hình, task của nó liền kề', () => {
  const graph = forkJoin();
  const view = { x: 0, y: 0, zoom: 1.3 };
  const collapsed = layoutHierarchy(projectGraph(graph, root, new Set()));
  const open = projectGraph(graph, root, new Set([id(10)]));
  const opened = relayoutAround(collapsed, open, id(10), view);
  assert.deepEqual(tasksBesideParents(open, opened.positions), []);
  const s0 = screen(collapsed[id(10)], view);
  const s1 = screen(opened.positions[id(10)], opened.viewport);
  assert.ok(Math.abs(s1.x - s0.x) <= 1e-6 && Math.abs(s1.y - s0.y) <= 1e-6, 'bước 10 đứng yên khi mở');
  const closed = relayoutAround(
    opened.positions,
    projectGraph(graph, root, new Set()),
    id(10),
    opened.viewport,
  );
  const s2 = screen(closed.positions[id(10)], closed.viewport);
  assert.ok(Math.abs(s2.x - s0.x) <= 1e-6 && Math.abs(s2.y - s0.y) <= 1e-6, 'bước 10 đứng yên khi thu gọn');
  const missing = relayoutAround(collapsed, open, id(999), view);
  assert.deepEqual(missing.viewport, view, 'neo không có ở cả hai bố cục thì viewport giữ nguyên');
});

test('quan hệ của node liệt kê đủ cha, predecessor, successor và repair ID', () => {
  const graph = forkJoin();
  assert.deepEqual(nodeRelations(graph, id(120)), {
    parentId: id(12),
    children: [],
    predecessors: [id(101), id(110)],
    successors: [],
    repairs: [],
  });
  assert.deepEqual(nodeRelations(graph, id(12)).predecessors, [id(10), id(11)]);
  assert.deepEqual(nodeRelations(graph, id(10)).successors, [id(12)]);
  assert.deepEqual(nodeRelations(graph, id(10)).children, [id(100), id(101)]);
  const repaired = repairCycles();
  const check = nodeRelations(repaired, id(20));
  assert.equal(check.repairs.length, 5);
  assert.deepEqual(check.repairs[0], { cycleId: cycle(1), checkStepId: id(20), fixTicketId: id(201) });
  assert.deepEqual(nodeRelations(repaired, id(203)).repairs, [
    { cycleId: cycle(3), checkStepId: id(20), fixTicketId: id(203) },
  ]);
});

test('điều hướng bàn phím: trái về cha, phải tới con đầu, lên/xuống theo cột', () => {
  const graph = forkJoin();
  const projection = projectGraph(graph, root, new Set([id(10)]));
  const at = layoutHierarchy(projection);
  assert.equal(neighbourInDirection(projection, at, id(100), 'left'), id(10));
  assert.equal(neighbourInDirection(projection, at, id(10), 'right'), id(100));
  assert.equal(neighbourInDirection(projection, at, id(1), 'right'), id(10));
  assert.equal(neighbourInDirection(projection, at, id(10), 'down'), id(11));
  assert.equal(neighbourInDirection(projection, at, id(11), 'up'), id(10));
  assert.equal(neighbourInDirection(projection, at, id(1), 'left'), null);
  assert.equal(neighbourInDirection(projection, at, id(11), 'right'), null, 'bước thu gọn không có con hiện');
});

test('mật độ theo mockup owner duyệt: thẻ 280×48, hàng cách 10, cột cách 56, vẫn chạm được', () => {
  assert.deepEqual(
    { cardWidth, cardHeight, rowGap, columnGap },
    { cardWidth: 280, cardHeight: 48, rowGap: 10, columnGap: 56 },
  );
  assert.ok(cardHeight >= 2 * 24, 'đủ hai dòng chạm được (≥ 24px mỗi dòng)');
  const at = layoutHierarchy(projectGraph(forkJoin(), root, new Set([id(10)])));
  assert.equal(at[id(101)]?.y, cardHeight + rowGap, 'hàng kế cách đúng pitch mới');
  assert.equal(at[id(10)]?.x, cardWidth + columnGap);
});

test('khung nhìn ban đầu 1:1: root ở mép trái, giữa chiều cao khung, không fit toàn cây', () => {
  const view = initialViewport({ x: 0, y: 500 }, 600);
  assert.deepEqual(view, { x: 24, y: 300 - (500 + cardHeight / 2), zoom: 1 });
  assert.deepEqual(initialViewport(undefined, 600), { x: 24, y: 24, zoom: 1 }, 'chưa có vị trí root');
});
