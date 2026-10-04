# Task 4 (S4 + A4): sơ đồ ticket và viewport

BASE: `5e852b5432e168cef49a58d0d78e1dafef6e79d6` (HEAD lúc bắt đầu; sau đó PM có `15abcf5`, chỉ sửa `pm-ledger.md`).
Commit source/test/docs: `da607c8`; báo cáo, log và bằng chứng nằm ở commit kế tiếp.
Trạng thái: DONE_WITH_CONCERNS. Source, unit và A4 trên API/PG thật đều đạt. Phần còn mở nằm ở mục “Lưu ý”.

## Thay đổi

- Mới, thuộc flow `web-ticket-map`:
  - `v2/web/src/graph/project.ts`: `projectGraph`, `canonicalEdges`, `expandableIds`, `hiddenRelationCounts`, `nodeRelations`, `resolveRootId`, cùng kiểu `MapEdge`/`MapProjection` đúng brief.
  - `v2/web/src/graph/layout.ts`: `layoutHierarchy`, `placeNewNodes`, `neighbourInDirection`.
  - `v2/web/src/graph/state.ts`: `MapViewState`, `closeMapDialog` và lưu trạng thái theo root.
  - `v2/web/src/graph/ticket-map.tsx`: `TicketMap`, `TicketMapPage`, danh sách thay thế và bảng quan hệ.
  - `v2/web/src/graph/ticket-node.tsx`, `v2/web/src/graph/ticket-edge.tsx`.
  - Test: `v2/web/test/graph.test.ts`, `v2/web/test/graph-state.test.ts`, `v2/web/e2e/ticket-map.spec.ts`.
- Sửa theo license hẹp của PM:
  - `v2/web/src/router.tsx`: thêm route `/projects/$projectId/map` (`validateSearch: parseMapSearch`, component nạp lazy) và import stylesheet của ReactFlow.
  - `v2/web/src/ticket-routes.tsx`: thanh chọn cách xem có thêm liên kết “Sơ đồ”. File này không nằm trong `tickets/*`, nên không cần hỏi NEEDS_CONTEXT.
  - Không đụng `tickets/*`, `contracts`, `lib`, `auth`, harness hay server.
- Docs:
  - `v2/docs/flows/web-ticket-map.md` (mới). Theo ruling, đường dẫn canonical là `v2/docs/flows/<flow>.md`, không dùng `docs/v2/...` như brief ghi.
  - `v2/docs/flows/web-shell.md`: route và liên kết mới (R3 cho `router.tsx`, `ticket-routes.tsx`).
  - `v2/docs/flows.yaml`: thêm flow mới, sửa dưới manifest lock, chỉ hunk của task này.
  - `v2/docs/index.md`, `v2/docs/files.md`: sinh bằng `crew-docs generate`.

## Hành vi chính

- Quan hệ được chiếu không suy và không mất. ID cạnh: `parent:`, `dependency:<pred>:<ticket>`, `repair:<cycle>:<check>:<fix>`. Hai cạnh khác loại nối cùng hai đầu được giữ cả hai. Cạnh chạm task đang thu gọn nằm trong `hiddenEdges` với đầu thật, và bước chứa task có badge “n quan hệ tới công việc thu gọn”. Có 11 loại diagnostic. Khi có diagnostic, giao diện hiện cảnh báo, nút “Tải lại” và danh sách thay thế giữ đủ mọi ticket; node mồ côi không bị bỏ.
- Layout: card 320, cột cách 100, hàng cách 24, anh em xếp theo ID, cha nằm giữa cây con, duyệt bằng stack tường minh. Dữ liệu realtime về thì giữ vị trí cũ. Chỉ mở/thu gọn và “Sắp xếp lại” mới bố cục lại.
- ReactFlow chỉ đọc. Thẻ là `<button>` có nhãn cấp, tiêu đề, trạng thái bằng chữ và phiên bản. Enter mở dialog, mũi tên đi theo cây. Thanh điều khiển có phóng to, thu nhỏ, vừa khung, sắp xếp lại, mở tất cả và thu gọn tất cả. Màn ≤ 40rem mặc định hiện danh sách tương đương.
- Dialog: chính là `TicketDialog`/`TicketDetail` dùng chung, mở theo `?ticket=` trên URL nên Back/Forward/reload đều đúng. Đóng chỉ xóa `selectedTicketId`. Focus về thẻ đã mở, hoặc về khung sơ đồ nếu thẻ đã biến mất. Viewport được lưu theo root trong tab storage. Root mới chỉ fit một lần; realtime không tự fit.
- Refetch: event invalidate prefix `graphs`, TanStack hủy GET cũ rồi đọc lại cả graph.

## TDD (RED semantic trước source)

| Bước | Kết quả | Log (sha256 12 ký tự) |
|---|---|---|
| RED thuần, trên stub có export nhưng trả rỗng | 18/19 fail bằng assertion. Test “không phụ thuộc thứ tự input” pass ngay trên stub (rỗng = rỗng); nó được giữ làm test hồi quy | `task-4-s4-red.log` `e05e591d7aea` |
| GREEN thuần | 19/19 | (chạy lại trong unit full) |
| RED component, stub `TicketMap` trả `null` | 7/7 fail `TIMEOUT:map rendered`, 5 test state pass | `task-4-s4-red-dom.log` `bb73793568eb` |
| RED pointer events: lỗi thật do browser phát hiện (ReactFlow đặt `pointer-events:none` cho node không chọn/kéo được nên không click được thẻ) | 1 fail đúng assertion, rồi sửa bằng `style.pointerEvents='all'` | `task-4-s4-red-pointer.log` `2285ffc23c76` |

## Kiểm chứng

| Lệnh | Kết quả | Log |
|---|---|---|
| Biome trên 11 file | exit 0 | `task-4-s4-biome.log` `e7a9f31fd318` |
| `tsc --noEmit` (web) | exit 0 | `task-4-s4-typecheck.log` `19eaf43821a7` |
| Unit web đầy đủ (`--test-concurrency=1`) | 281/281 | `task-4-s4-unit-full.log` `1dbe973259aa` |
| `vite build` ra outDir scratch | exit 0; chunk `ticket-map` 198.7 kB, chunk chính 697 kB (cảnh báo >500 kB đã có từ trước, không do task này) | `task-4-s4-build.log` `9dba3f513731` |
| `ticket-map.spec.ts` hai lượt liên tiếp | 4/4 và 4/4 | `task-4-s4-e2e-run1.log` `11fe8759ae14`, `task-4-s4-e2e-run2.log` `72da93b41c12` |
| Spec lân cận `ticket-routes`, `app-router`, `tickets` | 8/8 | `task-4-s4-e2e-adjacent.log` `0589cb065a39` |
| `crew-docs generate` + `check --all` (bản sao HEAD với `v2/` làm root, phủ file của task) | ok | — |

Hash là của bản log cuối (sau khi thêm `viewport-a4.json`).

## A4 trên API/PG thật (fixture Task1)

- Dữ liệu tạo qua route owner thật: project, root, bốn bước, bốn task, năm task sửa, sáu phụ thuộc (fork A‖B → join C → K; a1→a2; a2, b1 → c1).
- Ghi DB trực tiếp chỉ có `repair_links`. Không có route owner nào ghi bảng này; `POST /v2/tickets/:id/repair-results` là route của máy, cần bước kiểm tra đang `running` cùng attempt và evidence.
- Đã kiểm:
  - Graph đọc từ ticket con bằng graph đọc từ gốc (14 node).
  - Mọi cạnh trong DOM khớp đúng graph của producer.
  - Viewport zoom 1,7 khôi phục sau reload, sau đó kéo tay.
  - Mở thẻ ra dialog chung và gửi bình luận thật; đóng bằng Escape. Kết quả đo (`viewport-a4.json`): trước `(-534, -1181.6, 1.7)`, sau `(-534, -1181.6, 1.7)`, lệch 0/0/0. Ngưỡng là ≤ 1 px và ≤ 0,001.
  - Focus về thẻ sau khi đóng.
  - Bước mới tạo trong lúc đang xem hiện ra mà viewport không đổi (không tự fit).
  - Back mở lại dialog, Forward đóng, reload với `?ticket` mở lại.
  - `?ticket` sai không gây POST hay request lạ.
  - Bàn phím: mũi tên rồi Enter rồi Escape, focus về đúng thẻ.
  - ID con trên URL được đổi về gốc.
- G1 race: tạo đồng thời 6 task cùng phụ thuộc khi sơ đồ đang mở. Sơ đồ có đủ 20 node, đúng revision cuối, không có diagnostic, cạnh khớp producer. Bảng và danh sách hiện cùng revision.
- 390 px và 640 px (tương đương 1280 px ở zoom 200%): hiện danh sách tương đương, không tràn ngang, mở dialog, focus quay về dòng.
- Hiệu năng, 200 bước / 600 task / 599 phụ thuộc:
  - First usable, tính từ lúc bấm “Sơ đồ” tới khi thẻ gốc hiện và điều khiển dùng được: 203/195/193 ms (≤ 2 s).
  - Tải lại cả trang qua Vite dev: 205–208 ms.
  - Máy: Apple M4, 10 nhân, 16 GiB, macOS 25.6.0 arm64, Node v24.21.0, Chromium 153, fixture Task1 (PostgreSQL 18.6, Fastify, Vite dev).
  - Chưa đo trên máy của owner.
- Ảnh và số liệu ở `execution-phase07/ui-evidence/task-4/`: `map-root-fork-join-repair.png`, `dialog-open-from-map.png`, `viewport-restored-after-close.png`, `map-after-concurrent-writes.png`, `map-list-390.png`, `map-list-640.png`, `map-801-expanded.png`, `perf-801.json`, `viewport-a4.json`. Fixture đóng sạch sau mỗi lượt: không còn container `crew-v2-test-*`, không còn process.

## Lưu ý

1. Quy trình: có một lượt `node --test graph-state.test.ts` (một file, khoảng 35 s) chạy khi `heavyEligible=false`. Nguyên nhân là bước kiểm tra cũ dùng `grep -o`, vốn luôn exit 0. Từ đó mọi lệnh nặng đi qua script gate kiểm `heavyEligible is True` và giữ slot.
2. Một lần `vite build` mặc định ghi đè `v2/web/dist/` (thư mục bị ignore, đã có từ 09:59). Các lần build sau ghi ra scratch.
3. Phần A4 chưa phủ: dán ảnh hoặc gửi tệp trong dialog mở từ sơ đồ. Fixture chưa cấu hình extractor (503 `EXTRACTION_NOT_CONFIGURED`), nên A4 chỉ dùng bình luận văn bản. Ảnh chụp bằng Playwright test chứ không qua Playwright MCP; reviewer vẫn cần đối chiếu với ảnh tham chiếu IMG_6454 của owner.
4. Quyết định thiết kế cần reviewer xem: mở/thu gọn một bước thì bố cục lại toàn bộ, vì đó là hành động cấu trúc của chính owner. Dữ liệu realtime thì luôn giữ vị trí. Đóng dialog cũng push một mục history, nên Back sau khi đóng sẽ mở lại dialog.
5. Test component của sơ đồ nằm trong `graph-state.test.ts`, vì brief chỉ cho hai file unit. File đó tự gắn stub layout cho jsdom (ResizeObserver, DOMMatrixReadOnly, rAF, kích thước), không sửa harness.
6. Cạnh phụ thuộc giữa hai bước cùng cột vẽ thành đường cong chữ S, vì handle nằm ở trái và phải. Đọc được, nhưng chưa đẹp.
