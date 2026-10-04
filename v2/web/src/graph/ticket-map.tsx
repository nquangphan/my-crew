/**
 * Ticket map: the whole request tree from root (left) to steps and tasks (right), read-only. Data is the shared
 * graph query (`queryKeys.graph`), so an event invalidation refetches the whole root (TanStack cancels the GET
 * in flight) and board/list/map show the same revision; edges are never patched one by one. Clicking a card
 * opens the shared `TicketDialog`; the map stays mounted behind it, and closing only clears the selection, so
 * viewport, expanded steps and focus are exactly as before. The view state is kept per root in tab storage.
 * A new root is fitted once; realtime updates never refit. Torn or malformed data shows a diagnostic and falls
 * back to the equivalent list, which is also the narrow-screen view.
 */
import { Link, useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import {
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Viewport,
} from '@xyflow/react';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { routeUuid, useRuntime } from '../app-runtime.ts';
import type { Ticket, TicketGraph } from '../contracts/tickets.ts';
import { TicketDialog } from '../tickets/dialog.tsx';
import { TicketPagination } from '../tickets/list.tsx';
import { failureText, requestListFilters, useTicketGraph, useTicketList } from '../tickets/queries.ts';
import { levelLabels, mergeTicketPages, requestRoots, statusIcons, statusLabels } from '../tickets/status.ts';
import {
  cardHeight,
  cardWidth,
  followAnchor,
  layoutHierarchy,
  type MapDirection,
  neighbourInDirection,
  type Point,
  placeNewNodes,
} from './layout.ts';
import {
  expandableIds,
  hiddenRelationCounts,
  type MapProjection,
  nodeRelations,
  projectGraph,
} from './project.ts';
import {
  closeMapDialog,
  closeMapDialogNavigation,
  initialMapView,
  type MapViewState,
  mapDialogStateKey,
  maxZoom,
  minZoom,
  moveMapViewport,
  openMapDialog,
  parseMapSearch,
  readMapView,
  setMapExpanded,
  toggleMapExpanded,
  writeMapView,
} from './state.ts';
import { edgeLabel, type TicketFlowEdge, ticketEdgeTypes } from './ticket-edge.tsx';
import { type TicketFlowNode, TicketNode, type TicketNodeActions } from './ticket-node.tsx';

export type TicketMapProps = {
  rootId: string;
  selectedTicketId: string | null;
  onSelectTicket: (ticketId: string | null) => void;
  /** Called when the graph shows that `rootId` is a descendant; the caller can switch to the real root. */
  onRootResolved?: (rootId: string) => void;
};

const nodeTypes = { ticket: TicketNode };
const cardSize = { width: cardWidth, height: cardHeight };
const cardPointer: CSSProperties = { pointerEvents: 'all' };
/** Fixed handle geometry, so edges can be drawn before (or without) DOM measurement. */
const cardHandles: NonNullable<TicketFlowNode['handles']> = [
  { type: 'target', position: Position.Left, x: 0, y: cardHeight / 2, width: 1, height: 1 },
  { type: 'source', position: Position.Right, x: cardWidth, y: cardHeight / 2, width: 1, height: 1 },
];
const minFrameHeight = 352;
const flowStyle: CSSProperties = {
  border: '1px solid rgb(148 163 184 / 0.6)',
  borderRadius: '0.75rem',
};
const barStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' };
const controlsStyle: CSSProperties = { ...barStyle, margin: 0, padding: 0, border: 'none', minWidth: 0 };
const buttonStyle: CSSProperties = {
  font: 'inherit',
  padding: '0.35rem 0.7rem',
  borderRadius: '0.5rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};
const panelStyle: CSSProperties = {
  display: 'grid',
  gap: '0.35rem',
  padding: '0.75rem',
  borderRadius: '0.75rem',
  border: '1px solid rgb(148 163 184 / 0.6)',
  overflowWrap: 'anywhere',
};
const outlineButton: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'transparent',
  border: 'none',
  padding: 0,
  textAlign: 'left',
  textDecoration: 'underline',
  cursor: 'pointer',
  overflowWrap: 'anywhere',
};

const diagnosticText: Readonly<Record<string, string>> = {
  DUPLICATE_ID: 'Ticket xuất hiện nhiều lần',
  ROOT_MISSING: 'Không tìm thấy yêu cầu gốc',
  ROOT_MULTIPLE: 'Có thêm một yêu cầu gốc khác',
  ROOT_MISMATCH: 'Ticket thuộc yêu cầu gốc khác',
  PROJECT_MISMATCH: 'Ticket thuộc dự án khác',
  PARENT_MISSING: 'Thiếu ticket cha',
  LEVEL_INVALID: 'Cấp ticket không khớp với ticket cha',
  PARENT_CYCLE: 'Chuỗi cha/con có vòng',
  DEPENDENCY_CYCLE: 'Phụ thuộc có vòng',
  DEPENDENCY_DANGLING: 'Phụ thuộc trỏ tới ticket không có trong sơ đồ',
  REPAIR_DANGLING: 'Vòng sửa trỏ tới ticket không có trong sơ đồ',
};

export function diagnosticLabel(code: string): string {
  const split = code.indexOf(':');
  const kind = split < 0 ? code : code.slice(0, split);
  const subject = split < 0 ? '' : code.slice(split + 1);
  return `${diagnosticText[kind] ?? `Mã ${kind}`}${subject ? ` (${subject})` : ''}`;
}

function narrowScreen(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 40rem)').matches
    : false;
}

/**
 * Height that ends the map frame at the bottom of the window (page scrolled to the top), so “Vừa khung” shows
 * the whole tree without scrolling; never below `minFrameHeight`.
 */
function useFrameHeight(frame: HTMLElement | null): number {
  const [height, setHeight] = useState(minFrameHeight);
  useLayoutEffect(() => {
    if (!frame) return;
    const measure = () => {
      const top = frame.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(minFrameHeight, Math.floor(window.innerHeight - top - 16)));
    };
    measure();
    // Content above the frame can change height after the first measure (picker paging, the current-step
    // line wrapping): observe the page and the body, not only window resizes.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    const page = frame.closest('.page-stack');
    if (page) observer.observe(page);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [frame]);
  return height;
}

export function TicketMap(props: TicketMapProps) {
  return (
    <ReactFlowProvider>
      <MapView key={props.rootId} {...props} />
    </ReactFlowProvider>
  );
}

function MapView({ rootId, selectedTicketId, onSelectTicket, onRootResolved }: TicketMapProps) {
  const { client, composeServices } = useRuntime();
  const storage = composeServices?.storage ?? null;
  const graph = useTicketGraph(client, rootId);
  const flow = useReactFlow<TicketFlowNode, TicketFlowEdge>();
  const nodesReady = useNodesInitialized();
  const [restored] = useState(() => readMapView(storage, rootId));
  const [view, setView] = useState<MapViewState>(() => ({
    ...(restored ?? initialMapView(rootId)),
    selectedTicketId,
  }));
  const [listMode, setListMode] = useState(narrowScreen);
  // Owner relayout requests: “Sắp xếp lại” (no anchor) and structural changes (anchored).
  const [relayout, setRelayout] = useState<{ run: number; anchor: string | null }>({ run: 0, anchor: null });
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const frameHeight = useFrameHeight(frame);
  const trigger = useRef<HTMLElement | null>(null);
  const fitted = useRef(restored !== null);

  useEffect(() => {
    setView((current) =>
      current.selectedTicketId === selectedTicketId
        ? current
        : selectedTicketId === null
          ? closeMapDialog(current)
          : openMapDialog(current, selectedTicketId),
    );
  }, [selectedTicketId]);
  useEffect(() => {
    writeMapView(storage, view);
  }, [storage, view]);

  const expanded = useMemo(() => new Set(view.expanded), [view.expanded]);
  const projection = useMemo<MapProjection | null>(
    () => (graph.data ? projectGraph(graph.data, rootId, expanded) : null),
    [graph.data, rootId, expanded],
  );
  useEffect(() => {
    if (projection && projection.rootId !== rootId && onRootResolved) onRootResolved(projection.rootId);
  }, [projection, rootId, onRootResolved]);

  // Positions follow the projection as derived state (updated during render, React's pattern for state that
  // tracks inputs). The first projection is laid out; data changes (refetch, new child) keep every known card
  // and only place new ones; an owner relayout request (expand/collapse, “Sắp xếp lại”) lays the whole tree
  // out and, when it names an anchor, records the anchor's displacement so the viewport can follow it.
  const [layout, setLayout] = useState<{
    projection: MapProjection | null;
    run: number;
    positions: Record<string, Point>;
    anchor: { run: number; id: string; from: Point } | null;
  }>({ projection: null, run: 0, positions: {}, anchor: null });
  let positions = layout.positions;
  if (projection && (layout.projection !== projection || layout.run !== relayout.run)) {
    const requested = layout.run !== relayout.run;
    positions =
      layout.projection === null || requested
        ? layoutHierarchy(projection)
        : placeNewNodes(layout.positions, projection);
    // The anchor must be on screen before and after; otherwise (e.g. a focused task hidden by “Thu gọn tất cả”)
    // the root anchors the move.
    const candidates = requested && relayout.anchor !== null ? [relayout.anchor, projection.rootId] : [];
    const anchorId = candidates.find((id) => layout.positions[id] && positions[id]);
    setLayout({
      projection,
      run: relayout.run,
      positions,
      anchor:
        anchorId === undefined
          ? layout.anchor
          : { run: relayout.run, id: anchorId, from: layout.positions[anchorId] as Point },
    });
  }
  const positionsRef = useRef(positions);
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  const saveViewport = useCallback((viewport: Viewport) => {
    setView((current) => moveMapViewport(current, viewport));
  }, []);

  // Keep the anchor of an owner relayout still on screen: shift the viewport by its displacement, once per run.
  const anchoredRun = useRef(0);
  useLayoutEffect(() => {
    const anchor = layout.anchor;
    if (!anchor || anchoredRun.current === anchor.run) return;
    anchoredRun.current = anchor.run;
    const to = layout.positions[anchor.id];
    if (!to) return;
    void flow
      .setViewport(followAnchor(anchor.from, to, flow.getViewport()))
      .then(() => saveViewport(flow.getViewport()));
  }, [layout, flow, saveViewport]);

  const focusNode = useCallback(
    (ticketId: string) => {
      const button = container?.querySelector<HTMLButtonElement>(`button[data-map-node="${ticketId}"]`);
      if (button) return button.focus();
      const at = positionsRef.current[ticketId];
      if (!at) return;
      // Off-screen cards are not rendered (onlyRenderVisibleElements): bring the card into view, then focus it.
      void flow.setCenter(at.x + cardWidth / 2, at.y + cardHeight / 2, { zoom: flow.getZoom() }).then(() => {
        saveViewport(flow.getViewport());
        requestAnimationFrame(() =>
          container?.querySelector<HTMLButtonElement>(`button[data-map-node="${ticketId}"]`)?.focus(),
        );
      });
    },
    [container, flow, saveViewport],
  );

  const actionsRef = useRef<TicketNodeActions | null>(null);
  // Card callbacks read the latest render's values; they run only from events, after commit.
  useLayoutEffect(() => {
    actionsRef.current = {
      open: (ticketId, element) => {
        trigger.current = element;
        onSelectTicket(ticketId);
      },
      toggle: (ticketId) => {
        setView((current) => toggleMapExpanded(current, ticketId));
        setRelayout((current) => ({ run: current.run + 1, anchor: ticketId }));
      },
      navigate: (ticketId, direction: MapDirection) => {
        if (!projection) return;
        const next = neighbourInDirection(projection, positionsRef.current, ticketId, direction);
        if (next) focusNode(next);
      },
      focus: (ticketId) =>
        setView((current) =>
          current.focusedTicketId === ticketId ? current : { ...current, focusedTicketId: ticketId },
        ),
    };
  });
  const actions = useMemo<TicketNodeActions>(
    () => ({
      open: (id, element) => actionsRef.current?.open(id, element),
      toggle: (id) => actionsRef.current?.toggle(id),
      navigate: (id, direction) => actionsRef.current?.navigate(id, direction),
      focus: (id) => actionsRef.current?.focus(id),
    }),
    [],
  );

  const childCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!graph.data) return counts;
    const collapsible = new Set(expandableIds(graph.data));
    for (const row of mergeTicketPages([graph.data.nodes]))
      if (row.parentId !== null && collapsible.has(row.parentId))
        counts[row.parentId] = (counts[row.parentId] ?? 0) + 1;
    return counts;
  }, [graph.data]);
  const badges = useMemo(
    () => (graph.data && projection ? hiddenRelationCounts(graph.data, projection) : {}),
    [graph.data, projection],
  );
  const titles = useMemo(
    () => new Map((graph.data?.nodes ?? []).map((row) => [row.id, row.title])),
    [graph.data],
  );

  const nodes = useMemo<TicketFlowNode[]>(
    () =>
      (projection?.nodes ?? []).map((ticket) => ({
        id: ticket.id,
        type: 'ticket',
        position: positions[ticket.id] ?? { x: 0, y: 0 },
        width: cardWidth,
        height: cardHeight,
        // Cards have a fixed size: declaring it lets fit/bounds include cards that are off screen and therefore
        // never mounted or measured (onlyRenderVisibleElements).
        measured: cardSize,
        handles: cardHandles,
        // ReactFlow turns pointer events off for nodes that are neither selectable nor draggable; the card's
        // own buttons must stay clickable.
        style: cardPointer,
        draggable: false,
        connectable: false,
        deletable: false,
        selectable: false,
        focusable: false,
        data: {
          ticket,
          isRoot: ticket.id === projection?.rootId,
          childCount: childCounts[ticket.id] ?? 0,
          expanded: expanded.has(ticket.id),
          hiddenRelations: badges[ticket.id] ?? 0,
          actions,
        },
      })),
    [projection, positions, childCounts, expanded, badges, actions],
  );
  const edges = useMemo<TicketFlowEdge[]>(
    () =>
      (projection?.edges ?? []).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.kind,
        data: edge.cycleId ? { cycleId: edge.cycleId } : {},
        markerEnd: edge.kind === 'parent' ? undefined : { type: MarkerType.ArrowClosed, color: '#e2e8f0' },
        focusable: false,
        selectable: false,
        deletable: false,
        ariaLabel: edgeLabel(edge, (id) => titles.get(id) ?? id),
      })),
    [projection, titles],
  );

  // A root seen for the first time in this tab is fitted once; later data changes never refit.
  useEffect(() => {
    if (fitted.current || !nodesReady || nodes.length === 0) return;
    fitted.current = true;
    void flow.fitView({ padding: 0.15, maxZoom: 1 }).then(() => saveViewport(flow.getViewport()));
  }, [nodesReady, nodes.length, flow, saveViewport]);

  const explicit = (action: Promise<boolean>) => {
    void action.then(() => saveViewport(flow.getViewport()));
  };
  const rearrange = () => setRelayout((current) => ({ run: current.run + 1, anchor: null }));
  // “Mở/Thu gọn tất cả” anchor on the focused card, or on the root when no card has focus.
  const setExpandedIds = (ids: readonly string[]) => {
    setView((current) => setMapExpanded(current, ids));
    setRelayout((current) => ({
      run: current.run + 1,
      anchor: view.focusedTicketId ?? projection?.rootId ?? null,
    }));
  };

  const diagnostics = projection?.diagnostics ?? [];
  const showList = listMode || diagnostics.length > 0;
  const selectedNode =
    selectedTicketId === null
      ? null
      : container?.querySelector<HTMLElement>(`[data-map-node="${selectedTicketId}"]`);
  const returnFocus = (trigger.current?.isConnected ? trigger.current : null) ?? selectedNode ?? container;
  const focused = view.focusedTicketId;

  return (
    <section
      ref={setContainer}
      aria-label="Sơ đồ ticket"
      data-testid="ticket-map"
      data-nodes={projection?.nodes.length}
      data-focus-fallback=""
      tabIndex={-1}
      style={{ display: 'grid', gap: '0.75rem', minWidth: 0 }}
    >
      {graph.isPending && <p role="status">Đang tải sơ đồ…</p>}
      {graph.error && (
        <p role="alert">
          Không tải được sơ đồ: {failureText(graph.error)}{' '}
          <button type="button" style={buttonStyle} onClick={() => void graph.refetch()}>
            Thử lại
          </button>
        </p>
      )}
      {graph.data && projection && (
        <>
          <CurrentSteps nodes={graph.data.nodes} />
          {diagnostics.length > 0 && (
            <div role="alert" style={panelStyle}>
              <strong>
                Dữ liệu sơ đồ chưa nhất quán — đang hiện dạng danh sách để không mất ticket nào.
              </strong>
              <ul style={{ margin: 0 }}>
                {diagnostics.map((code) => (
                  <li key={code}>{diagnosticLabel(code)}</li>
                ))}
              </ul>
              <div>
                <button type="button" style={buttonStyle} onClick={() => void graph.refetch()}>
                  Tải lại
                </button>
              </div>
            </div>
          )}
          <fieldset aria-label="Điều khiển sơ đồ" style={controlsStyle}>
            {!showList && (
              <>
                <button type="button" style={buttonStyle} onClick={() => explicit(flow.zoomIn())}>
                  Phóng to
                </button>
                <button type="button" style={buttonStyle} onClick={() => explicit(flow.zoomOut())}>
                  Thu nhỏ
                </button>
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => explicit(flow.fitView({ padding: 0.15, maxZoom: 1 }))}
                >
                  Vừa khung
                </button>
                <button type="button" style={buttonStyle} onClick={rearrange}>
                  Sắp xếp lại
                </button>
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => setExpandedIds(expandableIds(graph.data))}
                >
                  Mở tất cả
                </button>
                <button type="button" style={buttonStyle} onClick={() => setExpandedIds([])}>
                  Thu gọn tất cả
                </button>
              </>
            )}
            {diagnostics.length === 0 && (
              <button
                type="button"
                style={buttonStyle}
                aria-pressed={listMode}
                onClick={() => setListMode(!listMode)}
              >
                {listMode ? 'Xem dạng sơ đồ' : 'Xem dạng danh sách'}
              </button>
            )}
          </fieldset>
          {showList ? (
            <TicketOutline
              graph={graph.data}
              rootId={projection.rootId}
              onOpen={(id, element) => actionsRef.current?.open(id, element)}
            />
          ) : (
            <div ref={setFrame} style={{ ...flowStyle, height: frameHeight }}>
              <ReactFlow<TicketFlowNode, TicketFlowEdge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={ticketEdgeTypes}
                defaultViewport={view.viewport}
                minZoom={minZoom}
                maxZoom={maxZoom}
                onMoveEnd={(_, viewport) => saveViewport(viewport)}
                nodesDraggable={false}
                nodesConnectable={false}
                nodesFocusable={false}
                edgesFocusable={false}
                elementsSelectable={false}
                deleteKeyCode={null}
                selectionKeyCode={null}
                multiSelectionKeyCode={null}
                disableKeyboardA11y
                zoomOnDoubleClick={false}
                onlyRenderVisibleElements
                colorMode="dark"
              />
            </div>
          )}
          {focused !== null && titles.has(focused) && (
            <RelationsPanel graph={graph.data} ticketId={focused} titleOf={(id) => titles.get(id) ?? id} />
          )}
        </>
      )}
      <TicketDialog
        ticketId={selectedTicketId}
        returnFocus={returnFocus}
        onClose={() => onSelectTicket(null)}
      />
    </section>
  );
}

/** Running or waiting steps, by producer status only (no inferred order). */
function CurrentSteps({ nodes }: { nodes: readonly Ticket[] }) {
  const active = mergeTicketPages([nodes]).filter(
    (row) => row.level === 'step' && (row.status === 'running' || row.status === 'needs_input'),
  );
  return (
    <p style={{ margin: 0 }}>
      {active.length === 0
        ? 'Chưa có bước nào đang chạy hoặc chờ bạn.'
        : `Bước đang làm: ${active.map((row) => `${row.title} (${statusLabels[row.status]})`).join(', ')}.`}
    </p>
  );
}

function RelationsPanel({
  graph,
  ticketId,
  titleOf,
}: {
  graph: TicketGraph;
  ticketId: string;
  titleOf: (id: string) => string;
}) {
  const relations = nodeRelations(graph, ticketId);
  const item = (id: string) => `${titleOf(id)} — ${id}`;
  const rows: [string, string[]][] = [
    ['Ticket cha', relations.parentId === null ? [] : [item(relations.parentId)]],
    ['Ticket con', relations.children.map(item)],
    ['Phải xong trước ticket này', relations.predecessors.map(item)],
    ['Ticket này phải xong trước', relations.successors.map(item)],
    [
      'Vòng sửa',
      relations.repairs.map(
        (link) => `Vòng ${link.cycleId}: kiểm tra ${item(link.checkStepId)} → sửa ${item(link.fixTicketId)}`,
      ),
    ],
  ];
  return (
    <section aria-label={`Quan hệ của ${titleOf(ticketId)}`} style={panelStyle}>
      <h2 style={{ margin: 0, fontSize: '1rem' }}>Quan hệ của {titleOf(ticketId)}</h2>
      <dl style={{ margin: 0, display: 'grid', gap: '0.25rem' }}>
        {rows.map(([label, values]) => (
          <div key={label}>
            <dt style={{ fontWeight: 600 }}>{label}</dt>
            <dd style={{ margin: 0 }}>{values.length === 0 ? 'Không có' : values.join('; ')}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * List equivalent of the map: every ticket of the root in tree order (iterative, indented by depth), with
 * level, status text, predecessors and repair links. Tickets outside the tree are listed after it.
 */
function TicketOutline({
  graph,
  rootId,
  onOpen,
}: {
  graph: TicketGraph;
  rootId: string;
  onOpen: (ticketId: string, trigger: HTMLElement) => void;
}) {
  const rows = useMemo(() => {
    const nodes = mergeTicketPages([graph.nodes]);
    const byId = new Map(nodes.map((row) => [row.id, row]));
    const children = new Map<string, Ticket[]>();
    for (const row of nodes)
      if (row.parentId !== null && byId.has(row.parentId))
        children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
    const ordered: { ticket: Ticket; depth: number }[] = [];
    const seen = new Set<string>();
    const walk = (start: Ticket, depth: number) => {
      const stack = [{ ticket: start, depth }];
      while (stack.length > 0) {
        const next = stack.pop() as { ticket: Ticket; depth: number };
        if (seen.has(next.ticket.id)) continue;
        seen.add(next.ticket.id);
        ordered.push(next);
        const kids = [...(children.get(next.ticket.id) ?? [])].sort((a, b) => (a.id < b.id ? 1 : -1));
        for (const kid of kids) stack.push({ ticket: kid, depth: next.depth + 1 });
      }
    };
    const root = byId.get(rootId);
    if (root) walk(root, 0);
    for (const row of [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) if (!seen.has(row.id)) walk(row, 0);
    return ordered;
  }, [graph.nodes, rootId]);
  const titleOf = (id: string) => graph.nodes.find((row) => row.id === id)?.title ?? id;
  return (
    <ul
      aria-label="Danh sách ticket thay cho sơ đồ"
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.4rem' }}
    >
      {rows.map(({ ticket, depth }) => {
        const relations = nodeRelations(graph, ticket.id);
        return (
          <li
            key={ticket.id}
            data-ticket-id={ticket.id}
            data-revision={ticket.revision}
            style={{ paddingLeft: `${Math.min(depth, 6) * 1.25}rem`, display: 'grid', gap: '0.15rem' }}
          >
            <button
              type="button"
              style={outlineButton}
              onClick={(event) => onOpen(ticket.id, event.currentTarget)}
            >
              {ticket.title}
            </button>
            <span>
              {levelLabels[ticket.level]} · <span aria-hidden="true">{statusIcons[ticket.status]}</span>{' '}
              {statusLabels[ticket.status]} · Phiên bản {ticket.revision}
            </span>
            {relations.predecessors.length > 0 && (
              <span>Sau khi xong: {relations.predecessors.map(titleOf).join(', ')}</span>
            )}
            {relations.repairs.length > 0 && (
              <span>
                Vòng sửa:{' '}
                {relations.repairs
                  .map((link) => `${titleOf(link.checkStepId)} → ${titleOf(link.fixTicketId)}`)
                  .join(', ')}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Root picker: request roots of the project (producer `level=request`), paged with “Tải thêm”. */
function RootPicker({
  projectId,
  rootId,
  onPick,
}: {
  projectId: string;
  rootId: string | undefined;
  onPick: (rootId: string) => void;
}) {
  const list = useTicketList(useRuntime().client, requestListFilters({ projectId }));
  const roots = requestRoots(list.tickets);
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <label style={barStyle}>
        Yêu cầu
        <select
          style={{ maxWidth: '100%', minWidth: 0 }}
          value={rootId ?? ''}
          onChange={(event) => {
            if (event.target.value) onPick(event.target.value);
          }}
        >
          <option value="">Chọn yêu cầu…</option>
          {rootId !== undefined && !roots.some((row) => row.id === rootId) && (
            <option value={rootId}>{rootId}</option>
          )}
          {roots.map((row) => (
            <option key={row.id} value={row.id}>
              {row.title}
            </option>
          ))}
        </select>
      </label>
      <TicketPagination list={list} />
    </div>
  );
}

function MapPageFrame({ projectId, children }: { projectId: string | null; children: ReactNode }) {
  return (
    <section className="page-stack" aria-labelledby="map-heading">
      <div className="page-intro">
        <h1 id="map-heading">Sơ đồ yêu cầu</h1>
      </div>
      {projectId && (
        <nav style={barStyle} aria-label="Cách xem ticket">
          <Link
            className="nav-link"
            to="/projects/$projectId/tickets"
            params={{ projectId }}
            search={{ view: 'board' }}
          >
            Dạng bảng
          </Link>
          <Link
            className="nav-link"
            to="/projects/$projectId/tickets"
            params={{ projectId }}
            search={{ view: 'list' }}
          >
            Dạng danh sách
          </Link>
        </nav>
      )}
      {children}
    </section>
  );
}

function MapNotFound({ what }: { what: string }) {
  return (
    <section className="page-stack" aria-labelledby="map-heading">
      <h1 id="map-heading">Không tìm thấy {what}</h1>
      <Link className="nav-link" to="/">
        Về tổng quan
      </Link>
    </section>
  );
}

/**
 * Route `/requests/$rootId/map?ticket=<uuid>`. The project (board/list links, request picker) comes from the
 * root ticket itself, so a map is never shown under another project's page. The open dialog lives in the URL.
 */
export function RequestMapPage() {
  const params = useParams({ strict: false }) as { rootId?: string };
  const rootId = routeUuid(params.rootId);
  const ticket = parseMapSearch(useSearch({ strict: false })).ticket ?? null;
  const navigate = useNavigate();
  const graph = useTicketGraph(useRuntime().client, rootId ?? undefined);
  const go = useCallback(
    (root: string, nextTicket: string | null, replace = false) =>
      void navigate({
        to: '/requests/$rootId/map',
        params: { rootId: root },
        search: nextTicket === null ? {} : { ticket: nextTicket },
        replace,
      }),
    [navigate],
  );
  const onRootResolved = useCallback((resolved: string) => go(resolved, ticket, true), [go, ticket]);
  const router = useRouter();
  // Opening pushes one history entry marked with this root; closing goes back over it only when the current
  // entry carries that mark (so the previous entry is this map). A deep link, a reload of an unmarked entry or
  // an entry pushed by anything else is closed by replacing it. Back while the dialog is open closes it.
  const selectTicket = (ticketId: string | null) => {
    if (!rootId) return;
    if (ticketId !== null) {
      void navigate({
        to: '/requests/$rootId/map',
        params: { rootId },
        search: { ticket: ticketId },
        state: (previous) => Object.assign({}, previous, { [mapDialogStateKey]: rootId }),
      });
    } else if (closeMapDialogNavigation(router.history.location.state, rootId) === 'back')
      router.history.back();
    else go(rootId, null, true);
  };
  if (!rootId) return <MapNotFound what="yêu cầu" />;
  const root = graph.data?.nodes.find((row) => row.id === rootId);
  const projectId = root?.projectId ?? null;
  return (
    <MapPageFrame projectId={projectId}>
      {projectId && (
        <RootPicker
          projectId={projectId}
          rootId={root?.rootId ?? rootId}
          onPick={(picked) => go(picked, null)}
        />
      )}
      <TicketMap
        rootId={rootId}
        selectedTicketId={ticket}
        onSelectTicket={selectTicket}
        onRootResolved={onRootResolved}
      />
    </MapPageFrame>
  );
}

/** Route `/projects/$projectId/map`: request picker of a project (links with `?root=` are redirected by the router). */
export function ProjectMapPickerPage() {
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = routeUuid(params.projectId);
  const navigate = useNavigate();
  if (!projectId) return <MapNotFound what="dự án" />;
  return (
    <MapPageFrame projectId={projectId}>
      <RootPicker
        projectId={projectId}
        rootId={undefined}
        onPick={(picked) => void navigate({ to: '/requests/$rootId/map', params: { rootId: picked } })}
      />
      <p>Chọn một yêu cầu để xem sơ đồ.</p>
    </MapPageFrame>
  );
}
