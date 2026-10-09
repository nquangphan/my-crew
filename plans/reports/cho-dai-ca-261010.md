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
