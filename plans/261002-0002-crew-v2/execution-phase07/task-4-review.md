# Task 4 (S4 + A4) — review độc lập: sơ đồ ticket và viewport

Phạm vi: `da607c8^..da607c8` (source/test/docs), báo cáo `task-4-report.md`, ảnh `ui-evidence/task-4/`. Brief ràng buộc: `task-4-brief.md`; ruling: `pm-ledger.md` (docs canonical `v2/docs/flows`, whole-graph refetch khi dirty, không vá subset, revision guard, TDD nghiêm). Không chạy lại test; đọc log RED/GREEN/E2E đã nộp.

Ảnh tham chiếu `IMG_6454.JPG`: **không có trong repo** (tìm theo tên trong `my-crew-v2` và `my-crew`; cũng không còn ở `/Users/phannhatquang/Downloads/` mà `phase-07-web.md:84` ghi). Đối chiếu dựa trên mô tả văn bản đã ghi: nền tối, card chữ nhật, gốc bên trái, nhánh sang phải, node có trạng thái, bấm xem chi tiết (`phase-07-web.md:84`, `handover-261004-0913-crew-v2.md:45`, spec `2026-10-01-crew-v2-design.md:260-267`).

### Spec Compliance

| Yêu cầu brief | Kết quả |
|---|---|
| Interface `MapEdge`/`MapProjection`/`MapViewState`/`projectGraph`/`layoutHierarchy`/`closeMapDialog` đúng chữ ký | ✅ `project.ts:11-24`, `state.ts:11-39` |
| Regression `closeMapDialog` đúng nguyên văn brief | ✅ `graph-state.test.ts:33` |
| RED topology: fork/join, repair 1–5, inherited root, >100 node, so mọi cặp dependency, không chuỗi tự suy | ✅ `graph.test.ts:118-370`; RED 18/19 assertion (`task-4-s4-red.log`) |
| Validate ID trùng, một root, cùng project/root, parent/level, parent cycle, dependency cycle; dangling → diagnostic + list fallback, không drop orphan | ✅ `project.ts:144-181`, `ticket-map.tsx:339,369-384` |
| Edge ID `parent:/dependency:/repair:`, cùng đầu khác loại giữ cả hai | ✅ `project.ts:49-77` |
| Root/step mặc định; edge task thu gọn ở `hiddenEdges` với đầu thật; badge; không gán endpoint sang step | ✅ `project.ts:187-237` |
| Panel quan hệ đủ ID; “Mở tất cả” | ✅ `ticket-map.tsx:488-524,405-411` |
| Layout trái→phải, 320/100/24, anh em theo ID, cha giữa, iterative | ✅ `layout.ts:37-91` |
| Giữ vị trí sau event/child mới | ⚠️ giữ vị trí cũ đúng, nhưng node mới bị đặt **chồng lên thẻ khác** (Important I1) |
| “Chỉ ‘Sắp xếp lại’ mới layout” | ⚠️ mở/thu gọn cũng layout lại toàn bộ (`ticket-map.tsx:229-232,333-336`) — lệch chữ của brief, report tự khai; cần PM/owner ruling |
| ReactFlow chỉ đọc; node focusable, Enter mở, mũi tên; ba kiểu cạnh phân biệt không dựa màu; status chữ+icon; toolbar | ✅ `ticket-map.tsx:436-457`, `ticket-node.tsx`, `ticket-edge.tsx` |
| Mobile list/current step tương đương | ✅ `ticket-map.tsx:135-139,475-606`; ảnh 390/640 |
| Graph mounted khi dialog mở; state per root/tab; onMoveEnd lưu; realtime không fit; close chỉ xóa selection; fit một lần root mới | ✅ `ticket-map.tsx:155-200,319-324,465-469` |
| Back/Forward/reload `?ticket` tested; UUID sai không gây request | ✅ E2E `ticket-map.spec.ts:244-400`; ⚠️ ngữ nghĩa Back sau khi đóng (Important I2) |
| Dùng **shared** `TicketDialog`/`TicketDetail` | ✅ `ticket-map.tsx:23,465`; không sửa `tickets/*` |
| Board/list/map/dialog cùng dữ liệu, whole-graph refetch, không vá subset | ✅ graph query chung `useTicketGraph`, invalidation prefix `graphs`, GET cũ bị hủy (`graph-state.test.ts:421`); G1 E2E so revision board/list/map |
| G1 real API/PG race; viewport đo thật ≤1px/≤0.001 | ✅ `viewport-a4.json` delta 0/0/0; G1 20 node, cạnh khớp producer |
| A4 paste ảnh/tệp trong dialog từ map | ❌ chưa phủ (extractor 503) — khai báo trung thực; giữ mở |
| 801 node first usable ≤2s, ghi cấu hình máy | ✅ `perf-801.json` 203–236 ms, M4/16GiB; không claim máy owner |
| Screenshot bằng **Playwright MCP** | ⚠️ chụp bằng Playwright test, không qua MCP — khác chữ brief, nội dung tương đương |
| Docs | ✅ `v2/docs/flows/web-ticket-map.md` theo ruling canonical; ⚠️ một câu sai (Minor M4) |
| TDD | ✅ RED semantic thuần 18/19, RED component 7/7 (timeout render — yếu hơn nhưng chấp nhận được), RED pointer thật |

### Visual evidence verdict

**Đạt một phần — có một ảnh chứng minh lỗi.**

- `map-root-fork-join-repair.png`: đúng hướng tham chiếu (nền tối, card chữ nhật, gốc trái, bước rồi công việc sang phải, trạng thái chữ+icon, cạnh cha liền, phụ thuộc nét đứt + “phải xong trước”, repair chấm vàng + “Vòng sửa …”). Nhưng **bị cắt**: khung sơ đồ bắt đầu ở y≈410 và cao `min(70vh,44rem)` nên vượt cửa sổ 1000 px; “Vừa khung” fit vào khung nhưng nửa dưới (bước B, nhánh fork thứ hai) nằm ngoài ảnh. Ảnh không chứng minh được fork đầy đủ. Nhãn repair bị thẻ đè (“ông sửa 108807d”).
- `map-after-concurrent-writes.png`: **chứng minh lỗi I1**. Cột công việc lẽ ra có 15 thẻ (b1, 5 thẻ sửa của K, a1, a2, c1, 6 việc song song) nhưng chỉ thấy ~10 thẻ phân biệt; “Sửa vòng 2”, “Sửa vòng 3”, “Việc song song 1/3/4” không thấy — bị thẻ mới đặt chồng lên đúng tọa độ. Test vẫn xanh vì chỉ đếm `button[data-map-node]` trong DOM.
- `dialog-open-from-map.png`: dialog chung, bình luận thật đã gửi; ảnh cuộn tới cuối nên không thấy tiêu đề, nhưng E2E assert `ticket-detail`/`data-ticket-id`. Chấp nhận.
- `viewport-restored-after-close.png`: zoom 1.7, focus ring trên Bước A sau đóng, khớp `viewport-a4.json`. Đạt.
- `map-list-390.png`, `map-list-640.png`: danh sách tương đương, thụt lề theo cây, trạng thái chữ, không tràn ngang. Đạt.
- `map-801-expanded.png`: fit 801 node thành một cột không đọc được; chỉ chứng minh tải nhanh, không chứng minh “dùng được” ở mức tổng quan. Chấp nhận cho tiêu chí thời gian.

### Strengths

- Phép chiếu thuần, deterministic, không suy cạnh; diagnostic phủ 11 loại và fallback list không bỏ node — đúng rủi ro H×H của brief.
- E2E so tập edge ID trong DOM với graph producer (cả A4 và G1) — kiểm thật, không phantom.
- Viewport đo bằng transform thật, delta 0; realtime không fit được kiểm cả unit lẫn E2E.
- Không đụng `tickets/*`, `contracts`, server; route lazy tách chunk ReactFlow.

### Issues

#### Critical

Không có.

#### Important

**I1 — Node mới từ realtime bị đặt chồng lên thẻ của bước khác (mất thẻ về mặt thị giác).** `v2/web/src/graph/layout.ts:113-124`.
- What: `placeNewNodes` đặt task mới ở `max(y anh em) + pitch` cùng cột, không kiểm va chạm. Khi bước đã mở và bước kế tiếp cũng có task trong cùng cột, task mới nằm đúng tọa độ của task bước kế. Ảnh `map-after-concurrent-writes.png` cho thấy 5/15 thẻ bị che; cạnh tới các thẻ bị che cũng không đọc được.
- Why: đây là đường dữ liệu chính (agent tạo task trong lúc owner xem). Brief success “không mất cạnh; root luôn nhận diện” — thẻ bị che là mất về mặt hiển thị; owner không bấm được thẻ bên dưới. Unit test `graph.test.ts:372-388` mã hóa đúng hành vi lỗi (dịch bước 10 tới y=-500 nên không bao giờ va chạm), E2E G1 chỉ đếm DOM.
- Fix: sau khi tính ứng viên, dò xuống theo `pitch` tới ô trống đầu tiên trong cột (tập `occupied` theo `x:y`, giống kiểm tra “không chồng node” đã có ở `graph.test.ts:317`); hoặc nếu không còn ô trống gần cha thì đặt dưới node thấp nhất của cột. Thêm RED: hai bước đã mở, mỗi bước có task, thêm task cho bước trên → assert không trùng tọa độ; E2E G1 assert tập vị trí `.react-flow__node` không trùng.

**I2 — Đóng dialog push history nên Back mở lại dialog; mỗi lần xem một ticket để lại hai entry.** `v2/web/src/graph/ticket-map.tsx:653-657,704`.
- What: `onSelectTicket(null)` gọi `go({ root })` với `replace=false`. Mở 10 ticket rồi muốn rời sơ đồ phải bấm Back 20 lần; Back ngay sau khi đóng làm dialog bật lại.
- Why: plan `phase-07-web.md:88` ghi “Close X/Escape/Back bỏ query ticket” — Back là một cách *đóng*, không phải cách *mở lại* thứ vừa đóng. Hành vi hiện tại ngược với pattern modal-route thông thường và làm lịch sử ô nhiễm; E2E đang khóa hành vi này (`ticket-map.spec.ts` “Back reopens the dialog”). Board/list (`ticket-routes.tsx:24-40`) không ghi history khi mở/đóng nên cũng không nhất quán giữa các view.
- Fix: khi đóng, nếu dialog được mở bằng push trong app (đánh dấu bằng state/ref lúc `open`), gọi `router.history.back()`; nếu mở từ URL trực tiếp/reload thì `navigate({ ..., replace: true })`. Sửa E2E: Back sau mở → đóng; Forward → mở; đóng bằng X → Back rời entry trước sơ đồ. Nếu PM muốn giữ hành vi hiện tại thì ghi ruling rõ.

#### Minor

- **M1 — Khung sơ đồ nằm dưới nếp gấp; “Vừa khung” không thấy toàn bộ trên 1440×1000.** `ticket-map.tsx:77-82`. Chiều cao cố định `min(70vh,44rem)` cộng header trang ~410 px vượt cửa sổ (thấy rõ ở ảnh fork/join). Fix: `height: calc(100dvh - <offset>)` hoặc gọn phần đầu trang; chụp lại ảnh fork/join đầy đủ.
- **M2 — Nhãn cạnh bị thẻ che và lặp quá dày.** `ticket-edge.tsx:36-44,60,81`. Nhãn repair đặt ngay mép cột bị thẻ đè; 599 nhãn “phải xong trước” ở 801 node. Fix: z-index nhãn trên node (`EdgeLabelRenderer` + `zIndex`), ẩn nhãn khi zoom < ~0.6.
- **M3 — Mutate ref trong `useMemo`.** `ticket-map.tsx:192-200`. `relayout.current=false` và `positionsRef` ghi trong render; render bị React bỏ (concurrent) có thể nuốt một lần relayout. Fix: lưu “layout epoch” trong state (tăng ở toggle/rearrange) và so epoch trong memo thay vì cờ mutable.
- **M4 — Docs nói board/list/map/dialog “đọc cùng query”.** `v2/docs/flows/web-ticket-map.md` (Mục đích). Thực tế board/list dùng list query, sơ đồ dùng graph query; chung nguồn producer và invalidation, không chung query. Sửa câu; đồng thời ghi giới hạn I1 nếu chưa sửa.
- **M5 — `?root=` của dự án khác vẫn render dưới trang dự án hiện tại.** `ticket-map.tsx:648-707`, `project.ts:163`. `PROJECT_MISMATCH` chỉ so với project của root, không so với `$projectId` của route. Chỉ owner nên không phải lỗ authz, nhưng gây nhầm ngữ cảnh. Fix: diagnostic/thông báo khi `root.projectId !== projectId`.
- **M6 — Stylesheet ReactFlow import ở `router.tsx` nên vào bundle chính.** `router.tsx` (import `@xyflow/react/dist/style.css`). Lý do (node --test không nạp CSS) hợp lý; có thể chuyển sang import CSS trong một module wrapper chỉ Vite nạp (`ticket-map-route.tsx`) để giữ lazy hoàn toàn.

#### ⚠️ cần PM/owner xem

- Mở/thu gọn layout lại toàn bộ (lệch chữ “chỉ Sắp xếp lại mới layout”); bước vừa bấm bị dịch ~(n-1)/2·136 px dưới con trỏ. Gợi ý nếu giữ: dịch viewport bằng delta của node được bấm để nó đứng yên trên màn hình.
- A4 paste ảnh/tệp trong dialog từ sơ đồ chưa kiểm (extractor 503) — còn mở cho lượt A4 sau khi phase05 extractor có.
- `repair_links` trong E2E ghi thẳng DB (không có route owner); đường producer thật `POST /v2/tickets/:id/repair-results` chưa được sơ đồ tiêu thụ end-to-end.
- Route `/projects/$projectId/map?root=` khác plan `phase-07-web.md:86` (`/requests/:rootId/map`); brief không ghi route, docs đã cập nhật — cần ghi ruling.
- Ảnh chụp bằng Playwright test thay vì Playwright MCP; ảnh tham chiếu IMG_6454 không có trong repo nên đối chiếu dựa trên mô tả văn bản.
- `vite build` ghi đè `v2/web/dist/` (thư mục ignore) một lần — không ảnh hưởng commit, đã khai báo.

### Assessment

**Task quality:** Needs fixes

Phép chiếu, chẩn đoán, viewport và dialog chung đạt brief và có bằng chứng thật. Chặn duyệt bởi I1 (thẻ realtime chồng nhau — chính ảnh bằng chứng cho thấy) và I2 (Back sau khi đóng mở lại dialog, trái plan). Cả hai sửa nhỏ, cần RED trước.
