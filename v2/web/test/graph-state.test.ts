import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import type { AppRuntime } from '../src/app-runtime.ts';
import type { Ticket, TicketGraph } from '../src/contracts/tickets.ts';
import {
  closeMapDialog,
  closeMapDialogNavigation,
  initialMapView,
  type MapViewState,
  mapDialogStateKey,
  mapViewStorageKey,
  moveMapViewport,
  openMapDialog,
  parseMapSearch,
  readMapView,
  setMapExpanded,
  toggleMapExpanded,
  writeMapView,
} from '../src/graph/state.ts';
import {
  FakeComposeServer,
  harness,
  inlineHasher,
  MemoryStorage,
  projectId,
  settle,
} from './support/compose-server.ts';
import { installDom } from './support/dom.ts';
import { useDomEventConstructors } from './support/dom-events.ts';

const rootA = '0a0a0a0a-0000-4000-8000-000000000001';
const rootB = '0b0b0b0b-0000-4000-8000-000000000002';
const node = '0c0c0c0c-0000-4000-8000-000000000003';

test('đóng dialog giữ vùng đang xem', () => {
  const state = {
    rootId: 'r',
    viewport: { x: -480, y: 140, zoom: 1.7 },
    expanded: ['s'],
    selectedTicketId: 't',
    focusedTicketId: 't',
  };
  assert.deepEqual(closeMapDialog(state), { ...state, selectedTicketId: null });
});

test('mở dialog chọn và focus node, không đổi viewport/expanded; di chuyển chỉ đổi viewport', () => {
  const state: MapViewState = {
    ...initialMapView(rootA),
    viewport: { x: 12, y: -4, zoom: 0.8 },
    expanded: [node],
  };
  const opened = openMapDialog(state, node);
  assert.deepEqual(opened, { ...state, selectedTicketId: node, focusedTicketId: node });
  const moved = moveMapViewport(opened, { x: -480, y: 140, zoom: 1.7 });
  assert.deepEqual(moved, { ...opened, viewport: { x: -480, y: 140, zoom: 1.7 } });
  assert.deepEqual(closeMapDialog(moved), { ...moved, selectedTicketId: null });
});

test('mở/thu gọn: toggle giữ thứ tự ổn định, “Mở tất cả” khôi phục tất cả, không trùng', () => {
  const state = initialMapView(rootA);
  const one = toggleMapExpanded(state, rootB);
  assert.deepEqual(one.expanded, [rootB]);
  const two = toggleMapExpanded(one, rootA);
  assert.deepEqual(two.expanded, [rootA, rootB]);
  assert.deepEqual(toggleMapExpanded(two, rootB).expanded, [rootA]);
  assert.deepEqual(setMapExpanded(state, [node, rootA, node]).expanded, [rootA, node]);
  assert.deepEqual(setMapExpanded(two, []).expanded, []);
  assert.deepEqual(setMapExpanded(two, []).viewport, two.viewport);
});

test('trạng thái sơ đồ lưu theo root trong tab storage; dữ liệu hỏng bị bỏ', () => {
  const storage = new MemoryStorage();
  assert.equal(readMapView(storage, rootA), null, 'root mới chưa có trạng thái → cần fit một lần');
  const state: MapViewState = {
    rootId: rootA,
    viewport: { x: -480, y: 140, zoom: 1.7 },
    expanded: [node],
    selectedTicketId: node,
    focusedTicketId: node,
  };
  assert.equal(writeMapView(storage, state), true);
  assert.deepEqual(readMapView(storage, rootA), state);
  assert.equal(readMapView(storage, rootB), null, 'root khác có trạng thái riêng');
  assert.equal(mapViewStorageKey(rootA), `crew-v2:map-view:${rootA}`);
  for (const broken of [
    '{',
    JSON.stringify({ ...state, rootId: rootB }),
    JSON.stringify({ ...state, viewport: { x: 'a', y: 0, zoom: 1 } }),
    JSON.stringify({ ...state, viewport: { x: 0, y: 0, zoom: 0 } }),
    JSON.stringify({ ...state, viewport: { x: Number.MAX_VALUE * 10, y: 0, zoom: 1 } }),
    JSON.stringify({ ...state, expanded: ['không-phải-uuid'] }),
    JSON.stringify({ ...state, focusedTicketId: 5 }),
  ]) {
    storage.setItem(mapViewStorageKey(rootA), broken);
    assert.equal(readMapView(storage, rootA), null, broken);
  }
  assert.equal(readMapView(null, rootA), null);
  assert.equal(writeMapView(null, state), false);
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(writeMapView(full, state), false, 'storage đầy không làm hỏng sơ đồ');
});

test('search của route sơ đồ: UUID về chữ thường, UUID sai bị bỏ (không gây request hay mutation)', () => {
  assert.deepEqual(parseMapSearch({ root: rootA.toUpperCase(), ticket: node.toUpperCase() }), {
    root: rootA,
    ticket: node,
  });
  assert.deepEqual(parseMapSearch({ root: 'abc', ticket: '../../v2/machines' }), {});
  assert.deepEqual(parseMapSearch({ root: rootA, ticket: 42, extra: 'x' }), { root: rootA });
  assert.deepEqual(parseMapSearch(null), {});
});

test('đóng dialog chỉ lùi history khi mục hiện tại do chính sơ đồ của root này push', () => {
  assert.equal(closeMapDialogNavigation({ [mapDialogStateKey]: rootA, __TSR_index: 3 }, rootA), 'back');
  assert.equal(closeMapDialogNavigation({ [mapDialogStateKey]: rootB }, rootA), 'replace', 'root khác');
  assert.equal(
    closeMapDialogNavigation({ __TSR_index: 3 }, rootA),
    'replace',
    'deep link/reload không có dấu',
  );
  assert.equal(closeMapDialogNavigation({ [mapDialogStateKey]: true }, rootA), 'replace');
  assert.equal(closeMapDialogNavigation(null, rootA), 'replace');
  assert.equal(closeMapDialogNavigation(undefined, rootA), 'replace');
});

// ---------------------------------------------------------------------------------------------------------
// Component: the map inside the app providers, over the real Task2 client/session on an in-memory producer.
// ---------------------------------------------------------------------------------------------------------

const closeDom = installDom();
// biome-ignore lint/correctness/useHookAtTopLevel: not a React hook; it binds jsdom event constructors.
useDomEventConstructors();

/** jsdom has no layout engine: ReactFlow needs ResizeObserver, DOMMatrixReadOnly, animation frames and sizes. */
const view = globalThis.window as unknown as Record<string, unknown>;
const observers = new Set<StubResizeObserver>();
class StubResizeObserver {
  readonly #callback: (entries: unknown[], observer: unknown) => void;
  constructor(callback: (entries: unknown[], observer: unknown) => void) {
    this.#callback = callback;
  }
  observe() {
    observers.add(this);
  }
  unobserve() {}
  disconnect() {
    observers.delete(this);
  }
  /** Test hook: report a size change of the observed elements. */
  trigger() {
    this.#callback([], this);
  }
}
class StubMatrix {
  m22: number;
  constructor(transform?: string) {
    const scale = /scale\(([-\d.e]+)\)/.exec(transform ?? '');
    this.m22 = scale ? Number(scale[1]) : 1;
  }
}
const frames = {
  requestAnimationFrame: (callback: (time: number) => void) =>
    setTimeout(() => callback(performance.now()), 0),
  cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
};
for (const [key, value] of Object.entries({
  ResizeObserver: StubResizeObserver,
  DOMMatrixReadOnly: StubMatrix,
  ...frames,
})) {
  view[key] = value;
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const elementProto = (view.HTMLElement as typeof HTMLElement).prototype;
Object.defineProperties(elementProto, {
  offsetWidth: { configurable: true, get: () => 1024 },
  offsetHeight: { configurable: true, get: () => 768 },
});
(elementProto as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 1024, bottom: 768, width: 1024, height: 768 }) as DOMRect;

const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { createElement, useState } = await import('react');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { ComposeServicesProvider } = await import('../src/compose/composer.tsx');
const { RuntimeContext } = await import('../src/app-runtime.ts');
const { TicketDraftStorageProvider } = await import('../src/tickets/create-request.tsx');
const { queryRoots } = await import('../src/lib/query-keys.ts');
const { TicketMap } = await import('../src/graph/ticket-map.tsx');

afterEach(() => cleanup());
after(() => closeDom());

const mapRoot = '0d0d0d0d-0000-4000-8000-000000000001';
const stepA = '0d0d0d0d-0000-4000-8000-000000000010';
const stepB = '0d0d0d0d-0000-4000-8000-000000000011';
const taskA1 = '0d0d0d0d-0000-4000-8000-000000000100';
const taskB1 = '0d0d0d0d-0000-4000-8000-000000000110';

function row(
  id: string,
  level: Ticket['level'],
  parentId: string | null,
  title: string,
  revision = 1,
): Ticket {
  return {
    id,
    projectId,
    parentId,
    rootId: mapRoot,
    level,
    kind: 'code',
    title,
    description: 'Mô tả',
    mandatory: true,
    criteria: {},
    inputs: {},
    outputs: {},
    skill: null,
    workflowPin: null,
    status: level === 'step' ? 'running' : 'pending',
    revision,
    waitReason: null,
    repairCycles: 0,
    mergedCommit: null,
  };
}

function baseGraph(): TicketGraph {
  return {
    nodes: [
      row(mapRoot, 'request', null, 'Yêu cầu gốc'),
      row(stepA, 'step', mapRoot, 'Bước A'),
      row(stepB, 'step', mapRoot, 'Bước B'),
      row(taskA1, 'task', stepA, 'Việc A1'),
      row(taskB1, 'task', stepB, 'Việc B1'),
    ],
    dependencies: [
      { ticketId: stepB, predecessorId: stepA },
      { ticketId: taskB1, predecessorId: taskA1 },
    ],
    repairLinks: [],
  };
}

type GraphServer = {
  server: FakeComposeServer;
  graphReads: { url: string; signal: AbortSignal | null }[];
  setGraph: (graph: TicketGraph) => void;
  hold: (on: boolean) => void;
  writes: () => string[];
};

/** Ticket read routes of the producer (`tickets/routes.ts`) over the fake compose server. */
function graphServer(initial: TicketGraph): GraphServer {
  const server = new FakeComposeServer();
  const base = server.fetch;
  let graph = initial;
  let holding = false;
  const held: (() => void)[] = [];
  const graphReads: GraphServer['graphReads'] = [];
  server.fetch = async (url: string, init: RequestInit = {}) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if ((init.method ?? 'GET') === 'GET') {
      const match = /^\/v2\/tickets\/([^/?]+)(\/[a-z-]+)?(?:\?.*)?$/.exec(url);
      if (match) {
        const snapshot = graph;
        const found = snapshot.nodes.find((candidate) => candidate.id === match[1]);
        if (match[2] === '/graph') {
          graphReads.push({ url, signal: init.signal ?? null });
          if (holding) await new Promise<void>((resolve) => held.push(resolve));
          if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
          return json(snapshot);
        }
        if (!found) return json({ code: 'NOT_FOUND' }, 404);
        if (!match[2]) return json(found);
        return json({ items: [], nextCursor: null });
      }
    }
    return base(url, init);
  };
  return {
    server,
    graphReads,
    setGraph: (next) => {
      graph = next;
    },
    hold: (on) => {
      holding = on;
      if (!on) for (const resume of held.splice(0)) resume();
    },
    writes: () =>
      server.calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.url}`),
  };
}

type MapEnv = Awaited<ReturnType<typeof harness>> & { queryClient: InstanceType<typeof QueryClient> };
let selectTicket: (id: string | null) => void = () => undefined;

async function mountMap(
  source: GraphServer,
  storage = new MemoryStorage(),
  selected: string | null = null,
  ready: () => boolean = () => nodeButton(mapRoot) !== null,
) {
  const env = await harness(source.server, storage);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  });
  const services = {
    client: env.client,
    pending: env.pending,
    session: env.session,
    storage: env.storage,
    createHasher: () => inlineHasher().hasher,
  };
  const runtime = {
    client: env.client,
    session: env.session,
    pending: env.pending,
    composeServices: services,
  } as unknown as AppRuntime;
  function Host() {
    const [ticket, setTicket] = useState<string | null>(selected);
    selectTicket = setTicket;
    return createElement(TicketMap, { rootId: mapRoot, selectedTicketId: ticket, onSelectTicket: setTicket });
  }
  render(
    createElement(
      RuntimeContext.Provider,
      { value: runtime },
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ComposeServicesProvider, {
          services,
          children: createElement(TicketDraftStorageProvider, {
            storage: env.storage,
            children: createElement(Host),
          }),
        }),
      ),
    ),
  );
  await until(ready, 'map rendered');
  return { ...env, queryClient } as MapEnv;
}

/** Waits up to the settle budget without failing; the assertion that follows reports the real state. */
async function settleQuietly(predicate: () => boolean) {
  await act(async () => {
    await settle(predicate).catch(() => undefined);
  });
}

async function until(predicate: () => boolean, label: string) {
  await act(async () => {
    await settle(predicate, label);
  });
}

/** Identity check without `assert.equal` on DOM nodes, whose failure diff would inspect the whole jsdom tree. */
function assertFocused(expected: Element | null, label: string) {
  const active = document.activeElement;
  assert.ok(
    expected !== null && active === expected,
    `focus phải ở ${label}, đang ở ${active?.tagName} ${active?.getAttribute('aria-label') ?? ''}`,
  );
}

const nodeButton = (id: string) => document.querySelector<HTMLButtonElement>(`button[data-map-node="${id}"]`);
const viewportTransform = () =>
  document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform.replace(/\s+/g, '') ?? '';
const storedView = (storage: MemoryStorage) =>
  JSON.parse(storage.getItem(mapViewStorageKey(mapRoot)) ?? 'null') as MapViewState | null;

test('sơ đồ: root và bước hiện mặc định, task ẩn có badge; nhãn truy cập có cấp, trạng thái chữ và phiên bản', async () => {
  const source = graphServer(baseGraph());
  await mountMap(source);
  assert.ok(screen.getByRole('region', { name: 'Sơ đồ ticket' }));
  for (const id of [mapRoot, stepA, stepB]) assert.ok(nodeButton(id), `node ${id}`);
  assert.equal(nodeButton(taskA1), null, 'task ẩn khi bước thu gọn');
  for (const id of [mapRoot, stepA])
    assert.equal(
      nodeButton(id)?.closest<HTMLElement>('.react-flow__node')?.style.pointerEvents,
      'all',
      'thẻ nhận click thật dù node không selectable/draggable',
    );
  assert.equal(
    nodeButton(stepA)?.getAttribute('aria-label'),
    'Bước: Bước A. Trạng thái: Đang chạy. Phiên bản 1',
  );
  assert.ok(screen.getAllByText('1 quan hệ tới công việc thu gọn').length >= 2);
  assert.ok(screen.getAllByText('phải xong trước').length >= 1, 'cạnh dependency có nhãn chữ');
  const toggle = screen.getByRole('button', { name: 'Mở công việc của Bước A' });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  await act(async () => fireEvent.click(toggle));
  await until(() => nodeButton(taskA1) !== null, 'task A1 visible');
  assert.equal(nodeButton(taskB1), null);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mở tất cả' })));
  await until(() => nodeButton(taskB1) !== null, 'expand all');
  assert.deepEqual(source.writes(), [], 'sơ đồ chỉ đọc, không mutation');
});

const taskA2 = '0d0d0d0d-0000-4000-8000-000000000101';
const cardAt = (id: string) =>
  nodeButton(id)?.closest<HTMLElement>('.react-flow__node')?.style.transform ?? '';

/** Card position on the screen: node translate × zoom + viewport translate (ReactFlow's own transforms). */
function screenOf(id: string): { x: number; y: number } {
  const card = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec(cardAt(id));
  const view = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)\s*scale\(([-\d.e]+)\)/.exec(
    document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? '',
  );
  if (!card || !view) throw new Error(`TRANSFORM_UNREADABLE:${id}`);
  const zoom = Number(view[3]);
  return { x: Number(card[1]) * zoom + Number(view[1]), y: Number(card[2]) * zoom + Number(view[2]) };
}
const cardY = (id: string) => Number(/translate\([-\d.e]+px,\s*([-\d.e]+)px\)/.exec(cardAt(id))?.[1]);

function assertStill(id: string, before: { x: number; y: number }, label: string) {
  const now = screenOf(id);
  assert.ok(
    Math.abs(now.x - before.x) <= 1 && Math.abs(now.y - before.y) <= 1,
    `${label}: (${before.x},${before.y}) → (${now.x},${now.y})`,
  );
}

test('mở/thu gọn: bố cục lại cả cây, task liền bước cha, node neo đứng yên trên màn hình (bước vừa bấm; focus hoặc root khi “tất cả”)', async () => {
  const graph = baseGraph();
  graph.nodes.push(row(taskA2, 'task', stepA, 'Việc A2'));
  const source = graphServer(graph);
  const storage = new MemoryStorage();
  writeMapView(storage, { ...initialMapView(mapRoot), viewport: { x: 40, y: 30, zoom: 0.5 } });
  await mountMap(source, storage);
  const a0 = screenOf(stepA);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mở công việc của Bước A' })));
  await until(() => nodeButton(taskA2) !== null, 'tasks of A');
  await settleQuietly(() => false);
  assertStill(stepA, a0, 'bước A khi mở');
  const pitch = 112 + 24;
  for (const task of [taskA1, taskA2])
    assert.ok(Math.abs(cardY(task) - cardY(stepA)) <= pitch / 2 + 0.5, `${task} liền bước A`);
  const a1 = screenOf(stepA);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn công việc của Bước A' })),
  );
  await until(() => nodeButton(taskA2) === null, 'collapse A');
  await settleQuietly(() => false);
  assertStill(stepA, a1, 'bước A khi thu gọn');
  // “Mở tất cả” without a focused card anchors on the root.
  const r0 = screenOf(mapRoot);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mở tất cả' })));
  await until(() => nodeButton(taskB1) !== null, 'expand all');
  await settleQuietly(() => false);
  assertStill(mapRoot, r0, 'root khi mở tất cả');
  assert.ok(Math.abs(cardY(taskB1) - cardY(stepB)) <= 0.5, 'task duy nhất của B ngang hàng B');
  const cards = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(
    (el) => el.style.transform,
  );
  assert.equal(new Set(cards).size, cards.length, 'không có hai thẻ cùng chỗ');
  // With a focused card, “Thu gọn tất cả” anchors on it.
  await act(async () => fireEvent.focus(nodeButton(stepB) as HTMLElement));
  const b0 = screenOf(stepB);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Thu gọn tất cả' })));
  await until(() => nodeButton(taskB1) === null, 'collapse all');
  await settleQuietly(() => false);
  assertStill(stepB, b0, 'bước B đang focus khi thu gọn tất cả');
});

test('mở node bằng click mở TicketDetail chung; đóng giữ viewport, expanded và trả focus về node', async () => {
  const source = graphServer(baseGraph());
  const storage = new MemoryStorage();
  writeMapView(storage, {
    rootId: mapRoot,
    viewport: { x: -480, y: 140, zoom: 1.7 },
    expanded: [stepA],
    selectedTicketId: null,
    focusedTicketId: null,
  });
  await mountMap(source, storage);
  assert.equal(
    viewportTransform(),
    'translate(-480px,140px)scale(1.7)',
    'khôi phục viewport đã lưu, không fit',
  );
  await until(() => nodeButton(taskA1) !== null, 'expanded restored');
  const trigger = nodeButton(stepB) as HTMLButtonElement;
  trigger.focus();
  await act(async () => fireEvent.click(trigger));
  await until(
    () => document.querySelector(`[data-testid="ticket-detail"][data-ticket-id="${stepB}"]`) !== null,
    'dialog open',
  );
  assert.ok(screen.getByRole('dialog', { name: 'Bước B' }));
  assert.ok(nodeButton(mapRoot), 'sơ đồ vẫn mount khi dialog mở');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Đóng' })));
  await until(() => screen.queryByRole('dialog') === null, 'dialog closed');
  assert.equal(viewportTransform(), 'translate(-480px,140px)scale(1.7)');
  assert.deepEqual(storedView(storage)?.viewport, { x: -480, y: 140, zoom: 1.7 });
  assert.deepEqual(storedView(storage)?.expanded, [stepA]);
  assert.equal(storedView(storage)?.selectedTicketId, null);
  assert.equal(storedView(storage)?.focusedTicketId, stepB);
  await settleQuietly(() => document.activeElement === nodeButton(stepB));
  assertFocused(nodeButton(stepB), 'stepB');
});

test('realtime: refetch cả graph (GET cũ bị hủy), node mới hiện mà viewport và vị trí cũ không đổi', async () => {
  const source = graphServer(baseGraph());
  const storage = new MemoryStorage();
  writeMapView(storage, { ...initialMapView(mapRoot), viewport: { x: 30, y: -20, zoom: 0.9 } });
  const env = await mountMap(source, storage);
  const before = nodeButton(stepA)?.closest<HTMLElement>('.react-flow__node')?.style.transform;
  const reads = source.graphReads.length;
  source.hold(true);
  await act(async () => {
    void env.queryClient.invalidateQueries({ queryKey: queryRoots.graphs });
  });
  await until(() => source.graphReads.length === reads + 1, 'first refetch started');
  const grown = baseGraph();
  grown.nodes.push(row('0d0d0d0d-0000-4000-8000-000000000012', 'step', mapRoot, 'Bước C'));
  grown.nodes[1] = row(stepA, 'step', mapRoot, 'Bước A', 2);
  source.setGraph(grown);
  await act(async () => {
    void env.queryClient.invalidateQueries({ queryKey: queryRoots.graphs });
  });
  await until(() => source.graphReads.length === reads + 2, 'second refetch started');
  assert.equal(source.graphReads[reads]?.signal?.aborted, true, 'GET cũ bị hủy, không vá cạnh từng phần');
  source.hold(false);
  await until(() => nodeButton('0d0d0d0d-0000-4000-8000-000000000012') !== null, 'new step');
  assert.equal(nodeButton(stepA)?.dataset.revision, '2');
  assert.equal(viewportTransform(), 'translate(30px,-20px)scale(0.9)', 'realtime không tự fit');
  assert.equal(nodeButton(stepA)?.closest<HTMLElement>('.react-flow__node')?.style.transform, before);
});

test('node biến mất khi dialog đang mở: đóng trả focus về khung sơ đồ', async () => {
  const source = graphServer(baseGraph());
  const env = await mountMap(source);
  const trigger = nodeButton(stepB) as HTMLButtonElement;
  trigger.focus();
  await act(async () => fireEvent.click(trigger));
  await until(() => screen.queryByRole('dialog') !== null, 'dialog open');
  const shrunk = baseGraph();
  shrunk.nodes = shrunk.nodes.filter((candidate) => candidate.id !== stepB && candidate.id !== taskB1);
  shrunk.dependencies = [];
  source.setGraph(shrunk);
  await act(async () => {
    await env.queryClient.invalidateQueries({ queryKey: queryRoots.graphs });
  });
  await until(() => nodeButton(stepB) === null, 'node gone');
  await act(async () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }));
  await until(() => screen.queryByRole('dialog') === null, 'dialog closed');
  // Radix returns focus on the next tick after the content unmounts.
  const region = screen.getByRole('region', { name: 'Sơ đồ ticket' });
  await settleQuietly(() => document.activeElement === region);
  assertFocused(region, 'khung sơ đồ');
});

test('bàn phím: mũi tên di chuyển focus giữa node theo cây; bảng quan hệ liệt kê đủ ID', async () => {
  const source = graphServer(baseGraph());
  await mountMap(source);
  const rootButton = nodeButton(mapRoot) as HTMLButtonElement;
  rootButton.focus();
  await act(async () => fireEvent.keyDown(rootButton, { key: 'ArrowRight' }));
  assertFocused(nodeButton(stepA), 'stepA');
  await act(async () => fireEvent.keyDown(nodeButton(stepA) as HTMLElement, { key: 'ArrowDown' }));
  assertFocused(nodeButton(stepB), 'stepB');
  await act(async () => fireEvent.keyDown(nodeButton(stepB) as HTMLElement, { key: 'ArrowLeft' }));
  assertFocused(nodeButton(mapRoot), 'mapRoot');
  await act(async () => fireEvent.focus(nodeButton(stepB) as HTMLElement));
  const panel = await screen.findByRole('region', { name: 'Quan hệ của Bước B' });
  for (const text of [mapRoot, stepA, taskB1])
    assert.ok(panel.textContent?.includes(text), `panel thiếu ${text}`);
});

test('dữ liệu graph hỏng: báo chẩn đoán, có “Tải lại” và danh sách thay thế giữ mọi node', async () => {
  const broken = baseGraph();
  broken.dependencies.push({ ticketId: stepA, predecessorId: '0d0d0d0d-0000-4000-8000-000000000999' });
  const source = graphServer(broken);
  await mountMap(source, new MemoryStorage(), null, () => screen.queryByRole('alert') !== null);
  assert.equal(document.querySelector('.react-flow'), null, 'không vẽ sơ đồ từ dữ liệu rách');
  const alert = screen.getByRole('alert');
  assert.match(alert.textContent ?? '', /chưa nhất quán/);
  const fallback = screen.getByRole('list', { name: 'Danh sách ticket thay cho sơ đồ' });
  for (const title of ['Yêu cầu gốc', 'Bước A', 'Bước B', 'Việc A1', 'Việc B1'])
    assert.ok(fallback.textContent?.includes(title), `danh sách thiếu ${title}`);
  const reads = source.graphReads.length;
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Tải lại' })));
  await until(() => source.graphReads.length === reads + 1, 'reload');
});

test('mở bằng URL (reload) với ticket đã chọn: dialog hiện, đóng gọi onSelectTicket(null)', async () => {
  const source = graphServer(baseGraph());
  await mountMap(source, new MemoryStorage(), stepA);
  await until(() => screen.queryByRole('dialog', { name: 'Bước A' }) !== null, 'dialog from url');
  await act(async () => selectTicket(null));
  await until(() => screen.queryByRole('dialog') === null, 'closed');
  assert.ok(nodeButton(stepA));
});

test('khung sơ đồ đo lại chiều cao khi nội dung phía trên đổi cỡ (ResizeObserver), không chỉ khi resize cửa sổ', async () => {
  const source = graphServer(baseGraph());
  await mountMap(source);
  const frame = document.querySelector<HTMLElement>('.react-flow')?.parentElement as HTMLElement;
  const first = frame.style.height;
  // Content above the frame grows: the frame now starts 300px down.
  frame.getBoundingClientRect = () =>
    ({ top: 300, left: 0, right: 1024, bottom: 768, width: 1024, height: 468, x: 0, y: 300 }) as DOMRect;
  await act(async () => {
    for (const observer of observers) observer.trigger();
  });
  assert.equal(frame.style.height, `${window.innerHeight - 300 - 16}px`, `trước: ${first}`);
});
