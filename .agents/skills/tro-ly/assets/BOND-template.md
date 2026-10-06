# Bond

## Basics
- **Name:** {user_name}
- **Call them:** {user_name}
- **Language:** {communication_language}

## Dự án
- **2P Crew** — hệ điều phối agent AI cho dự án phần mềm của Đại Ca: nhận yêu cầu trên web, agent chạy trên Mac, review, merge, đồng bộ docs. pnpm TypeScript monorepo.
- **v1/v2** (`apps/*`, `packages/*` và nhánh `codex/crew-v2-server`) là nền cũ; v2 giữ làm nguồn tham chiếu và regression, không xoá.
- **v3** đang làm: fork Paperclip theo hướng **stock-first** — Paperclip giữ issue/run/scheduler/session, Crew chỉ thêm plugin, hook một dòng và skill. Kế hoạch: `plans/261006-0805-crew-v3-stock-first/plan.md`.
- Toàn bộ UI và docs **tiếng Việt**; identifier, path, route, tên bảng giữ tiếng Anh. Giờ hiển thị Asia/Ho_Chi_Minh.

## Cách Đại Ca làm việc
- Giao việc bằng một câu, mong nhận lại việc đã xong — không muốn theo dõi từng bước, không muốn bị hỏi chọn phương pháp giữa các task.
- Thích nghe **kết luận trước**, số liệu sau. Đọc lướt.
- Nói thẳng, và muốn được cãi lại khi sai.
- Ghét vận hành chậm: chạy lại cùng một bộ test ở nhiều bước, quy trình ghi chép nặng, review đi review lại tài liệu kế hoạch.

## Những gì Đại Ca đã chốt
_Giữ ở đây để không hỏi lại. Bổ sung mỗi lần có quyết định mới._
- 06/10: v3 theo hướng stock-first. Mac nối bằng **Tailscale + SSH environment** của upstream, không tự viết gateway/transport.
- 06/10: Repo dự án **nằm trên Mac**, agent làm `in_place`.
- 06/10: Module v2 về transport/journal/ACK do upstream thay; giữ telemetry, policy, workflow registry/isolation, docs-kit, UI map.
- 06/10: **R1 mỏng** = Superpowers × Claude Code chạy xuyên suốt. BMAD, Codex/API, file/ảnh, app ký và updater sang R2.
- 06/10: Vẫn phải nâng được Paperclip theo mỗi bản stable của upstream.
- 06/10: Hook lõi Paperclip: **H2 `beforeIssueWrite`** (đầu `runUpdate` trong `issues.ts`) đã duyệt; **H1 `beforeClaim`** chỉ là dự phòng.
- 06/10: **Test theo tầng**, mỗi loại test chạy một lần ở đúng tầng.
- 06/10: Luật docs **R3 kiểm trên cả lần push**, pre-commit chỉ chặn credential (commit `96eeb745`).
- 06/10: Dự án dùng **quy trình Superpowers**.

## Things They've Asked Me to Remember
{Explicit requests — "remember that I want to..." or "keep track of..."}

## Things to Avoid
- Hỏi thứ tự tra được trong repo.
- Báo tiến độ thay cho báo kết quả.
- Tô hồng lúc đang đỏ.
- Dài dòng.
- Bắt mọi bước chạy full test hoặc ghi sổ tài nguyên/quota từng phút.
