# Crew v2 — Prototype UI để owner review trước phase 07

Ngày: 2026-10-02. Phạm vi: visual probe theo spec đã duyệt mục10; không phải giao diện production hoặc nghiệm thu phase07.

## Deliverable và căn cứ

- HTML standalone: `plans/previews/crew-v2-ui.html`.
- SHA256: `b4478e0558f53f8388183a2dce579518eed98e49792e588fead197c61fe3a3de`.
- Kích thước: 55,502 bytes, một file HTML/CSS/JS, không dependency/CDN/network request.
- Căn cứ: `docs/superpowers/specs/2026-10-01-crew-v2-design.md`, mục9–10 (docs phân biệt implemented/artifact, Jira/Confluence direction, attachments, flowchart, workflow/model/machine provenance).
- Dữ liệu đều minh họa. Project/model/pin/commit/timestamp/kiểm thử/timeline không là bằng chứng vận hành thật. Không sửa frozen plan phase02, server/domain source, Git index hoặc commit.

## Brief và các giả định

Owner cần giao việc, nắm công việc đang chạy và trả lời câu hỏi ít bước. Trang đầu ưu tiên hội thoại Trợ lý và quyết định đang chờ; quản trị nguồn runtime đặt ở màn hình riêng. Layout sáng, violet nhẹ cho Trợ lý/running, amber cho việc cần chú ý, status luôn có chữ và biểu tượng. Sidebar theo dự án; tên/ticket demo Crew/Kidy nhằm minh họa, không đọc dữ liệu thật.

Giả định review lần này tập trung bố cục/thứ tự thao tác và độ rõ trạng thái. Model chỉ ghi nguồn/model demo; pin workflow dùng revision-demo, không bịa release BMAD/Superpowers. Prototype không mô tả đầy đủ auth, backend error hoặc final acceptance; thiết kế sẽ được điều chỉnh theo owner review trước kế hoạch07.

## Các màn hình và tương tác

1. **Trợ lý:** hội thoại; trích nguồn docs/commit demo; progress request; câu hỏi CR-46; trả lời nhanh hoặc mở ticket; gửi text/attachment cục bộ. Context có project, máy Trợ lý và nguồn/model; nguồn bị tắt bị loại khỏi selector. Chọn máy offline không tự chuyển sang máy khác. Các lựa chọn không tạo session model.
2. **Công việc:** Board, danh sách và flowchart đọc cùng `state.tickets` trong bộ nhớ. Chọn ticket ở cả ba cách mở cùng detail. Sau trả lời/pause/cancel ACK demo, chuyển mode thấy cùng status. Filter mã/tên ticket cùng nguồn; project switch giới hạn ticket theo project.
3. **Ticket detail:** cấp request→step→task, parent/children, workflow/skill, máy/model demo, số vòng sửa/5, tiêu chí/bằng chứng, docs stale, timeline quyết định/review/can thiệp, câu hỏi owner, comment. Pause/cancel tạo pending intent demo; status chưa đổi đến khi chủ động “Mô phỏng ACK process đã dừng”. Ticket done/cancelled không nhận pause/cancel UI. Không có nút đổi label done để vượt completion gate.
4. **Docs:** cây trang, search theo nội dung, page gốc demo, source commit/stale, nhãn riêng Docs đã triển khai/Artifact workflow, related-ticket open. Search artifact giữ nhãn. Kidy demo chưa có snapshot nên empty state; không hiển thị docs Crew dưới nhãn Kidy. Nội dung được escape, không render HTML từ input.
5. **Máy:** hai máy online/offline; ba switch Claude Code/Codex/OpenAI-compatible API độc lập; desired/applied hiển thị riêng. Đổi desired không đổi applied. ACK là thao tác mô phỏng riêng và bị chặn khi máy offline. Tắt hết nguồn hiển thị lý do chờ. Hai bộ workflow có trạng thái riêng đúng/lệch/lỗi. Nút cài/update chỉ giải thích điều kiện, không tải/cài hoặc giả thành công.

## Attachment và sơ đồ

- Create request, chat và comment đều có file picker nhiều file, drop zone, clipboard image paste từ ô nhập, thumbnail raster PNG/JPEG/GIF/WebP, tên/dung lượng, gỡ trước gửi. Giới hạn demo10 files,10MB/file. File không đọc nội dung và không chạy macro/script; loại không có thumbnail vẫn hiển thị metadata.
- File chỉ giữ metadata/object URL tại trình duyệt; không upload. “Lỗi upload” và “retry” là nút mô phỏng được ghi rõ; retry giữ ID/file thay vì nhân bản. Gửi bị chặn khi attachment còn error demo. Comment chỉ có attachment được nhận. Sau gửi file tham chiếu được gắn đúng comment/ticket trong demo state.
- Draft comment không giữ qua chuyển ticket; reset/reload mất toàn bộ demo state. File đã gửi giữ object URL trong phiên; file draft gỡ/hủy và unload revoke URL. Không có persistence/resume/fallback thật.
- Sơ đồ CR-42 hiển thị bước workflow demo cụ thể, dependencies và đường vòng sửa dashed; node mở detail, +/- zoom, kéo nền pan, fit, mở task CR-45. Nút không chỉnh sửa workflow bằng kéo thả. Project không có steps có empty/list thay vì invent workflow chain. Mobile dưới760px dùng list fallback, không bắt buộc kéo sơ đồ rộng.

## Verification và giới hạn thực tế

**Đã kiểm tra bằng shell:** JavaScript parse bằng `new Function` thành công với Node24.14.0; static scan không có script/link external, fetch/XMLHttpRequest hoặc URL http(s) trong artifact; các interaction markers chính có mặt. Đây là syntax/static verification, không phải chạy DOM/browser hay test behavior.

**Render chưa xác minh:** đã tạo HTTP preview riêng tại127.0.0.1:58127 và thử `cua.createBrowserTab('iab',...)`; tool trả `Browser is not available: iab`. `cua.listBrowsers()` trả `[]`. Không có screenshot hoặc quan sát UI thực tế; desktop/mobile overflow, keyboard/clipboard/file picker, drag/pan và dialog interaction vẫn cần owner/controller kiểm tra trong browser. Không dùng shell browser automation thay cho công cụ UI.

Server preview temporary riêng đã dừng (PID56322 do task này tạo), không để process preview chạy. Không dừng process/project/DB của người khác; HTML và report giữ nguyên để review. Không tạo screenshot thiếu kiểm chứng.

## Checklist review cụ thể cho owner/controller

- Mở HTML trực tiếp trong browser hiện có; không cần server hoặc cài dependency.
- Từ Trợ lý, trả lời CR-46 → xem Board/List/Flow và ticket detail để đối chiếu cùng status.
- Tạo yêu cầu với ảnh/file; thử gỡ, error/retry, comment chỉ attachment; thử pause/cancel trước và sau ACK demo.
- Search docs “Máy Mac” hoặc “thiết kế”; kiểm tra artifact/implemented label, stale/commit và related ticket.
- Đổi desired runtime ở hai máy; kiểm tra applied vẫn cũ, offline không ACK, selector model loại nguồn tắt.
- Resize desktop/mobile; kiểm tra list fallback, drawer focus/close Escape, tabs, file picker/drop/clipboard và flow pan/fit.

Những checklist này là thao tác review còn phải chạy, không phải kết quả pass đã có. Khi owner chốt visual, phase07 mới lập implementation plan và nối API thật theo contracts các phần trước.

## PM bổ sung kiểm tra browser

Controller dùng Playwright đã có trong môi trường dev v1 như công cụ kiểm tra artifact, không import vào runtime v2 hoặc cài công cụ toàn máy. Chromium headless mở file HTML trực tiếp: trang Trợ lý1440×960 và390×844 render không pageerror; mobile không horizontal overflow. Click Công việc → Sơ đồ → Tài liệu → Máy đã render, không pageerror. Đã quan sát screenshot Trợ lý desktop/mobile và sơ đồ; chưa kiểm chứng toàn bộ thao tác paste/drop/retry/pan/keyboard hay server behavior. Một lần locator chữ Công việc8 timeout vì accessible name có khoảng trắng; sửa locator tên Công việc thì click đạt, không phải lỗi prototype.

Ảnh giữ để owner review: crew-v2-ui-desktop.png, crew-v2-ui-mobile.png, crew-v2-ui-board.png, crew-v2-ui-flow.png, crew-v2-ui-docs.png, crew-v2-ui-machines.png cùng thư mục HTML. Browser của từng kiểm tra đã đóng trong finally, không để preview server chạy. Đã gửi câu hỏi UI cho owner; backend/gateway tiếp tục độc lập trong lúc chờ, chưa tự coi prototype đã được duyệt.
