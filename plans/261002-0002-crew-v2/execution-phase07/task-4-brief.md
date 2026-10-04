## Task 4: Sơ đồ ticket và viewport

**Files mới:** `v2/web/src/graph/project.ts`, `v2/web/src/graph/layout.ts`, `v2/web/src/graph/state.ts`, `v2/web/src/graph/ticket-map.tsx`, `v2/web/src/graph/ticket-node.tsx`, `v2/web/src/graph/ticket-edge.tsx`, `v2/web/test/graph.test.ts`, `v2/web/test/graph-state.test.ts`, `v2/web/e2e/ticket-map.spec.ts`. Worker chỉ sửa các file đã liệt kê; controller tích hợp shared files. Docs canonical `docs/v2/web-ticket-map.md`.

**Interfaces:**

```ts
type MapEdge = { id: string; source: string; target: string;
  kind: 'parent' | 'dependency' | 'repair'; cycleId?: string };
type MapProjection = { rootId: string; nodes: Ticket[]; edges: MapEdge[];
  hiddenEdges: MapEdge[]; diagnostics: string[] };
type MapViewState = { rootId: string; viewport: { x: number; y: number; zoom: number };
  expanded: string[]; selectedTicketId: string | null; focusedTicketId: string | null };
function projectGraph(input: TicketGraph, rootId: string, expanded: ReadonlySet<string>): MapProjection;
function layoutHierarchy(input: MapProjection): Record<string, { x: number; y: number }>;
function closeMapDialog(state: MapViewState): MapViewState;
```

- [ ] RED topology tests root→two parallel steps→task và descendants, fork/join nhiều predecessor, repair check→fix cycle 1–5, inherited root input, >100 nodes. Compare every dependency pair before/after projection; không synthetic chain. Dependency cycles invalid; repair historical relation có vòng vẫn được render riêng, không scheduler DAG.
- [ ] Validate ID duy nhất, một root, cùng project/root, parent tồn tại và level hợp lệ, cycle trên chuỗi cha/con và cycle trong dependency DAG. Dangling/cyclic/torn data báo diagnostic+refresh/fallback sang list; không drop orphan hoặc layout loop. Edge IDs `parent:<parent>:<id>`, `dependency:<predecessor>:<ticket>`, `repair:<cycle>:<check>:<fix>`; same endpoints khác kind giữ cả hai.
- [ ] Root/steps mặc định visible. Dependency/repair của task khi collapsed vẫn nằm canonical graph và hiddenEdges và có badge số quan hệ tới công việc thu gọn; expand đúng endpoints. Không gán endpoint task sang step rồi trình bày thành cạnh thật. Node panel quan hệ liệt kê full parent/predecessor/repair ID; Mở tất cả khôi phục tất cả.
- [ ] Layout hierarchical left→right theo cây cha/con, siblings sort theo ID, root giữa subtree; card width320, column gap100, row gap24. Iterative traversal tránh recursion overflow; dependency/repair overlay không ép sequence. Preserve old node positions sau event/child mới; explicit “Sắp xếp lại” mới layout. Không thêm layout engine trước benchmark nhu cầu.
- [ ] ReactFlow chỉ đọc: tắt connect/delete và drag gây mutation; node focusable/Enter mở dialog/keyboard traversal. Parent solid neutral; dependency dashed arrow+“phải xong trước”; repair curved dotted+cycle. Status chữ+icon, không màu riêng. Zoom/pan/fit toolbar accessible; mobile list/currentstep tương đương.
- [ ] Graph/provider mounted khi dialog mở. MapViewState per root/tab; onMoveEnd lưu viewport; realtime chỉ cập nhật dữ liệu không fit. Close chỉ selectedTicketId=null; expanded/viewport/focused ID giữ. Fit ban đầu một lần root mới; fit button explicit. Back/Forward/reload ticket query tested; malformed UUID query không gây mutation.
- [ ] Regression state cụ thể:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeMapDialog } from '../src/graph/state.ts';
test('đóng dialog giữ vùng đang xem', () => {
  const state = { rootId: 'r', viewport: { x: -480, y: 140, zoom: 1.7 },
    expanded: ['s'], selectedTicketId: 't', focusedTicketId: 't' };
  assert.deepEqual(closeMapDialog(state), { ...state, selectedTicketId: null });
});
```

- [ ] G1 real API/PG race: GET graph từ ticket con phải đủ root; child/dependency tạo đồng thời không dangling edges; board/list/map cùng revision cuối. Browser mở dialog task để paste ảnh/comment, đóng ở zoom1.7: x/y delta≤1px, delta zoom≤0.001; realtime không tự fit. Dataset200 steps/600 tasks, đo first usable≤2s trên fixture machine ghi cấu hình; không claim latency trên máy owner chưa đo.
- [ ] Scoped node:test/types/Biome ở S4; A4 sau A3/G1 dùng Playwright MCP screenshot root/fork/join/repair/dialog/viewport được khôi phục; reviewer đối chiếu ảnh owner và mọi cạnh test. Controller 7H2 docs/map/commit.

**Success:** Không suy cạnh hoặc mất cạnh; root luôn nhận diện được; viewport sau khi đóng dialog được đo thật. **Risk:** H×H torn/edge loss; mitigation G1/coherent full root/collapse/cycle/large tests. **Rollback:** Revert route map sang danh sách request đọc được; không đổi ticket graph/schema/workflow.

