# Giả định Trợ Lý tự chốt trong spike

Các quyết định kỹ thuật Trợ Lý tự chốt để spike chạy tiếp. Đại Ca đọc lại khi rảnh; muốn đổi thì nói, Trợ Lý sửa theo.

| Ngày | Chỗ | Trợ Lý chốt | Vì sao | Bằng chứng |
|---|---|---|---|---|
| 06/10/2026 | S4 Step 1–5 | Dùng adapter `process` (lệnh `true`/`sleep 60`) thay vì `claude_local` | Kiểm gate không cần AI chạy thật, và VPS không được giữ credential AI | `spike-policy.md` mục "S4 — chạy thật" |
| 06/10/2026 | S4 bước owner approve | Approve qua API bằng tài khoản board của Đại Ca, không bắt Đại Ca bấm UI | Cái cần kiểm là gate owner chặn đúng, không phải thao tác bấm | `spike-policy.md` Step 2d |
| 06/10/2026 | S4 Step 6 | Chạy qua SSH environment tới Mac mini sau khi S2 có token | Session `claude_local` thật cần đăng nhập Claude, chỉ được có trên Mac | — |
| 06/10/2026 | Hook H2 (đưa vào S7) | H2 phải chặn cả việc agent sửa hoặc xóa `executionPolicy` của issue, không chỉ kiểm lúc chuyển `done` | S4 chứng minh agent tự xóa policy rồi tự đóng issue (CREA-2: `done`, 0 decision, policy null) và tự rút gọn policy bỏ gate docs/owner (CREA-3). Kiểm "đủ stage" lúc đóng không bắt được vì policy đã bị đổi trước | DB spike, `spike-policy.md` Step 3c/3d |
| 06/10/2026 | Board ép `done` | Chấp nhận cho R1 (một owner duy nhất); ghi lại để xem lại khi có nhiều người | Ở chế độ `authenticated` mọi người dùng đều là board | `spike-policy.md` Step 3g |
