/**
 * Ticket map: the whole request tree from root (left) to steps and tasks (right), read-only. Data is the shared
 * graph query (`queryKeys.graph`), so an event invalidation refetches the whole root (TanStack cancels the GET
 * in flight) and board/list/map show the same revision; edges are never patched one by one. Clicking a card
 * opens the shared `TicketDialog`; the map stays mounted behind it, and closing only clears the selection, so
 * viewport, expanded steps and focus are exactly as before. The view state is kept per root in tab storage.
 * A new root is fitted once; realtime updates never refit. Torn or malformed data shows a diagnostic and falls
 * back to the equivalent list, which is also the narrow-screen view.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import {
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
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
import {
  failureText,
  projectsQueryOptions,
  requestListFilters,
  useTicketGraph,
  useTicketList,
} from '../tickets/queries.ts';
import { levelLabels, mergeTicketPages, requestRoots, statusIcons, statusLabels } from '../tickets/status.ts';
import {
  cardHeight,
  cardWidth,
  chooseRealtimeAnchor,
  followAnchor,
  initialViewport,
  layoutHierarchy,
  type MapDirection,
  neighbourInDirection,
  type Point,
  placeEdgeLabels,
  type SideRoute,
  sideRoutes,
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
import { edgeColors, edgeLabel, repairLabel, type TicketFlowEdge, ticketEdgeTypes } from './ticket-edge.tsx';
import { statusDotColors, type TicketFlowNode, TicketNode, type TicketNodeActions } from './ticket-node.tsx';

export type TicketMapProps = {
  rootId: string;
  selectedTicketId: string | null;
  onSelectTicket: (ticketId: string | null) => void;
  /** Called when the graph shows that `rootId` is a descendant; the caller can switch to the real root. */
  onRootResolved?: (rootId: string) => void;
  /** View switch (Bảng/Danh sách/Sơ đồ) rendered in the header; the page owns its links. */
  viewSwitch?: ReactNode;
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
/** Modal-like shell of the owner-approved mockup. */
const frameShellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  background: '#17191c',
  color: '#e8e9eb',
  border: '1px solid #2b2f35',
  borderRadius: 6,
  overflow: 'hidden',
};
const headerStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '16px 20px',
  borderBottom: '1px solid #2b2f35',
};
const innerStyle: CSSProperties = { margin: 0, padding: '12px 20px' };
const flowStyle: CSSProperties = { background: '#17191c' };
const barStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' };
const controlsStyle: CSSProperties = { ...barStyle, margin: 0, padding: 0, border: 'none', minWidth: 0 };
const buttonStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  padding: '8px 12px',
  minHeight: 36,
  borderRadius: 4,
  border: '1px solid #2b2f35',
  background: '#1c1f23',
  color: '#e8e9eb',
  cursor: 'pointer',
};
const iconButtonStyle: CSSProperties = { ...buttonStyle, minWidth: 36, padding: '8px 0' };
const legendStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '16px 24px',
  margin: 0,
  padding: '12px 20px',
  listStyle: 'none',
  borderTop: '1px solid #2b2f35',
  fontSize: 12,
  color: '#9aa0a6',
};
const legendItem: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const legendDot = (color: string): CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
});

/** Legend of the mockup: status dots (the status is also written on every card) and the three edge kinds. */
function Legend() {
  const items: [string, CSSProperties][] = [
    ['Xong', legendDot(statusDotColors.done)],
    ['Đang làm', legendDot(statusDotColors.running)],
    ['Đang chờ', legendDot(statusDotColors.needs_input)],
    ['Chưa bắt đầu', legendDot(statusDotColors.pending)],
    ['Cha – con', { width: 18, height: 1, background: edgeColors.parent }],
    ['Phụ thuộc', { width: 18, height: 0, borderTop: `1px dashed ${edgeColors.dependency}` }],
    ['Sửa lỗi', { width: 18, height: 0, borderTop: `2px dotted ${edgeColors.repair}` }],
  ];
  return (
    <ul aria-label="Chú giải" style={legendStyle}>
      {items.map(([label, swatch]) => (
        <li key={label} style={legendItem}>
          <span aria-hidden="true" style={swatch} />
          {label}
        </li>
      ))}
    </ul>
  );
}
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
 * Height that ends the map shell (frame plus legend) at the bottom of the window (page scrolled to the top), so
 * “Vừa khung” shows the whole tree and the legend without scrolling; never below `minFrameHeight`.
 */
function useFrameHeight(frame: HTMLElement | null): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!frame) return;
    const measure = () => {
      const box = frame.getBoundingClientRect();
      const top = box.top + window.scrollY;
      // Leave room for what follows the frame inside the map shell (the legend), so it stays in the window.
      const shell = frame.closest('[data-testid="ticket-map"]')?.getBoundingClientRect();
      const below = shell ? Math.max(0, shell.bottom - box.bottom) : 0;
      setHeight(Math.max(minFrameHeight, Math.floor(window.innerHeight - top - below - 16)));
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

function MapView({ rootId, selectedTicketId, onSelectTicket, onRootResolved, viewSwitch }: TicketMapProps) {
  const { client, composeServices } = useRuntime();
  const storage = composeServices?.storage ?? null;
  const graph = useTicketGraph(client, rootId);
  const flow = useReactFlow<TicketFlowNode, TicketFlowEdge>();
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
  // tracks inputs). Every change of the visible tree is laid out again (parents always between their children,
  // tasks beside their step); the viewport then follows one anchor so it stays still on screen, chosen after
  // commit (it needs the live viewport): the clicked step for expand/collapse, the focused card or root for
  // “tất cả”, and for realtime data what the owner is looking at (`chooseRealtimeAnchor`).
  // “Sắp xếp lại” lays out without an anchor.
  const [layout, setLayout] = useState<{
    projection: MapProjection | null;
    run: number;
    seq: number;
    positions: Record<string, Point>;
    previous: Record<string, Point>;
    reason: 'initial' | 'owner' | 'realtime';
    requested: string | null;
  }>({ projection: null, run: 0, seq: 0, positions: {}, previous: {}, reason: 'initial', requested: null });
  let positions = layout.positions;
  if (projection && (layout.projection !== projection || layout.run !== relayout.run)) {
    const requested = layout.run !== relayout.run;
    positions = layoutHierarchy(projection);
    setLayout({
      projection,
      run: relayout.run,
      seq: layout.seq + 1,
      positions,
      previous: layout.positions,
      reason: layout.projection === null ? 'initial' : requested ? 'owner' : 'realtime',
      requested: requested ? relayout.anchor : null,
    });
  }
  const positionsRef = useRef(positions);
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  const saveViewport = useCallback((viewport: Viewport) => {
    setView((current) => moveMapViewport(current, viewport));
  }, []);

  // Keep the anchor still on screen: shift the viewport by its displacement, once per layout. While the owner
  // is dragging the shift is held back and applied when the gesture ends, so the map never jumps under the hand.
  const anchoredSeq = useRef(0);
  const dragging = useRef(false);
  const heldShift = useRef<{ dx: number; dy: number } | null>(null);
  useLayoutEffect(() => {
    if (anchoredSeq.current === layout.seq || layout.reason === 'initial' || !layout.projection) return;
    anchoredSeq.current = layout.seq;
    const { previous, positions: next, projection: shown } = layout;
    const present = new Set(Object.keys(next).filter((id) => previous[id]));
    const viewNow = flow.getViewport();
    const box = frame?.getBoundingClientRect();
    const anchor =
      layout.reason === 'owner'
        ? layout.requested === null
          ? null
          : ([layout.requested, shown.rootId].find((id) => present.has(id)) ?? null)
        : chooseRealtimeAnchor({
            positions: previous,
            viewport: viewNow,
            frame: { width: box?.width || 0, height: box?.height || 0 },
            focusedId: view.focusedTicketId,
            rootId: shown.rootId,
            present,
          });
    const from = anchor === null ? undefined : previous[anchor];
    const to = anchor === null ? undefined : next[anchor];
    if (!from || !to) return;
    if (dragging.current) {
      const held = heldShift.current ?? { dx: 0, dy: 0 };
      heldShift.current = { dx: held.dx + (to.x - from.x), dy: held.dy + (to.y - from.y) };
      return;
    }
    void flow.setViewport(followAnchor(from, to, viewNow)).then(() => saveViewport(flow.getViewport()));
  }, [layout, flow, frame, view.focusedTicketId, saveViewport]);
  const onMoveStart = useCallback((event: unknown) => {
    if (event) dragging.current = true;
  }, []);
  const onMoveEnd = useCallback(
    (event: unknown, viewport: Viewport) => {
      if (event) dragging.current = false;
      const held = heldShift.current;
      if (event && held) {
        heldShift.current = null;
        void flow
          .setViewport(followAnchor({ x: 0, y: 0 }, { x: held.dx, y: held.dy }, viewport))
          .then(() => saveViewport(flow.getViewport()));
        return;
      }
      saveViewport(viewport);
    },
    [flow, saveViewport],
  );

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
  const fixIds = useMemo(
    () => new Set((graph.data?.repairLinks ?? []).map((link) => link.fixTicketId)),
    [graph.data],
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
          isFix: fixIds.has(ticket.id),
          focused: ticket.id === view.focusedTicketId,
          childCount: childCounts[ticket.id] ?? 0,
          expanded: expanded.has(ticket.id),
          hiddenRelations: badges[ticket.id] ?? 0,
          actions,
        },
      })),
    [projection, positions, childCounts, expanded, badges, actions, fixIds, view.focusedTicketId],
  );
  const routes = useMemo(
    () =>
      sideRoutes(
        (projection?.edges ?? []).filter((edge) => edge.kind !== 'parent'),
        positions,
      ),
    [projection, positions],
  );
  const labelBoxes = useMemo(() => {
    const labels = (projection?.edges ?? [])
      .filter((edge) => edge.kind !== 'parent' && routes[edge.id])
      .map((edge) => ({
        id: edge.id,
        at: (routes[edge.id] as SideRoute).label,
        text: edge.kind === 'repair' ? repairLabel(edge.cycleId) : 'phải xong trước',
        endpoints: [edge.source, edge.target],
      }));
    return new Map(placeEdgeLabels(labels, positions, view.focusedTicketId).map((box) => [box.id, box]));
  }, [projection, routes, positions, view.focusedTicketId]);
  const edges = useMemo<TicketFlowEdge[]>(
    () =>
      (projection?.edges ?? []).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.kind,
        data: {
          ...(edge.cycleId ? { cycleId: edge.cycleId } : {}),
          ...(edge.kind === 'parent'
            ? {}
            : { points: routes[edge.id]?.points, label: labelBoxes.get(edge.id) ?? null }),
        },
        markerEnd:
          edge.kind === 'parent' ? undefined : { type: MarkerType.ArrowClosed, color: edgeColors[edge.kind] },
        focusable: false,
        selectable: false,
        deletable: false,
        ariaLabel: edgeLabel(edge, (id) => titles.get(id) ?? id),
      })),
    [projection, titles, routes, labelBoxes],
  );

  // A root seen for the first time in this tab opens 1:1 with the root at the left edge, centred vertically
  // (the reference map scrolls instead of shrinking); “Vừa khung” stays available for the overview.
  const rootAt = projection ? positions[projection.rootId] : undefined;
  useEffect(() => {
    if (fitted.current || !frame || !rootAt || frameHeight === null) return;
    fitted.current = true;
    void flow.setViewport(initialViewport(rootAt, frameHeight)).then(() => saveViewport(flow.getViewport()));
  }, [frame, rootAt, frameHeight, flow, saveViewport]);

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
      style={frameShellStyle}
    >
      <header style={headerStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Sơ đồ ticket</h1>
          {graph.data && (
            <p style={{ margin: 0, fontSize: 13, color: '#9aa0a6' }}>
              {mergeTicketPages([graph.data.nodes]).length} ticket · bấm vào thẻ để xem chi tiết
            </p>
          )}
        </div>
        <fieldset aria-label="Điều khiển sơ đồ" style={controlsStyle}>
          {viewSwitch}
          {graph.data && projection && !showList && (
            <>
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
              <button
                type="button"
                style={iconButtonStyle}
                aria-label="Phóng to"
                onClick={() => explicit(flow.zoomIn())}
              >
                +
              </button>
              <button
                type="button"
                style={iconButtonStyle}
                aria-label="Thu nhỏ"
                onClick={() => explicit(flow.zoomOut())}
              >
                −
              </button>
            </>
          )}
          {graph.data && projection && diagnostics.length === 0 && (
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
      </header>
      {graph.isPending && (
        <p role="status" style={innerStyle}>
          Đang tải sơ đồ…
        </p>
      )}
      {graph.error && (
        <p role="alert" style={innerStyle}>
          Không tải được sơ đồ: {failureText(graph.error)}{' '}
          <button type="button" style={buttonStyle} onClick={() => void graph.refetch()}>
            Thử lại
          </button>
        </p>
      )}
      {graph.data && projection && (
        <>
          {diagnostics.length > 0 && (
            <div role="alert" style={{ ...panelStyle, margin: '12px 20px 0' }}>
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
          {showList ? (
            <div style={{ ...innerStyle, display: 'grid', gap: 12 }}>
              <CurrentSteps nodes={graph.data.nodes} />
              <TicketOutline
                graph={graph.data}
                rootId={projection.rootId}
                onOpen={(id, element) => actionsRef.current?.open(id, element)}
              />
            </div>
          ) : (
            <>
              <div ref={setFrame} style={{ ...flowStyle, height: frameHeight ?? minFrameHeight }}>
                <ReactFlow<TicketFlowNode, TicketFlowEdge>
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={ticketEdgeTypes}
                  defaultViewport={view.viewport}
                  minZoom={minZoom}
                  maxZoom={maxZoom}
                  onMoveStart={onMoveStart}
                  onMoveEnd={onMoveEnd}
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
                  panOnScroll
                  onlyRenderVisibleElements
                  colorMode="dark"
                  style={{ background: '#17191c' }}
                />
              </div>
              <Legend />
            </>
          )}
          {focused !== null && titles.has(focused) && (
            <div style={{ ...innerStyle, paddingTop: 0 }}>
              <RelationsPanel graph={graph.data} ticketId={focused} titleOf={(id) => titles.get(id) ?? id} />
            </div>
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

const crumbStyle: CSSProperties = {
  fontSize: 13,
  color: '#9aa0a6',
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};
const switchStyle: CSSProperties = {
  display: 'flex',
  border: '1px solid #2b2f35',
  borderRadius: 4,
  overflow: 'hidden',
};
const switchItem: CSSProperties = {
  fontSize: 13,
  padding: '8px 14px',
  minHeight: 36,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  color: '#9aa0a6',
  textDecoration: 'none',
  borderRight: '1px solid #2b2f35',
};

/** Bảng/Danh sách/Sơ đồ of the mockup: links to the project's ticket views; the map is the current page. */
function ViewSwitch({ projectId }: { projectId: string }) {
  return (
    <nav aria-label="Chế độ xem" style={switchStyle}>
      <Link
        style={switchItem}
        to="/projects/$projectId/tickets"
        params={{ projectId }}
        search={{ view: 'board' }}
      >
        Bảng
      </Link>
      <Link
        style={switchItem}
        to="/projects/$projectId/tickets"
        params={{ projectId }}
        search={{ view: 'list' }}
      >
        Danh sách
      </Link>
      <span
        aria-current="page"
        style={{ ...switchItem, borderRight: 'none', background: '#262a30', color: '#e8e9eb' }}
      >
        Sơ đồ
      </span>
    </nav>
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
  const { client } = useRuntime();
  const graph = useTicketGraph(client, rootId ?? undefined);
  const projects = useQuery(projectsQueryOptions(client));
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
  const projectName = projects.data?.find((row) => row.id === projectId)?.name;
  return (
    <section className="page-stack" aria-label="Sơ đồ yêu cầu" style={{ gap: 16 }}>
      <nav aria-label="Đường dẫn" style={crumbStyle}>
        {projectId ? (
          <>
            <Link to="/projects/$projectId/tickets" params={{ projectId }} search={{ view: 'board' }}>
              {projectName ?? 'Dự án'}
            </Link>
            <span aria-hidden="true">›</span>
            <Link to="/projects/$projectId/tickets" params={{ projectId }} search={{ view: 'requests' }}>
              Yêu cầu
            </Link>
            <span aria-hidden="true">›</span>
          </>
        ) : null}
        <span style={{ color: '#e8e9eb' }}>{root?.title ?? 'Yêu cầu'}</span>
      </nav>
      <TicketMap
        rootId={rootId}
        selectedTicketId={ticket}
        onSelectTicket={selectTicket}
        onRootResolved={onRootResolved}
        viewSwitch={projectId ? <ViewSwitch projectId={projectId} /> : null}
      />
    </section>
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
