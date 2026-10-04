# Task 4 FIX1 — re-review có phạm vi

Phạm vi: `da607c8..a297d3d` (source/test/docs của Task4; bỏ log và các commit không thuộc Task4 trong khoảng này), mục FIX1 trong `task-4-report.md`, ảnh chụp lại trong `ui-evidence/task-4/`. Không chạy lại test; đọc code, diff và ảnh. Ruling PM: route `/requests/$rootId/map`; chỉ “Sắp xếp lại” bố cục toàn bộ, nếu phải relayout thì bước vừa bấm giữ nguyên vị trí trên màn hình.

## Verdict từng mục

| Mục | Verdict | Bằng chứng |
|---|---|---|
| I1 thẻ chồng | **ADDRESSED** | `layout.ts` `Occupancy` + `placeNewNodes` dời thẻ mới tới ô trống đầu tiên của cột, xét mọi thẻ đang hiện, cả task của bước khác. Unit RED đúng kịch bản cũ (task bước 10 rơi vào ô task bước 11). E2E A4/G1 `expectNoOverlap` so bounding box thật của mọi cặp node, không chỉ đếm DOM. Ảnh `map-after-concurrent-writes.png`: đủ 20 thẻ rời nhau (root, 4 bước, 15 task), không thẻ nào bị che. |
| I2 history/Back | **ADDRESSED** | `ticket-map.tsx` `RequestMapPage.selectTicket`: mở trong app thì push; đóng thì `history.back()` khi `openedInApp`, ngược lại `replace`. Đã thử các chuỗi Back/Forward/X trên code: chuỗi nào cũng không để lại mục thừa và Back không mở lại dialog vừa đóng. E2E khóa đúng: Forward mở lại, Back đóng; deep link đóng bằng replace, Back/Forward không mở lại. |
| Ruling route `/requests/$rootId/map` | **ADDRESSED** | `router.tsx` `requestMapRoute` (UUID qua `routeUuid`, `ticket` qua `parseMapSearch`); `/projects/$projectId/map?root=` redirect replace bên trong `beforeLoad`, giữ `ticket`; không có `root` thì là trang chọn yêu cầu. Dự án lấy từ ticket gốc nên M5 cũ cũng được xử lý. Link “Sơ đồ” ở `ticket-routes.tsx` trỏ route mới. |
| Ruling chỉ “Sắp xếp lại” bố cục toàn bộ | **ADDRESSED (đúng chữ)** | Mở/thu gọn/Mở tất cả dùng `placeNewNodes`; thẻ đang hiện đứng yên nên bước vừa bấm không dịch; `layoutHierarchy` chỉ chạy ở projection đầu tiên và khi `layoutRun` đổi. Hệ quả trực quan: xem B1. |
| M1 khung vừa 1440×1000 | **ADDRESSED** | `useFrameHeight` đo đỉnh khung, chiều cao tới đáy cửa sổ trừ 16 px, tối thiểu 352 px. E2E `expectFittedInWindow`. Ảnh `map-root-fork-join-repair.png` mới hiện đủ root, 4 bước (K, B, A, C), 9 task và nhãn “React Flow” ở đáy khung trong cửa sổ; fork A‖B → join C thấy được. Còn hở: xem B2. |
| M3 ref trong `useMemo` | **ADDRESSED** | Vị trí là derived state cập nhật trong render (`setLayout` có điều kiện, dừng sau một lần); `actionsRef` gán trong `useLayoutEffect`, `positionsRef` trong `useEffect`; không còn cờ `relayout` mutable. |
| M4 docs “cùng query” | **ADDRESSED** | `web-ticket-map.md` ghi đúng list/graph/ticket query, chung producer và invalidation. |
| M6 CSS ReactFlow trong bundle chính | **ADDRESSED** | `ticket-map-route.tsx` import CSS và re-export trang; router nạp lazy module này; `router.tsx` bỏ import CSS. Kích thước chunk lấy theo báo cáo build, không đo lại. |

## Breakage mới

### Important

**B1 — Sau “Mở tất cả” (và khi mở nhiều bước), task không còn nằm cạnh bước cha; cạnh cha/con dồn chung một trục nên không đọc được task nào của bước nào.** `v2/web/src/graph/layout.ts` (`placeNewNodes` + `Occupancy.free`), `ticket-map.tsx` (`setExpandedIds`/`toggle` không còn relayout).
- What: bước ở trạng thái thu gọn xếp sát nhau theo `pitch`. Khi mở, task của bước đầu lấp các ô từ trên xuống; task của các bước sau bị đẩy xuống ô trống tiếp theo, xa dần bước cha. Ảnh `map-root-fork-join-repair.png`: 5 task sửa của K chiếm hàng 1–5; b1 (của B, đặt ở hàng 2) rơi xuống hàng 6; a1/a2 (của A) xuống hàng 7–8; c1 (của C) xuống hàng 9. Cạnh smoothstep từ B, A, C đều đi chung một đường dọc ở x≈930, nên nhìn ảnh không biết task nào thuộc bước nào. `map-after-concurrent-writes.png` cũng vậy. Ở 200 bước/600 task, task của bước 200 cách bước cha cỡ 2×200×136 px. Phải bấm “Sắp xếp lại” mới đọc được cây.
- Why: mục đích chính của sơ đồ (gốc trái, bước rồi task sang phải, phân biệt quan hệ cha/con) bị phá ngay ở thao tác mặc định để xem task. Ruling cho phép phương án khác: “nếu phải relayout thì step vừa bấm giữ nguyên vị trí trên màn hình”. Cách sửa chọn tránh relayout bằng mọi giá nên đổi lỗi chồng thẻ lấy lỗi mất cấu trúc. Test chỉ kiểm không chồng và không dời thẻ, không kiểm task nằm cạnh cha.
- Fix: thao tác cấu trúc của owner (mở hoặc thu gọn một bước, Mở/Thu gọn tất cả) chạy `layoutHierarchy`, rồi dịch viewport một đoạn đúng bằng độ lệch tọa độ của node neo: bước vừa bấm, hoặc với “tất cả” thì node đang focus, không có thì root. Như vậy node neo đứng yên trên màn hình, đúng ruling. Dữ liệu realtime vẫn dùng `placeNewNodes` (giữ vị trí là bắt buộc). Thêm test: sau khi mở, mọi task nằm trong khoảng y của cây con của cha (hoặc khoảng cách tới cha ≤ số con × pitch), và vị trí màn hình của node neo lệch ≤ 1 px. Nếu PM chấp nhận hành vi hiện tại thì phải ghi ruling, và docs nên nói rõ cần “Sắp xếp lại” sau khi mở.

### Minor

**B2 — Chiều cao khung chỉ đo lại khi resize cửa sổ.** `ticket-map.tsx` `useFrameHeight`. Nội dung phía trên khung đổi chiều cao sau khi đo thì đáy khung lại vượt cửa sổ hoặc để hở: dòng phân trang của `RootPicker` từ list query về muộn, dòng “Bước đang làm” xuống hàng khi có bước chạy. Fix: `ResizeObserver` trên phần tử cha của trang (hoặc trên `document.body`) để đo lại; hoặc dùng layout flex/grid `100dvh` thay vì đo.

**B3 — Đóng dialog bằng `history.back()` dựa vào giả định mục trước đó là sơ đồ.** `ticket-map.tsx` `selectTicket`. Đã thử các chuỗi điều hướng trên code: giả định đúng vì `openedInApp` chỉ bật sau push trong cùng component đang mount. Nếu sau này `TicketDetail` điều hướng trong dialog bằng `navigate` (push) mà không unmount sơ đồ, `back()` sẽ chỉ lùi một bước. Ghi rủi ro; chưa cần sửa.

## Còn mở (ngoài FIX1, đã được ghi nhận)

M2 nhãn cạnh dày; A4 dán ảnh/tệp chờ extractor; `repair_links` E2E ghi DB trực tiếp; ảnh chụp qua Playwright test và IMG_6454 không có trong repo; vị trí thẻ không lưu qua reload.

## Assessment

**Task quality:** Needs fixes. I1, I2, hai ruling, M1, M3, M4, M6 đều ADDRESSED. Còn chặn: B1 (Important). Sau Mở tất cả, cây cha/con không đọc được, ảnh bằng chứng cho thấy rõ. Sửa theo nhánh relayout có neo mà ruling cho phép, hoặc PM ghi ruling chấp nhận.
