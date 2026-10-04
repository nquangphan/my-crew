# Task 4 polish: re-review vòng sửa 1

Phạm vi:
- Commit `531892b`. Các commit gateway/S6b xen trong `74f678b..531892b` không thuộc Task4.
- Mục “Sửa theo review polish” trong `task-4-report.md`.
- Ảnh side-by-side và ảnh trong `ui-evidence/task-4/`.
- License: ledger 11:30 cấp quyền trình bày cho `history.tsx` và `docs/ticket-links.tsx`.

Không chạy lại test.

## Verdict từng mục

| Mục | Verdict | Bằng chứng |
|---|---|---|
| I1: neo realtime theo vùng đang xem | **ADDRESSED** | `layout.ts` `chooseRealtimeAnchor` là hàm thuần, thứ tự: focus nếu tâm thẻ còn trong khung → thẻ gần tâm khung → root; chỉ xét thẻ có ở cả hai bố cục. `MapView` gọi hàm này trong `useLayoutEffect` sau commit, dùng bố cục cũ (`previous`) và viewport thật lúc đó, tức đúng thứ owner đang thấy. RED DOM thật: thẻ giữa vùng trượt (36,198)→(36,212.5). E2E G1 kiểm thẻ gần tâm đứng yên |
| M1: tiêu đề dialog xám | **ADDRESSED** | `titleStyle` có `color: '#e8e9eb'`; ảnh dialog tiêu đề trắng như mockup |
| M2: connector lệch mockup, nhãn đè nhau | **ADDRESSED (còn Minor N2, N3)** | `sideRoutes` thay bezier/quadratic bằng đoạn vuông góc trong khe, tách làn 6 px. `placeEdgeLabels`: không nhãn nào đè nhãn nào; nhãn không có chỗ thì ẩn, chỉ hiện khi thẻ của nó được focus. Ảnh map: không còn đường chéo cắt cột, nhãn “sửa vòng” không còn chồng nhau |
| M3: docs | **ADDRESSED** | `web-ticket-map.md` không còn nhắc `placeNewNodes`/`relayoutAround`. Docs mô tả đúng luồng neo, bất biến mới, trạng thái chấm + chữ |
| M4: `relayoutAround` chỉ có test dùng | **ADDRESSED** | Đã xóa; test chuyển sang `layoutHierarchy` + `followAnchor`, đúng đường production. Luật chọn neo realtime giờ là hàm thuần có unit test |
| M5: kéo khung + realtime | **NOT (một phần)** | Dời viewport được hoãn và áp đúng toán học khi thả: `followAnchor({0,0},{dx,dy}, viewport lúc thả)`, cộng dồn nhiều lượt, dùng zoom lúc thả. Nhưng vị trí thẻ mới vẫn áp ngay trong lúc kéo, nên nội dung nhảy dưới tay rồi nhảy về khi thả (Minor N1) |
| Thân dialog theo màn 2 | **ADDRESSED (một phần, chấp nhận)** | “Thực thi hiện tại” bỏ, còn một dòng “Độ khó, lượt chạy và bằng chứng: Chưa có dữ liệu…” dưới ô Máy·model. Lịch sử có cột giờ mono rồi mô tả, giữ `<time>`/`data-testid`/`data-source`. Liên kết tài liệu (`TerminalDocsLinks`, editor) dạng chip, chip đang chọn viền `#8ab4ff`. Bảng “Thông tin” và cỡ chữ thân vẫn khác màn 2 (đã khai). Fixture không có liên kết tài liệu nên ảnh chưa cho thấy chip |

## Ba điểm soi thêm

**1. Dời viewport hoãn khi kéo: áp đúng khi thả, nhưng vẫn giật.**
- Toán học đúng:
  - `onMoveStart(event)` chỉ bật `dragging` khi có event người dùng.
  - Layout effect cộng dồn `dx/dy` theo tọa độ flow.
  - `onMoveEnd(event, viewport)` áp `viewport.x − dx·zoom`, `viewport.y − dy·zoom` theo zoom cuối cử chỉ. Neo về đúng chỗ.
- Còn giật: bố cục mới (`positions`) vẫn vào ReactFlow ngay trong render. Trong lúc kéo, thẻ dịch theo `pitch`/2·pitch dưới tay, rồi dịch ngược lại khi thả. Tức là giật hai lần thay vì một.
- Bản trước (gọi `setViewport` giữa cử chỉ) không có lỗi này: d3-zoom tính bước kéo tiếp theo từ transform hiện tại.
- E2E chỉ assert viewport không đổi trong lúc kéo; không assert vị trí thẻ trên màn hình và không assert sau khi thả.
- Xem N1.

**2. Cạnh vuông góc tách làn, nhãn chỉ hiện khi focus: giữ bất biến không chồng thẻ, a11y đạt.**
- Không chồng thẻ: `sideRoutes`/`placeEdgeLabels` không đổi vị trí node, nên bất biến không chồng thẻ vẫn do `layoutHierarchy` giữ.
- Tuyến cạnh không cắt qua thẻ:
  - Đoạn ngang chỉ đi từ mép thẻ vào khe.
  - Đoạn dọc nằm ở `gap+10 … gap+40`, trong khe 56 px.
  - Quá 6 làn thì dùng lại làn cũ: nét có thể chồng nét, nhưng không chồng thẻ.
- A11y:
  - Thẻ vẫn là `<button>` có nhãn đủ.
  - Quan hệ bị ẩn nhãn vẫn có ở bảng “Quan hệ của …” (đủ ID) và `ariaLabel` của cạnh.
  - Nhãn của thẻ focus luôn hiện.
- Lưu ý:
  - Nhãn của thẻ focus không tránh thẻ (chỉ tránh nhãn khác), nền đặc `#17191c` có thể che chữ của thẻ lân cận.
  - Làn 3 (`gap+28`) trùng thân ngoặc cha–con (`bracketRun 28`), xem N2.

**3. S3a/S3b: không thấy phá hỏng.**
- `history.tsx` chỉ đổi bố cục. Giữ `<time dateTime>`, `data-testid="timeline-entry"`, `data-source`, `aria-label="Nguồn"`, và các nhánh comment/decision giữ nguyên nội dung.
- `detail.tsx` bỏ mục “Thực thi hiện tại”. Không test S3a/S3b nào tìm heading này (grep `test/` và `e2e/`). Chuỗi “Chưa có dữ liệu — máy chủ…” vẫn còn cho assert của `tickets.spec`.
- `ticket-links.tsx` chỉ đổi style; `TicketDocsLinksEditor` chỉ dùng trong `TicketDetail`. Composer, draft, focus và query không đổi.
- Log ghi unit 295/295 và E2E `ticket-map/tickets/ticket-routes/compose` 15/15 (không chạy lại).

## Issues

Không có Critical hay Important.

Minor:
- **N1: Kéo khung + realtime vẫn giật hai lần.** `ticket-map.tsx` (layout effect + `onMoveEnd`). Fix: khi `dragging`, giữ nguyên `positions` cũ cho ReactFlow (hoãn cả bố cục lẫn dời viewport), rồi khi thả áp cả hai trong cùng một commit. Hoặc trả về cách cũ, dời viewport ngay vì d3-zoom chịu được `setTransform` giữa cử chỉ. Thêm assert E2E: vị trí màn hình của thẻ neo trong lúc kéo và sau khi thả.
- **N2: Làn 3 của cạnh phụ thuộc/sửa trùng thân ngoặc cha–con.** `layout.ts` `sideRoutes` (`x = gap + 10 + lane·6`) và `ticket-edge.tsx` (`bracketRun = 28`). Khe bước→task có ≥ 4 làn (ảnh `map-after-concurrent-writes.png`) thì nét đứt nằm đúng trên thân ngoặc. Fix: bỏ qua làn rơi vào `bracketRun ± 2`, hoặc dời làn sang `gap+32…`.
- **N3: Nhãn ở mép phải bị khung cắt.** Ảnh side-by-side map cho thấy “phải xong …” bị cắt ở mép khung (report đã khai). Có thể chấp nhận; hoặc cho nhãn của tuyến cùng cột nằm bên trái làn khi gần mép.
- **N4: Nhãn cạnh không có ngữ cảnh cho screen reader.** Span nhãn trong `EdgeLabelRenderer` không có `aria-hidden`, nên chỉ được đọc là “phải xong trước” mà không có hai đầu. Thêm `aria-hidden="true"`, vì `ariaLabel` của cạnh đã đủ.

## Visual

- Map (`side-by-side-map-vs-mockup.png`, `map-after-concurrent-writes.png`):
  - Connector giờ vuông góc ngắn trong khe như mockup, không còn đường chéo.
  - Nhãn “sửa vòng” không còn chồng nhau.
  - Nhãn “phải xong trước” ở cột phải xếp so le, không đè.
  - 20 thẻ rời nhau, bước nằm giữa các task.
  - Khe bước→task khá dày khi có nhiều làn, và có điểm trùng thân ngoặc (N2).
- Dialog (`side-by-side-dialog-vs-mockup.png`, `dialog-open-from-map.png`):
  - Header, hai ô thông tin và dòng “Độ khó…” gọn hơn; lịch sử có giờ mono như màn 2.
  - Thân vẫn dài hơn màn 2 vì bảng Thông tin, chữ thân 16 px và nhãn “Nội dung” to.
  - Chip tài liệu chưa có trong ảnh vì fixture không có liên kết.

## Assessment

**Task quality:** Approved (kèm Minor N1–N4 cho lượt sau). I1, M1, M2, M3, M4 và thân dialog đạt. M5 chỉ đạt một phần vì giật khi kéo trùng realtime. Đây là tình huống hẹp, không phá bất biến nào; ghi vào backlog hoặc sửa nhanh cùng N2/N4.
