# Memory

_Curated long-term knowledge. Aim to stay under roughly 1500 tokens, a guardrail rather than a hard gate. Raw session notes go in `sessions/YYYY-MM-DD.md` (not here). Distill insights from session logs into this file during Pulse and prune what's stale. See `references/memory-guidance.md` for full discipline._

## Tình trạng lúc chào đời
- Đọc bàn giao mới nhất trong `plans/` trước (tìm `handover*.md` mới nhất; 08/10/2026 là `plans/261008-0850-crew-v3-r1-3/handover-codex.md`). R1-1, R1-2 xong và đã push; R1-3 có plan, chưa code.
- Repo Crew nhánh `v3`; fork Paperclip `.worktrees/paperclip-v3` nhánh `v3` (gốc `v2026.1001.0`, `upstream` = paperclipai/paperclip, `origin` public, không PR upstream). Server spike `/opt/crew-v3-spike` trên VPS `nhamoiplatform`.
- DB dev của Crew: container `crew-dev-postgres` đã bị dọn ngày 06/10 (cả volume). Bản sao lưu ở `~/kidy-dumps/crew-backup/`. Cần DB thì dựng lại bằng `docker compose -f docker-compose.dev.yml up -d --wait` rồi khôi phục nếu cần dữ liệu cũ.

## Phép kiểm khởi đầu
- `[git]` Script có lệnh git ghi (commit/reset/merge): kiểm `git rev-parse --show-toplevel` đúng repo mong muốn trước khi chạy. 06/10 một script tạo worktree tạm thất bại, chạy luôn trong checkout fork và tạo 5 commit rác trên nhánh `v3` của fork.
- `[shell]` zsh không tách biến không có ngoặc thành nhiều tham số: `run.sh $pair` truyền một tham số. Gọi qua `bash -c` hoặc dùng mảng.
- `[hook]` Hook `scout-block` chặn lệnh có chuỗi `node_modules` hoặc `dist`. Chạy qua `pnpm --filter <pkg> <script>` hoặc lấy đường dẫn từ `git config --get crew-docs.bundle`; không sửa hook để né.
- `[paperclip]` Execution policy của Paperclip chỉ được áp ở REST route (`routes/issues.ts`); plugin host, native runtime và service nội bộ gọi thẳng `issueService.update` — lý do H2 tồn tại.
- `[paperclip]` Tìm code Paperclip theo tên symbol, không theo số dòng: mỗi bản stable đổi hàng trăm dòng ở `heartbeat.ts`.
