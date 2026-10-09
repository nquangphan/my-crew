# Việc chờ Đại Ca trả lời (sáng 10/10/2026)

Trợ Lý gom mọi câu hỏi và việc cần owner trong lúc chạy liên tục R2. Mỗi mục có phương án Trợ Lý đang tạm theo.

## Việc cần ngồi máy
- [ ] Chứng chỉ Developer ID Application + `xcrun notarytool store-credentials crew-notary` (chặn ký/notarize/phát hành app, cổng 1, 2, 5 của R2-1).
- [ ] Một lần đăng xuất/đăng nhập Mac mini (đo app tự mở cùng máy, S1b).
- [ ] Thử đóng cửa sổ và "Thoát ngay, run vẫn chạy" giữa một run (cổng 4 phần UI).
- [ ] Gỡ login item app 2P Crew cũ trong Cài đặt hệ thống → Chung → Mục đăng nhập.
- [ ] Có thử "Gỡ khỏi Mac" project 2ps-landing không (cổng 6).

## Push
- [ ] Repo Crew `v3`, `r2-1` (và nhánh R2 sau); fork `crew/r2-1` (và nhánh sau). Chưa push gì từ 09/10 chiều.

## Câu hỏi phát sinh
- R2-2 AG-2: Trợ Lý đã cho đồng bộ 4 template hướng dẫn agent trong app (để project thêm bằng app cũng đọc được file đính kèm). Phủ quyết nếu không muốn.
- R2-2 lệch 2: plugin đọc chữ ký đầu file (ảnh/PDF/DOCX/XLSX) để bắt file thực thi đổi đuôi, trái câu "không đọc nội dung" trong spec 5.6. Phủ quyết nếu không muốn.
- R2-2 nghiệm thu UI (~10 phút ngồi máy): tạo issue kèm file, dán ảnh vào comment, thử file 10 MB + 1 byte trên giao diện.
- R2-1 P1 đã chốt để R3 (ghi lại để nhớ).
- PA-1 thêm quyền `companies.read` cho plugin (ngoài plan) để job biết quét company nào. Phủ quyết nếu không muốn.

## R3 — 8 câu từ BA (`plans/261010-0020-crew-v3-r3/ba/ba-report.md` mục 5). Trợ Lý TẠM theo phương án khuyên để chạy tiếp; Đại Ca phủ quyết câu nào thì em đổi.
1. UI Crew THAY HẲN UI Paperclip ở `crew.2p-solutions.com` (chép bản build vào `server/ui-dist` qua overlay, không sửa lõi, không thêm subdomain).
2. App 2P Crew trên Mac kéo hàng đợi "việc cần làm trên máy" (thêm project, v.v.); app phải đang mở thì việc mới chạy, UI hiện "Chờ app trên máy X".
3. KHÔNG có nút để board vượt cổng (ép Done, sửa reviewer/approver); chỉ Duyệt / Yêu cầu sửa / Hủy.
4. Trang Hướng dẫn có bản tiếng Anh (viết cuối R3 từ bản tiếng Việt); docs dự án vẫn chỉ tiếng Việt.
5. UI chỉ hiện company có trong cấu hình Crew; ẩn "Crew Spike Policy" (CREA); thêm company "Crew E2E" cho Playwright; R3 không có nút tạo company.
6. Chặn thêm skill trùng tên skill Superpowers đã ghim; trang Skills R3 chỉ: xem, thêm từ GitHub, bật cho agent, trạng thái sync.
7. Gỡ agent/project trên web để sau R3; R3 vẫn gỡ bằng app Mac.
8. Design system bản đầu dùng token/component của Paperclip (đổi tên, logo 2P); đổi màu thương hiệu sau.

## Lỗ hổng quyền BA phát hiện (Trợ Lý sẽ đưa vào kế hoạch R3, báo để Đại Ca biết)
- Agent `tro-ly` đang có quyền `canCreateAgents`, `canCreateSkills`; agent tạo được project qua API.

## R2-2 — nghiệm thu còn cần ngồi máy (~10 phút)
- Phần API đã ĐẠT (AC1 API, AC3–AC11; báo cáo `plans/261009-1945-crew-v3-r2-2/reports/ac-r2-2-report.md`).
- Còn: AC2 (dán ảnh `ac2-second.png` vào comment trên UI), AC5 phần UI (kéo file 10 MB + 1 byte, UI phải từ chối), một ca đính file bằng hộp thoại "New issue". Trợ Lý sẽ giao lại TPS-80 cho `tro-ly` trước khi Đại Ca dán ảnh.

## R2-3 BMAD — 5 câu (spec `docs/superpowers/specs/2026-10-10-crew-v3-r2-3-bmad-design.md` §11). Trợ Lý TẠM theo phương án khuyên.
1. BMAD chỉ lập epic/story; code từng story vẫn do executor Superpowers.
2. Trợ Lý chọn BMAD khi company có agent BMAD, là yêu cầu code, và issue gốc có nhãn `bmad` hoặc mô tả đòi rõ epic/story/PRD.
3. Owner duyệt epic/story ở bước duyệt của chính issue con BMAD.
4. Ghim BMAD bản `d009608` (6.13.0-next, kênh -next chứ không phải tag stable).
5. Agent BMAD tự chọn tiếp ở menu, chỉ hỏi owner một lượt, tối đa 30 story mỗi file.
- R3 spec §5: 7 chỗ lệch so với BA (6 ý Trợ Lý/agent tự chốt) — đọc `docs/superpowers/specs/2026-10-10-crew-v3-r3-ui-design.md` §5 và phủ quyết nếu cần. R3 ước ~12 ngày công; UI Crew chỉ lên prod khi đăng nhập, cli-auth, tạo yêu cầu, duyệt, hủy đã qua test, có mốc rollback.

## R2-4 runtime — 5 câu (spec `docs/superpowers/specs/2026-10-10-crew-v3-r2-4-runtimes-design.md` §11) + 2 việc
1. **Duyệt 3 vá adapter P5, P6, P7** (loại adapter-patch, theo dõi trong core-hooks.json). QUAN TRỌNG: adapter `opencode_local` gốc khi chạy qua SSH chạy `rm -rf "$HOME/.claude/skills"` trên Mac (xóa skill của Đại Ca mỗi run) — P6 sửa. Không duyệt P6 thì R2-4 không có OpenCode (công tắc ép tắt).
2. Bảng runtime/model theo độ khó (§6.1). 3. Điều kiện và trần fallback (tối đa 2 lần/issue; mức large không fallback). 4. Mặc định công tắc và chỉ board bật. 5. Vai trò nào được chạy Codex/OpenCode, số executor.
- Việc Đại Ca: nạp key OpenCode Go vào Keychain: `security add-generic-password -U -s crew.opencode-go -a crew -w` (lệnh tự hỏi key, không lưu lịch sử).
- Codex từng trả 400 ngày 08/10; nếu nghiệm thu còn lỗi thì phần Codex dừng.

## R2-5 docs graph/usage — 5 câu (spec `docs/superpowers/specs/2026-10-10-crew-v3-r2-5-docs-usage-design.md` §11). Trợ Lý TẠM theo khuyên.
1. Hiện ngay trong plugin bằng UI tối thiểu (module dùng lại được cho R3).
2. Ticket nối vào graph qua `crew-commit` + danh sách file đổi do Mac gửi.
3. USD hiện, có nhãn "ước tính, không phải hóa đơn".
4. Dung lượng cache file đính kèm trên Mac đưa vào bản tin máy.
5. Bảng `docs_pages` cũ giữ nguyên, không xóa.
