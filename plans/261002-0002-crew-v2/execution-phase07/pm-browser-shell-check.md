# CREWV2-701 — PM Playwright MCP shell check

Ngày03/10/2026, source trước sửa focus/favicon. Preview dùng fixture thật với PostgreSQL18.6 và web/API/Vite proxy; guest shell vẫn là **Bản minh họa**, không phải board/map/login hoàn chỉnh. Đây là bằng chứng browser riêng với lifecycle HTTP/PG, chưa phải nghiệm thu toàn A1.

- Root dùng Playwright MCP, tạo riêng tab1 tại `http://127.0.0.1:64593/crew-v2/`; tab0 ban đầu chỉ `about:blank`. Không mở backend/user service khác.
- Desktop1280×800: landmark/main và nhãn minh họa hiện đúng; document scrollWidth1280, không tràn ngang. Screenshot `ui-evidence/shell-desktop.png`, SHA256 `3d6930f20aab0c0b7ef099d87dde234fd21f6c78464647cebb61a8f4f5482c39`.
- Mobile390×844: screenshot cho thấy layout một cột, không clip nội dung; document scrollWidth390. Tab đầu focus vào “Bỏ qua điều hướng”, `:focus-visible=true`. Screenshot `ui-evidence/shell-mobile.png`, SHA256 `373815268cd785b031712cba0de9f2d1c0807ba085f1fc6faa781f6d397494df`.
- **Focus regression thực:** Enter đổi hash thành `#main-content` nhưng activeElement vẫn BODY. Worker đã nhận yêu cầu sửa main target và kiểm lại; chưa PASS sau sửa.
- Console chỉ một error404 `favicon.ico`; worker sửa favicon trong index.html. Không thấy app exception hoặc warning ở lượt này.
- **Zoom/reflow chưa kết luận:** Ctrl+Equal bốn lần không thay viewport/visualViewport scale. CDP override640/DPR2 báo không overflow, nhưng PNG thực640×534 giữ/clips desktop layout; chỉ metric scrollWidth không đủ. `ui-evidence/shell-reflow-200.png` SHA256 `34c301cb7560bbc3d0f6d6cbd634fefb15326c68f8fc6138305f9ff2a5742e27` là diagnostic, không evidence zoom200% PASS. Lượt sau dùng viewport640 thật và kiểm bounding boxes; literal browser zoom chưa xác minh.

Preview nonce `5868db4c-3bd8-46c4-a5a5-2cfe98fb8d2a`, PID21308/start21:02:49, container `cf1496aa6656b39f30cfa177132100ea747b139190b6bbcc8978966ead367e7f`, DB/web/API ports64585/64593/64594. Scratch `crew-v2-web-aU77kL` dev:ino16777229:64593706. Root đóng đúng tab1 và xác nhận chỉ còn blank tab0 trước gửi BROWSER_TAB_CLOSED. Worker trả preview exit0 và exact STOP/remove; independent docker/PID/lsof/scratch absence ghi trong preflight. Sau đó root đóng blank page của MCP, tool xác nhận không còn tab; không suy ra OS browser process đã dừng vì process thuộc provider. Không đóng tab/user app khác.

MCP output root cho screenshot chỉ cho phép primary repo. Root lưu ba PNG ở đó rồi copy/hash vào worktree, xóa đúng ba bản tạm do root tạo; snapshot/console log của lượt này cũng được giữ trong ui-evidence và xóa đúng bản tool scratch. Screenshot destination trong worktree bị tool từ chối lần đầu, không tạo file và không bypass chính sách. Deliverable/evidence trong worktree được giữ.

Task bootstrap còn chờ actual interrupt evidence, sourcefreeze/review và docs manifest; board/map/dialog acceptance thuộc task sau. Không cần Đại Ca duyệt lại hướng UI.

## Final source MCP rerun — 21:41 VN

Own tab1 on owned fixture web55467/API55469/DB55135, noncea7c02352-7a8f-4ea9-97d4-1277ff1cd81b. Fresh5.534GiB/pressure1/idle86.27/disk24.644 before tab creation. Keyboard Tab skip link focus-visible=true then Enter actual MAIN#main-content (previous BODY defect closed). Console error0/warning0. Actual page.setViewportSize1280x800 and390x844: scrollWidth1280 and390; mobile mainright390/navright374. Actual640x400: scrollWidth640, main x200/right640, navright183, content x219.195/right620.804; root inspected full-page PNG640x534, complete text/cards fit with vertical scroll. Screenshots source bytes copied from only own primary MCP files and those exact copies removed.

SHA256: desktop694921eef690eb9783e1c62f013ff0df24383bf77ce64c870404dc11e91a2094; mobile9a90cfd94f112d77f655edfb96145d3241f5f1a2332516c82900e3dace665919; reflowd57c480fc98c744b3c9f1b9d98df3f2b83c4c96f0a2b74694e7847983abd696d. Root viewed all three actual pixels.

Meta+Equal four presses at1280 also leaves innerWidth1280/dpr1/visualViewport.scale1. Literal Chrome200% zoom remains unmeasured; no claim PASS. Ruling: for this shell bootstrap, acceptance uses actual640 CSS-pixel layout as the layout-equivalent of1280 at200%, preserving explicit literal-zoom limitation; approved feature tasks later retain own accessibility/browser checks. This bounded equivalence tests layout/readability and prevents blocking source acceptance on an MCP unsupported browser shortcut; wrong ruling costs later browser-zoom-specific rework, not authority or deployment.

Root closed only own tab1; listblanktab0. BROWSER_TAB_CLOSED sent before fixture cleanup; cleanup evidence pending worker. No board/map/ticket/dialog or authenticated feature UI PASS from this static guest shell.
