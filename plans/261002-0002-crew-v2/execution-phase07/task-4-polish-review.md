# Task 4 polish: review theo mockup owner duyệt

Phạm vi:
- Commit `47bbfe9` (sơ đồ theo mockup và dialog tối) và `74f678b` (dialog theo màn 2). Các commit S6b-i/docs xen giữa `47bbfe9^..74f678b` không thuộc Task4 nên bỏ qua.
- Mục “Polish theo mockup” và “Dialog theo màn 2” trong `task-4-report.md`.
- Mockup chuẩn `ui-evidence/design-map-mockup.html`, ảnh tham chiếu `reference-map-IMG_6454.png`, ảnh mới trong `ui-evidence/task-4/`.
- Quyết định owner: `pm-ledger.md` 10:20 (delta 2/6/11), 10:55 (duyệt design, license `dialog.tsx` và `styles.css`), 11:40 (license `detail.tsx` cho phần trình bày, class cho `composer.tsx`).

Không chạy lại test.

### Spec Compliance

| Mục kiểm | Kết quả |
|---|---|
| (1) Cấu trúc trang: breadcrumb, khung kiểu modal, tiêu đề “Sơ đồ ticket”, phụ đề “N ticket · bấm vào thẻ…”, segmented Bảng/Danh sách/Sơ đồ, nút điều khiển, chú giải ở đáy | ✅ khớp màn 1 (`ticket-map.tsx` header/legend, `RequestMapPage` breadcrumb) |
| (1) Thẻ 280×48, nền `#1c1f23`, viền `#2b2f35`, bo 4, chấm trạng thái, dòng phụ `#9aa0a6`, focus `#8ab4ff` | ✅ đúng bảng màu và kích thước trong HTML mockup (`ticket-node.tsx`) |
| (1) Mật độ: cột cách 56, hàng cách 10 | ✅ `layout.ts:13-16` |
| (1) Connector: ngoặc cha–con vuông 1 px `#3a3f46` | ✅ `ticket-edge.tsx` `ParentEdge` (smoothstep, borderRadius 0, run 28) |
| (1) Connector phụ thuộc/sửa lỗi | ⚠️ màu và kiểu nét đúng. Hình học lệch mockup: mockup vẽ đoạn vuông góc ngắn ở mép phải thẻ; app dùng bezier/curve dài cắt ngang cột thẻ, nhãn chồng nhau (Minor M2) |
| (1) Legend: Xong/Đang làm/Đang chờ/Chưa bắt đầu/Cha–con/Phụ thuộc/Sửa lỗi | ✅ |
| (1) Dòng phụ chỉ dữ liệu thật (delta 6) | ✅ cấp/“Yêu cầu”/“Sửa” · workflow ghim · trạng thái. Không có giờ, vì DTO không có trường thời gian; không bịa |
| (2) Delta 2: không chồng thẻ, task liền cha | ✅ mọi thay đổi chạy `layoutHierarchy`; ảnh `map-after-concurrent-writes.png`: 20 thẻ rời nhau, mỗi bước nằm giữa các task của nó |
| (2) Delta 2: neo đứng yên | ⚠️ đúng với thẻ đang focus hoặc root. Nhưng “đang xem” không được hiểu là vùng owner đang nhìn (Important I1) |
| (2) Bỏ `placeNewNodes`/`Occupancy` | ✅ không còn tham chiếu trong `src`/`test`. Hai bất biến I1/B1 cũ nay do `layoutHierarchy` bảo đảm. Docs còn nhắc test cũ (M3) |
| (3) `initialViewport` 1:1 | ✅ chỉ chạy khi có khung (`frame`) và `frameHeight`. 390 px mặc định là danh sách nên không chạy, chuyển sang sơ đồ thì chạy một lần. Không đụng a11y: thẻ vẫn là `<button>` có nhãn đủ cấp/trạng thái/phiên bản; +/− có `aria-label`; h1 duy nhất trong trang |
| (3) 390 px | ✅ ảnh `map-list-390.png`: header tối, segmented, “Xem dạng sơ đồ”, danh sách tương đương, không tràn ngang |
| (4) Dialog tối: focus/URL/Back/draft | ✅ `dialog.tsx` chỉ đổi style, `className` và icon × (SVG `aria-hidden`, nút giữ `aria-label="Đóng"`). `onCloseAutoFocus`, `onOpenChange`, `returnFocus` không đổi. `composer.tsx` chỉ thêm `className`. `detail.tsx` không đổi query/mutation/composer; `useTicketSubline` dùng đúng key `graph(rootId)` của `ChildTickets` (đã xác minh `detail.tsx:137,173`). Spec S3a/S3b/compose xanh theo log (không chạy lại) |
| (5) Ngoài license | ✅ chỉ sửa `graph/*`, `dialog.tsx`, `styles.css`, `detail.tsx` (trình bày), `composer.tsx` (className), test/e2e/docs. ⚠️ `detail.tsx` cũng là trang `/tickets/:id`, nên header và ô thông tin mới hiện cả ở trang độc lập |
| (6) RED semantic | ✅ có thật: `task-4-polish-red-unit.log` 3 fail bằng assertion; `task-4-polish-red-unit2.log` 5 fail bằng assertion (root không ở giữa sau căn lại, thẻ không có dòng title/meta, root cách mép trái 170 ≠ 24, hằng mật độ); `task-4-dialog-red.log` `TIMEOUT:subline` (chờ phần tử chưa có, chấp nhận được). Thay đổi chỉ CSS/SVG (connector, màu, nút gửi) xác minh bằng ảnh, hợp lý |

### Visual evidence verdict

**Map khớp mockup màn 1 về cấu trúc, màu, mật độ và legend; dialog khớp header và ô thông tin của màn 2; còn lệch connector phụ thuộc/sửa và thân dialog.**

- `side-by-side-map-vs-mockup.png`: breadcrumb, khung kiểu modal, segmented, nút, thẻ hai dòng có chấm, ngoặc vuông xám, legend: tương đương mockup. So với ảnh `reference-map-IMG_6454.png`: cùng tinh thần (gốc trái, ngoặc vuông, thẻ tối hai dòng). Lệch:
  - Cạnh phụ thuộc là đường cong dài chéo qua cột bước (A→C, A→K), không phải connector vuông ngắn bên phải như mockup.
  - Nhãn “sửa vòng 398a…/2cdf…/a22d75e…” dồn trong khe 56 px giữa K và cột task, đè nhau và bị cắt.
  - Nhãn “phải xong trước” lặp ở mọi cạnh.
- `map-after-concurrent-writes.png`: 20 thẻ rời nhau, bước nằm giữa task, root neo đứng yên. Nhãn sửa vòng cạnh K vẫn đè nhau.
- `dialog-header-from-map.png` / `side-by-side-dialog-vs-mockup.png`: nền `#17191c`, × có viền, chấm, tiêu đề, dòng phụ “Bước · Yêu cầu sơ đồ ticket”, hai ô Trạng thái và Máy·model: khớp màn 2. Tiêu đề hơi xám so với mockup (M1). Thân dialog còn khác màn 2 nhiều: bảng “Thông tin” 9 dòng; “Thực thi hiện tại” 5 dòng “Chưa có dữ liệu — máy chủ…” lặp lại ý ô Máy·model; font thân to hơn mockup. Report đã khai.
- `map-list-390.png`: đạt.

### Strengths

- Bảng màu và kích thước lấy đúng từ HTML mockup, không ước lượng.
- Delta 2 đơn giản hơn trước: một đường `layoutHierarchy` duy nhất, bất biến không chồng và task liền cha giữ theo cấu trúc, không cần bộ tránh va chạm.
- Không bịa dữ liệu: không có giờ hay token, ô “Cập nhật” bị bỏ thay vì hiện giá trị giả.
- E2E so bounding box thật (không chồng, bước giữa các task, neo ≤ 1 px) và chụp ảnh đối chiếu tự động với chính mockup.

### Issues

#### Critical

Không có.

#### Important

**I1: Neo realtime không phải thứ owner “đang xem”. Focus cũ hoặc root ngoài màn hình làm vùng đang xem trượt theo mỗi event.** `v2/web/src/graph/ticket-map.tsx:318-326`.
- What: với realtime, neo là `view.focusedTicketId`, không có thì root. `focusedTicketId` không bị xóa khi thẻ mất focus và còn được khôi phục từ tab storage, nên có thể là thẻ owner bấm từ lâu, nay đã ở ngoài khung. Root cũng ra ngoài khung ngay khi owner kéo sang phải: mở 1:1 với cây lớn thì luôn phải kéo. Khi có thay đổi phía trên vùng đang xem (thêm task ở bước 10 trong lúc xem bước 150), `layoutHierarchy` đẩy mọi thứ phía dưới xuống một `pitch`, còn root chỉ dịch nửa `pitch`. Giữ root đứng yên vẫn làm vùng đang xem trượt khoảng 29 px mỗi event.
- Why: quyết định owner 10:20 là “dịch viewport giữ thẻ focus/**đang xem** đứng yên”. Agent ghi liên tục nên realtime là đường dữ liệu chính, và màn hình sẽ giật trong lúc owner đọc. Test DOM/E2E chỉ phủ hai trường hợp: thẻ vừa đóng dialog (đang ở giữa màn hình) và trang mới chưa có focus.
- Fix: chọn neo cho realtime theo thứ tự:
  1. Thẻ đang focus, nếu nó nằm trong khung nhìn hiện tại (tính từ `positions`, `flow.getViewport()` và kích thước khung).
  2. Nếu không, thẻ gần tâm khung nhìn nhất.
  3. Cuối cùng là root.

  Owner bấm mở/thu gọn thì giữ neo hiện tại (bước vừa bấm). Cần RED trước bằng test DOM:
  - Kéo viewport sao cho root ra ngoài khung.
  - Thêm một task vào bước nằm phía trên vùng đang xem.
  - Kiểm thẻ ở tâm khung lệch ≤ 1 px.

#### Minor

- **M1: Tiêu đề dialog bị CSS mục làm xám.** `v2/web/src/styles.css` (`.ticket-dialog h2, h3 { color: #9aa0a6 }`) và `detail.tsx` (`titleStyle` không đặt màu). `Dialog.Title` của Radix render ra `<h2>`, nên tiêu đề ăn màu xám của tiêu đề mục; inline style chỉ ghi đè cỡ chữ. Ảnh dialog cho thấy tiêu đề xám hơn mockup (`#e8e9eb`). Fix: thêm `color: '#e8e9eb'` vào `titleStyle`, hoặc giới hạn selector vào các `section h2`.
- **M2: Connector phụ thuộc/sửa lỗi lệch mockup, nhãn đè nhau.** `ticket-edge.tsx` `DependencyEdge`/`RepairEdge`.
  - Mockup: đoạn vuông góc ngắn ở mép phải thẻ.
  - App: bezier và quadratic cắt ngang cột thẻ. Mật độ mới (khe 56 px) làm nhãn “sửa vòng …” chồng lên nhau và bị cắt.
  - Fix: path vuông góc ra mép phải (`getSmoothStepPath` với `sourcePosition`/`targetPosition` Right và offset theo chỉ số cạnh). Nhãn đặt ở cột phải, không đặt giữa khe; ẩn nhãn khi zoom < 0,8, tooltip qua `ariaLabel`.
  - Đây là mở rộng của M2 cũ đã hoãn; nay lệch luôn design đã duyệt.
- **M3: Docs flow còn mô tả test đã xóa và gán vai trò sai.** `v2/docs/flows/web-ticket-map.md:41` vẫn liệt kê “FIX1 thêm … `placeNewNodes` …”. Dòng 23 nói mọi thay đổi chạy “bằng `relayoutAround`”, trong khi `MapView` tự gọi `layoutHierarchy` + `followAnchor` inline. Sửa cho khớp code.
- **M4: `relayoutAround` chỉ còn test dùng.** `layout.ts:131`. Production không gọi hàm này. Bốn unit test `relayoutAround` kiểm logic neo mà `MapView` không chạy; logic chọn neo thật (`ticket-map.tsx:318-326`) chỉ được phủ qua DOM/E2E. Fix: cho `MapView` gọi `relayoutAround` (đưa luật chọn neo vào hàm thuần), hoặc xóa hàm và các test của nó.
- **M5: `panOnScroll` giữ con lăn chuột trong khung; realtime có thể giật lúc đang kéo.** `ticket-map.tsx:649,348-357`.
  - Con lăn trên khung không cuộn trang. Khung tối thiểu 352 px cộng header vượt cửa sổ thấp (laptop 768 px), owner phải cuộn bên ngoài khung.
  - `setViewport` theo neo chạy cả khi owner đang kéo (d3 gesture) nên có thể nhảy.
  - Fix: bỏ qua lượt dịch neo khi đang kéo (theo dõi `onMoveStart`/`onMoveEnd`, áp delta sau khi thả). Cân nhắc `preventScrolling` khi khung không vừa cửa sổ.

#### ⚠️ cần PM/owner xem

- `detail.tsx` cũng là trang `/tickets/:id`. Header (chấm, dòng phụ), ô thông tin, “Loại” chuyển vào Thông tin và màu cứng `#1c1f23` áp dụng cả ở trang độc lập và dialog của bảng/danh sách. License ghi “phần trong dialog”. E2E `tickets` xanh, nhưng owner chưa thấy ảnh trang độc lập.
- Brief gốc đo “đóng dialog: viewport lệch ≤ 1 px”. Theo delta 2, nếu có realtime trong lúc dialog mở thì viewport dịch để thẻ đã mở đứng yên. Bất biến mới là thẻ đứng yên, không phải viewport. Docs/brief nên ghi rõ việc thay bất biến.
- Trạng thái trên thẻ: brief ghi “chữ + icon”. Nay là chấm màu (`aria-hidden`) cộng chữ ở dòng phụ. Không phụ thuộc màu nên vẫn đạt mục tiêu a11y, nhưng icon hình dạng đã bỏ theo mockup.
- Thân dialog chưa theo màn 2 (Thông tin, Thực thi hiện tại, Lịch sử, liên kết docs). “Thực thi hiện tại” 5 dòng “Chưa có dữ liệu” trùng ý ô Máy·model. Phần này cần license `history.tsx`/`docs/ticket-links.tsx` và chỉnh nội dung S3a.
- Dòng phụ thiếu giờ; nhãn sửa vòng dùng `cycleId`. Cả hai đã vào backlog producer.

### Assessment

**Task quality:** Needs fixes. Khớp mockup về cấu trúc, màu, mật độ, legend và header. Dialog tối không phá focus/URL/Back/draft. Không có sửa đổi ngoài license; RED có thật. Còn chặn: I1, vì neo realtime không giữ vùng owner đang xem như owner quyết. Nên sửa kèm M1 và M2 trong cùng vòng.
